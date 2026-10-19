"""
Minimal MCP Streamable HTTP client for calling tools on the Novada hosted MCP server
(https://mcp.novada.com/mcp) from a Dify plugin.

Dify tool plugins are plain Python — there is no MCP SDK available inside the plugin
runtime — so this client implements only what the live server actually requires, not
the full MCP Streamable HTTP transport.

Verified live against the production endpoint on 2026-10-18 (see
novada-mcp/reports/dify-marketplace-spec-2026-10-18.md §2.3) with a real API key:

  1. No `initialize` handshake is needed. The server builds a fresh Server+Transport
     per HTTP request (`sessionIdGenerator: undefined`), so a bare `tools/call`
     JSON-RPC POST succeeds on the first request. A prior implementation of this
     client ran a 3-request initialize/notifications/initialized/tools-call handshake
     with session-ID tracking — removed, it was dead weight against this endpoint.
  2. `Accept: application/json, text/event-stream` (both values, literally) is
     mandatory. `Accept: application/json` alone returns HTTP 406.
  3. The response is always plain `application/json` — the server sets
     `enableJsonResponse: true`, so no `text/event-stream` / SSE framing is ever
     returned. No SSE parser is needed.
  4. Tool-level errors are HTTP 200 with `result.isError: true` and a human-readable
     (often `agent_instruction`-bearing) message in `result.content[0].text`.
     Transport/auth errors are non-200 with a flat JSON body.
"""
from __future__ import annotations

import json
from typing import Any

import requests

BASE_URL = "https://mcp.novada.com/mcp"

# Round 1 fix (F4): must exceed the hosted function's own kill so the server's
# structured JSON-RPC result (or its own 504) always arrives before this client's
# timeout fires. Source of truth: `npm-package/src/config.ts`
# `HOSTED_FUNCTION_LIMIT_MS = 60_000` (the Vercel function wall-clock limit every
# hosted tool budget is capped under, per that file's own comment). 60s + 10s
# margin = 70s. `tests/test_timeout_coupling.py` parses that constant directly and
# fails if this stops holding (e.g. if HOSTED_FUNCTION_LIMIT_MS is ever raised
# without this also being raised).
TIMEOUT_S = 70


class NovadaMcpError(Exception):
    """
    Raised for transport-level failures: missing/rejected key, rate limiting, timeout,
    connection failure, a non-200 HTTP status, or a response body that isn't valid JSON.

    A tool-level failure (`result.isError: true`) is NOT raised as this exception — it
    is returned normally from `call_novada_tool` (`is_error=True`) so the caller can
    surface the server's own message (which often carries an `agent_instruction`)
    instead of swallowing it into a generic error.
    """


def call_novada_tool(api_key: str, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """
    Calls `tool_name` on the Novada hosted MCP server with `arguments`.

    Returns a normalized dict: {"text": str | None, "json": Any | None, "is_error": bool}.
    """
    if not api_key:
        raise NovadaMcpError(
            "Missing Novada API key. Add it in the plugin's credential settings "
            "(get one from the Novada dashboard — see this plugin's README for the link)."
        )

    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments},
    }

    try:
        resp = requests.post(
            BASE_URL,
            headers={
                "Content-Type": "application/json",
                # Both values are mandatory — verified live, HTTP 406 otherwise.
                "Accept": "application/json, text/event-stream",
                "Authorization": f"Bearer {api_key}",
            },
            data=json.dumps(body),
            timeout=TIMEOUT_S,
        )
    except requests.exceptions.Timeout as e:
        raise NovadaMcpError(
            f"Novada MCP request timed out after {TIMEOUT_S}s calling '{tool_name}'. "
            "The target site or operation may be slow; try again or narrow the request."
        ) from e
    except requests.exceptions.ConnectionError as e:
        raise NovadaMcpError(
            f"Could not connect to {BASE_URL} calling '{tool_name}'. Check network "
            "connectivity to mcp.novada.com and try again."
        ) from e
    except requests.exceptions.RequestException as e:
        raise NovadaMcpError(f"Novada MCP request failed calling '{tool_name}': {e}") from e

    if resp.status_code in (401, 403):
        raise NovadaMcpError(
            f"Novada rejected this API key (HTTP {resp.status_code}). Check your API key "
            "at the Novada dashboard (API Keys section) and update the plugin credential."
        )
    if resp.status_code == 429:
        raise NovadaMcpError(
            "Novada rate-limited this request (HTTP 429). Wait a moment before retrying, "
            "or reduce call frequency."
        )
    if resp.status_code >= 400:
        raise NovadaMcpError(
            f"Novada MCP returned HTTP {resp.status_code} for '{tool_name}': {resp.text[:500]}"
        )

    try:
        parsed = resp.json()
    except ValueError as e:
        raise NovadaMcpError(
            f"Novada MCP returned a non-JSON response for '{tool_name}' "
            f"(HTTP {resp.status_code}): {resp.text[:300]!r}"
        ) from e

    if "error" in parsed:
        # JSON-RPC protocol-level error (malformed request, protocol mismatch) —
        # distinct from a tool-level result.isError. Surfaced the same way.
        raise NovadaMcpError(
            f"Novada MCP returned a protocol error for '{tool_name}': {parsed['error']}"
        )

    result = parsed.get("result") or {}
    content = result.get("content") or []
    text_parts = [
        block.get("text", "") for block in content if isinstance(block, dict) and block.get("type") == "text"
    ]
    text = "\n".join(part for part in text_parts if part) or None
    json_value = next(
        (block.get("json") for block in content if isinstance(block, dict) and block.get("type") == "json"),
        None,
    )
    is_error = bool(result.get("isError"))

    if is_error and not text and json_value is None:
        # Never surface an empty/"undefined" message to the agent.
        text = f"Novada tool '{tool_name}' reported an error but returned no message."

    return {"text": text, "json": json_value, "is_error": is_error}
