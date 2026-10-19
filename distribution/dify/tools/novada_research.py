"""Thin Dify Tool subclass for `novada_research`. All behavior lives in
`utils.tool_handler.invoke_novada_tool`, parameterized by hosted tool name — see
`utils/tools_table.py` for why this file is intentionally only a few lines."""
from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from utils.tool_handler import invoke_novada_tool


class NovadaResearchTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage]:
        api_key = self.runtime.credentials.get("api_key", "")
        yield from invoke_novada_tool(self, "novada_research", api_key, tool_parameters)
