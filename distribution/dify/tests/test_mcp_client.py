"""
Unit tests for `utils/mcp_client.py`, mocking `requests.post` so no network call is
made. Covers every error path the design rules require a clear message for:
missing key, HTTP 401/403, HTTP 429, other HTTP >=400, timeout, connection error,
non-JSON body, JSON-RPC protocol error, and tool-level `isError` with/without text.
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
import requests

from utils.mcp_client import NovadaMcpError, call_novada_tool


def _ok_response(result: dict, status: int = 200) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = {"jsonrpc": "2.0", "id": 1, "result": result}
    resp.text = json.dumps({"result": result})
    return resp


def test_missing_api_key_raises_without_network_call() -> None:
    with pytest.raises(NovadaMcpError, match="Missing Novada API key"):
        call_novada_tool("", "novada_search", {"query": "x"})


@patch("utils.mcp_client.requests.post")
def test_success_text_and_json_content(mock_post) -> None:
    mock_post.return_value = _ok_response(
        {
            "content": [
                {"type": "text", "text": "hello"},
                {"type": "json", "json": {"a": 1}},
            ],
            "isError": False,
        }
    )
    result = call_novada_tool("k", "novada_search", {"query": "x"})
    assert result == {"text": "hello", "json": {"a": 1}, "is_error": False}
    # Verify the Accept header is exactly the mandatory both-values string.
    _, kwargs = mock_post.call_args
    assert kwargs["headers"]["Accept"] == "application/json, text/event-stream"
    assert kwargs["headers"]["Authorization"] == "Bearer k"


@pytest.mark.parametrize("status", [401, 403])
@patch("utils.mcp_client.requests.post")
def test_auth_errors_tell_user_to_check_key(mock_post, status) -> None:
    resp = MagicMock()
    resp.status_code = status
    resp.text = json.dumps({"error": "MISSING_TOKEN"})
    mock_post.return_value = resp
    with pytest.raises(NovadaMcpError, match="API key"):
        call_novada_tool("bad-key", "novada_search", {"query": "x"})


@patch("utils.mcp_client.requests.post")
def test_rate_limit_is_explicit(mock_post) -> None:
    resp = MagicMock()
    resp.status_code = 429
    resp.text = "{}"
    mock_post.return_value = resp
    with pytest.raises(NovadaMcpError, match="rate-limited"):
        call_novada_tool("k", "novada_search", {"query": "x"})


@patch("utils.mcp_client.requests.post")
def test_other_http_error_includes_status_and_body(mock_post) -> None:
    resp = MagicMock()
    resp.status_code = 500
    resp.text = "internal error"
    mock_post.return_value = resp
    with pytest.raises(NovadaMcpError, match="HTTP 500"):
        call_novada_tool("k", "novada_search", {"query": "x"})


@patch("utils.mcp_client.requests.post", side_effect=requests.exceptions.Timeout("boom"))
def test_timeout_is_explicit(mock_post) -> None:
    with pytest.raises(NovadaMcpError, match="timed out"):
        call_novada_tool("k", "novada_search", {"query": "x"})


@patch("utils.mcp_client.requests.post", side_effect=requests.exceptions.ConnectionError("boom"))
def test_connection_error_is_explicit(mock_post) -> None:
    with pytest.raises(NovadaMcpError, match="Could not connect"):
        call_novada_tool("k", "novada_search", {"query": "x"})


@patch("utils.mcp_client.requests.post")
def test_non_json_body_is_explicit(mock_post) -> None:
    resp = MagicMock()
    resp.status_code = 200
    resp.json.side_effect = ValueError("no JSON object could be decoded")
    resp.text = "<html>not json</html>"
    mock_post.return_value = resp
    with pytest.raises(NovadaMcpError, match="non-JSON"):
        call_novada_tool("k", "novada_search", {"query": "x"})


@patch("utils.mcp_client.requests.post")
def test_406_accept_header_error_is_surfaced_as_generic_http_error(mock_post) -> None:
    # Verified live (spec §2.3): a wrong Accept header returns HTTP 406 with a
    # JSON-RPC error envelope. Non-200 is checked before the body is parsed for a
    # top-level "error" key, so this is caught by the generic HTTP>=400 branch —
    # the body text (which carries the real JSON-RPC message) is still included.
    resp = MagicMock()
    resp.status_code = 406
    resp.json.return_value = {
        "jsonrpc": "2.0",
        "error": {"code": -32000, "message": "Not Acceptable: Client must accept both application/json and text/event-stream"},
    }
    resp.text = json.dumps(resp.json.return_value)
    mock_post.return_value = resp
    with pytest.raises(NovadaMcpError, match="HTTP 406"):
        call_novada_tool("k", "novada_search", {"query": "x"})


@patch("utils.mcp_client.requests.post")
def test_jsonrpc_top_level_error_on_200_is_surfaced(mock_post) -> None:
    # Defensive path: an HTTP-200 response whose JSON body carries a top-level
    # "error" instead of "result" (distinct from a tool-level result.isError).
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {"jsonrpc": "2.0", "error": {"code": -32601, "message": "Method not found"}}
    resp.text = json.dumps(resp.json.return_value)
    mock_post.return_value = resp
    with pytest.raises(NovadaMcpError, match="protocol error"):
        call_novada_tool("k", "novada_search", {"query": "x"})


@patch("utils.mcp_client.requests.post")
def test_tool_level_error_with_text_is_not_raised_but_flagged(mock_post) -> None:
    mock_post.return_value = _ok_response(
        {"content": [{"type": "text", "text": "Error [TOOL_NOT_ENABLED]: nope"}], "isError": True}
    )
    result = call_novada_tool("k", "novada_scrape", {"platform": "x", "operation": "y"})
    assert result["is_error"] is True
    assert "TOOL_NOT_ENABLED" in result["text"]


@patch("utils.mcp_client.requests.post")
def test_tool_level_error_with_no_content_still_gets_a_message(mock_post) -> None:
    mock_post.return_value = _ok_response({"content": [], "isError": True})
    result = call_novada_tool("k", "novada_search", {"query": "x"})
    assert result["is_error"] is True
    assert result["text"], "an isError result must never surface an empty/undefined message"
