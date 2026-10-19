"""
Unit tests for `provider/novada.py`'s `_validate_credentials`.

Round 1 (F8): added alongside the `is not None` selection fix (review-code.md
finding #6) — previously `result.get("text") or result.get("json")` could, in
principle, swallow a falsy-but-meaningful diagnostic value into the other operand.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from provider.novada import NovadaProvider


def test_missing_api_key_raises_before_any_network_call() -> None:
    with pytest.raises(ToolProviderCredentialValidationError, match="required"):
        NovadaProvider()._validate_credentials({})


@patch("provider.novada.call_novada_tool")
def test_rejected_key_surfaces_server_text(mock_call) -> None:
    mock_call.return_value = {"text": "invalid token", "json": None, "is_error": True}
    with pytest.raises(ToolProviderCredentialValidationError, match="invalid token"):
        NovadaProvider()._validate_credentials({"api_key": "bad"})


@patch("provider.novada.call_novada_tool")
def test_rejected_key_falls_back_to_json_only_when_text_is_none(mock_call) -> None:
    """F8: `is not None` selection — `text` is `None` (not just falsy), so `json` is
    used, and a falsy-but-real `json` value (`False`) must appear verbatim rather
    than being coerced away."""
    mock_call.return_value = {"text": None, "json": False, "is_error": True}
    with pytest.raises(ToolProviderCredentialValidationError, match="False"):
        NovadaProvider()._validate_credentials({"api_key": "bad"})


@patch("provider.novada.call_novada_tool")
def test_rejected_key_prefers_text_over_json_when_both_present(mock_call) -> None:
    mock_call.return_value = {"text": "check your API key", "json": {"code": "MISSING_TOKEN"}, "is_error": True}
    with pytest.raises(ToolProviderCredentialValidationError, match="check your API key"):
        NovadaProvider()._validate_credentials({"api_key": "bad"})
