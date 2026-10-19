"""
Unit tests for `utils/tool_handler.py`: building hosted arguments from Dify
`tool_parameters` (including JSON-encoded array/object params and their bad-JSON
error path), and the shared `invoke_novada_tool` generator's message/error mapping.

Round 1 (F5): the error-path tests below patch `utils.mcp_client.requests.post`
rather than `utils.tool_handler.call_novada_tool`, so they exercise the REAL
`call_novada_tool` error-message generation through `invoke_novada_tool` end to end
— not just a canned mock string. This is what verifier mutation probe #4 (making
`invoke_novada_tool` yield `""` and return early on `is_error`) needed to fail: see
`test_invoke_surfaces_tool_level_is_error_text_from_server` below.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
import requests

from utils.mcp_client import NovadaMcpError
from utils.tool_handler import (
    ToolParameterError,
    build_hosted_arguments,
    invoke_novada_tool,
)


def test_build_hosted_arguments_skips_empty_optional_params() -> None:
    args = build_hosted_arguments("novada_search", {"query": "hello", "num": ""})
    assert args == {"query": "hello"}


def test_build_hosted_arguments_passes_through_scalars() -> None:
    args = build_hosted_arguments(
        "novada_search",
        {"query": "hello", "num": 5, "engine": "google", "country": "de"},
    )
    assert args == {"query": "hello", "num": 5, "engine": "google", "country": "de"}


def test_build_hosted_arguments_decodes_json_array() -> None:
    args = build_hosted_arguments(
        "novada_search",
        {"query": "hello", "include_domains": '["github.com", "arxiv.org"]'},
    )
    assert args["include_domains"] == ["github.com", "arxiv.org"]


def test_build_hosted_arguments_decodes_json_object() -> None:
    args = build_hosted_arguments(
        "novada_scrape",
        {"platform": "amazon.com", "operation": "amazon_product_keywords", "params": '{"keyword": "iphone 16"}'},
    )
    assert args["params"] == {"keyword": "iphone 16"}


def test_build_hosted_arguments_rejects_bad_json_array() -> None:
    with pytest.raises(ToolParameterError, match="JSON array"):
        build_hosted_arguments("novada_search", {"query": "hello", "include_domains": "not json"})


def test_build_hosted_arguments_rejects_json_object_where_array_expected() -> None:
    with pytest.raises(ToolParameterError, match="JSON array"):
        build_hosted_arguments("novada_search", {"query": "hello", "include_domains": '{"a": 1}'})


def test_build_hosted_arguments_rejects_missing_required_param() -> None:
    with pytest.raises(ToolParameterError, match="is required"):
        build_hosted_arguments("novada_search", {})


# --- Round 1 (F6): falsy-but-meaningful values must survive, only None/"" are omitted ---


def test_build_hosted_arguments_preserves_false_boolean() -> None:
    """`novada_extract`'s `clean=False` is a meaningful, explicit choice — distinct
    from leaving `clean` unset — and must reach the hosted call as `False`, not be
    skipped the way `None`/`""` are. (review-code.md finding #3.)"""
    args = build_hosted_arguments("novada_extract", {"url": "https://example.com", "clean": False})
    assert args["clean"] is False


def test_build_hosted_arguments_preserves_zero_number() -> None:
    """`num=0` is a meaningful explicit value (distinct from "unset"), not falsy-skip."""
    args = build_hosted_arguments("novada_search", {"query": "hello", "num": 0})
    assert args["num"] == 0
    assert "num" in args


def test_build_hosted_arguments_omits_none_and_empty_string() -> None:
    """The actual skip condition is `None`/`""` — not "falsy" — confirming `False`
    and `0` above are preserved because of what the code checks, not by accident."""
    args = build_hosted_arguments("novada_search", {"query": "hello", "num": None, "country": ""})
    assert "num" not in args
    assert "country" not in args
    assert args == {"query": "hello"}


class _FakeTool:
    """Stands in for a `dify_plugin.Tool` instance: records what the handler would
    yield via the SDK's own `create_text_message`/`create_json_message` methods."""

    def __init__(self) -> None:
        self.texts: list[str] = []
        self.jsons: list[object] = []

    def create_text_message(self, text: str):
        self.texts.append(text)
        return ("text", text)

    def create_json_message(self, obj: object):
        self.jsons.append(obj)
        return ("json", obj)


def test_invoke_yields_text_message_on_bad_param() -> None:
    tool = _FakeTool()
    list(invoke_novada_tool(tool, "novada_search", "key", {}))
    assert tool.texts and "is required" in tool.texts[0]
    assert not tool.jsons


@patch("utils.tool_handler.call_novada_tool", side_effect=NovadaMcpError("rate-limited"))
def test_invoke_yields_text_message_on_transport_error(mock_call) -> None:
    tool = _FakeTool()
    list(invoke_novada_tool(tool, "novada_search", "key", {"query": "x"}))
    assert tool.texts == ["rate-limited"]


@patch("utils.tool_handler.call_novada_tool", return_value={"text": "result text", "json": {"a": 1}, "is_error": False})
def test_invoke_yields_both_text_and_json(mock_call) -> None:
    tool = _FakeTool()
    list(invoke_novada_tool(tool, "novada_search", "key", {"query": "x"}))
    assert tool.texts == ["result text"]
    assert tool.jsons == [{"a": 1}]
    mock_call.assert_called_once_with("key", "novada_search", {"query": "x"})


@patch("utils.tool_handler.call_novada_tool", return_value={"text": None, "json": None, "is_error": False})
def test_invoke_never_yields_nothing_on_empty_non_error_result(mock_call) -> None:
    tool = _FakeTool()
    list(invoke_novada_tool(tool, "novada_search", "key", {"query": "x"}))
    assert tool.texts, "a non-error empty result must still surface a message, never silence"


# --- Round 1 (F7): a non-Mapping/list `json` content block must degrade to text ---


@patch(
    "utils.tool_handler.call_novada_tool",
    return_value={"text": None, "json": 42, "is_error": False},
)
def test_invoke_degrades_scalar_json_to_text_instead_of_raising(mock_call) -> None:
    """`ToolInvokeMessage.create_json_message` is typed `Mapping | list` in the SDK
    and would reject a bare scalar. Nothing in the hosted server emits one today, but
    the handler must never crash if it ever did — it should fall back to a text
    message instead (review-code.md finding #4)."""
    tool = _FakeTool()
    list(invoke_novada_tool(tool, "novada_search", "key", {"query": "x"}))
    assert not tool.jsons, "a scalar must not be forwarded to create_json_message"
    assert tool.texts == ["42"]


@patch(
    "utils.tool_handler.call_novada_tool",
    return_value={"text": None, "json": [1, 2, 3], "is_error": False},
)
def test_invoke_still_uses_json_message_for_a_real_list(mock_call) -> None:
    """Confirms the F7 guard doesn't over-correct: a `list` (one of the two SDK-legal
    shapes) must still go through `create_json_message`, not be stringified."""
    tool = _FakeTool()
    list(invoke_novada_tool(tool, "novada_search", "key", {"query": "x"}))
    assert tool.jsons == [[1, 2, 3]]
    assert not tool.texts


# --- Round 1 (F5): handler-level error-path tests, mocking only `requests.post` so ---
# --- the REAL call_novada_tool error-message logic runs through invoke_novada_tool ---


def _text_response(text: str, is_error: bool = True, status: int = 200) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {"content": [{"type": "text", "text": text}], "isError": is_error},
    }
    return resp


def test_invoke_surfaces_tool_level_is_error_text_from_server() -> None:
    """Verifier Finding A / mutation probe #4: `invoke_novada_tool` must forward the
    server's own `isError` text (which may carry an `agent_instruction`) verbatim and
    never silence it. A mutated handler that yields `create_text_message("")` and
    returns immediately on `is_error` must now fail this test — see BUILD.md's
    "Round 1 fixes" section for the re-run confirming that."""
    with patch("utils.mcp_client.requests.post") as mock_post:
        mock_post.return_value = _text_response("Error [TOOL_NOT_ENABLED]: enable Scrape on your plan")
        tool = _FakeTool()
        list(invoke_novada_tool(tool, "novada_scrape", "key", {"platform": "x", "operation": "y"}))
    assert tool.texts, "an is_error result must yield a non-empty message"
    assert tool.texts[0], "the yielded message must not be empty"
    assert "TOOL_NOT_ENABLED" in tool.texts[0], "the server's own message must be surfaced verbatim"


@patch("utils.mcp_client.requests.post")
def test_invoke_surfaces_401_through_handler(mock_post) -> None:
    resp = MagicMock()
    resp.status_code = 401
    resp.text = "{}"
    mock_post.return_value = resp
    tool = _FakeTool()
    list(invoke_novada_tool(tool, "novada_search", "key", {"query": "x"}))
    assert tool.texts and tool.texts[0]
    assert "API key" in tool.texts[0]


@patch("utils.mcp_client.requests.post")
def test_invoke_surfaces_403_through_handler(mock_post) -> None:
    resp = MagicMock()
    resp.status_code = 403
    resp.text = "{}"
    mock_post.return_value = resp
    tool = _FakeTool()
    list(invoke_novada_tool(tool, "novada_search", "key", {"query": "x"}))
    assert tool.texts and tool.texts[0]
    assert "API key" in tool.texts[0]


@patch("utils.mcp_client.requests.post")
def test_invoke_surfaces_429_through_handler(mock_post) -> None:
    resp = MagicMock()
    resp.status_code = 429
    resp.text = "{}"
    mock_post.return_value = resp
    tool = _FakeTool()
    list(invoke_novada_tool(tool, "novada_search", "key", {"query": "x"}))
    assert tool.texts and tool.texts[0]
    assert "rate-limited" in tool.texts[0]


@patch("utils.mcp_client.requests.post")
def test_invoke_surfaces_5xx_through_handler(mock_post) -> None:
    resp = MagicMock()
    resp.status_code = 503
    resp.text = "upstream unavailable"
    mock_post.return_value = resp
    tool = _FakeTool()
    list(invoke_novada_tool(tool, "novada_search", "key", {"query": "x"}))
    assert tool.texts and tool.texts[0]
    assert "HTTP 503" in tool.texts[0]


@patch("utils.mcp_client.requests.post", side_effect=requests.exceptions.Timeout("boom"))
def test_invoke_surfaces_timeout_through_handler(mock_post) -> None:
    tool = _FakeTool()
    list(invoke_novada_tool(tool, "novada_search", "key", {"query": "x"}))
    assert tool.texts and tool.texts[0]
    assert "timed out" in tool.texts[0]


@patch("utils.mcp_client.requests.post", side_effect=requests.exceptions.ConnectionError("boom"))
def test_invoke_surfaces_connection_error_through_handler(mock_post) -> None:
    tool = _FakeTool()
    list(invoke_novada_tool(tool, "novada_search", "key", {"query": "x"}))
    assert tool.texts and tool.texts[0]
    assert "Could not connect" in tool.texts[0]


@patch("utils.mcp_client.requests.post")
def test_invoke_surfaces_non_json_body_through_handler(mock_post) -> None:
    resp = MagicMock()
    resp.status_code = 200
    resp.json.side_effect = ValueError("no JSON object could be decoded")
    resp.text = "<html>not json</html>"
    mock_post.return_value = resp
    tool = _FakeTool()
    list(invoke_novada_tool(tool, "novada_search", "key", {"query": "x"}))
    assert tool.texts and tool.texts[0]
    assert "non-JSON" in tool.texts[0]


@patch("utils.mcp_client.requests.post")
def test_invoke_surfaces_jsonrpc_protocol_error_through_handler(mock_post) -> None:
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {"jsonrpc": "2.0", "error": {"code": -32601, "message": "Method not found"}}
    mock_post.return_value = resp
    tool = _FakeTool()
    list(invoke_novada_tool(tool, "novada_search", "key", {"query": "x"}))
    assert tool.texts and tool.texts[0]
    assert "protocol error" in tool.texts[0]
