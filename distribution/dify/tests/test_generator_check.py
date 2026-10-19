"""
Round 1 (F9): confirms `scripts/gen_tool_yaml.py --check` finds zero drift between
`utils/tools_table.py` and the committed `tools/*.yaml` / `tools/*.py` pairs. Runs
the script as a real subprocess (not an in-process import) so this test exercises
exactly what a contributor or CI would run, including argument parsing and the exit
code contract. Works standalone (no monorepo context needed) — everything the
generator touches lives inside `distribution/dify`.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

DIFY_DIR = Path(__file__).resolve().parents[1]
GENERATOR = DIFY_DIR / "scripts" / "gen_tool_yaml.py"


def test_generator_check_mode_reports_no_drift() -> None:
    result = subprocess.run(
        [sys.executable, str(GENERATOR), "--check"],
        cwd=DIFY_DIR,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, (
        "tools_table.py has drifted from the committed tools/*.yaml and/or "
        "tools/*.py files — re-run `python3 scripts/gen_tool_yaml.py` and commit "
        f"the result.\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
    assert "OK" in result.stdout
