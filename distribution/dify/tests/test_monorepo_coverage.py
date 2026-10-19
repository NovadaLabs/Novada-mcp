"""
Round 2 fix (review-round2.md FIX-FIRST): asserts the CI workflow's `paths:`
trigger filters actually cover every file `tests/monorepo_inputs.py` declares as a
monorepo-context input, plus `distribution/dify/**` itself (the plugin's own
source, which must always trigger this workflow). Closes the exact gap the review
found: `npm-package/src/config.ts` was read by `test_timeout_coupling.py` but not
covered by any filter, so a PR that only changed that constant never re-ran this
workflow.

Parses the workflow YAML with a small, deliberately narrow regex-based extractor
(no PyYAML dependency) — this repo's own two trigger blocks (`on.push`,
`on.pull_request`) use a simple `paths:` list-of-quoted-strings shape, and the
extractor asserts (rather than silently returning nothing) if that shape ever
changes, so a workflow restructure fails this test loudly instead of quietly
stopping checking anything.

Monorepo-context test: requires `.github/workflows/dify-plugin.yml` itself, which
is registered in `MONOREPO_INPUTS` (name="ci_workflow_file") — skipped on a
standalone `distribution/dify` checkout, hard-failed instead under
`DIFY_PLUGIN_REQUIRE_MONOREPO=1` (see `tests/monorepo_inputs.py`).
"""
from __future__ import annotations

import fnmatch
import re

import pytest

from tests.monorepo_inputs import MONOREPO_INPUTS, get, require

WORKFLOW_INPUT = get("ci_workflow_file")

_SECTION_RE_TEMPLATE = r"^  {key}:\n((?:(?:    .*)?\n)*)"
_PATHS_BLOCK_RE = re.compile(r"^    paths:\n((?:      - .*\n)*)", re.MULTILINE)
_QUOTED_ITEM_RE = re.compile(r'^\s*-\s*"([^"]+)"\s*$', re.MULTILINE)


def _trigger_section(workflow_text: str, key: str) -> str:
    pattern = re.compile(_SECTION_RE_TEMPLATE.format(key=re.escape(key)), re.MULTILINE)
    match = pattern.search(workflow_text)
    assert match, (
        f"could not find an `on.{key}:` trigger section in {WORKFLOW_INPUT.path} — "
        "has the workflow's structure changed? update this test's parser."
    )
    return match.group(1)


def _paths_filter(section_text: str, key: str) -> list[str]:
    match = _PATHS_BLOCK_RE.search(section_text)
    assert match, (
        f"could not find a `paths:` filter list under `on.{key}:` in "
        f"{WORKFLOW_INPUT.path} — has the workflow's structure changed?"
    )
    items = _QUOTED_ITEM_RE.findall(match.group(1))
    assert items, (
        f"`on.{key}.paths` parsed as empty in {WORKFLOW_INPUT.path} — the parser "
        "regex has drifted from the workflow's actual formatting."
    )
    return items


def path_matches_any(candidate: str, patterns: list[str]) -> bool:
    """fnmatch-style match: GitHub Actions' `**` falls directly out of fnmatch's
    translation of `*` to `.*` (two consecutive `.*` collapse to the same thing as
    one `.*`), so `"a/**"` matches `"a/b/c.json"` the same way GA's own `**` would.
    This is an approximation, not real gitignore-glob semantics (a bare `*` here
    also crosses `/`, which GA's wouldn't) — acceptable because every filter this
    repo actually uses is either an exact literal path or ends in `/**`.
    """
    return any(fnmatch.fnmatchcase(candidate, pattern) for pattern in patterns)


@pytest.mark.parametrize(
    "candidate,patterns,expected",
    [
        ("distribution/dify/tests/test_foo.py", ["distribution/dify/**"], True),
        ("npm-package/src/config.ts", ["hosted-server/scripts/golden/baseline/**"], False),
        (".github/workflows/dify-plugin.yml", [".github/workflows/dify-plugin.yml"], True),
    ],
)
def test_path_matches_any_matcher(candidate: str, patterns: list[str], expected: bool) -> None:
    assert path_matches_any(candidate, patterns) is expected


@pytest.mark.parametrize("trigger_key", ["push", "pull_request"])
def test_ci_path_filters_cover_every_monorepo_input(trigger_key: str) -> None:
    workflow_path = require(WORKFLOW_INPUT)
    workflow_text = workflow_path.read_text(encoding="utf-8")
    filters = _paths_filter(_trigger_section(workflow_text, trigger_key), trigger_key)

    # distribution/dify/** is the plugin's own source tree. It isn't itself a
    # MonorepoInput (it's not a path a test *reads from outside* distribution/dify
    # — it's the thing being tested), so it's required here explicitly rather than
    # via the table.
    required = [entry.repo_relative_path for entry in MONOREPO_INPUTS] + ["distribution/dify/**"]
    uncovered = [item for item in required if not path_matches_any(item, filters)]
    assert not uncovered, (
        f"on.{trigger_key}.paths in {workflow_path} does not cover: {uncovered}. "
        "Every entry in tests/monorepo_inputs.MONOREPO_INPUTS (plus "
        "distribution/dify/**) must be matched by a filter glob, or a change to "
        "that file silently never re-runs this workflow. Filters seen: " + repr(filters)
    )
