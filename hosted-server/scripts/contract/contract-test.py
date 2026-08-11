#!/usr/bin/env python3
"""
contract-test.py <base_url>
contract-test.py --transport=stdio [path/to/npm-package/build/index.js]

Novada MCP contract invariant tests — prevents truthfulness regressions.
stdlib only. Style mirrors scripts/golden/capture-golden.py.

Two transports, one invariant suite:

    http (default) — speaks JSON-RPC over HTTP POST + SSE-framed responses
    against a DEPLOYED URL (mcp.novada.com or a local hosted-server dev
    instance). This is the original, unchanged code path.

    stdio           — speaks JSON-RPC over stdio (newline-delimited JSON, no
    Content-Length framing — see @modelcontextprotocol/sdk's
    shared/stdio.js ReadBuffer) against a SPAWNED `node <build/index.js>`
    process. This is the local surface every `npx novada-mcp` user actually
    runs, and until this transport existed it had zero dynamic contract
    coverage — only the hosted HTTP surface was ever exercised here.

Usage:
    export NOVADA_MCP_KEY=<your-key>   # or NOVADA_API_KEY
    python3 contract-test.py https://mcp.novada.com/mcp

    # Run default (FREE) set only:
    python3 contract-test.py http://localhost:4747/mcp

    # Run full set including billable invariants:
    CONTRACT_FULL=1 python3 contract-test.py http://localhost:4747/mcp

    # Run the FREE set against the LOCAL stdio server (builds must exist —
    # run `npm run build` in npm-package/ first). No real API key required:
    # a dummy test key is used automatically unless NOVADA_MCP_KEY/
    # NOVADA_API_KEY is already set in the environment. CONTRACT_FULL is
    # refused for stdio (see below) — this path never makes a billed call.
    python3 contract-test.py --transport=stdio
    python3 contract-test.py --transport=stdio /path/to/npm-package/build/index.js

    # Self-test the 429-retry/SKIP and TOW2-376/XFAIL classifiers with
    # synthetic, in-process inputs — no network, no live key, no billable
    # call. See run_self_test()'s docstring block.
    python3 contract-test.py --self-test

Exit codes:
    0  all invariants pass (skipped invariants do NOT fail; a persistent
       HTTP 429 from OUR OWN gateway rate-limiter is retried 3x then SKIPped,
       never failed — see GatewayThrottled; the 4 TOW2-376-tracked
       PARAM_HONESTY rows in KNOWN_ISSUES are XFAILed, printed as
       "KNOWN (TOW2-376)", never failed)
    1  one or more invariants fail for a reason with NO known signature
       (a genuine owned-invariant regression, or a new/unrecognized failure),
       or the transport itself could not start

Invariants — FREE set (run by default in deploy gate; also the stdio set):
    1. VERSION_AGREEMENT     — initialize.serverInfo.version == novada_setup.server_version
                               == novada_discover.server_version
                               [http + stdio — both surfaces read the same VERSION constant]
    4. ADVERTISED_CAPABILITY — every novada:// URI in tool descriptions resolves via
                               resources/list + resources/read; unknown URI returns
                               JSON-RPC top-level error (not result-wrapped)
                               [http + stdio — resources/* handlers are shared code]
    5. COST_VISIBILITY       — novada_discover carries exactly one exempt footer line;
                               no duplicate status lines
                               [http ONLY — buildStatusFooter() lives exclusively in
                               hosted-server/vercel/api/mcp.ts; npm-package/src has no
                               concept of a gateway quota footer. SKIPPED on stdio.]
    7. OAUTH_METADATA        — /.well-known/oauth-authorization-server[/mcp] and
                               /.well-known/oauth-protected-resource[/mcp] serve
                               S256-only public-client metadata rooted at the
                               origin; unauthenticated POST /mcp returns 401 with
                               a WWW-Authenticate header carrying resource_metadata=
                               [http ONLY — stdio has no HTTP surface at all. SKIPPED
                               on stdio.]
    11. ACTIONABLE_ERRORS    — every error response (tool-call OR protocol-level)
                               carries a non-empty agent_instruction line. Table-
                               driven (ACTIONABLE_ERRORS_CASES): unknown operation
                               on a known scrape platform, missing required scrape
                               param, missing required extract param — all three
                               fail in preflightScrape()/Zod validation BEFORE any
                               backend round-trip (FREE). A 4th row (unknown
                               resources/read URI) is a KNOWN GAP: readResource()
                               throws a plain Error with no agent_instruction at
                               all — EXPECTED TO FAIL, reported as a real finding,
                               never weakened to a skip.
                               [http + stdio — preflightScrape/Zod/readResource
                               are all shared npm-package/src code]

Invariants — CONTRACT_FULL=1 only (billable — costs a few cents; http only,
CONTRACT_FULL is refused outright for stdio, see StdioTransport):
    2. NO_SILENT_NOOP        — novada_proxy type=isp with country=de warns country
                               not applied; type=residential with country=de does NOT
                               emit that warning (country IS applied)
    3. NO_LYING_ZERO         — amazon scrape price fields are never 0 when another
                               price field has a real value; null is acceptable
    6. HEALTH_TRUTH          — novada_health (default) has disclaimer + no probe block
                               [FREE part — applies to BOTH http and stdio; verified:
                               novada_health is a hidden alias to novada_account(section=
                               "summary") + HEALTH_PROBE_DISCLAIMER in core.ts, identical
                               code path on both surfaces];
                               novada_health probe=true has render_probe block with
                               attempted:true; probe result agrees with entitlement
                               [CONTRACT_FULL part — billed, http only in practice since
                               CONTRACT_FULL never runs against stdio]
    8. BILLING_TRUTH         — permanent regression guard for the 2026-07-30 incident
                               (TOW2-349): a key with purchasable balance on ANY ledger
                               (wallet OR capture) is never denied service by the
                               free-gateway cap. Probes both ledgers directly; a key
                               unfunded on both is SKIPPED (test-infra state, not a
                               product lie); a funded key that still gets the cap
                               rejection ("## Free Gateway Cap Reached") FAILS.
                               [billed, http only in practice since CONTRACT_FULL
                               never runs against stdio]
    9. PARAM_HONESTY         — class-level generalization of NO_SILENT_NOOP
                               (2026-07-30, TOW2-349 postmortem round 2: a correct
                               principle fixed for ONE param pair instead of the
                               CLASS). Table-driven (PARAM_HONESTY_CASES): every
                               known tool input the server accepts syntactically
                               but does not honor semantically must be disclosed
                               — on BOTH surfaces (response body AND, separately,
                               the agent_instruction line — round-3 finding:
                               checking only "anywhere in body" was itself a
                               one-surface-not-all-surfaces bug), unless the row
                               is `agent_instruction_exempt` for a verified
                               structural reason. novada_proxy isp+country is the
                               PRECEDENT row (body-level fix live, but
                               agent_instruction_exempt — proxy.ts has zero
                               agent_instruction surface at all). novada_browser
                               country, novada_ai_monitor topics[1:], and
                               novada_extract country-on-the-static/auto-path
                               (the 4th member, coordinator-flagged in a parallel
                               round-2 code review) are the three non-exempt rows
                               — under the dual-surface check, ALL THREE now read
                               known_pending_deploy=True (novada_browser flipped
                               from a false-PASS in the round-2 draft, which only
                               checked the body). See each row's
                               `known_pending_deploy`/`agent_instruction_exempt`
                               flags for this worker's 2026-07-30 finding. The
                               table growing from 3 rows → 4 rows → a stricter
                               dual-surface assertion, mid-task, with zero new
                               code branches, is itself evidence the table-driven
                               shape is the correct fix for the class-vs-instance
                               root cause.
    10. REAL_SOURCE_URLS     — every URL surfaced by a search/research response
                               must be a direct destination, never a tracking
                               redirector. Table-driven
                               (REAL_SOURCE_URLS_FORBIDDEN_PATTERNS): bing.com/ck/a,
                               google.com/url?q=, duckduckgo.com/l/?uddg=,
                               r.msn.com. Checked against novada_search and
                               novada_research (REAL_SOURCE_URLS_CASES). The Bing
                               decode fix (utils/url.ts's decodeBingRedirect,
                               commit 7e4a296) is committed to npm-package/src but
                               NOT yet vendored into hosted-server's research.js —
                               a research-row failure is a pending-deploy finding,
                               not a code defect.
"""

import abc
import contextlib
import io
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

KEY = os.environ.get("NOVADA_MCP_KEY") or os.environ.get("NOVADA_API_KEY")

CONTRACT_FULL = os.environ.get("CONTRACT_FULL", "").strip() in ("1", "true", "yes")

# Dummy key used ONLY for the stdio transport when no real key is present in the
# environment. The FREE invariants check self-description structure (version
# strings, resource URIs, disclaimer text) — none of them require a VALID key,
# and the tools under test (novada_setup, novada_discover, novada_health) are
# all written to degrade gracefully (never throw) on an auth rejection or even
# a fully offline network — see setup.ts's validateKey() and health.ts's
# per-product .catch() handlers, both verified empirically against this exact
# dummy key while writing this harness.
STDIO_DUMMY_KEY = "nk_test_dummy_contract_key_stdio_free_invariants"


# ─── helpers ──────────────────────────────────────────────────────────────────

class SkipInvariant(Exception):
    """Raise to mark an invariant as pending implementation, or not applicable
    to the transport under test — does NOT fail the suite."""


# ─── gateway 429 self-throttle handling (nightly-canary policy, 2026-08-11) ────
# Evidence (GitHub runs 31368424384 / 31300731838 / 31469660659): the canary's
# own test key trips OUR gateway's per-IP rate limiter (rateLimitExceeded() in
# hosted-server/vercel/api/mcp.ts, HTTP 429). Before this fix, ANY invariant
# function that calls transport.rpc()/rpc_raw() directly (no local try/except)
# let the raw urllib.error.HTTPError propagate straight to run_invariants'
# generic `except Exception` handler, which logged "ERROR (invariant runner
# crashed)" and marked that invariant FAILED — and because the rate limit is a
# per-minute bucket, EVERY subsequent HTTP call in the same run hit it too,
# cascading one self-inflicted throttle into a wall of unrelated red
# invariants. A 429 from OUR OWN gateway carries zero signal about the product
# under test — it must never fail the run.
#
# GatewayThrottled is a distinct exception (not a bare RuntimeError or string
# match) so every call site — the driver loop AND the three invariants that
# run their own per-row try/except (9/10/11) — can classify it as SKIP without
# re-deriving "was this a 429" from a formatted message each time.
class GatewayThrottled(RuntimeError):
    """Raised by the HTTP helpers below when OUR OWN gateway's rate limiter
    (HTTP 429) is still active after every retry attempt. Every call site
    that catches this must treat it as SKIP, never FAIL — see module header
    comment above."""


# 3 attempts total: first attempt immediate (delay 0), then +2s, then +5s —
# short exponential-ish backoff, cheap enough not to meaningfully lengthen a
# nightly run even if every invariant hits it once.
_GATEWAY_429_BACKOFF_SECONDS = (0, 2, 5)


def _is_http_429(exc: BaseException) -> bool:
    """True if `exc` is (or, after being collapsed into a message string by
    one of the call sites below, still recognizably) an HTTP 429 from our own
    gateway. Prefers the structured `urllib.error.HTTPError.code` check;
    falls back to a string match only for the two call sites
    (_http_rpc_raw, _http_call_tool) whose EXISTING (pre-2026-08-11) contract
    already collapses the original exception into a message string before
    any caller sees it — so a raw isinstance check alone would miss them."""
    if isinstance(exc, urllib.error.HTTPError) and exc.code == 429:
        return True
    msg = str(exc)
    if "429" not in msg:
        return False
    msg_l = msg.lower()
    return "too many requests" in msg_l or "rate_limited" in msg_l or "rate limited" in msg_l


def _retry_on_429(fn, *, label: str = "request"):
    """
    Call `fn()` (a zero-arg callable performing one HTTP round-trip). If it
    raises an exception that `_is_http_429` recognizes as our own gateway's
    rate limiter, retry per `_GATEWAY_429_BACKOFF_SECONDS` (0s / 2s / 5s —
    3 attempts total). Any OTHER exception propagates immediately, unretried
    — this is a 429-specific circuit breaker, not a generic retry-everything
    wrapper, and must not mask or delay a genuine product failure.

    If still 429 after the last attempt, raises GatewayThrottled (never the
    raw HTTPError) so every caller can classify it as SKIP without
    string-sniffing.
    """
    last_exc: BaseException | None = None
    for delay in _GATEWAY_429_BACKOFF_SECONDS:
        if delay:
            time.sleep(delay)
        try:
            return fn()
        except Exception as e:
            if _is_http_429(e):
                last_exc = e
                continue
            raise
    raise GatewayThrottled(
        f"gateway 429 self-throttle after {len(_GATEWAY_429_BACKOFF_SECONDS)} "
        f"attempt(s) — infra, not product ({label}): {last_exc}"
    )


def _headers(key: str):
    return {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": "Bearer " + key,
    }


def _parse_sse(raw: str):
    """Return list of parsed JSON objects from SSE stream."""
    results = []
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("data: "):
            line = line[6:]
        if not line:
            continue
        try:
            results.append(json.loads(line))
        except Exception:
            pass
    return results


def _http_rpc(url: str, key: str, method: str, params: dict, timeout: int = 60):
    """Send a JSON-RPC request over HTTP+SSE; returns parsed result dict or raises.
    Behavior is UNCHANGED from the original single-transport implementation
    EXCEPT: a persistent HTTP 429 from our own gateway is retried with backoff
    (see _retry_on_429) and, only if still 429 after every attempt, raises
    GatewayThrottled instead of the raw HTTPError — callers/the driver loop
    classify GatewayThrottled as SKIP. Any other exception (including a
    non-429 HTTPError) propagates immediately and unretried, exactly as
    before this change."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    headers = _headers(key)

    def _do():
        req = urllib.request.Request(url, data=body, headers=headers)
        raw = urllib.request.urlopen(req, timeout=timeout).read().decode()
        objects = _parse_sse(raw)
        for o in objects:
            if "result" in o:
                return o["result"]
            if "error" in o:
                raise RuntimeError("JSON-RPC error: " + json.dumps(o["error"]))
        raise RuntimeError("no result in response: " + raw[:200])

    return _retry_on_429(_do, label=f"{method} (rpc)")


def _http_rpc_raw(url: str, key: str, method: str, params: dict, timeout: int = 60):
    """
    Send a JSON-RPC request over HTTP+SSE; returns the raw first parsed SSE object
    (may have "result" or "error" at top level — caller decides).
    Raises only on network/parse failure. UNCHANGED from the original, EXCEPT:
    a persistent HTTP 429 from our own gateway is retried with backoff (see
    _retry_on_429) and, only if still 429 after every attempt, raises
    GatewayThrottled instead of the generic "network error: ..." RuntimeError
    — callers classify GatewayThrottled as SKIP. Any other network/parse
    failure is still wrapped as "network error: ..." exactly as before.
    """
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    headers = _headers(key)

    def _do():
        req = urllib.request.Request(url, data=body, headers=headers)
        try:
            return urllib.request.urlopen(req, timeout=timeout).read().decode()
        except Exception as e:
            if _is_http_429(e):
                raise  # let _retry_on_429 see the real exception for classification
            raise RuntimeError(f"network error: {e}")

    raw = _retry_on_429(_do, label=f"{method} (rpc_raw)")
    objects = _parse_sse(raw)
    if not objects:
        raise RuntimeError("no parseable SSE objects in response: " + raw[:300])
    return objects[0], raw


def _http_call_tool(url: str, key: str, name: str, args: dict, timeout: int = 60):
    """Call tools/call over HTTP+SSE; returns (is_error, text_content).
    UNCHANGED for every case except a persistent HTTP 429 from our own
    gateway: that is retried with backoff (see _retry_on_429) and, only if
    still 429 after every attempt, RAISES GatewayThrottled instead of
    returning (True, "EXCEPTION: ..."). Every call site of call_tool() either
    lets this propagate to run_invariants' driver loop (classified SKIP) or
    catches it explicitly in its own per-row loop (invariants 9/10/11) — see
    each site. Any OTHER exception (timeout, DNS failure, non-429 HTTP
    status, ...) keeps the original, unretried, never-raises contract:
    caught and returned as (True, f"EXCEPTION: {e}")."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": name, "arguments": args}}).encode()
    headers = _headers(key)

    def _do():
        req = urllib.request.Request(url, data=body, headers=headers)
        return urllib.request.urlopen(req, timeout=timeout).read().decode()

    try:
        raw = _retry_on_429(_do, label=f"tools/call {name}")
    except GatewayThrottled:
        raise
    except Exception as e:
        return True, f"EXCEPTION: {e}"
    objects = _parse_sse(raw)
    for o in objects:
        r = o.get("result", {})
        if not r and "error" in o:
            return True, json.dumps(o["error"])
        content = r.get("content", [])
        text = content[0].get("text", "") if content else ""
        is_error = bool(r.get("isError", False))
        return is_error, text
    return True, "NO_RESPONSE: " + raw[:200]


def extract_server_version(tool_text: str) -> str | None:
    """
    Extract the value of 'server_version: <value>' from a tool output string.
    Returns None if not found.
    """
    m = re.search(r'(?m)^[\s>]*server_version:\s*(.+)$', tool_text)
    if m:
        return m.group(1).strip()
    return None


# ─── Regex for status footer lines ────────────────────────────────────────────
# Matches any of the three footer variants from buildStatusFooter() in mcp.ts:
#   "⚠ gateway: N/M free calls remaining this month · cost: unknown — see dashboard.novada.com"
#   "gateway: uncapped (paid account) · cost: unknown — see dashboard.novada.com"
#   "gateway: free call — no quota consumed"
# NOTE: this wrapper is HOSTED-ONLY (hosted-server/vercel/api/mcp.ts). It never
# runs over stdio — see invariant_5_cost_visibility's transport gate below.
_STATUS_LINE_RE = re.compile(r'(?m)^(?:⚠ )?gateway:.*$')


def count_status_lines(text: str) -> list[str]:
    """Return all status footer lines found in text."""
    return _STATUS_LINE_RE.findall(text)


# ─── ledger probe helpers (BILLING_TRUTH) ──────────────────────────────────────
# Bare developer-api host — NOT the MCP endpoint under test (mcp.novada.com or a
# local hosted-server dev instance). Same two ledgers fetchAggregateBalance()
# (hosted-server/vercel/api/_plan.ts, the 2026-07-30 fix) reads to decide the
# free-gateway-cap paid exemption.
WALLET_BALANCE_URL = "https://api-m.novada.com/v1/wallet/balance"
CAPTURE_BALANCE_URL = "https://api-m.novada.com/v1/capture/get_balance"

# Cap-rejection signature — verified against hosted-server/vercel/api/mcp.ts's
# enforceGatewayCap block: a single text content item joined with "\n" whose
# first line is exactly "## Free Gateway Cap Reached" and whose last line
# starts with "agent_instruction: free_gateway_cap_reached".
_CAP_TEXT_MARKER = "## Free Gateway Cap Reached"
_CAP_INSTRUCTION_MARKER = "agent_instruction: free_gateway_cap_reached"


def _build_multipart_body(fields: dict) -> tuple[bytes, str]:
    """
    Build a minimal `multipart/form-data` request body, stdlib only (no
    `requests`, no `form-data` — matches this script's "stdlib only"
    constraint; npm-package's equivalent, `toMultipart()` in
    _core/developer_api.ts, has the `form-data` npm dep available, this
    script does not). Returns (body_bytes, content_type_header_value).

    One `Content-Disposition: form-data; name="..."` part per field, values
    coerced to str() — sufficient for the scalar-only ledger probes below;
    no file parts needed.

    NOT a general-purpose/hardened multipart encoder: `name`/`value` are
    interpolated verbatim with no escaping, so a value containing CRLF, a
    literal `"`, or the boundary string itself would corrupt the encoding.
    Only safe for known-safe scalar test fixtures (today's only call site is
    the hardcoded `{"d": ""}` in `_probe_ledger_balance` below) — do not widen
    this to untrusted/caller-supplied input without adding escaping first.
    """
    boundary = uuid.uuid4().hex
    lines = []
    for name, value in fields.items():
        lines.append(f"--{boundary}\r\n")
        lines.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n')
        lines.append(f"{value}\r\n")
    lines.append(f"--{boundary}--\r\n")
    body = "".join(lines).encode("utf-8")
    content_type = f"multipart/form-data; boundary={boundary}"
    return body, content_type


def _probe_ledger_balance(url: str, key: str, extract_balance) -> float:
    """
    POST a `multipart/form-data` body (NOT JSON) with Bearer auth to a ledger
    balance endpoint (free read — not billed) and return the balance as a
    float via `extract_balance(parsed_json)`.

    2026-07-30 fix: this probe previously sent `Content-Type: application/json`
    with a `{}` body, which api-m.novada.com does not accept the same way as
    multipart — every OTHER caller of api-m.novada.com in this repo already
    uses multipart/form-data (see developer_api.ts's header comment: an
    earlier "JSON body" assumption there was the confirmed root cause of
    historical `code:10001 Invalid parameter` responses from
    /v1/proxy_account/*). A direct multipart probe against the same two
    endpoints was reported live-verified on 2026-07-30 with a working key:
      POST /v1/capture/get_balance  -F "d="  -> {"code":0,"data":<n>,"msg":"success"}
      POST /v1/wallet/balance       -F "d="  -> {"code":0,"data":{"balance":<n>},"msg":"success"}
    so the probe sends the same single empty-valued "d" field.

    RETRACTED (same day, verified after the fact): an earlier revision of this
    comment claimed the contract key hits a permanent `401 authentication
    failure:10000` against api-m.novada.com and that "BILLING_TRUTH will SKIP
    rather than PASS until a developer-api-authenticated key is provisioned."
    That is FALSE and was based on a transient 401 seen during a burst of
    verification traffic (most likely upstream rate limiting). Re-running this
    exact function afterwards with the same key returns capture=99993.99, and a
    full CONTRACT_FULL run reports `[8/PASS] BILLING_TRUTH: funded on
    capture=99993.98942`. The multipart fix works; the invariant ARMS.
    The retraction is kept rather than deleted because the false claim was the
    dangerous part: a plausible external attribution ("their auth is broken")
    permanently disarms a guard by convincing the next reader not to look. If
    this probe ever returns 0.0 for a key you believe is funded, re-probe by
    hand before concluding anything about the account.

    ANY failure — network error, non-200, malformed JSON, unexpected response
    shape, extractor raising — returns 0.0 rather than propagating. A probe
    failure means "treat this ledger as unfunded", never a crashed invariant
    runner — mirrors how invariant_3 isolates upstream flakiness from
    reporting-layer failures. This isolation is per-ledger: one ledger's
    probe raising has no effect on the other ledger's probe or its returned
    value — see invariant_8_billing_truth's max(wallet_balance,
    capture_balance) aggregation, which is unchanged by this fix.
    """
    body, content_type = _build_multipart_body({"d": ""})

    def _do():
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "Content-Type": content_type,
                "Authorization": "Bearer " + key,
            },
            method="POST",
        )
        return urllib.request.urlopen(req, timeout=20).read().decode()

    try:
        # A transient 429 here gets a retry budget (2026-08-11) before this
        # function's own documented "ANY failure -> 0.0" contract kicks in —
        # otherwise a throttled probe could misreport a genuinely funded
        # ledger as unfunded, turning an infra blip into a false BILLING_TRUTH
        # SKIP. The outer except Exception below is UNCHANGED: it still
        # swallows every failure (including an exhausted GatewayThrottled)
        # into 0.0, exactly as before.
        raw = _retry_on_429(_do, label=f"ledger probe {url}")
        parsed = json.loads(raw)
        return float(extract_balance(parsed))
    except Exception:
        return 0.0


def _looks_like_upstream_error(text: str) -> bool:
    """
    Heuristic shared by invariants 9/10 (new 2026-07-30): does an is_error=True
    response look like upstream/backend flakiness rather than a genuine
    contract violation? Mirrors invariant_3's inline check conceptually, kept
    as a separate function (not a refactor of invariant_3) so this change stays
    additive-only and invariant_3's existing, already-verified behavior is
    untouched.
    """
    t = text.lower()
    return (
        "timeout" in t or "upstream" in t or "backend" in t or
        "503" in text or "504" in text or "502" in text or
        "not activated" in t or "11006" in text or
        "not enabled" in t or "not available" in t
    )


_AGENT_INSTRUCTION_LINE_RE = re.compile(r'(?im)^\s*agent_instruction\s*:\s*(.+)$')


def _extract_agent_instruction_text(text: str) -> str:
    """
    Return the content of the first 'agent_instruction: ...' line in `text`,
    or '' if no such line exists.

    Used by PARAM_HONESTY (invariant 9) to check disclosure on the
    agent_instruction surface SEPARATELY from the response body as a whole —
    2026-07-30 coordinator finding: checking only "does the marker appear
    ANYWHERE in the body" let a disclosure that lives exclusively in a
    "## Warnings" block (never reaching agent_instruction) count as honest,
    even though an agent that reads only agent_instruction — our own
    agent-first convention — would still be misled. That was itself a
    class-vs-instance bug (one surface checked, not all surfaces), the same
    failure shape this whole invariant exists to catch.

    SINGLE-LINE ASSUMPTION (round 4, explicit): `_AGENT_INSTRUCTION_LINE_RE` is
    a single-line `$`-anchored match — it captures only the text up to the
    first newline after "agent_instruction:". Verified against every current
    emission site (proxy.ts, browser.ts, ai_monitor.ts, extract.ts,
    index.ts's ZodError path, _core/errors.ts's toAgentString()): all of them
    build this line as one un-wrapped string, so this is inert today. If a
    FUTURE emission site ever wraps its agent_instruction across multiple
    physical lines, this function will silently return only the first line's
    text and PARAM_HONESTY's disclosure check may under-match — fails safe
    (toward FAIL, never a false PASS, since less text can only make a marker
    harder to find, not easier), but not correct. Do not assume multi-line
    support without extending this regex first.
    """
    m = _AGENT_INSTRUCTION_LINE_RE.search(text)
    return m.group(1) if m else ""


# ─── PARAM_HONESTY case table (invariant 9) ────────────────────────────────────
# CLASS-VS-INSTANCE ROOT CAUSE (2026-07-30, TOW2-349 postmortem round 2):
# NO_SILENT_NOOP (invariant 2) hard-codes honesty for exactly ONE param pair
# (novada_proxy type=isp + country). The actual principle is "every input a
# tool accepts syntactically but does not honor semantically must be disclosed
# in the response" — a CLASS, not one param pair. novada_browser's `country`,
# novada_ai_monitor's `topics[1:]`, and novada_extract's `country` on the
# default render="auto" static/proxy path are three more members of that same
# class that went unchecked (the novada_extract member was flagged by a
# parallel code review AFTER this table's first draft shipped with only 3 rows
# — proof the class was under-enumerated, exactly the failure mode this
# table-driven shape exists to make cheap to fix: one more row, zero new code).
# This table enumerates every KNOWN member; extending coverage from here on is
# a new row, never a new code branch or a new
# invariant function.
#
# DUAL-SURFACE REQUIREMENT (2026-07-30, coordinator round 3): checking only
# "does the marker appear ANYWHERE in the response body" is itself a
# class-vs-instance bug — the same shape as the ledger/param incidents this
# invariant exists to catch. An agent that reads only `agent_instruction:`
# (our own agent-first convention, actively encouraged elsewhere in this repo)
# would still be misled by a disclosure that lives ONLY in a "## Warnings"
# body block and never reaches an agent_instruction line. So every row must
# disclose on BOTH surfaces — body text AND, separately, the content of an
# `agent_instruction:` line (see `_extract_agent_instruction_text`) — unless
# the row is explicitly marked `agent_instruction_exempt` with a verified
# structural reason (never a convenience opt-out).
#
# Row shape:
#   tool                     — MCP tool name to call
#   args                     — arguments that supply the unhonored input
#   param_note               — human-readable label of the unhonored input (report only)
#   markers                  — case-insensitive substrings; BOTH the response body
#                              AND (unless exempt) the agent_instruction line must
#                              contain AT LEAST ONE to count as an honest disclosure
#   precondition_markers     — if the response text contains ANY of these
#                              (checked unconditionally, regardless of is_error —
#                              see invariant_9's docstring for why), the row is
#                              a provisioning gap for THIS tool/key/env (missing
#                              product/creds) — SKIP, not a PARAM_HONESTY
#                              finding. Mirrors invariant_2's isp/residential
#                              precondition gate. Empty list = no such gap exists
#                              for this tool (e.g. novada_extract).
#   agent_instruction_exempt — True ONLY when this row's tool has been verified
#                              to have ZERO agent_instruction: surface anywhere
#                              in its response-building source (not just for
#                              this disclosure) — a structural fact, documented
#                              in `exemption_reason`, never a convenience
#                              downgrade. Exempt rows are checked on the body
#                              surface only.
#   exemption_reason         — required when agent_instruction_exempt is True;
#                              the verified structural reason (file(s) grepped).
#   known_pending_deploy     — True marks a row this worker's 2026-07-30 research
#                              found UNCOMMITTED (`git status` shows `M`) and/or
#                              unvendored at write time. Annotation only — it NEVER
#                              changes pass/fail logic. Every row runs the exact
#                              same assertion; a pending-deploy failure is the
#                              invariant working, not a reason to weaken the check.
PARAM_HONESTY_CASES = [
    {
        "tool": "novada_proxy",
        "args": {"type": "isp", "country": "de", "format": "url"},
        "param_note": "type=isp + country=de (country is not applied for ISP proxies)",
        # Canonical match key for _known_issue_ticket's (invariant, tool, param)
        # lookup (2026-08-11 tightening) — MUST be byte-identical to this row's
        # counterpart in KNOWN_ISSUES above, or this real, ticketed gap starts
        # hard-FAILing instead of XFAILing. See KNOWN_ISSUES's module comment.
        "param": "type=isp+country",
        "markers": ["not applied", "do not rely"],
        "precondition_markers": ["not configured", "missing environment variables"],
        # PRECEDENT — this is the exact instance NO_SILENT_NOOP (invariant 2)
        # already fences (proxy.ts, commit 2752e2b). Body-only check applies —
        # see agent_instruction_exempt below.
        "known_pending_deploy": False,
        # Verified 2026-07-30 by grep: `novada_proxy` dispatches to proxy.ts's
        # novadaProxy() (core.ts dispatch()), which has ZERO occurrences of
        # "agent_instruction" anywhere in the file — not just for this
        # disclosure, for ANY response including genuine errors ("not
        # configured" has no agent_instruction line either). The legacy
        # per-type tools (proxy_isp.ts/proxy_residential.ts) DO use an
        # "## agent_instruction" heading, but novada_proxy never routes there
        # — those files are dead code for this call path. This is a real,
        # separate gap (proxy.ts's whole error surface lacks
        # agent_instruction, arguably an ACTIONABLE_ERRORS-class issue), but
        # is OUT OF SCOPE for this invariant's assertion — documented here so
        # the exemption is never mistaken for a convenience downgrade.
        "agent_instruction_exempt": True,
        "exemption_reason": (
            "proxy.ts (the handler novada_proxy dispatches to) has zero "
            "'agent_instruction' occurrences anywhere in its source — verified "
            "by grep 2026-07-30. Structural, not per-disclosure."
        ),
    },
    {
        "tool": "novada_browser",
        "args": {
            "actions": [{"action": "navigate", "url": "https://example.com",
                         "wait_until": "domcontentloaded"}],
            "country": "de",
        },
        "param_note": "country=de (not applied to the Browser API's CDP exit node)",
        # See EDIT #1 comment on the novada_proxy row above — must exactly
        # match this tool's row in KNOWN_ISSUES.
        "param": "country (Browser API CDP exit)",
        "markers": ["not applied", "do not rely"],
        "precondition_markers": ["novada_browser_ws", "browser api", "not configured", "not entitled"],
        # Verified 2026-07-30 by reading source + vendor: browser.ts's base
        # "## Warnings" body disclosure ("... not applied ... do not rely ...")
        # is committed (2752e2b) AND already vendored — that surface alone
        # WAS treated as sufficient in this table's first draft, which is
        # exactly the bug the dual-surface requirement above fixes. The
        # SEPARATE `agent_instruction:` line for this same disclosure exists
        # ONLY in the uncommitted working tree (`git status` shows `M`) — so
        # under the dual-surface check this row now correctly reads
        # known_pending_deploy=True (flipped from False in the prior draft).
        "known_pending_deploy": True,
        "agent_instruction_exempt": False,
    },
    {
        "tool": "novada_ai_monitor",
        "args": {"brand": "novada", "topics": ["pricing", "support"]},
        "param_note": "topics[1:] ('support') — only topics[0] is queried; the rest are silently accepted and ignored",
        # See EDIT #1 comment on the novada_proxy row above — must exactly
        # match this tool's row in KNOWN_ISSUES.
        "param": "topics[1:]",
        "markers": ["not applied", "do not rely"],
        "precondition_markers": ["not configured", "not entitled"],
        # Verified 2026-07-30: BOTH the body disclosure ("topics[1..] accepted
        # but not applied ... do not rely ...") and the agent_instruction line
        # exist ONLY in the uncommitted working tree (npm-package/src/tools/
        # ai_monitor.ts, `git status` shows `M`).
        # hosted-server/vercel/vendor/novada-mcp/tools/ai_monitor.js has ZERO
        # occurrences of either. EXPECTED TO FAIL against prod on BOTH
        # surfaces until the next deploy vendors this file.
        "known_pending_deploy": True,
        "agent_instruction_exempt": False,
    },
    {
        "tool": "novada_extract",
        "args": {"url": "https://example.com", "country": "de"},
        "param_note": (
            "country=de on the default render=\"auto\" static/proxy path — "
            "extract.ts's fetchViaProxy call in the auto/static branch (around "
            "line 1050) passes no `country` field at all; `country` is wired "
            "ONLY into the render/unblocker path (extract.ts:950 and :1144)"
        ),
        # See EDIT #1 comment on the novada_proxy row above — must exactly
        # match this tool's row in KNOWN_ISSUES.
        "param": "country (render=auto/static path)",
        "markers": ["not applied", "do not rely"],
        "precondition_markers": [],
        # 4TH CLASS MEMBER — coordinator-flagged in a parallel code review
        # (2026-07-30, round 2): the tool description documents "no effect on a
        # pure static fetch" but that caveat NEVER reaches the response text
        # for a call that actually takes the static path — proving the class
        # had a member nobody had enumerated yet (exactly what this table
        # exists to catch).
        #
        # STALE-COMMENT FIX (round 4, 2026-07-30): this comment previously said
        # "`git status` on extract.ts is CLEAN — no disclosure of any kind
        # exists in source yet." That is NO LONGER TRUE — re-verified round 4:
        # `git status` now shows `M` on extract.ts, and it contains BOTH the
        # body disclosure (a `country_warning` field / summary-line text) AND
        # an `agent_instruction:` line, both containing "not applied"/"do not
        # rely" (grepped: extract.ts:361, :1709-1713, :2024-2029). The
        # underlying mechanism this row exercises (fetchViaProxy on the
        # auto/static path never forwards `country` — see param_note above) is
        # UNCHANGED; only the disclosure was added on top of it. So this row is
        # correctly FAIL-PENDING-DEPLOY (the fix exists in npm-package/src, not
        # yet vendored into hosted-server) — NOT fail-pending-implementation,
        # which is what this comment used to (incorrectly, as of round 4)
        # imply.
        "known_pending_deploy": True,
        "agent_instruction_exempt": False,
    },
]


# ─── KNOWN-ISSUE registry (nightly-canary policy layer, 2026-08-11) ────────────
# Class-not-instance registry of product gaps that are KNOWN, TICKETED, and
# deliberately allowed to keep the nightly canary GREEN instead of paging on
# every run until the underlying fix ships. Extending coverage to a NEW
# tracked-known gap is a new ROW here, never a new inline branch/if inside an
# invariant function. Row shape: {invariant, tool, param, ticket}.
#
# Today's 4 rows are exactly the PARAM_HONESTY_CASES table (invariant 9) —
# TOW2-376 tracks all four: novada_proxy (type=isp+country), novada_browser
# (country not applied to the Browser API's CDP exit), novada_ai_monitor
# (topics[1:] silently ignored), novada_extract (country not applied on the
# default render=auto/static path). A row here only downgrades the SPECIFIC
# "disclosure missing" assertion that row's invariant makes — it does NOT
# touch that invariant's OTHER failure paths (is_error with no
# provisioning/upstream signal, exceptions, ...), which stay hard failures.
# See _known_issue_ticket / invariant_9_param_honesty's XFAIL branch.
KNOWN_ISSUES = [
    {"invariant": "PARAM_HONESTY", "tool": "novada_proxy",
     "param": "type=isp+country", "ticket": "TOW2-376"},
    {"invariant": "PARAM_HONESTY", "tool": "novada_browser",
     "param": "country (Browser API CDP exit)", "ticket": "TOW2-376"},
    {"invariant": "PARAM_HONESTY", "tool": "novada_ai_monitor",
     "param": "topics[1:]", "ticket": "TOW2-376"},
    {"invariant": "PARAM_HONESTY", "tool": "novada_extract",
     "param": "country (render=auto/static path)", "ticket": "TOW2-376"},
]


def _known_issue_ticket(invariant: str, tool: str, param: str) -> str | None:
    """Return the tracking ticket for a (invariant, tool, param) triple if
    it's a registered KNOWN_ISSUES row, else None.

    TIGHTENED 2026-08-11 (review finding): matching on (invariant, tool)
    alone ignored the `param` field every KNOWN_ISSUES row already carries —
    a disclosure gap on a tool that HAS a registered row but for a
    DIFFERENT, unregistered param would have silently XFAILed under someone
    else's ticket instead of hard-failing as the new, untracked gap it
    actually is. `param` must now match exactly (same string the row's
    `param` was authored with) for a row to apply.

    A None result means "no known signature" — the caller must treat any
    resulting failure as a genuine, unswallowed FAIL, never a silent
    downgrade."""
    for row in KNOWN_ISSUES:
        if (row["invariant"] == invariant and row["tool"] == tool
                and row["param"] == param):
            return row["ticket"]
    return None


# ─── REAL_SOURCE_URLS case table (invariant 10) ────────────────────────────────
# Class: "every URL surfaced to the agent must be the direct, fetchable
# destination — never a tracking redirector the agent then has to
# base64/percent-decode by hand" (2026-07-30 field feedback on novada_research,
# fixed via utils/url.ts's decodeBingRedirect, commit 7e4a296).
# FORBIDDEN_PATTERNS enumerates the redirector shapes known across major search
# engines; extending coverage is a new pattern string, never a new code branch.
REAL_SOURCE_URLS_FORBIDDEN_PATTERNS = [
    "bing.com/ck/a",
    "google.com/url?q=",
    "duckduckgo.com/l/?uddg=",
    "r.msn.com",
]

# Row shape: {tool, args, note} — `note` records where the decode is supposed
# to live and its known deploy state as of 2026-07-30, for report context only;
# it never changes the assertion.
REAL_SOURCE_URLS_CASES = [
    {
        "tool": "novada_search",
        "args": {"query": "site:wikipedia.org python programming language", "num": 5},
        "note": (
            "search.ts calls the shared decodeBingRedirect (utils/url.ts, commit "
            "7e4a296). The vendored copy (hosted-server/vercel/vendor) still has "
            "its own older, private unwrapBingUrl that ALSO decodes ck/a — this "
            "row is expected to PASS even before the shared-util deploy lands."
        ),
    },
    {
        "tool": "novada_research",
        "args": {"question": "What is the capital of France and in what century was it founded?", "depth": "quick"},
        "note": (
            "research.ts FIX A (2026-07-30, commit 7e4a296) added the FIRST bing "
            "decode research.ts has ever had. Grepped "
            "hosted-server/vercel/vendor/novada-mcp/tools/research.js: ZERO "
            "bing-decode occurrences. A bing.com/ck/a URL surfacing here is a "
            "pending-deploy finding, not a code defect — the fix exists in "
            "npm-package/src, just not vendored yet."
        ),
    },
]

_URL_RE = re.compile(r'https?://[^\s\)\]\>"\'`]+')


def _extract_urls(text: str) -> list[str]:
    """Pull every http(s) URL substring out of a tool response's text content."""
    return _URL_RE.findall(text)


# ─── ACTIONABLE_ERRORS case table (invariant 11) ───────────────────────────────
# Class: "every error response — tool-call OR protocol-level — carries a
# non-empty agent_instruction so the agent has a parseable recovery signal
# instead of a bare error string it has to interpret itself." Table-driven so
# adding a new cheap error-triggering call is a new row, never a new invariant
# function. Every "tool" row below was verified by reading its source call
# site to fail BEFORE any backend round-trip — this invariant is FREE and runs
# in the default deploy-gate suite, not just CONTRACT_FULL.
#
# Row shape:
#   kind        — "tool" (tools/call) or "resource" (resources/read)
#   tool/uri    — the target for that kind
#   args        — tool args (kind="tool" only)
#   note        — why this call is expected to error, and which code path
#   known_gap   — True marks a row this worker's research found has NO
#                 agent_instruction at all in current source (a real,
#                 structural class gap, not a transient bug). Annotation
#                 only — never weakens the assertion; a failing known_gap row
#                 is the invariant correctly reporting a finding.
ACTIONABLE_ERRORS_CASES = [
    {
        "kind": "tool",
        "tool": "novada_scrape",
        "args": {"platform": "amazon.com", "operation": "totally_fake_operation_xyz_9000", "params": {}},
        "note": (
            "unknown operation for a KNOWN platform — preflightScrape() "
            "(scrape.ts, detail='preflight:unknown_operation') rejects before "
            "any backend round-trip"
        ),
        "known_gap": False,
    },
    {
        "kind": "tool",
        "tool": "novada_scrape",
        "args": {"platform": "amazon.com", "operation": "amazon_product_asin", "params": {}},
        "note": (
            "known operation, missing its required 'asin' param — "
            "preflightScrape() (detail='preflight:missing_param') rejects "
            "before any backend round-trip"
        ),
        "known_gap": False,
    },
    {
        "kind": "tool",
        "tool": "novada_extract",
        "args": {},
        "note": (
            "missing required 'url' — rejected by Zod schema validation "
            "(ExtractParamsSchema) in index.ts's CallToolRequestSchema handler, "
            "before dispatch() ever runs"
        ),
        "known_gap": False,
    },
    {
        "kind": "resource",
        "uri": "novada://does-not-exist",
        "note": (
            "unknown resource URI — resources/index.ts's readResource() throws "
            "a plain Error('Unknown resource URI: ... Available: ...') with NO "
            "agent_instruction field at all. The agent_instruction convention "
            "was built for tool-call errors (index.ts's ZodError catch + "
            "NovadaError.toAgentString()) and was never extended to "
            "protocol-level resource errors — a real class gap."
        ),
        "known_gap": True,
    },
]

_AGENT_INSTRUCTION_RE = re.compile(r'agent_instruction\s*:\s*\S')


# ─── Transport abstraction ─────────────────────────────────────────────────────
# The invariant functions below only ever call transport.rpc / transport.rpc_raw
# / transport.call_tool — they have no idea whether they're talking to a
# deployed HTTP+SSE endpoint or a spawned local stdio process. This is what
# lets the SAME 7 invariants run against BOTH surfaces without duplicating any
# invariant logic. Two capability flags (has_http_surface, has_gateway_cost_footer)
# let the couple of genuinely HOSTED-ONLY invariants (OAUTH_METADATA,
# COST_VISIBILITY) skip themselves cleanly instead of failing on a surface that
# was never supposed to have them.

class Transport(abc.ABC):
    label: str = "transport"
    has_http_surface: bool = False
    has_gateway_cost_footer: bool = False

    @abc.abstractmethod
    def rpc(self, method: str, params: dict, timeout: int = 60) -> dict:
        """Send a JSON-RPC request; return the parsed `result` dict or raise."""

    @abc.abstractmethod
    def rpc_raw(self, method: str, params: dict, timeout: int = 60):
        """Send a JSON-RPC request; return (raw_top_level_object, raw_text)."""

    @abc.abstractmethod
    def call_tool(self, name: str, args: dict, timeout: int = 60):
        """Call tools/call; return (is_error, text_content)."""

    def close(self) -> None:
        """Release any transport-owned resources (process, connection, ...)."""


class HttpSseTransport(Transport):
    """Wraps the original, unmodified HTTP+SSE request functions. Behavior is
    byte-for-byte identical to the pre-refactor single-transport script."""

    has_http_surface = True
    has_gateway_cost_footer = True

    def __init__(self, base_url: str, key: str):
        self.url = base_url.rstrip("/")
        self.origin = self.url.rsplit("/mcp", 1)[0]
        self.key = key
        self.label = f"http+sse ({self.url})"

    def rpc(self, method, params, timeout=60):
        return _http_rpc(self.url, self.key, method, params, timeout)

    def rpc_raw(self, method, params, timeout=60):
        return _http_rpc_raw(self.url, self.key, method, params, timeout)

    def call_tool(self, name, args, timeout=60):
        return _http_call_tool(self.url, self.key, name, args, timeout)

    def get_json(self, url: str):
        """GET url → (parsed_dict, None) on success, (None, reason) on any failure.
        HTTP-only capability used exclusively by invariant 7. A persistent 429
        gets the same retry budget as every other HTTP call site (2026-08-11)
        before falling into the unchanged "GET failed: ..." failure shape —
        invariant 7 is gated behind CONTRACT_OAUTH=1 and off by default in the
        nightly canary, so its own failure classification is intentionally
        left as-is here; only the retry is added."""
        def _do():
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            return urllib.request.urlopen(req, timeout=30).read().decode()
        try:
            raw = _retry_on_429(_do, label=f"GET {url}")
        except Exception as e:
            return None, f"GET failed: {e}"
        try:
            parsed = json.loads(raw)
        except Exception:
            return None, f"response is not JSON (first 200 chars): {raw[:200]!r}"
        if not isinstance(parsed, dict):
            return None, f"response JSON is not an object (first 200 chars): {raw[:200]!r}"
        return parsed, None


class StdioTransport(Transport):
    """
    Speaks MCP JSON-RPC over stdio to a spawned `node <build/index.js>` process.

    Framing: newline-delimited JSON, ONE object per line, no Content-Length
    headers (unlike LSP) — confirmed against @modelcontextprotocol/sdk's
    shared/stdio.js: ReadBuffer.readMessage() splits the buffer on '\\n' and
    serializeMessage() is just `JSON.stringify(message) + '\\n'`.

    Error path (traced, not hand-waved): if `node <entry>` doesn't exist, isn't
    executable, or the server crashes/never responds during the handshake, this
    constructor raises RuntimeError within `spawn_timeout` seconds — it never
    hangs. Every subsequent rpc()/call_tool() call is ALSO bounded by its own
    timeout + a liveness check (`self.proc.poll()`), so a mid-run crash surfaces
    as a clear error (with the process's stderr tail attached) instead of the
    harness hanging on a read that will never arrive.
    """

    has_http_surface = False
    has_gateway_cost_footer = False

    def __init__(self, entry_path: str, api_key: str, spawn_timeout: float = 15.0):
        self.entry_path = entry_path
        self.label = f"stdio (node {entry_path})"
        self._id_counter = 0
        self._id_lock = threading.Lock()
        self._stderr_lines: list[str] = []
        self._EOF = object()

        if not os.path.isfile(entry_path):
            raise RuntimeError(
                f"stdio transport: build entry not found at {entry_path!r}. "
                f"Run `npm run build` in npm-package/ first (this harness never builds "
                f"for you), or pass the correct path as the second CLI argument."
            )

        env = dict(os.environ)
        env["NOVADA_API_KEY"] = api_key
        # Never let a stray operator env var accidentally unlock a billed developer
        # path during the stdio FREE run — the stdio transport is FREE-invariant-only.
        env.pop("NOVADA_DEVELOPER_API_KEY", None)

        try:
            self.proc = subprocess.Popen(
                ["node", entry_path],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                env=env,
            )
        except Exception as e:
            raise RuntimeError(f"stdio transport: failed to spawn `node {entry_path}`: {e}")

        self._out_queue: "queue.Queue" = queue.Queue()
        self._reader = threading.Thread(target=self._read_stdout_loop, daemon=True)
        self._reader.start()
        self._stderr_reader = threading.Thread(target=self._read_stderr_loop, daemon=True)
        self._stderr_reader.start()

        # Handshake: initialize, THEN notifications/initialized (mirrors a real
        # MCP client). The server's Server class has no gate that requires this
        # notification before serving other requests (verified against
        # @modelcontextprotocol/sdk's Server._oninitialize — it is a pure,
        # idempotent function with no session-state side effect), but sending it
        # keeps this harness honest about what a real client does.
        try:
            init_result = self._request("initialize", {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "contract-test-stdio", "version": "1.0.0"},
            }, timeout=spawn_timeout)
        except Exception as e:
            self.close(force=True)
            # `e` already carries a full _death_message() (stderr tail + exit code) when
            # it originates from _request's own timeout/EOF/write-failure paths — don't
            # wrap it a second time (that just duplicates the stderr tail in the output).
            raise RuntimeError(f"server did not complete initialize handshake: {e}")

        if "error" in init_result:
            self.close(force=True)
            raise RuntimeError(
                f"stdio transport: initialize returned a JSON-RPC error: {init_result['error']}"
            )

        self._notify("notifications/initialized", {})
        self._init_result = init_result.get("result", {})

    # ── low-level plumbing ─────────────────────────────────────────────────

    def _next_id(self) -> int:
        with self._id_lock:
            self._id_counter += 1
            return self._id_counter

    def _read_stdout_loop(self) -> None:
        try:
            assert self.proc.stdout is not None
            for line in self.proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                self._out_queue.put(obj)
        except Exception:
            pass
        finally:
            self._out_queue.put(self._EOF)

    def _read_stderr_loop(self) -> None:
        try:
            assert self.proc.stderr is not None
            for line in self.proc.stderr:
                self._stderr_lines.append(line.rstrip("\n"))
                if len(self._stderr_lines) > 200:
                    self._stderr_lines.pop(0)
        except Exception:
            pass

    def _death_message(self, context: str) -> str:
        exit_code = self.proc.poll()
        tail = "\n".join(self._stderr_lines[-20:])
        return (
            f"stdio transport: {context} (process exit code: {exit_code!r})\n"
            f"  stderr tail:\n{tail}"
        )

    def _write(self, obj: dict) -> None:
        assert self.proc.stdin is not None
        line = json.dumps(obj) + "\n"
        try:
            self.proc.stdin.write(line)
            self.proc.stdin.flush()
        except Exception as e:
            raise RuntimeError(self._death_message(f"failed to write to child stdin: {e}"))

    def _notify(self, method: str, params: dict) -> None:
        self._write({"jsonrpc": "2.0", "method": method, "params": params})

    def _request(self, method: str, params: dict, timeout: float = 60) -> dict:
        """Send a request and return the raw top-level JSON-RPC envelope
        (`{"result": ...}` or `{"error": ...}`). Bounded by `timeout` — never
        hangs: polls the response queue in short slices so a dead process is
        noticed promptly rather than only after the full timeout elapses."""
        req_id = self._next_id()
        self._write({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params})

        deadline = time.time() + timeout
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                if self.proc.poll() is not None:
                    raise RuntimeError(self._death_message(f"process exited while waiting for {method!r}"))
                raise RuntimeError(
                    f"stdio transport: timed out after {timeout}s waiting for response to {method!r} "
                    f"(process still alive — server may be hung)"
                )
            try:
                obj = self._out_queue.get(timeout=min(remaining, 1.0))
            except queue.Empty:
                if self.proc.poll() is not None:
                    raise RuntimeError(self._death_message(f"process exited while waiting for {method!r}"))
                continue
            if obj is self._EOF:
                raise RuntimeError(self._death_message(f"stdout closed while waiting for {method!r}"))
            if obj.get("id") == req_id:
                return obj
            # Notification or a response to a stale/unrelated id — ignore and keep waiting.

    # ── Transport interface ────────────────────────────────────────────────

    def rpc(self, method, params, timeout=60):
        obj = self._request(method, params, timeout)
        if "result" in obj:
            return obj["result"]
        if "error" in obj:
            raise RuntimeError("JSON-RPC error: " + json.dumps(obj["error"]))
        raise RuntimeError(f"no result in response: {json.dumps(obj)[:200]}")

    def rpc_raw(self, method, params, timeout=60):
        obj = self._request(method, params, timeout)
        return obj, json.dumps(obj)

    def call_tool(self, name, args, timeout=60):
        try:
            obj = self._request("tools/call", {"name": name, "arguments": args}, timeout)
        except Exception as e:
            return True, f"EXCEPTION: {e}"
        r = obj.get("result", {})
        if not r and "error" in obj:
            return True, json.dumps(obj["error"])
        content = r.get("content", [])
        text = content[0].get("text", "") if content else ""
        is_error = bool(r.get("isError", False))
        return is_error, text

    def close(self, force: bool = False) -> None:
        proc = getattr(self, "proc", None)
        if proc is None:
            return
        try:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)
        except Exception:
            pass


# ─── invariant implementations ────────────────────────────────────────────────
# Every invariant function now takes a `transport: Transport` instead of a raw
# `url: str`, and calls transport.rpc / transport.rpc_raw / transport.call_tool.
# This is the ONLY change to invariants 1/2/3/4/6 — their pass/fail logic is
# untouched. Invariants 5 and 7 gained an early transport-capability check
# (SkipInvariant) because they test a HOSTED-ONLY concept that structurally
# cannot exist on the other surface — see each function's docstring.

def invariant_1_version_agreement(transport: Transport) -> list[str]:
    """
    INVARIANT 1 — VERSION_AGREEMENT [FREE — http + stdio]:
    The version string must be identical on every surface that reports it:
      (a) initialize -> serverInfo.version
      (b) novada_setup output -> 'server_version: <value>' line
      (c) novada_discover output -> '> server_version: <value>' line

    A confident wrong value is worse than no field (principle from owner handoff).
    This invariant catches the specific regression where mcp.ts HOSTED_VERSION and
    the vendored setup.ts VERSION constant diverge after a deploy.

    Applies identically to stdio: setup.ts / discover.ts read
    `process.env.NOVADA_SERVER_VERSION ?? VERSION` and initialize's
    serverInfo.version reads the same VERSION constant (src/config.ts) — no
    NOVADA_SERVER_VERSION override exists in stdio mode, so all three
    necessarily agree unless the build is broken.
    """
    failures = []

    # (a) initialize
    init_result = transport.rpc("initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "contract-test", "version": "1.0.0"},
    })
    server_info_version = init_result.get("serverInfo", {}).get("version")
    if not server_info_version:
        failures.append("INVARIANT_1[initialize]: serverInfo.version is missing or empty")
        return failures  # can't compare if canonical is absent

    # (b) novada_setup
    is_err_setup, setup_text = transport.call_tool("novada_setup", {})
    setup_version = extract_server_version(setup_text)
    if setup_version is None:
        failures.append(
            f"INVARIANT_1[novada_setup]: 'server_version:' line not found in output.\n"
            f"  setup output (first 300 chars): {setup_text[:300]!r}"
        )
    elif setup_version != server_info_version:
        failures.append(
            f"INVARIANT_1[novada_setup]: server_version mismatch.\n"
            f"  surface: novada_setup\n"
            f"  reported: {setup_version!r}\n"
            f"  expected: {server_info_version!r}  (from initialize.serverInfo.version)"
        )

    # (c) novada_discover
    is_err_disc, discover_text = transport.call_tool("novada_discover", {})
    discover_version = extract_server_version(discover_text)
    if discover_version is None:
        failures.append(
            f"INVARIANT_1[novada_discover]: 'server_version:' line not found in output.\n"
            f"  discover output (first 300 chars): {discover_text[:300]!r}"
        )
    elif discover_version != server_info_version:
        failures.append(
            f"INVARIANT_1[novada_discover]: server_version mismatch.\n"
            f"  surface: novada_discover\n"
            f"  reported: {discover_version!r}\n"
            f"  expected: {server_info_version!r}  (from initialize.serverInfo.version)"
        )

    if not failures:
        print(f"  [1/PASS] VERSION_AGREEMENT: all 3 surfaces agree → {server_info_version!r}")
    else:
        print(f"  [1/FAIL] VERSION_AGREEMENT: canonical={server_info_version!r}  "
              f"setup={setup_version!r}  discover={discover_version!r}")

    return failures


def _proxy_not_configured(text: str) -> bool:
    """
    True if a novada_proxy response is an honest "not configured" precondition
    declaration (missing NOVADA_PROXY_* env vars for the account/key under
    test) rather than a served response that could exhibit — or hide — a
    silent-noop bug. The tool never reached the point where the
    country-not-applied disclosure would apply, so this is an account/env
    provisioning gap, not evidence either way about NO_SILENT_NOOP.
    """
    return ("not configured" in text) and ("Missing environment variables" in text)


def invariant_2_no_silent_noop(transport: Transport) -> list[str]:
    """
    INVARIANT 2 — NO_SILENT_NOOP [CONTRACT_FULL only — billable]:
    When country= is passed to novada_proxy with type=isp, the tool MUST warn the
    caller that the parameter is accepted but NOT applied.  The warning text must
    contain the canonical phrase "not applied" or "do not rely".

    For type=residential with country=de the country IS applied and the tool must NOT
    emit a country-not-applied warning — residential actually routes through the
    requested country.

    Rationale: the proxy.ts source on this branch changed the ISP warning from
    "silently ignored" to "not applied … do not rely" (commit 2752e2b).  This invariant
    fences that the build+vendor reflect the source and the hosted server serves the
    corrected, honest phrasing.

    This invariant costs one proxy credential fetch — cheap but technically billable.
    CONTRACT_FULL never runs against stdio (see StdioTransport / main()), so in
    practice this only ever executes against the http transport, but the logic
    itself is transport-agnostic (novada_proxy exists identically on both surfaces).

    Precondition gate (2026-07-30, TOW2-349 round 2 — nightly false-red fix): if
    novada_proxy honestly reports itself unconfigured for the account under test
    ("not configured" + "Missing environment variables: NOVADA_PROXY_...") for a
    given sub-check, that sub-check never reached the point where the
    country-not-applied disclosure applies at all — an account/env provisioning
    gap, not a silent-noop lie. Each sub-check (isp+country, residential+country)
    is evaluated independently: a not-configured response for that sub-check is
    reported as a SKIP-style line and does NOT count as a failure. A configured
    proxy that still silently ignores country is unaffected and still FAILS.
    """
    if not CONTRACT_FULL:
        raise SkipInvariant("CONTRACT_FULL=1 not set — billable invariant skipped")

    failures = []
    isp_skipped = False
    res_skipped = False

    # ── ISP + country → MUST contain warning ──────────────────────────────────
    is_err_isp, isp_text = transport.call_tool("novada_proxy", {
        "type": "isp",
        "country": "de",
        "format": "url",
    })
    if is_err_isp:
        # Upstream error fetching proxy creds — the proxy tool may fail for accounts
        # that don't have the product configured. Only fail if the response contains no
        # warning at all; a cred-error before the warning block IS a real gap.
        print(f"  [2] novada_proxy ISP returned is_error=True: {isp_text[:200]!r}")

    if _proxy_not_configured(isp_text):
        isp_skipped = True
        print(
            "  [2] SKIP[isp+country]: proxy not provisioned for the contract "
            "key/env — precondition not met, not a silent-noop violation."
        )
    else:
        # Accept either canonical phrase.
        isp_warned = ("not applied" in isp_text) or ("do not rely" in isp_text)
        if not isp_warned:
            failures.append(
                f"INVARIANT_2[isp+country]: response must contain 'not applied' or 'do not rely' "
                f"when type=isp + country=de is passed.\n"
                f"  actual (first 400 chars): {isp_text[:400]!r}"
            )

    # ── Residential + country → must NOT contain the warning ──────────────────
    is_err_res, res_text = transport.call_tool("novada_proxy", {
        "type": "residential",
        "country": "de",
        "format": "url",
    })
    if _proxy_not_configured(res_text):
        res_skipped = True
        print(
            "  [2] SKIP[residential+country]: proxy not provisioned for the "
            "contract key/env — precondition not met, not a silent-noop violation."
        )
    else:
        res_warned = ("not applied" in res_text) or ("do not rely" in res_text)
        if res_warned:
            failures.append(
                f"INVARIANT_2[residential+country]: residential proxy must NOT emit a "
                f"country-not-applied warning (country IS applied for residential).\n"
                f"  actual (first 400 chars): {res_text[:400]!r}"
            )

    if not failures:
        if isp_skipped or res_skipped:
            print(
                f"  [2/PASS] NO_SILENT_NOOP: no violations "
                f"(isp {'skipped' if isp_skipped else 'checked, warned'}; "
                f"residential {'skipped' if res_skipped else 'checked, no warning'})."
            )
        else:
            print(f"  [2/PASS] NO_SILENT_NOOP: ISP emitted warning; residential did not.")
    else:
        print(f"  [2/FAIL] NO_SILENT_NOOP: see failures above.")

    return failures


def invariant_3_no_lying_zero(transport: Transport) -> list[str]:
    """
    INVARIANT 3 — NO_LYING_ZERO [CONTRACT_FULL only — billable]:
    For a known stable Amazon ASIN (B07FZ8S74R — Amazon Echo Dot, consistently
    listed), call novada_scrape with format=json and inspect the returned records.

    For every record, for every *price* field in the record:
      - null / None is ACCEPTABLE (price unknown / not parsed)
      - a real numeric price (> 0) is ACCEPTABLE
      - literal 0 (integer or float) is NOT ACCEPTABLE when another price field
        in the same record has a real (> 0) value — that's a silent zeroing

    Upstream flakiness (timeout, backend error, rate-limit) → SKIP with reason.
    This invariant tests our reporting layer, not Amazon uptime.
    """
    if not CONTRACT_FULL:
        raise SkipInvariant("CONTRACT_FULL=1 not set — billable invariant skipped")

    failures = []

    # Use a stable ASIN: Amazon Echo Dot (4th Gen).
    ASIN = "B07FZ8S74R"

    is_err, text = transport.call_tool("novada_scrape", {
        "platform": "amazon.com",
        "operation": "amazon_product_asin",
        "params": {"asin": ASIN},
        "format": "json",
    }, timeout=90)

    if is_err:
        # Distinguish upstream vs configuration errors.
        upstream_signals = (
            "timeout" in text.lower() or
            "upstream" in text.lower() or
            "backend" in text.lower() or
            "503" in text or
            "504" in text or
            "502" in text or
            "not activated" in text.lower() or
            "11006" in text
        )
        if upstream_signals:
            raise SkipInvariant(
                f"novada_scrape returned upstream/backend error — SKIP (not a reporting-layer failure): "
                f"{text[:200]!r}"
            )
        # Configuration error or unexpected tool error → fail
        failures.append(
            f"INVARIANT_3[scrape]: tool call failed with is_error=True and no obvious upstream signal.\n"
            f"  error (first 300 chars): {text[:300]!r}"
        )
        return failures

    # Parse JSON from the response.  The text is a ## Scrape Results fenced block.
    records = []
    try:
        # Try to find the JSON block inside ```json ... ```
        m = re.search(r'```json\s*(.*?)\s*```', text, re.DOTALL)
        if m:
            raw_json = m.group(1)
        else:
            # Fallback: try parsing the whole text as JSON
            raw_json = text
        parsed = json.loads(raw_json)
        # Normalise: list at top level, or {"data": [...]} or just a dict
        if isinstance(parsed, list):
            records = parsed
        elif isinstance(parsed, dict):
            for key in ("data", "records", "results", "items"):
                if isinstance(parsed.get(key), list):
                    records = parsed[key]
                    break
            if not records:
                records = [parsed]
    except Exception as e:
        raise SkipInvariant(
            f"novada_scrape response is not parseable JSON — SKIP (parse error, not a reporting-layer failure): "
            f"{e!r}  raw (first 200 chars): {text[:200]!r}"
        )

    if not records:
        raise SkipInvariant(
            "novada_scrape returned 0 records — SKIP (empty upstream result, not a reporting-layer failure)"
        )

    # Price field names as used in Amazon scrape responses.
    PRICE_FIELDS = [
        "price", "final_price", "initial_price",
        "sale_price", "list_price", "original_price",
        "current_price", "unit_price",
    ]

    for idx, rec in enumerate(records):
        if not isinstance(rec, dict):
            continue
        price_values = {}
        for field in PRICE_FIELDS:
            val = rec.get(field)
            if val is not None:
                price_values[field] = val

        if len(price_values) < 2:
            # Only 0 or 1 price fields — can't check cross-field consistency.
            continue

        real_price_fields = {k: v for k, v in price_values.items()
                             if isinstance(v, (int, float)) and v > 0}
        zero_price_fields = {k: v for k, v in price_values.items()
                             if isinstance(v, (int, float)) and v == 0}

        if real_price_fields and zero_price_fields:
            failures.append(
                f"INVARIANT_3[record #{idx}]: price field(s) silently zeroed while other "
                f"price field(s) have real values.\n"
                f"  zeroed fields: {zero_price_fields}\n"
                f"  real fields:   {real_price_fields}"
            )

    if not failures:
        print(f"  [3/PASS] NO_LYING_ZERO: checked {len(records)} record(s) — no silent zeros found.")
    else:
        print(f"  [3/FAIL] NO_LYING_ZERO: {len(failures)} record(s) with silent-zero price fields.")

    return failures


def invariant_4_advertised_capability(transport: Transport) -> list[str]:
    """
    INVARIANT 4 — ADVERTISED_CAPABILITY [FREE — http + stdio]:

    Part A — URI coverage:
      tools/list → extract every novada:// URI mentioned in any tool description
      resources/list → collect served URIs
      Every advertised URI must appear in resources/list AND resources/read must
      return non-empty content.

    Part B — Error format fence:
      resources/read of "novada://does-not-exist" must return a JSON-RPC top-level
      error (object with "error" key, no "result" key) — NOT a result-wrapped error
      object ({ "result": { "error": ... } }).
      This fences the McpError throw fix (commit 25c6daf).

    Applies identically to stdio: resources/list + resources/read are handled by
    the SAME src/resources/index.ts code the hosted server vendors — verified
    empirically (6 resources served, unknown URI returns a top-level JSON-RPC
    error, both surfaces).
    """
    failures = []

    # ── Fetch tools/list ────────────────────────────────────────────────────────
    tools_result = transport.rpc("tools/list", {})
    tools = tools_result.get("tools", [])
    if not tools:
        failures.append("INVARIANT_4[tools/list]: returned 0 tools — cannot scan descriptions.")
        return failures

    # Collect all novada:// URIs mentioned in any tool description or inputSchema.
    advertised_uris: set[str] = set()
    URI_RE = re.compile(r'novada://[a-zA-Z0-9_\-]+')
    for t in tools:
        desc = t.get("description", "")
        advertised_uris.update(URI_RE.findall(desc))
        # Also scan annotations / inputSchema if present.
        schema_str = json.dumps(t.get("inputSchema", {}))
        advertised_uris.update(URI_RE.findall(schema_str))

    # ── Fetch resources/list ────────────────────────────────────────────────────
    resources_result = transport.rpc("resources/list", {})
    served_uris: set[str] = {r["uri"] for r in resources_result.get("resources", [])}

    if not served_uris:
        failures.append("INVARIANT_4[resources/list]: returned 0 resources — cannot verify coverage.")

    # ── Part A: every advertised URI must be served ────────────────────────────
    for uri in sorted(advertised_uris):
        if uri not in served_uris:
            failures.append(
                f"INVARIANT_4[coverage]: URI {uri!r} is mentioned in a tool description "
                f"but not in resources/list."
            )
            continue

        # resources/read must return non-empty content.
        try:
            read_result = transport.rpc("resources/read", {"uri": uri})
        except GatewayThrottled as e:
            print(f"  [4] SKIP[{uri}]: {e}")
            continue
        except RuntimeError as e:
            failures.append(
                f"INVARIANT_4[read]: resources/read({uri!r}) returned JSON-RPC error "
                f"(should succeed for advertised URIs): {e}"
            )
            continue

        contents = read_result.get("contents", [])
        if not contents:
            failures.append(
                f"INVARIANT_4[read]: resources/read({uri!r}) returned empty contents list."
            )
            continue
        text = contents[0].get("text", "")
        if not text or len(text.strip()) == 0:
            failures.append(
                f"INVARIANT_4[read]: resources/read({uri!r}) returned non-empty contents "
                f"but text is blank."
            )

    # ── Part B: unknown URI must return JSON-RPC top-level error ───────────────
    FAKE_URI = "novada://does-not-exist"
    try:
        obj, raw = transport.rpc_raw("resources/read", {"uri": FAKE_URI})
    except GatewayThrottled as e:
        print(f"  [4] SKIP[error-format]: {e}")
    except RuntimeError as e:
        failures.append(
            f"INVARIANT_4[error-format]: network/parse error fetching unknown URI: {e}"
        )
    else:
        has_top_level_error = "error" in obj and "result" not in obj
        has_result_wrapped  = "result" in obj and isinstance(obj.get("result"), dict) and \
                              "error" in obj.get("result", {})

        if has_result_wrapped:
            failures.append(
                f"INVARIANT_4[error-format]: resources/read({FAKE_URI!r}) returned a "
                f"result-wrapped error — should be a top-level JSON-RPC error instead.\n"
                f"  response: {json.dumps(obj)[:300]!r}"
            )
        elif not has_top_level_error:
            failures.append(
                f"INVARIANT_4[error-format]: resources/read({FAKE_URI!r}) returned neither "
                f"a top-level error nor a result-wrapped error.\n"
                f"  response: {json.dumps(obj)[:300]!r}"
            )
        # else: top-level error present — correct

    if not failures:
        print(
            f"  [4/PASS] ADVERTISED_CAPABILITY: {len(advertised_uris)} URI(s) advertised "
            f"({', '.join(sorted(advertised_uris))}); all served + readable; "
            f"unknown URI returns top-level error."
        )
    else:
        print(f"  [4/FAIL] ADVERTISED_CAPABILITY: {len(failures)} check(s) failed.")

    return failures


def invariant_5_cost_visibility(transport: Transport) -> list[str]:
    """
    INVARIANT 5 — COST_VISIBILITY [FREE default + CONTRACT_FULL — http ONLY]:

    FREE part:
      novada_discover response must contain exactly ONE status footer line, and that
      line must be the exempt variant:
        "gateway: free call — no quota consumed"
      No duplicate status lines are allowed.

    CONTRACT_FULL part:
      novada_search {query: "test", num: 1} must contain exactly ONE status footer
      line. That line must contain "cost: unknown".  It must NOT contain a fabricated
      cost number (no pattern like "cost: $N.NN" or "cost: 0.00XX").

    HOSTED-ONLY: `buildStatusFooter()` (the sole source of every "gateway: ..."
    line this invariant looks for) is defined exclusively in
    hosted-server/vercel/api/mcp.ts. npm-package/src has zero occurrences of
    "gateway:" or "buildStatusFooter" (grepped) — the stdio surface has no
    concept of a monthly free-call quota or a cost footer at all. Confirmed
    empirically: novada_discover over stdio emits zero "gateway:" lines.
    Skips cleanly on stdio rather than failing on a concept that was never
    supposed to exist there.
    """
    if not transport.has_gateway_cost_footer:
        raise SkipInvariant(
            f"{transport.label}: buildStatusFooter()/gateway cost-footer is a hosted-only "
            f"wrapper (hosted-server/vercel/api/mcp.ts) — SKIP (not applicable, not a gap)"
        )

    failures = []

    # ── FREE: novada_discover → exempt footer, no duplicates ──────────────────
    is_err_disc, discover_text = transport.call_tool("novada_discover", {})
    if is_err_disc:
        failures.append(
            f"INVARIANT_5[discover]: novada_discover returned is_error=True.\n"
            f"  error (first 300 chars): {discover_text[:300]!r}"
        )
    else:
        lines = count_status_lines(discover_text)
        if len(lines) != 1:
            failures.append(
                f"INVARIANT_5[discover]: expected exactly 1 status footer line, "
                f"got {len(lines)}.\n  lines: {lines}"
            )
        else:
            line = lines[0]
            if "free call — no quota consumed" not in line:
                failures.append(
                    f"INVARIANT_5[discover]: status line is NOT the exempt variant.\n"
                    f"  expected: 'gateway: free call — no quota consumed'\n"
                    f"  actual:   {line!r}"
                )

    # ── CONTRACT_FULL: novada_search → truthful quota/cost footer ─────────────
    if CONTRACT_FULL:
        is_err_search, search_text = transport.call_tool("novada_search", {
            "query": "test",
            "num": 1,
        }, timeout=90)

        if is_err_search:
            # Could be SERP not enabled on this key — skip rather than fail.
            serp_not_enabled = (
                "not enabled" in search_text.lower() or
                "not activated" in search_text.lower() or
                "not available" in search_text.lower()
            )
            if serp_not_enabled:
                print(f"  [5] novada_search SERP not enabled on this key — CONTRACT_FULL part skipped.")
            else:
                failures.append(
                    f"INVARIANT_5[search]: novada_search returned is_error=True.\n"
                    f"  error (first 300 chars): {search_text[:300]!r}"
                )
        else:
            lines = count_status_lines(search_text)
            if len(lines) != 1:
                failures.append(
                    f"INVARIANT_5[search]: expected exactly 1 status footer line, "
                    f"got {len(lines)}.\n  lines: {lines}"
                )
            else:
                line = lines[0]
                if "cost: unknown" not in line:
                    failures.append(
                        f"INVARIANT_5[search]: status footer must contain 'cost: unknown'.\n"
                        f"  actual: {line!r}"
                    )
                # Check for fabricated cost number: "cost: $N.NN" or "cost: N.NNNN"
                if re.search(r'cost:\s+\$?\d+\.\d+', line):
                    failures.append(
                        f"INVARIANT_5[search]: status footer contains a fabricated cost "
                        f"number — must be 'cost: unknown'.\n  actual: {line!r}"
                    )

    if not failures:
        msg = "FREE: discover exempt footer ✓"
        if CONTRACT_FULL:
            msg += "; CONTRACT_FULL: search cost:unknown ✓"
        print(f"  [5/PASS] COST_VISIBILITY: {msg}")
    else:
        print(f"  [5/FAIL] COST_VISIBILITY: {len(failures)} check(s) failed.")

    return failures


def invariant_6_health_truth(transport: Transport) -> list[str]:
    """
    INVARIANT 6 — HEALTH_TRUTH [FREE default part — http + stdio; CONTRACT_FULL
    probe part — billable, http only in practice]:

    FREE (default):
      novada_health {} must contain the entitlement-only disclaimer
        "does NOT verify live render capability"
      AND must NOT contain a render_probe block (no "render_probe:" line,
      no "attempted: true" line).

    Applies identically to stdio: novada_health is a hidden alias that routes to
    novadaAccount(section="summary") + HEALTH_PROBE_DISCLAIMER in core.ts — the
    SAME dispatch code the hosted server vendors. Verified empirically with a
    dummy key over stdio: the disclaimer renders and no probe block appears,
    because every per-product fetch inside novadaAccount/novadaHealth is wrapped
    in try/catch and degrades to an "error" status row rather than throwing —
    this invariant needs no valid key or reachable network to pass structurally.

    CONTRACT_FULL (probe):
      novada_health {probe: true} must:
        - contain "render_probe:" section
        - contain "attempted: true"
        - contain the billing disclosure ("billed" or "probe performed")
        - contain "ok:" with a boolean value
        - if ok: true, the entitlement card must not simultaneously claim
          render/browser is "not_entitled" or "not_configured" (those would
          contradict the probe success)
        - if ok: false, the response must not claim healthy render capability
          anywhere OUTSIDE the probe section
    """
    failures = []

    # ── FREE part: default health call ────────────────────────────────────────
    is_err_default, default_text = transport.call_tool("novada_health", {})
    if is_err_default:
        failures.append(
            f"INVARIANT_6[health-default]: novada_health returned is_error=True.\n"
            f"  error (first 300 chars): {default_text[:300]!r}"
        )
    else:
        disclaimer_present = "does NOT verify live render capability" in default_text
        if not disclaimer_present:
            failures.append(
                f"INVARIANT_6[health-default]: missing disclaimer "
                f"'does NOT verify live render capability'.\n"
                f"  first 500 chars: {default_text[:500]!r}"
            )

        # Must NOT have a render_probe block when probe was not requested.
        has_probe_block = (
            "render_probe:" in default_text or
            "attempted: true" in default_text
        )
        if has_probe_block:
            failures.append(
                f"INVARIANT_6[health-default]: response contains render_probe block "
                f"but probe=true was not requested — tool performed a billed probe "
                f"without opt-in.\n"
                f"  first 500 chars: {default_text[:500]!r}"
            )

    # ── CONTRACT_FULL part: probe=true ────────────────────────────────────────
    if CONTRACT_FULL:
        is_err_probe, probe_text = transport.call_tool("novada_health", {"probe": True}, timeout=90)
        if is_err_probe:
            failures.append(
                f"INVARIANT_6[health-probe]: novada_health probe=true returned is_error=True.\n"
                f"  error (first 300 chars): {probe_text[:300]!r}"
            )
        else:
            # Must have render_probe section.
            if "render_probe:" not in probe_text:
                failures.append(
                    f"INVARIANT_6[health-probe]: missing 'render_probe:' section.\n"
                    f"  first 600 chars: {probe_text[:600]!r}"
                )

            if "attempted: true" not in probe_text:
                failures.append(
                    f"INVARIANT_6[health-probe]: missing 'attempted: true' in probe section.\n"
                    f"  first 600 chars: {probe_text[:600]!r}"
                )

            # Must contain billing disclosure.
            billing_disclosed = ("billed" in probe_text.lower() or
                                 "probe performed" in probe_text.lower())
            if not billing_disclosed:
                failures.append(
                    f"INVARIANT_6[health-probe]: billing disclosure missing "
                    f"('billed' or 'probe performed' not found).\n"
                    f"  first 600 chars: {probe_text[:600]!r}"
                )

            # Extract ok: true/false from probe section.
            ok_match = re.search(r'(?m)^\s*ok:\s*(true|false)\s*$', probe_text)
            if not ok_match:
                failures.append(
                    f"INVARIANT_6[health-probe]: missing 'ok: true/false' line.\n"
                    f"  first 600 chars: {probe_text[:600]!r}"
                )
            else:
                probe_ok = ok_match.group(1) == "true"

                if probe_ok:
                    # ok: true → entitlement must not CONTRADICT this.
                    # "not_entitled" or "not_configured" in the Browser/Unblock product row
                    # alongside ok:true would be a contradiction.
                    # We only flag if both "not_entitled"/"not_configured" AND the probe
                    # is for render/unblock (which it is — health.ts calls fetchWithRender).
                    contradictions = (
                        ("not_entitled" in probe_text and
                         "Browser API" in probe_text) or
                        ("not_configured" in probe_text and
                         "Browser API" in probe_text)
                    )
                    if contradictions:
                        failures.append(
                            f"INVARIANT_6[health-probe]: probe ok=true but entitlement card "
                            f"claims Browser API is not_entitled/not_configured — contradiction.\n"
                            f"  first 800 chars: {probe_text[:800]!r}"
                        )
                else:
                    # ok: false → response must NOT claim render/browser is healthy
                    # OUTSIDE the probe section itself.
                    # Strip out the render_probe section before checking.
                    probe_start = probe_text.find("render_probe:")
                    pre_probe = probe_text[:probe_start] if probe_start != -1 else probe_text
                    if "✅ Available" in pre_probe and "Browser" in pre_probe:
                        failures.append(
                            f"INVARIANT_6[health-probe]: probe ok=false but entitlement "
                            f"card claims Browser API is Available — contradiction.\n"
                            f"  pre-probe section: {pre_probe[:600]!r}"
                        )

    if not failures:
        msg = "FREE: default has disclaimer, no probe block"
        if CONTRACT_FULL:
            msg += "; CONTRACT_FULL: probe block present with attempted/ok/billing"
        print(f"  [6/PASS] HEALTH_TRUTH: {msg}")
    else:
        print(f"  [6/FAIL] HEALTH_TRUTH: {len(failures)} check(s) failed.")

    return failures


def invariant_7_oauth_metadata(transport: Transport) -> list[str]:
    """
    INVARIANT 7 — OAUTH_METADATA [FREE — http ONLY]:

    OAuth 2.0 discovery surface (Firecrawl parity — RFC 8414 + RFC 9728):

    Part A — authorization-server metadata:
      GET <origin>/.well-known/oauth-authorization-server (and the /mcp variant)
      must return JSON where issuer == origin, PKCE is S256-only, only public
      clients are supported (token_endpoint_auth_methods_supported == ["none"]),
      and the authorization/token/registration endpoints are rooted at the issuer.

    Part B — protected-resource metadata:
      GET <origin>/.well-known/oauth-protected-resource (and the /mcp variant)
      must return JSON where authorization_servers == [origin] and resource
      ends with /mcp (both discovery paths must agree on the MCP endpoint).

    Part C — 401 discovery trigger:
      An unauthenticated POST to the MCP endpoint must return 401 with a
      WWW-Authenticate header containing "resource_metadata=" — this is how
      OAuth-capable MCP clients bootstrap discovery.

    On a server where OAuth is not yet deployed, every check fails cleanly
    (reported as failures, never a crash) and the suite verdict is FAIL.

    HOSTED-ONLY: a spawned stdio process has no HTTP listener at all — there is
    no origin, no well-known path, no 401 response to check. Skips cleanly on
    stdio rather than failing on a surface that structurally cannot serve
    OAuth discovery metadata.
    """
    # DEPLOYMENT GATE (2026-07-27): the OAuth discovery surface ships with the
    # feat/oauth-keyless branch, which is NOT yet deployed to prod (owner-gated).
    # Until it deploys, this invariant tests an aspiration, not the contract —
    # every nightly canary run failed on it, which is alert fatigue, not signal
    # (owner call, same day: red must mean NEW breakage). Set CONTRACT_OAUTH=1
    # to re-enable ahead of the deploy; DELETE this gate once oauth-keyless is
    # live so the invariant becomes a hard guard again.
    if os.environ.get("CONTRACT_OAUTH", "").strip() not in ("1", "true", "yes"):
        raise SkipInvariant(
            "feat/oauth-keyless not yet deployed to prod — OAuth discovery "
            "invariant gated behind CONTRACT_OAUTH=1 until it ships"
        )
    if not transport.has_http_surface:
        raise SkipInvariant(
            f"{transport.label}: no HTTP surface — OAuth discovery (/.well-known/...) is a "
            f"hosted-only concept (stdio has no listening socket at all) — SKIP (not applicable)"
        )

    failures = []
    url = transport.url
    origin = transport.origin

    def get_json(u: str):
        return transport.get_json(u)

    # ── Part A: authorization-server metadata (bare + /mcp variant) ────────────
    for path in ("/.well-known/oauth-authorization-server",
                 "/.well-known/oauth-authorization-server/mcp"):
        meta, err = get_json(origin + path)
        if err:
            failures.append(f"INVARIANT_7[as-metadata {path}]: {err}")
            continue
        issuer = meta.get("issuer")
        if issuer != origin:
            failures.append(
                f"INVARIANT_7[as-metadata {path}]: issuer mismatch.\n"
                f"  reported: {issuer!r}\n"
                f"  expected: {origin!r}  (derived from target URL)"
            )
        if meta.get("code_challenge_methods_supported") != ["S256"]:
            failures.append(
                f"INVARIANT_7[as-metadata {path}]: code_challenge_methods_supported "
                f"must be exactly ['S256'] (PKCE mandatory, no 'plain').\n"
                f"  actual: {meta.get('code_challenge_methods_supported')!r}"
            )
        if meta.get("token_endpoint_auth_methods_supported") != ["none"]:
            failures.append(
                f"INVARIANT_7[as-metadata {path}]: token_endpoint_auth_methods_supported "
                f"must be exactly ['none'] (public clients only).\n"
                f"  actual: {meta.get('token_endpoint_auth_methods_supported')!r}"
            )
        base = issuer if isinstance(issuer, str) and issuer else origin
        for ep in ("authorization_endpoint", "token_endpoint", "registration_endpoint"):
            val = meta.get(ep)
            if not isinstance(val, str) or not val.startswith(base):
                failures.append(
                    f"INVARIANT_7[as-metadata {path}]: {ep} missing or not rooted at issuer.\n"
                    f"  actual: {val!r}\n"
                    f"  issuer: {base!r}"
                )

    # ── Part B: protected-resource metadata (bare + /mcp variant) ──────────────
    for path in ("/.well-known/oauth-protected-resource",
                 "/.well-known/oauth-protected-resource/mcp"):
        meta, err = get_json(origin + path)
        if err:
            failures.append(f"INVARIANT_7[pr-metadata {path}]: {err}")
            continue
        if meta.get("authorization_servers") != [origin]:
            failures.append(
                f"INVARIANT_7[pr-metadata {path}]: authorization_servers must be "
                f"exactly [{origin!r}].\n"
                f"  actual: {meta.get('authorization_servers')!r}"
            )
        resource = meta.get("resource")
        if not isinstance(resource, str) or not resource.endswith("/mcp"):
            failures.append(
                f"INVARIANT_7[pr-metadata {path}]: resource must end with '/mcp' "
                f"(the MCP endpoint IS the resource).\n"
                f"  actual: {resource!r}"
            )

    # ── Part C: unauthenticated 401 carries the discovery pointer ──────────────
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                       "params": {}}).encode()
    # Deliberately NO Authorization header — the 401 path is the point.
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    })
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        failures.append(
            f"INVARIANT_7[401-trigger]: unauthenticated POST returned "
            f"HTTP {resp.status} — expected 401."
        )
    except urllib.error.HTTPError as e:
        if e.code != 401:
            failures.append(
                f"INVARIANT_7[401-trigger]: unauthenticated POST returned "
                f"HTTP {e.code} — expected 401."
            )
        else:
            www_auth = e.headers.get("WWW-Authenticate") or ""
            if "resource_metadata=" not in www_auth:
                failures.append(
                    f"INVARIANT_7[401-trigger]: 401 response is missing the "
                    f"'resource_metadata=' pointer in WWW-Authenticate — OAuth "
                    f"clients cannot bootstrap discovery.\n"
                    f"  WWW-Authenticate: {www_auth!r}"
                )
    except Exception as e:
        failures.append(f"INVARIANT_7[401-trigger]: network error: {e}")

    if not failures:
        print("  [7/PASS] OAUTH_METADATA: AS + PR metadata correct on all 4 discovery "
              "paths; unauthenticated 401 carries resource_metadata= pointer.")
    else:
        print(f"  [7/FAIL] OAUTH_METADATA: {len(failures)} check(s) failed.")

    return failures


def invariant_8_billing_truth(transport: Transport) -> list[str]:
    """
    INVARIANT 8 — BILLING_TRUTH [CONTRACT_FULL only — billable; http only in
    practice since CONTRACT_FULL is refused outright for stdio, see StdioTransport]:

    Permanent regression guard for the 2026-07-30 incident (TOW2-349): the
    hosted gateway's free-gateway-cap paid-exemption check once read ONLY the
    master wallet ledger to decide whether a key was "paid" — so a key funded
    exclusively on the capture ledger (where Scraping Solutions money actually
    lives; wallet is a pass-through and legitimately sits near 0 for paying
    customers — pay -> wallet (transit) -> buy products -> money lives in
    product/plan credits) got capped as if it were free. Fixed via
    fetchAggregateBalance() (hosted-server/vercel/api/_plan.ts), which queries
    both ledgers and takes their max.

    Invariant: "a key with purchasable balance on ANY ledger is never denied
    service."

    Steps:
      1. Probe both ledgers directly (free reads, NOT billed) with the contract
         key: wallet balance (data.balance) and capture balance (data is a bare
         number). Either probe failing/malformed degrades to 0 for that ledger
         — see _probe_ledger_balance — never crashes the runner.
      2. If neither ledger shows a positive balance, SKIP — an unfunded
         contract key is a test-infra state, not a product lie; this invariant
         cannot distinguish "correctly capped" from "regression" without a
         funded key.
      3. If funded on at least one ledger, make ONE cheap billable MCP call
         (novada_search, num=1, trivial query). If the response matches the
         free-gateway-cap rejection signature → FAIL: this is exactly the
         2026-07-30 regression class. is_error for any OTHER reason (upstream
         flake, SERP not enabled, etc.) is NOT a BILLING_TRUTH failure — this
         invariant tests the gate, not upstream availability — reported as an
         inconclusive SKIP with the error head instead. Success (no cap
         rejection) → PASS.
    """
    if not CONTRACT_FULL:
        raise SkipInvariant("CONTRACT_FULL=1 not set — billable invariant skipped")

    failures = []

    wallet_balance = _probe_ledger_balance(
        WALLET_BALANCE_URL, KEY, lambda p: p.get("data", {}).get("balance", 0)
    )
    capture_balance = _probe_ledger_balance(
        CAPTURE_BALANCE_URL, KEY, lambda p: p.get("data", 0)
    )

    funded_ledgers = []
    if wallet_balance > 0:
        funded_ledgers.append(f"wallet={wallet_balance}")
    if capture_balance > 0:
        funded_ledgers.append(f"capture={capture_balance}")

    if max(wallet_balance, capture_balance) <= 0:
        raise SkipInvariant(
            "contract key not funded on any ledger — provision a funded key to "
            "arm BILLING_TRUTH"
        )

    is_err, text = transport.call_tool("novada_search", {
        "query": "test",
        "num": 1,
    }, timeout=90)

    if is_err:
        is_cap_rejection = (
            text.strip().startswith(_CAP_TEXT_MARKER) and
            _CAP_INSTRUCTION_MARKER in text
        )
        if is_cap_rejection:
            failures.append(
                f"INVARIANT_8[cap-rejection]: funded key (ledgers: {', '.join(funded_ledgers)}) "
                f"was denied service by the free-gateway-cap gate — this is the 2026-07-30 "
                f"ledger-split regression class (TOW2-349): the gate must check ALL ledgers, "
                f"not just wallet.\n"
                f"  response (first 400 chars): {text[:400]!r}"
            )
            print(f"  [8/FAIL] BILLING_TRUTH: {len(failures)} check(s) failed.")
            return failures
        raise SkipInvariant(
            f"novada_search returned is_error=True for a reason unrelated to the "
            f"free-gateway-cap gate — inconclusive, not a BILLING_TRUTH failure "
            f"(this invariant tests the gate, not upstream availability).\n"
            f"  error (first 300 chars): {text[:300]!r}"
        )

    print(
        f"  [8/PASS] BILLING_TRUTH: funded on {', '.join(funded_ledgers)} — "
        f"novada_search was NOT denied by the free-gateway-cap gate."
    )
    return failures


def invariant_9_param_honesty(transport: Transport) -> list[str]:
    """
    INVARIANT 9 — PARAM_HONESTY [CONTRACT_FULL only — billable]:

    Class-level generalization of NO_SILENT_NOOP (invariant 2). See
    PARAM_HONESTY_CASES's module-level comment for the 2026-07-30
    class-vs-instance root cause this invariant fences. For each row: call
    `tool` with `args`; the response must disclose that the row's input was
    accepted but not honored — and, per the 2026-07-30 round-3 coordinator
    finding below, it must disclose this on BOTH surfaces, not just one.

    DUAL-SURFACE ASSERTION (2026-07-30, round 3): checking only "does a
    marker appear ANYWHERE in the response body" is itself a class-vs-instance
    bug — one surface (body) checked, not all surfaces a real caller might
    read. An agent that reads only `agent_instruction:` (this repo's own
    agent-first convention) would be misled by a disclosure that lives
    exclusively in a body block (e.g. "## Warnings") and never reaches
    agent_instruction. So, unless a row is `agent_instruction_exempt` (a
    verified structural fact about that tool, documented in
    `exemption_reason` — never a convenience opt-out), disclosure requires
    BOTH: at least one marker anywhere in the full response text, AND at
    least one marker inside the specific text captured by
    `_extract_agent_instruction_text` (the content of an `agent_instruction:`
    line, if any).

    Per-row isolation (Worker Done-Definition — a raising row must not crash
    the suite):
      - a raised exception on the tool call is recorded as a failure for that
        row only; every other row still runs.
      - a response whose text matches `precondition_markers` is a provisioning
        gap for THAT row (missing product/creds on the contract key/env) —
        SKIP, not a failure. This check is UNCONDITIONAL on is_error, exactly
        mirroring invariant_2's `_proxy_not_configured` gate: a "not
        configured" precondition response is not guaranteed to set
        is_error=True (verified empirically 2026-07-30 — novada_proxy's
        not-configured response for this contract key returns is_error=False;
        gating the precondition check inside `if is_err:` was a real bug in
        an earlier draft of this function that produced a false PARAM_HONESTY
        failure on the precedent row).
      - is_error=True with no precondition match is upstream flakiness, not a
        PARAM_HONESTY finding — SKIP (see _looks_like_upstream_error).
      - is_error=True with neither a precondition nor an upstream signal, or
        is_error=False with the dual-surface check failing → FAIL, regardless
        of `known_pending_deploy`. That flag is report-only context; the
        assertion is identical for every non-exempt row, and a pending-deploy
        failure is the invariant working correctly (2026-07-30 handoff: never
        weaken this to reach green).

    novada_proxy's row is the PRECEDENT for the underlying (body-level)
    disclosure and is `agent_instruction_exempt` (proxy.ts genuinely has zero
    agent_instruction surface — see the row's comment). novada_browser,
    novada_ai_monitor, and novada_extract are NOT exempt: under the
    dual-surface check, novada_browser now correctly reads
    known_pending_deploy=True too (its body-only disclosure was previously
    scored as a false PASS — exactly the failure shape this round-3 fix
    closes). See each row's comment in PARAM_HONESTY_CASES for this worker's
    2026-07-30 finding on deploy state.
    """
    if not CONTRACT_FULL:
        raise SkipInvariant("CONTRACT_FULL=1 not set — billable invariant skipped")

    failures = []
    passed_rows = []
    skipped_rows = []
    xfailed_rows = []

    for case in PARAM_HONESTY_CASES:
        tool = case["tool"]
        try:
            is_err, text = transport.call_tool(tool, case["args"], timeout=90)
        except GatewayThrottled as e:
            skipped_rows.append(tool)
            print(f"  [9] SKIP[{tool}]: {e}")
            continue
        except Exception as e:
            failures.append(
                f"INVARIANT_9[{tool}]: tool call raised an exception instead of "
                f"returning a result — {e!r}"
            )
            continue

        text_l = text.lower()

        # Precondition gate FIRST, unconditional on is_error — see the
        # docstring note above on why this must not be nested inside
        # `if is_err:`. An empty precondition_markers list (e.g. novada_extract,
        # which has no comparable "not configured" concept) makes `any([])`
        # False, so this simply never matches for that row.
        if case["precondition_markers"] and any(m in text_l for m in case["precondition_markers"]):
            skipped_rows.append(tool)
            print(
                f"  [9] SKIP[{tool}]: not provisioned for the contract key/env — "
                f"precondition not met, not a PARAM_HONESTY finding."
            )
            continue

        if is_err:
            if _looks_like_upstream_error(text):
                skipped_rows.append(tool)
                print(f"  [9] SKIP[{tool}]: upstream/backend error — {text[:150]!r}")
                continue
            failures.append(
                f"INVARIANT_9[{tool}]: is_error=True with no provisioning/upstream "
                f"signal — {case['param_note']}.\n"
                f"  actual (first 400 chars): {text[:400]!r}"
            )
            continue

        body_disclosed = any(m in text_l for m in case["markers"])
        exempt = case.get("agent_instruction_exempt", False)

        if exempt:
            disclosed = body_disclosed
            instruction_disclosed = None  # not applicable — never checked for an exempt row
        else:
            instruction_text_l = _extract_agent_instruction_text(text).lower()
            instruction_disclosed = any(m in instruction_text_l for m in case["markers"])
            disclosed = body_disclosed and instruction_disclosed

        if not disclosed:
            pending = " [KNOWN PENDING DEPLOY — see 2026-07-30 handoff]" if case["known_pending_deploy"] else ""
            if exempt:
                surface_note = (
                    f"(body-only check — agent_instruction_exempt: "
                    f"{case.get('exemption_reason', 'no reason recorded')})"
                )
            else:
                missing = []
                if not body_disclosed:
                    missing.append("response body")
                if not instruction_disclosed:
                    missing.append("agent_instruction line")
                surface_note = f"(missing on: {', '.join(missing)})"
            detail = (
                f"PARAM_HONESTY[{tool}]: response does not disclose that "
                f"{case['param_note']} is not honored {surface_note}.{pending}\n"
                f"  expected one of: {case['markers']}\n"
                f"  actual (first 400 chars): {text[:400]!r}"
            )
            # 2026-08-11 nightly-canary policy: a disclosure-missing failure on
            # a row registered in KNOWN_ISSUES is a TICKETED, already-known
            # product gap — the check still RAN and still DETECTED the exact
            # signature, it is just downgraded from FAIL to XFAIL so a known,
            # tracked gap doesn't page every night. This does NOT touch the
            # is_error/exception branches above (still hard failures for an
            # unswallowed unknown signature) and does NOT apply to any row
            # absent from KNOWN_ISSUES — a brand-new disclosure gap on a row
            # with no ticket still hard-fails, exactly as before.
            ticket = _known_issue_ticket("PARAM_HONESTY", tool, case["param"])
            if ticket:
                xfailed_rows.append(tool)
                print(f"  [9] XFAIL: KNOWN ({ticket}) — {tool}: {case['param_note']}")
                for line in detail.splitlines():
                    print(f"      {line}")
            else:
                failures.append(detail)
        else:
            passed_rows.append(tool)

    if not failures:
        print(
            f"  [9/PASS] PARAM_HONESTY: {len(passed_rows)} row(s) disclosed honestly "
            f"({passed_rows}); {len(skipped_rows)} row(s) skipped (not provisioned/"
            f"upstream/429); {len(xfailed_rows)} row(s) XFAILed as KNOWN ({xfailed_rows})."
        )
    else:
        print(f"  [9/FAIL] PARAM_HONESTY: {len(failures)} row(s) failed to disclose "
              f"with no known-issue ticket.")

    return failures


def invariant_10_real_source_urls(transport: Transport) -> list[str]:
    """
    INVARIANT 10 — REAL_SOURCE_URLS [CONTRACT_FULL only — billable]:

    Class-level guard: every URL a search/research response hands to the agent
    must be a direct, fetchable destination — never a tracking redirector the
    agent then has to decode by hand (2026-07-30, commit 7e4a296). See
    REAL_SOURCE_URLS_CASES / REAL_SOURCE_URLS_FORBIDDEN_PATTERNS's module-level
    comments for the full table.

    For each row: call `tool`, extract every http(s) URL from the response
    text (_extract_urls), and fail if ANY extracted URL contains ANY forbidden
    redirector pattern. is_error=True rows that look like upstream flakiness
    are SKIPPED (this invariant tests our reporting layer's URL hygiene, not
    upstream SERP availability) and a row with zero URLs is also skipped
    (nothing to check) — never silently counted as a pass.

    See each row's `note` for this worker's 2026-07-30 deploy-state finding —
    a failure on the novada_research row is EXPECTED (research.ts's decode is
    committed to npm-package/src but not yet vendored into hosted-server) and
    must be reported as a pending-deploy finding, never silently downgraded to
    a skip.
    """
    if not CONTRACT_FULL:
        raise SkipInvariant("CONTRACT_FULL=1 not set — billable invariant skipped")

    failures = []
    checked_rows = []

    for case in REAL_SOURCE_URLS_CASES:
        tool = case["tool"]
        try:
            is_err, text = transport.call_tool(tool, case["args"], timeout=150)
        except GatewayThrottled as e:
            print(f"  [10] SKIP[{tool}]: {e}")
            continue
        except Exception as e:
            failures.append(
                f"INVARIANT_10[{tool}]: tool call raised an exception instead of "
                f"returning a result — {e!r}"
            )
            continue

        if is_err:
            if _looks_like_upstream_error(text):
                print(f"  [10] SKIP[{tool}]: upstream/backend error — {text[:150]!r}")
                continue
            failures.append(
                f"INVARIANT_10[{tool}]: is_error=True with no upstream signal.\n"
                f"  error (first 300 chars): {text[:300]!r}"
            )
            continue

        urls = _extract_urls(text)
        if not urls:
            print(f"  [10] SKIP[{tool}]: response contained 0 URLs to check.")
            continue

        checked_rows.append(tool)
        offenders = [(u, p) for u in urls for p in REAL_SOURCE_URLS_FORBIDDEN_PATTERNS if p in u]
        if offenders:
            failures.append(
                f"INVARIANT_10[{tool}]: {len(offenders)} URL(s) matched a forbidden "
                f"tracking-redirector pattern instead of the direct destination.\n"
                f"  {case['note']}\n"
                f"  offenders (first 5): {offenders[:5]}"
            )

    if not checked_rows and not failures:
        raise SkipInvariant(
            "no row produced any URL to check (all rows skipped) — inconclusive, not a pass"
        )

    if not failures:
        print(f"  [10/PASS] REAL_SOURCE_URLS: {len(checked_rows)} row(s) checked, "
              f"no tracking-redirector URLs found.")
    else:
        print(f"  [10/FAIL] REAL_SOURCE_URLS: {len(failures)} row(s) surfaced "
              f"redirector URLs.")

    return failures


def invariant_11_actionable_errors(transport: Transport) -> list[str]:
    """
    INVARIANT 11 — ACTIONABLE_ERRORS [FREE — http + stdio]:

    Class-level guard: every error response carries a non-empty
    `agent_instruction` line. See ACTIONABLE_ERRORS_CASES's module-level
    comment for the full table. No row makes a billed backend call — every
    "tool" row's error path was verified by reading its source call site
    (preflightScrape() in scrape.ts, Zod .parse() in types.ts) to run BEFORE
    any network request; resources/read is a local lookup against RESOURCES.

    Each row must produce is_error=True (tool rows) or a JSON-RPC error
    (resource row) whose text contains a non-empty `agent_instruction:` line.
    A row that unexpectedly succeeds is also a failure — the whole point of
    the row is to exercise a known error path.

    The resources/read row is a KNOWN GAP (see ACTIONABLE_ERRORS_CASES) and is
    EXPECTED TO FAIL: readResource()'s plain Error has no agent_instruction at
    all. That failure is the invariant correctly reporting a real, un-fixed
    inconsistency in the class — never downgraded to a skip.

    Applies identically to stdio: preflightScrape, Zod validation, and
    readResource all live in npm-package/src — the SAME code the hosted server
    vendors, with no HTTP-only wrapper involved in any of these four paths.
    """
    failures = []
    passed_rows = []

    for case in ACTIONABLE_ERRORS_CASES:
        if case["kind"] == "tool":
            tool = case["tool"]
            try:
                is_err, text = transport.call_tool(tool, case["args"], timeout=30)
            except GatewayThrottled as e:
                print(f"  [11] SKIP[{tool}]: {e}")
                continue
            except Exception as e:
                failures.append(
                    f"INVARIANT_11[{tool}]: tool call raised an exception instead "
                    f"of returning a result — {e!r}"
                )
                continue

            if not is_err:
                failures.append(
                    f"INVARIANT_11[{tool}]: expected an error response ({case['note']}) "
                    f"but got is_error=False.\n"
                    f"  actual (first 300 chars): {text[:300]!r}"
                )
                continue

            if not _AGENT_INSTRUCTION_RE.search(text):
                gap = "  [KNOWN GAP]" if case.get("known_gap") else ""
                failures.append(
                    f"INVARIANT_11[{tool}]: error response has no non-empty "
                    f"'agent_instruction:' line ({case['note']}).{gap}\n"
                    f"  actual (first 400 chars): {text[:400]!r}"
                )
            else:
                passed_rows.append(tool)

        elif case["kind"] == "resource":
            uri = case["uri"]
            try:
                obj, raw = transport.rpc_raw("resources/read", {"uri": uri})
            except GatewayThrottled as e:
                print(f"  [11] SKIP[resources/read {uri}]: {e}")
                continue
            except Exception as e:
                # Round 4 (coordinator finding): was `except RuntimeError` — the
                # only per-row branch in this diff that didn't match the
                # `except Exception` isolation contract every other row (and
                # this row's own docstring) advertises. Both Transport impls'
                # rpc_raw only ever raise RuntimeError today, so this was inert
                # in practice, but it would silently become a real
                # suite-crashing masking bug the moment a second resource row
                # is appended after this one and something else raises.
                failures.append(
                    f"INVARIANT_11[resources/read {uri}]: network/parse error: {e}"
                )
                continue

            err = obj.get("error")
            if err is None and isinstance(obj.get("result"), dict):
                err = obj["result"].get("error")
            message = err.get("message", "") if isinstance(err, dict) else str(err or "")

            if not err:
                failures.append(
                    f"INVARIANT_11[resources/read {uri}]: expected a JSON-RPC error "
                    f"for an unknown URI but got none.\n"
                    f"  response (first 300 chars): {json.dumps(obj)[:300]!r}"
                )
            elif not _AGENT_INSTRUCTION_RE.search(message):
                gap = "  [KNOWN GAP]" if case.get("known_gap") else ""
                failures.append(
                    f"INVARIANT_11[resources/read {uri}]: error message has no "
                    f"non-empty 'agent_instruction:' text ({case['note']}).{gap}\n"
                    f"  message: {message[:400]!r}"
                )
            else:
                passed_rows.append(f"resources/read {uri}")

    if not failures:
        print(f"  [11/PASS] ACTIONABLE_ERRORS: {len(passed_rows)} row(s) all carried "
              f"a non-empty agent_instruction.")
    else:
        print(f"  [11/FAIL] ACTIONABLE_ERRORS: {len(failures)} row(s) missing agent_instruction.")

    return failures


# ─── runner ───────────────────────────────────────────────────────────────────

INVARIANTS = [
    ("VERSION_AGREEMENT",     invariant_1_version_agreement),
    ("NO_SILENT_NOOP",        invariant_2_no_silent_noop),
    ("NO_LYING_ZERO",         invariant_3_no_lying_zero),
    ("ADVERTISED_CAPABILITY", invariant_4_advertised_capability),
    ("COST_VISIBILITY",       invariant_5_cost_visibility),
    ("HEALTH_TRUTH",          invariant_6_health_truth),
    ("OAUTH_METADATA",        invariant_7_oauth_metadata),
    ("BILLING_TRUTH",         invariant_8_billing_truth),
    ("PARAM_HONESTY",         invariant_9_param_honesty),
    ("REAL_SOURCE_URLS",      invariant_10_real_source_urls),
    ("ACTIONABLE_ERRORS",     invariant_11_actionable_errors),
]


def run_invariants(transport: Transport) -> int:
    """
    Run all invariants against `transport`. Returns 0 if all pass (or skip),
    1 if any fail. Identical driver loop for every transport — this is the
    "one invariant suite, N transports" contract this refactor exists to enforce.
    """
    print(f"\n[contract-test] target: {transport.label}")
    mode = "CONTRACT_FULL" if CONTRACT_FULL else "FREE (default)"
    print(f"[contract-test] mode:   {mode}")
    print( "[contract-test] ─────────────────────────────────────────────────────")

    passed = []
    failed = []
    skipped = []
    throttled = []  # subset of `skipped` caused specifically by a gateway 429
                     # self-throttle (see EDIT #2, 2026-08-11) — tracked
                     # separately so an all-/many-429 run is visually
                     # distinguishable from a clean PASS in the verdict output
                     # below, without changing the (intentionally non-fatal)
                     # exit code.

    for name, fn in INVARIANTS:
        print(f"\n[{name}]")
        try:
            failures = fn(transport)
            if failures:
                for f in failures:
                    print(f"  FAIL: {f}")
                failed.append(name)
            else:
                passed.append(name)
        except SkipInvariant as e:
            print(f"  SKIP: {e}")
            skipped.append(name)
        except GatewayThrottled as e:
            # Must be caught BEFORE the generic `except Exception` below —
            # GatewayThrottled subclasses RuntimeError/Exception. This is the
            # crash-cascade fix (2026-08-11): an invariant that calls
            # transport.rpc()/rpc_raw()/call_tool() directly (no local
            # try/except — invariants 1/2/3/6/7/8) previously let a 429
            # propagate all the way here and got misreported as "invariant
            # runner crashed" -> FAIL. It is now a clean, visible SKIP.
            print(f"  SKIP (gateway 429 self-throttle — infra, not product): {e}")
            skipped.append(name)
            throttled.append(name)
        except Exception as e:
            print(f"  ERROR (invariant runner crashed): {e}")
            failed.append(name)

    print("\n[contract-test] ─────────────────────────────────────────────────────")
    print(f"  passed:  {len(passed)}  {passed}")
    print(f"  failed:  {len(failed)}  {failed}")
    print(f"  skipped: {len(skipped)}  {skipped}")

    if throttled:
        # Print-only signal (2026-08-11, EDIT #2) — does NOT change the exit
        # code. A 429-throttled invariant stays a non-fatal SKIP by design
        # (infra rate-limiting, not a product defect), but an all-/many-429
        # run must be visually distinct from a clean PASS in scrollback/CI
        # logs, or a self-throttled no-op run silently masquerades as a
        # verified green run.
        print(
            f"\n⚠ {len(throttled)} invariant(s) SKIPPED (gateway 429 self-throttle) "
            f"— NOT a clean PASS: {throttled}"
        )

    if failed:
        print("\nVERDICT: FAIL")
        return 1
    print("\nVERDICT: PASS")
    return 0


# ─── self-test (--self-test, 2026-08-11) ───────────────────────────────────────
# Exercises the REAL classifier functions (_retry_on_429/GatewayThrottled,
# _known_issue_ticket/KNOWN_ISSUES, and the owned invariant functions
# themselves — invariant_9_param_honesty / invariant_11_actionable_errors) with
# synthetic, in-process inputs. No network call, no live key, no billable
# spend — this is what proves the 429->SKIP and TOW2-376->XFAIL policy changes
# behave as specified WITHOUT running the full CONTRACT_FULL suite against
# prod. Run with: python3 contract-test.py --self-test
#
# Deliberately calls the same functions run_invariants() calls — NOT a
# reimplementation of their logic — so a self-test PASS is actual evidence
# about the real classifier, not a vacuous tautology.

class _FakeTransport(Transport):
    """In-memory Transport double for --self-test only. `tool_responses` maps
    tool name -> either a (is_error, text) tuple, or a zero-arg callable
    (used to simulate an exception, e.g. GatewayThrottled). `rpc`/`rpc_raw`
    are wired just enough for the invariants exercised by the self-test
    scenarios below (call_tool is the one every scenario needs)."""

    def __init__(self, tool_responses: dict | None = None,
                 rpc_raw_response=None,
                 has_http_surface: bool = True,
                 has_gateway_cost_footer: bool = True):
        self.label = "faketransport (self-test)"
        self.has_http_surface = has_http_surface
        self.has_gateway_cost_footer = has_gateway_cost_footer
        self.tool_responses = tool_responses or {}
        # Default: a top-level JSON-RPC error WITH a non-empty
        # agent_instruction line, so the ACTIONABLE_ERRORS resources/read
        # known_gap row doesn't incidentally fail a scenario that isn't
        # testing that row.
        self._rpc_raw_response = rpc_raw_response or (
            {"error": {"message": "agent_instruction: self-test default — unknown resource"}},
            "{}",
        )

    def rpc(self, method, params, timeout=60):
        raise NotImplementedError(f"self-test FakeTransport.rpc({method!r}) not wired — "
                                   f"no self-test scenario needs it today")

    def rpc_raw(self, method, params, timeout=60):
        resp = self._rpc_raw_response
        return resp() if callable(resp) else resp

    def call_tool(self, name, args, timeout=60):
        resp = self.tool_responses.get(name)
        if resp is None:
            return False, ""
        return resp() if callable(resp) else resp


def _self_test_scenario_429() -> bool:
    """(a) synthetic 429 -> SKIP, exit 0.
    Exercises the REAL _retry_on_429 helper directly (proves: exactly 3
    attempts, raises GatewayThrottled, never a bare HTTPError) AND the REAL
    invariant_9_param_honesty with every row raising GatewayThrottled (proves:
    a 429'd row contributes zero failures — SKIP, not FAIL)."""
    print("\n[self-test a] synthetic 429 -> SKIP")

    attempts = {"n": 0}

    def always_429():
        attempts["n"] += 1
        raise urllib.error.HTTPError("http://fake.invalid/mcp", 429, "Too Many Requests", {}, None)

    orig_sleep = time.sleep
    time.sleep = lambda _seconds: None  # keep the self-test fast; still runs 3 real attempts
    try:
        try:
            _retry_on_429(always_429, label="self-test")
            print("  FAIL: _retry_on_429 did not raise after exhausting retries")
            return False
        except GatewayThrottled:
            pass
        except Exception as e:
            print(f"  FAIL: expected GatewayThrottled, got {e!r}")
            return False
    finally:
        time.sleep = orig_sleep

    if attempts["n"] != 3:
        print(f"  FAIL: expected exactly 3 attempts (0/2s/5s backoff), got {attempts['n']}")
        return False

    global CONTRACT_FULL
    prev_full = CONTRACT_FULL
    CONTRACT_FULL = True
    try:
        def raise_throttled():
            raise GatewayThrottled("self-test: synthetic exhausted 429")

        ft = _FakeTransport({case["tool"]: raise_throttled for case in PARAM_HONESTY_CASES})
        failures = invariant_9_param_honesty(ft)
    finally:
        CONTRACT_FULL = prev_full

    if failures:
        print(f"  FAIL: invariant_9 reported failures on an all-429 run: {failures}")
        return False

    print("  PASS: _retry_on_429 makes exactly 3 attempts then raises GatewayThrottled; "
          "invariant_9_param_honesty treats every 429'd row as SKIP (0 failures).")
    return True


def _self_test_scenario_known_xfail() -> bool:
    """(b) each of the 4 TOW2-376 known signatures -> XFAIL, exit 0,
    'KNOWN (TOW2-376)' printed. Exercises the REAL invariant_9_param_honesty
    with every row responding is_error=False but with NO disclosure marker —
    the exact 'not yet disclosed' signature PARAM_HONESTY_CASES exists to
    catch — and asserts it contributes 0 failures while printing the XFAIL
    marker for all 4 tools."""
    print("\n[self-test b] 4 TOW2-376 known signatures -> XFAIL (0 failures, marker printed)")

    global CONTRACT_FULL
    prev_full = CONTRACT_FULL
    CONTRACT_FULL = True
    try:
        responses = {case["tool"]: (False, "ok — nothing disclosed in this synthetic response")
                     for case in PARAM_HONESTY_CASES}
        ft = _FakeTransport(responses)

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            failures = invariant_9_param_honesty(ft)
        output = buf.getvalue()
    finally:
        CONTRACT_FULL = prev_full

    print(output, end="")

    if failures:
        print(f"  FAIL: expected 0 failures (all 4 rows are registered in KNOWN_ISSUES), "
              f"got: {failures}")
        return False

    expected_tools = {case["tool"] for case in PARAM_HONESTY_CASES}
    xfail_lines = [l for l in output.splitlines() if "KNOWN (TOW2-376)" in l]
    xfailed_tools = {tool for tool in expected_tools if any(tool in l for l in xfail_lines)}
    if xfailed_tools != expected_tools:
        print(f"  FAIL: expected all 4 tools to print 'KNOWN (TOW2-376)', got "
              f"{sorted(xfailed_tools)} (missing {sorted(expected_tools - xfailed_tools)})")
        return False

    print(f"  PASS: all {len(expected_tools)} known TOW2-376 rows printed "
          f"'KNOWN (TOW2-376)' and contributed 0 failures.")
    return True


def _self_test_scenario_owned_failure() -> bool:
    """(c) a synthetic OWNED-invariant failure (hidden/bad tool call NOT
    refused) -> FAIL, non-zero exit. Exercises the REAL
    invariant_11_actionable_errors: novada_scrape's unknown-operation row is
    supposed to be refused (is_error=True) before any backend round-trip;
    simulate a regression where it is NOT refused and assert this is still a
    hard failure — the tripwire must still bite."""
    print("\n[self-test c] synthetic OWNED-invariant failure (bad op NOT refused) -> FAIL")

    responses = {
        "novada_scrape": (False, "## Scrape Results\n(pretend the bad operation went through)"),
        "novada_extract": (True, "agent_instruction: missing required 'url'\nsome error text"),
    }
    ft = _FakeTransport(responses)
    failures = invariant_11_actionable_errors(ft)

    if not failures:
        print("  FAIL: expected invariant_11 to report a failure for the hidden/bad "
              "operation that was NOT refused — got 0 failures")
        return False
    if not any("novada_scrape" in f for f in failures):
        print(f"  FAIL: failure list didn't mention the regressed row: {failures}")
        return False

    print(f"  PASS: ACTIONABLE_ERRORS (an OWNED invariant) correctly reports "
          f"{len(failures)} failure(s) for a hidden/bad tool call that was NOT "
          f"refused — the tripwire still bites.")
    return True


def _self_test_scenario_unknown_failure() -> bool:
    """(d) an unknown/new is_error with no known signature -> FAIL, not
    swallowed. Exercises the REAL invariant_9_param_honesty: 3 rows disclose
    honestly (or at least don't matter for this assertion), one row returns
    is_error=True with a never-seen-before error string (no precondition
    marker, no upstream signal, no 429) — that row must still hard-fail, not
    be silently downgraded to SKIP or XFAIL."""
    print("\n[self-test d] unknown is_error, no known signature -> FAIL (not swallowed)")

    global CONTRACT_FULL
    prev_full = CONTRACT_FULL
    CONTRACT_FULL = True
    try:
        responses = {case["tool"]: (False, "ok — nothing disclosed in this synthetic response")
                     for case in PARAM_HONESTY_CASES}
        target = PARAM_HONESTY_CASES[1]["tool"]  # novada_browser
        responses[target] = (True, "totally novel internal error 0xDEADBEEF — never seen before")
        ft = _FakeTransport(responses)
        failures = invariant_9_param_honesty(ft)
    finally:
        CONTRACT_FULL = prev_full

    if not any(target in f and "no provisioning/upstream" in f for f in failures):
        print(f"  FAIL: expected an unswallowed failure mentioning {target!r}, got: {failures}")
        return False

    print(f"  PASS: an unknown is_error with no known signature ({target}) still "
          f"produced a hard failure — not silently swallowed as XFAIL or SKIP.")
    return True


def _self_test_scenario_known_tool_wrong_param() -> bool:
    """(e) a PARAM_HONESTY disclosure gap on a tool that HAS a KNOWN_ISSUES
    row but for a DIFFERENT param not in the table -> FAIL, not XFAIL.

    Proves the 2026-08-11 match-key tightening in _known_issue_ticket: a
    tool-only match ((invariant, tool)) is no longer sufficient to XFAIL — the
    row's exact `param` must also match, or a disclosure gap is a genuine,
    untracked new gap that must hard-fail. Exercises the REAL
    invariant_9_param_honesty / _known_issue_ticket end-to-end (not a
    reimplementation): mutates a copy of the real PARAM_HONESTY_CASES table so
    novada_proxy's row carries a param string absent from KNOWN_ISSUES, then
    asserts novada_proxy hard-FAILs while the other 3 real TOW2-376 rows
    (unchanged) still XFAIL."""
    print("\n[self-test e] KNOWN tool, DIFFERENT param -> FAIL (not XFAIL)")

    global CONTRACT_FULL, PARAM_HONESTY_CASES
    prev_full = CONTRACT_FULL
    prev_cases = PARAM_HONESTY_CASES
    CONTRACT_FULL = True

    mutated_tool = "novada_proxy"
    bogus_param = "format=url (NOT a registered TOW2-376 param)"

    try:
        new_cases = [dict(case) for case in prev_cases]
        for case in new_cases:
            if case["tool"] == mutated_tool:
                case["param"] = bogus_param
        PARAM_HONESTY_CASES = new_cases

        responses = {case["tool"]: (False, "ok — nothing disclosed in this synthetic response")
                     for case in new_cases}
        ft = _FakeTransport(responses)

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            failures = invariant_9_param_honesty(ft)
        output = buf.getvalue()
    finally:
        CONTRACT_FULL = prev_full
        PARAM_HONESTY_CASES = prev_cases

    print(output, end="")

    if not any(mutated_tool in f for f in failures):
        print(f"  FAIL: expected a hard FAIL for {mutated_tool!r} (registered tool, "
              f"unregistered param) — got failures: {failures}")
        return False

    xfail_lines = [l for l in output.splitlines() if "KNOWN (TOW2-376)" in l]
    if any(mutated_tool in l for l in xfail_lines):
        print(f"  FAIL: {mutated_tool!r} was XFAILed despite carrying a param absent "
              f"from KNOWN_ISSUES — the (invariant, tool, param) match key is not "
              f"being enforced.")
        return False

    other_tools = {case["tool"] for case in new_cases if case["tool"] != mutated_tool}
    xfailed_others = {tool for tool in other_tools if any(tool in l for l in xfail_lines)}
    if xfailed_others != other_tools:
        print(f"  FAIL: expected the other {len(other_tools)} real KNOWN_ISSUES rows "
              f"to still XFAIL, got {sorted(xfailed_others)} (missing "
              f"{sorted(other_tools - xfailed_others)})")
        return False

    print(f"  PASS: {mutated_tool!r} with an unregistered param hard-FAILed (not "
          f"XFAILed), while the other {len(other_tools)} real KNOWN_ISSUES rows "
          f"correctly still XFAILed — the (invariant, tool, param) match key works.")
    return True


def run_self_test() -> int:
    print("[contract-test] --self-test: exercising the real classifier functions "
          "with synthetic, in-process inputs (no network, no live key).")
    print("[contract-test] ─────────────────────────────────────────────────────")

    scenarios = [
        ("(a) synthetic 429 -> SKIP", _self_test_scenario_429),
        ("(b) 4x TOW2-376 known signatures -> XFAIL", _self_test_scenario_known_xfail),
        ("(c) owned-invariant regression -> FAIL", _self_test_scenario_owned_failure),
        ("(d) unknown is_error -> FAIL (not swallowed)", _self_test_scenario_unknown_failure),
        ("(e) known tool, different param -> FAIL (not XFAIL)", _self_test_scenario_known_tool_wrong_param),
    ]
    results = []
    for name, fn in scenarios:
        try:
            ok = fn()
        except Exception as e:
            print(f"  FAIL: scenario raised unexpectedly: {e!r}")
            ok = False
        results.append((name, ok))

    print("\n[contract-test] ─────────────────────────────────────────────────────")
    for name, ok in results:
        print(f"  {'PASS' if ok else 'FAIL'}: {name}")

    if all(ok for _, ok in results):
        print("\nSELF-TEST VERDICT: PASS")
        return 0
    print("\nSELF-TEST VERDICT: FAIL")
    return 1


def run(base_url: str) -> int:
    """Backward-compat entry point — original HTTP-only signature, unchanged
    behavior. Still used implicitly whenever no --transport= flag is given."""
    if not KEY:
        print("[contract-test] ERROR: Set NOVADA_MCP_KEY (or NOVADA_API_KEY) in env — no key is baked into this script.")
        sys.exit(1)
    transport = HttpSseTransport(base_url, KEY)
    return run_invariants(transport)


def _default_stdio_entry() -> str:
    """npm-package/build/index.js, resolved relative to this script's location
    (hosted-server/scripts/contract/contract-test.py → repo root is 3 levels up)."""
    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(here, "..", "..", ".."))
    return os.path.join(repo_root, "npm-package", "build", "index.js")


def _run_stdio(entry_path: str) -> int:
    if CONTRACT_FULL:
        # CONTRACT_FULL invariants (2/3/6-probe) make real billed calls
        # (proxy credential fetch, a live Amazon scrape, a billed render probe).
        # Refusing this combination outright is safer than silently running
        # billed calls against a local process spun up with a dummy test key —
        # there is no legitimate reason to combine them, and a real key
        # accidentally present in the environment would make CONTRACT_FULL+stdio
        # spend real credits with no corresponding hosted-parity purpose.
        print(
            "[contract-test] ERROR: CONTRACT_FULL=1 is not supported with --transport=stdio "
            "(the stdio harness exists to cover the FREE structural invariants against the "
            "local build; billed invariants stay http+CONTRACT_FULL only). Unset CONTRACT_FULL."
        )
        return 1

    dummy_key = KEY or STDIO_DUMMY_KEY
    spawn_timeout = float(os.environ.get("CONTRACT_STDIO_SPAWN_TIMEOUT", "15"))

    try:
        transport = StdioTransport(entry_path, api_key=dummy_key, spawn_timeout=spawn_timeout)
    except Exception as e:
        print(f"[contract-test] FATAL: could not start stdio transport: {e}")
        return 1

    try:
        return run_invariants(transport)
    finally:
        transport.close()


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        # No network, no live key, no billable spend — see run_self_test()'s
        # docstring block. Takes priority over --transport=/positional args,
        # which self-test doesn't use.
        return run_self_test()

    transport_kind = "http"
    positional: list[str] = []
    for a in argv:
        if a.startswith("--transport="):
            transport_kind = a.split("=", 1)[1].strip().lower()
        else:
            positional.append(a)

    if transport_kind == "stdio":
        entry_path = positional[0] if positional else (
            os.environ.get("NOVADA_STDIO_ENTRY") or _default_stdio_entry()
        )
        return _run_stdio(entry_path)

    if transport_kind in ("http", "http+sse", "sse"):
        if not positional:
            print("Usage: contract-test.py <base_url>")
            print("  e.g. contract-test.py https://mcp.novada.com/mcp")
            print("  or:  contract-test.py --transport=stdio [path/to/npm-package/build/index.js]")
            return 1
        return run(positional[0])

    print(f"[contract-test] ERROR: unknown --transport={transport_kind!r}. Valid values: http, stdio.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
