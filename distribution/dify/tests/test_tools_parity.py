"""
Parity test between `utils/tools_table.py` (what this plugin exposes) and the real
hosted MCP server's `tools/list` response (what mcp.novada.com actually accepts).

Two data sources, in priority order:
  1. `hosted-server/scripts/golden/baseline/toolslist-default.json` in the full
     monorepo checkout — the live golden baseline, so a hosted schema change is
     caught the next time this test runs inside the monorepo instead of silently
     going stale.
  2. `tests/fixtures/hosted_tools_snapshot.json` — a committed snapshot of just the
     7 tools this plugin exposes, taken from that same baseline at commit time. This
     is what a standalone checkout of `distribution/dify` (e.g. a `git archive`, or
     this directory copied into a `dify-plugins` fork with no monorepo parent) uses,
     since the monorepo baseline doesn't exist outside this repo.

Round 1 fix (F2): previously this test hard-required the monorepo baseline and
failed with 21 fixture-setup errors on a standalone checkout of `distribution/dify`
alone — the exact scope this plugin ships as. Falling back to the committed snapshot
fixes that; `test_snapshot_matches_monorepo_baseline` below re-closes the drift gap
this introduces by asserting the two agree whenever both are available (i.e. inside
the monorepo). Never silently skips the whole parity suite: if NEITHER source
exists, `hosted_tools` fails loudly instead of letting every parametrized test below
report a confusing downstream error.

Asserts, for every tool in `TOOLS`:
  1. The tool exists in the hosted `tools/list` response.
  2. Every param this plugin exposes exists in the hosted tool's `inputSchema` with a
     type compatible with the Dify param kind chosen for it (see
     `tools_table.ParamKind`/`_COMPATIBLE_HOSTED_TYPES`).
  3. Every hosted-side `required` param is exposed by this plugin (existence only —
     this plugin is allowed to be *stricter* than hosted, e.g. `novada_research`
     exposes `question` as Dify-required even though the hosted schema can't express
     its either/or `question`-or-`query` constraint and so marks neither required).
  4. Every `select` param's `options` matches the hosted `enum` exactly, as a set.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests.monorepo_inputs import get, require
from utils.tools_table import TOOLS, ParamKind

# The monorepo-only baseline path is resolved via tests/monorepo_inputs.py (not
# hardcoded here) — see that module for why.
BASELINE_INPUT = get("hosted_tools_baseline")
BASELINE_PATH = BASELINE_INPUT.path
SNAPSHOT_PATH = Path(__file__).resolve().parent / "fixtures" / "hosted_tools_snapshot.json"

EXPECTED_HOSTED_NAMES = {
    "novada_search",
    "novada_extract",
    "novada_crawl",
    "novada_map",
    "novada_research",
    "novada_scrape",
    "novada_account",
}


def _load_tools(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def hosted_tools() -> dict[str, dict]:
    if BASELINE_PATH.is_file():
        data = _load_tools(BASELINE_PATH)
    elif SNAPSHOT_PATH.is_file():
        data = _load_tools(SNAPSHOT_PATH)
    else:
        pytest.fail(
            "Cannot verify hosted tool parity: neither the monorepo baseline "
            f"({BASELINE_PATH}) nor the committed snapshot ({SNAPSHOT_PATH}) exists. "
            "This is not a skip — fix the fixture before trusting this plugin's "
            "parameter surface against the hosted contract."
        )
    return {t["name"]: t for t in data}


def test_snapshot_matches_monorepo_baseline() -> None:
    """Round 1 fix (F2): when the monorepo baseline IS available, assert the
    committed `hosted_tools_snapshot.json` (used by every test below on a standalone
    checkout) still matches it for the 7 tools this plugin exposes — so a hosted
    schema change updates the live baseline but leaves the plugin's frozen snapshot
    silently stale, caught here in the monorepo rather than only surfacing as a
    missed parity failure on someone's standalone checkout.

    Round 2: the "monorepo baseline not present -> skip" gate is now
    `tests.monorepo_inputs.require()` (see that module), so CI's
    `DIFY_PLUGIN_REQUIRE_MONOREPO=1` turns a missing baseline into a hard failure
    instead of a silent skip.
    """
    baseline_path = require(BASELINE_INPUT)
    baseline = {t["name"]: t for t in _load_tools(baseline_path) if t["name"] in EXPECTED_HOSTED_NAMES}
    snapshot = {t["name"]: t for t in _load_tools(SNAPSHOT_PATH)}
    assert snapshot.keys() == EXPECTED_HOSTED_NAMES, (
        f"tests/fixtures/hosted_tools_snapshot.json covers {sorted(snapshot.keys())}, "
        f"expected exactly {sorted(EXPECTED_HOSTED_NAMES)}"
    )
    assert baseline.keys() == EXPECTED_HOSTED_NAMES, (
        "hosted-server/scripts/golden/baseline/toolslist-default.json is missing one "
        f"of the 7 tools this plugin exposes: {EXPECTED_HOSTED_NAMES - baseline.keys()}"
    )
    for name in EXPECTED_HOSTED_NAMES:
        assert snapshot[name] == baseline[name], (
            f"{name}: tests/fixtures/hosted_tools_snapshot.json has drifted from the "
            "live hosted-server golden baseline. Regenerate the snapshot (copy the 7 "
            "tool entries from "
            "hosted-server/scripts/golden/baseline/toolslist-default.json) and commit "
            "the update."
        )


def _hosted_types(prop_schema: dict) -> set[str]:
    """Collects the JSON-Schema `type` value(s) a hosted property can take, handling
    both a direct `type` key and an `anyOf` list of sub-schemas (e.g. novada_extract's
    `url`, which accepts a single string or an array of strings)."""
    types: set[str] = set()
    if "type" in prop_schema:
        types.add(prop_schema["type"])
    for branch in prop_schema.get("anyOf", []):
        if "type" in branch:
            types.add(branch["type"])
    return types


def test_table_covers_exactly_the_seven_spec_tools() -> None:
    names = {t.hosted_name for t in TOOLS}
    assert names == EXPECTED_HOSTED_NAMES, (
        f"TOOLS surface drifted from the spec's 7-tool list: "
        f"missing={EXPECTED_HOSTED_NAMES - names}, extra={names - EXPECTED_HOSTED_NAMES}"
    )


def test_no_duplicate_param_names_within_a_tool() -> None:
    for tool in TOOLS:
        names = [p.name for p in tool.params]
        assert len(names) == len(set(names)), f"{tool.hosted_name} has duplicate param names: {names}"


@pytest.mark.parametrize("tool", TOOLS, ids=lambda t: t.hosted_name)
def test_tool_exists_on_hosted_server(tool, hosted_tools) -> None:
    assert tool.hosted_name in hosted_tools, f"{tool.hosted_name} is not in the hosted tools/list response"


@pytest.mark.parametrize("tool", TOOLS, ids=lambda t: t.hosted_name)
def test_hosted_required_params_are_exposed(tool, hosted_tools) -> None:
    hosted_schema = hosted_tools[tool.hosted_name]["inputSchema"]
    hosted_required = set(hosted_schema.get("required", []))
    exposed = {p.name for p in tool.params}
    missing = hosted_required - exposed
    assert not missing, f"{tool.hosted_name}: hosted-required params not exposed by this plugin: {missing}"


@pytest.mark.parametrize("tool", TOOLS, ids=lambda t: t.hosted_name)
def test_every_exposed_param_matches_hosted_schema(tool, hosted_tools) -> None:
    hosted_props = hosted_tools[tool.hosted_name]["inputSchema"]["properties"]
    for p in tool.params:
        assert p.name in hosted_props, (
            f"{tool.hosted_name}.{p.name}: exposed by this plugin but not present in the "
            "hosted inputSchema at all"
        )
        hosted_types = _hosted_types(hosted_props[p.name])
        assert hosted_types & p.compatible_hosted_types, (
            f"{tool.hosted_name}.{p.name}: Dify kind {p.kind!r} (compatible with "
            f"{sorted(p.compatible_hosted_types)}) does not match hosted type(s) "
            f"{sorted(hosted_types)}"
        )
        if p.kind == ParamKind.SELECT:
            hosted_enum = set(hosted_props[p.name].get("enum", []))
            assert hosted_enum, f"{tool.hosted_name}.{p.name}: exposed as select but hosted schema has no enum"
            assert set(p.options) == hosted_enum, (
                f"{tool.hosted_name}.{p.name}: select options {sorted(p.options)} != "
                f"hosted enum {sorted(hosted_enum)}"
            )
