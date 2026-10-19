"""
Monorepo-context test (F4): confirms `utils.mcp_client.TIMEOUT_S` stays ahead of the
hosted server's own Vercel function wall-clock kill, so the client never gives up
before the server can return a structured result (or its own 504).

Reads the real source-of-truth constant from `npm-package/src/config.ts`
(`HOSTED_FUNCTION_LIMIT_MS`) rather than hardcoding a duplicate number here, so a
future change to that constant without a matching `TIMEOUT_S` bump fails this test
instead of silently drifting.

The path to that file is resolved via `tests/monorepo_inputs.py` (not hardcoded
here) — see that module for why, and for the `DIFY_PLUGIN_REQUIRE_MONOREPO` strict
mode that turns "file not found" into a hard failure instead of a skip when running
in CI, where this test must always actually run.
"""
from __future__ import annotations

import re

from tests.monorepo_inputs import get, require
from utils.mcp_client import TIMEOUT_S

CONFIG_INPUT = get("hosted_function_limit_config")

_CONST_RE = re.compile(r"HOSTED_FUNCTION_LIMIT_MS\s*=\s*([\d_]+)")


def test_client_timeout_exceeds_hosted_function_kill() -> None:
    config_path = require(CONFIG_INPUT)
    source = config_path.read_text(encoding="utf-8")
    match = _CONST_RE.search(source)
    assert match, (
        f"could not find HOSTED_FUNCTION_LIMIT_MS in {config_path} — "
        "has it been renamed? update this test's regex to match."
    )
    hosted_limit_ms = int(match.group(1).replace("_", ""))

    assert TIMEOUT_S * 1000 > hosted_limit_ms, (
        f"utils.mcp_client.TIMEOUT_S ({TIMEOUT_S}s = {TIMEOUT_S * 1000}ms) must exceed "
        f"the hosted function's own kill (HOSTED_FUNCTION_LIMIT_MS = {hosted_limit_ms}ms) "
        "so the server's structured result/504 always arrives before this client's "
        "timeout fires. Raise TIMEOUT_S (with margin) to match."
    )
