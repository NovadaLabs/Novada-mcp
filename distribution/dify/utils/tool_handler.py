"""
Shared `_invoke` logic for every exposed Novada tool. Each file under `tools/*.py` is
a thin `Tool` subclass that calls `invoke_novada_tool(hosted_name, ...)` with its own
`hosted_name` — the only thing that differs between tools. This keeps tool behavior in
one place (class-not-instance): a new tool is a new row in `utils.tools_table.TOOLS`
plus a ~6-line subclass, never a copy-pasted `_invoke` body.
"""
from __future__ import annotations

import json
from collections.abc import Generator, Mapping
from typing import TYPE_CHECKING, Any

from dify_plugin.entities.tool import ToolInvokeMessage

from utils.mcp_client import NovadaMcpError, call_novada_tool
from utils.tools_table import TOOLS_BY_NAME, ParamSpec

if TYPE_CHECKING:
    from dify_plugin import Tool


class ToolParameterError(Exception):
    """Raised when a Dify-supplied parameter can't be turned into a hosted argument
    (e.g. invalid JSON in a JSON-encoded field). Always caught and reported as a text
    message — never allowed to propagate as an unhandled exception."""


def _decode_json_param(spec: ParamSpec, raw: str) -> Any:
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as e:
        expected = "a JSON array" if spec.kind == "json_array" else "a JSON object"
        raise ToolParameterError(
            f"Parameter '{spec.name}' must be {expected} encoded as a string "
            f"(got: {raw!r}). JSON error: {e}"
        ) from e
    if spec.kind == "json_array" and not isinstance(value, list):
        raise ToolParameterError(f"Parameter '{spec.name}' must decode to a JSON array, got {type(value).__name__}.")
    if spec.kind == "json_object" and not isinstance(value, dict):
        raise ToolParameterError(f"Parameter '{spec.name}' must decode to a JSON object, got {type(value).__name__}.")
    return value


def build_hosted_arguments(hosted_name: str, tool_parameters: dict[str, Any]) -> dict[str, Any]:
    """
    Maps Dify `tool_parameters` to the hosted MCP tool's `arguments` dict, per the
    `ToolSpec` for `hosted_name`. Skips any param the caller left empty/unset so the
    hosted tool's own defaults apply. Raises `ToolParameterError` on bad JSON in a
    JSON-encoded field.
    """
    spec = TOOLS_BY_NAME[hosted_name]
    args: dict[str, Any] = {}
    for p in spec.params:
        raw = tool_parameters.get(p.name)
        if raw is None or raw == "":
            if p.required:
                raise ToolParameterError(f"Parameter '{p.name}' is required.")
            continue
        if p.is_json_encoded:
            args[p.name] = _decode_json_param(p, raw)
        else:
            args[p.name] = raw
    return args


def invoke_novada_tool(
    tool: Tool,
    hosted_name: str,
    api_key: str,
    tool_parameters: dict[str, Any],
) -> Generator[ToolInvokeMessage, None, None]:
    """
    Shared body for every exposed tool's `_invoke`. Builds hosted arguments from the
    table, calls the hosted MCP tool, and yields Dify messages via `tool`'s own
    `create_text_message`/`create_json_message` (so message construction stays
    whatever the installed `dify_plugin` SDK expects, rather than this module
    hardcoding the `ToolInvokeMessage` shape). Never yields an empty or missing
    message on failure — every error path ends with a human-readable text message.
    """
    try:
        arguments = build_hosted_arguments(hosted_name, tool_parameters)
    except ToolParameterError as e:
        yield tool.create_text_message(str(e))
        return

    try:
        result = call_novada_tool(api_key, hosted_name, arguments)
    except NovadaMcpError as e:
        yield tool.create_text_message(str(e))
        return

    # `result["text"]` carries the server's own message even when is_error is true —
    # including any `agent_instruction` the server embedded — so the agent can act on
    # it instead of seeing a bare "failed" with no detail.
    if result.get("text"):
        yield tool.create_text_message(result["text"])
    json_value = result.get("json")
    if json_value is not None:
        # Round 1 fix (F7): `ToolInvokeMessage.create_json_message` /
        # `InvokeMessage.JsonMessage.json_object` is typed `Mapping | list` in the
        # SDK and is strict about it — a scalar (int/bool/str) raises a pydantic
        # ValidationError. Nothing in the hosted server emits a scalar `type:"json"`
        # content block today, but if it ever did, this module's own docstring
        # promises every error/edge path ends with a human-readable message, not an
        # unhandled exception — so degrade gracefully instead of trusting the shape.
        if isinstance(json_value, (Mapping, list)):
            yield tool.create_json_message(json_value)
        else:
            yield tool.create_text_message(json.dumps(json_value))
    if not result.get("text") and result.get("json") is None:
        # Belt-and-suspenders: mcp_client already backfills a message when is_error is
        # true with no content, but a non-error empty result is theoretically possible
        # for a hosted tool change this plugin hasn't caught up with yet.
        yield tool.create_text_message(f"Novada tool '{hosted_name}' returned no content.")
