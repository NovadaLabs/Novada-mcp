#!/usr/bin/env python3
"""
Generator: emits `tools/<hosted_name>.yaml` and `tools/<hosted_name>.py` from
`utils/tools_table.py`, so the per-tool YAML/py pairs can never drift from the
single source-of-truth table by hand-editing.

Round 1 fix (F9): committed under `distribution/dify/scripts/` with repo-relative
paths (previously this lived only in a personal test-engineering scratch directory
with a hardcoded `Path.home() / "Projects" / "novada-mcp-dify"` — see
review-code.md finding #5). Excluded from the shipped `.difypkg` via `.difyignore`'s
`scripts/` entry, the same pattern already used for `tests/`.

Usage:
    python3 scripts/gen_tool_yaml.py            # regenerate tools/*.yaml and *.py
    python3 scripts/gen_tool_yaml.py --check    # verify committed files match the
                                                  # table; exit 1 and print a diff on
                                                  # any mismatch, write nothing

`tests/test_generator_check.py` runs this in `--check` mode as part of the test
suite, so a `tools_table.py` edit that isn't matched by a regenerated YAML/py pair
fails CI instead of silently drifting.
"""
from __future__ import annotations

import argparse
import difflib
import sys
from pathlib import Path

DIFY_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DIFY_DIR))

from utils.tools_table import TOOLS, ParamKind

# Param-name -> (EN label, ZH label). Keyed by name, not by tool, because the same
# param name (url, format, query, ...) repeats across several tools with the same
# meaning — one row covers every tool that uses it, per class-not-instance.
PARAM_LABELS: dict[str, tuple[str, str]] = {
    "query": ("Query", "查询词"),
    "num": ("Number of Results", "结果数量"),
    "engine": ("Search Engine", "搜索引擎"),
    "country": ("Country Code", "国家代码"),
    "time_range": ("Time Range", "时间范围"),
    "include_domains": ("Include Domains (JSON)", "限定域名（JSON）"),
    "exclude_domains": ("Exclude Domains (JSON)", "排除域名（JSON）"),
    "format": ("Output Format", "输出格式"),
    "url": ("URL", "网址"),
    "clean": ("Main Content Only", "仅提取正文"),
    "render": ("Render Mode", "渲染模式"),
    "max_chars": ("Max Characters", "最大字符数"),
    "fields": ("Fields (JSON)", "字段（JSON）"),
    "wait_for": ("Wait For Selector", "等待选择器"),
    "wait_ms": ("Wait Milliseconds", "等待毫秒数"),
    "max_pages": ("Max Pages", "最大页数"),
    "strategy": ("Crawl Strategy", "抓取策略"),
    "select_paths": ("Select Paths (JSON)", "限定路径（JSON）"),
    "exclude_paths": ("Exclude Paths (JSON)", "排除路径（JSON）"),
    "instructions": ("Instructions", "说明提示"),
    "search": ("Search Substring", "搜索子串"),
    "limit": ("Limit", "数量上限"),
    "max_depth": ("Max Depth", "最大深度"),
    "include_subdomains": ("Include Subdomains", "包含子域名"),
    "question": ("Question", "研究问题"),
    "depth": ("Research Depth", "研究深度"),
    "focus": ("Focus Area", "聚焦方向"),
    "start_date": ("Start Date", "起始日期"),
    "end_date": ("End Date", "结束日期"),
    "platform": ("Platform", "平台"),
    "operation": ("Operation ID", "操作 ID"),
    "params": ("Parameters (JSON)", "参数（JSON）"),
    "task_id": ("Task ID", "任务 ID"),
    "section": ("Section", "数据分类"),
    "start_time": ("Start Time", "起始时间"),
    "end_time": ("End Time", "结束时间"),
    "products": ("Products (JSON)", "产品（JSON）"),
    "page": ("Page", "页码"),
    "page_size": ("Page Size", "每页大小"),
}


def yaml_str(s: str) -> str:
    """Quote a scalar for YAML only when needed; block literals handle the rest."""
    needs_quote = any(c in s for c in [":", "#", "{", "}", "[", "]", "&", "*", "!", "|", ">", "'", '"', "%", "@", "`"])
    if needs_quote or s == "" or s.strip() != s:
        escaped = s.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return s


def emit_tool_yaml(tool) -> str:
    label_en, label_zh = tool.label_en, tool.label_zh
    lines: list[str] = []
    lines.append("identity:")
    lines.append(f"  name: {tool.hosted_name}")
    lines.append("  author: novadalabs")
    lines.append("  label:")
    lines.append(f"    en_US: {yaml_str(label_en)}")
    lines.append(f"    zh_Hans: {yaml_str(label_zh)}")
    lines.append("description:")
    lines.append("  human:")
    lines.append(f"    en_US: {yaml_str(tool.summary_en)}")
    lines.append(f"    zh_Hans: {yaml_str(tool.summary_zh)}")
    lines.append(f"  llm: {yaml_str(tool.summary_en)}")
    lines.append("parameters:")
    for p in tool.params:
        lines.append(f"  - name: {p.name}")
        lines.append(f"    type: {p.dify_type}")
        lines.append(f"    required: {'true' if p.required else 'false'}")
        if p.default is not None:
            default_val = p.default if not isinstance(p.default, str) else yaml_str(p.default)
            lines.append(f"    default: {default_val}")
        label_en_p, label_zh_p = PARAM_LABELS.get(p.name, (p.name.replace("_", " ").title(), p.name))
        lines.append("    label:")
        lines.append(f"      en_US: {yaml_str(label_en_p)}")
        lines.append(f"      zh_Hans: {yaml_str(label_zh_p)}")
        lines.append("    human_description:")
        lines.append(f"      en_US: {yaml_str(p.description_en)}")
        lines.append(f"      zh_Hans: {yaml_str(p.description_zh)}")
        lines.append(f"    llm_description: {yaml_str(p.description_en)}")
        if p.kind == ParamKind.SELECT:
            lines.append("    options:")
            for opt in p.options:
                lines.append(f"      - value: {opt}")
                lines.append("        label:")
                lines.append(f"          en_US: {yaml_str(opt)}")
                lines.append(f"          zh_Hans: {yaml_str(opt)}")
        lines.append("    form: llm")
    lines.append("extra:")
    lines.append("  python:")
    lines.append(f"    source: tools/{tool.hosted_name}.py")
    lines.append("")
    return "\n".join(lines)


TOOL_CLASS_NAME = {
    "novada_search": "NovadaSearchTool",
    "novada_extract": "NovadaExtractTool",
    "novada_crawl": "NovadaCrawlTool",
    "novada_map": "NovadaMapTool",
    "novada_research": "NovadaResearchTool",
    "novada_scrape": "NovadaScrapeTool",
    "novada_account": "NovadaAccountTool",
}

TOOL_PY_TEMPLATE = '''"""Thin Dify Tool subclass for `{hosted_name}`. All behavior lives in
`utils.tool_handler.invoke_novada_tool`, parameterized by hosted tool name — see
`utils/tools_table.py` for why this file is intentionally only a few lines."""
from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from utils.tool_handler import invoke_novada_tool


class {class_name}(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage]:
        api_key = self.runtime.credentials.get("api_key", "")
        yield from invoke_novada_tool(self, "{hosted_name}", api_key, tool_parameters)
'''


def _generated_files() -> dict[Path, str]:
    tools_dir = DIFY_DIR / "tools"
    out: dict[Path, str] = {}
    for tool in TOOLS:
        out[tools_dir / f"{tool.hosted_name}.yaml"] = emit_tool_yaml(tool)
        out[tools_dir / f"{tool.hosted_name}.py"] = TOOL_PY_TEMPLATE.format(
            hosted_name=tool.hosted_name,
            class_name=TOOL_CLASS_NAME[tool.hosted_name],
        )
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify committed tools/*.yaml and tools/*.py match the table; write nothing",
    )
    args = parser.parse_args()

    generated = _generated_files()

    if args.check:
        mismatches: list[str] = []
        for path, content in generated.items():
            rel = path.relative_to(DIFY_DIR)
            if not path.is_file():
                mismatches.append(f"{rel}: missing (table has a tool this file doesn't cover)")
                continue
            current = path.read_text(encoding="utf-8")
            if current != content:
                diff = "\n".join(
                    difflib.unified_diff(
                        current.splitlines(),
                        content.splitlines(),
                        fromfile=f"committed/{rel}",
                        tofile=f"generated/{rel}",
                        lineterm="",
                    )
                )
                mismatches.append(f"{rel}: differs from the table-generated version\n{diff}")
        if mismatches:
            print("gen_tool_yaml.py --check found drift between tools_table.py and tools/*:\n")
            print("\n\n".join(mismatches))
            return 1
        print(f"OK: {len(generated)} files match utils/tools_table.py.")
        return 0

    for path, content in generated.items():
        path.write_text(content, encoding="utf-8")
        print(f"wrote {path.relative_to(DIFY_DIR)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
