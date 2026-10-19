from typing import Any

from dify_plugin import ToolProvider
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from utils.mcp_client import NovadaMcpError, call_novada_tool


class NovadaProvider(ToolProvider):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        api_key = (credentials or {}).get("api_key", "").strip()
        if not api_key:
            raise ToolProviderCredentialValidationError("Novada API Key is required.")
        try:
            # novada_setup is Novada's own onboarding/health-check tool: it validates
            # the key and returns the account balance with no quota consumed — the
            # cheapest possible credential check. Kept internal to this provider; it
            # is never exposed as a user-facing Tool (see utils/tools_table.py).
            result = call_novada_tool(api_key, "novada_setup", {})
            if result.get("is_error"):
                # Round 1 fix (F8): `is not None` selection, consistent with
                # utils/tool_handler.py's own falsy-but-meaningful-value handling —
                # a truthy/falsy `or` would risk swallowing a falsy-but-real `text`
                # or `json` diagnostic (e.g. an explicit `0`/`False`/`{}`) into the
                # other operand.
                detail = result.get("text") if result.get("text") is not None else result.get("json")
                raise ToolProviderCredentialValidationError(f"Novada rejected this API key: {detail}")
        except NovadaMcpError as e:
            raise ToolProviderCredentialValidationError(f"Could not validate Novada API key: {e}") from e
