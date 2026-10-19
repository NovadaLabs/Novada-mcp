"""
Single source of truth for every file this plugin's test suite reads from outside
`distribution/dify/` — i.e. every path that only exists inside the full
`novada-mcp-dify` monorepo checkout, not in a standalone copy / `git archive` of
`distribution/dify/` alone (what actually ships to a `dify-plugins` fork, and what
the packaged `.difypkg` contains).

Round 2 fix (review-round2.md FIX-FIRST): previously `test_tools_parity.py` and
`test_timeout_coupling.py` each hardcoded their own
`Path(__file__).resolve().parents[3]` and target file, and
`.github/workflows/dify-plugin.yml`'s trigger `paths:` filters were hand-maintained
separately with no link back to what the tests actually read. So when the round-1
fix for F4 made `npm-package/src/config.ts` load-bearing for
`test_timeout_coupling.py`, the workflow filters silently missed it and the guard
never re-ran in CI on the one change it exists to catch.

Every monorepo-context test MUST resolve its external path through `get(name)` /
`require(input_)` below — no other hardcoded `parents[3]` (or any path literal that
escapes `distribution/dify/`) may appear anywhere else under `distribution/dify/`.
`tests/test_monorepo_coverage.py` enforces the other half: every entry registered
here (plus `distribution/dify/**` itself) is matched by some glob in the CI
workflow's `on.push.paths` / `on.pull_request.paths` filters.

Strict mode: set `DIFY_PLUGIN_REQUIRE_MONOREPO=1` (the CI workflow always does) to
turn every "monorepo input missing -> skip" below into a hard `pytest.fail`
instead. Locally, with the var unset, a standalone checkout of `distribution/dify/`
alone still skips these tests with a clear reason — that is the one case where
skipping is actually correct, since the file genuinely isn't shippable inside the
plugin.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import pytest

# distribution/dify/tests/monorepo_inputs.py -> repo root is 3 parents up
# (tests -> dify -> distribution -> repo root). This is the ONLY place under
# distribution/dify/ allowed to compute a monorepo-escaping path this way.
REPO_ROOT = Path(__file__).resolve().parents[3]

STRICT_ENV_VAR = "DIFY_PLUGIN_REQUIRE_MONOREPO"


@dataclass(frozen=True)
class MonorepoInput:
    """One file a test reads from outside `distribution/dify/`."""

    name: str
    # POSIX-style, relative to REPO_ROOT. Also the exact string a CI `paths:`
    # filter glob must cover — see tests/test_monorepo_coverage.py.
    repo_relative_path: str

    @property
    def path(self) -> Path:
        return REPO_ROOT / self.repo_relative_path

    def is_available(self) -> bool:
        return self.path.is_file()


MONOREPO_INPUTS: tuple[MonorepoInput, ...] = (
    MonorepoInput(
        name="hosted_tools_baseline",
        repo_relative_path="hosted-server/scripts/golden/baseline/toolslist-default.json",
    ),
    MonorepoInput(
        name="hosted_function_limit_config",
        repo_relative_path="npm-package/src/config.ts",
    ),
    MonorepoInput(
        name="ci_workflow_file",
        repo_relative_path=".github/workflows/dify-plugin.yml",
    ),
)

_BY_NAME: dict[str, MonorepoInput] = {entry.name: entry for entry in MONOREPO_INPUTS}
assert len(_BY_NAME) == len(MONOREPO_INPUTS), "duplicate MonorepoInput.name in MONOREPO_INPUTS"


def get(name: str) -> MonorepoInput:
    """Look up a registered monorepo input by name. Raises KeyError (loudly, not a
    silent None) if `name` was never registered above."""
    return _BY_NAME[name]


def strict_mode() -> bool:
    return os.environ.get(STRICT_ENV_VAR) == "1"


def require(input_: MonorepoInput) -> Path:
    """Call at the top of a monorepo-context test body. Returns the resolved,
    existing Path for `input_`.

    If the input is missing:
      - `DIFY_PLUGIN_REQUIRE_MONOREPO=1` (CI always sets this): hard `pytest.fail`.
        A missing monorepo input in strict mode means the guard silently didn't
        run — exactly the bug this module exists to close.
      - unset (the normal case for a local, standalone `distribution/dify`-only
        checkout): `pytest.skip` with a clear reason.
    """
    if input_.is_available():
        return input_.path
    reason = (
        f"monorepo context required for {input_.name!r} ({input_.path} not found) — "
        "this test only runs inside the full novada-mcp-dify checkout, not a "
        "standalone copy of distribution/dify"
    )
    if strict_mode():
        pytest.fail(
            f"{reason}. {STRICT_ENV_VAR}=1 is set, so a missing monorepo input is a "
            "hard failure here, not a skip (this is what CI sets)."
        )
    pytest.skip(reason)
