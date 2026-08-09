#!/usr/bin/env python3
"""
test_diff_golden.py — subprocess-level tests for diff-golden.py's
redaction-probe.json field-scoped hard gate (see _check_redaction_probe /
_redaction_probe_stable in diff-golden.py).

These tests invoke the REAL diff-golden.py as a subprocess
(`sys.executable diff-golden.py <baseline_dir> <after_dir>`) against crafted
temp directories — they never re-implement diff-golden.py's comparison logic.
A test that reconstructed the comparison in Python would prove nothing about
the actual script's behavior.

Fixture strategy: each test copies the real baseline/ dir (checked into this
same directory) into two temp dirs — "baseline" and "after" — so every
sibling golden file (refused-set.json, toolslist-*.json, error-path.json,
initialize.json, dispatch-matrix.json, version.txt) matches out of the box
and only the intentional mutation under test can cause a hard-gate failure.
Then the test mutates ONLY redaction-probe.json (in baseline or after, per
scenario) and asserts the resulting exit code.

Run:
    python3 test_diff_golden.py
    python3 -m unittest test_diff_golden -v
"""

import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
DIFF_GOLDEN = THIS_DIR / "diff-golden.py"
REAL_BASELINE = THIS_DIR / "baseline"


def run_diff_golden(baseline_dir: Path, after_dir: Path) -> subprocess.CompletedProcess:
    """Invoke the real diff-golden.py as a subprocess. Returns the completed
    process (caller asserts on .returncode; .stdout/.stderr available for
    debugging a failing assertion)."""
    return subprocess.run(
        [sys.executable, str(DIFF_GOLDEN), str(baseline_dir), str(after_dir)],
        capture_output=True,
        text=True,
    )


class DiffGoldenRedactionProbeTests(unittest.TestCase):
    """Each test gets its own pair of fresh temp dirs (baseline_dir/after_dir),
    both seeded from the real checked-in baseline/ so all 6 whole-file
    HARD_GATE_FILES plus dispatch-matrix.json match identically and only the
    redaction-probe.json mutation under test can move the exit code."""

    def setUp(self):
        self._tmp_stack = []

    def tearDown(self):
        for tmp in self._tmp_stack:
            tmp.cleanup()

    def _make_dirs(self):
        """Create baseline_dir and after_dir, each seeded as a full copy of
        the real baseline/ fixture. Returns (baseline_dir, after_dir) Paths."""
        b_tmp = self._new_tempdir()
        a_tmp = self._new_tempdir()
        baseline_dir = Path(b_tmp.name) / "baseline"
        after_dir = Path(a_tmp.name) / "after"
        shutil.copytree(REAL_BASELINE, baseline_dir)
        shutil.copytree(REAL_BASELINE, after_dir)
        return baseline_dir, after_dir

    def _new_tempdir(self):
        import tempfile
        tmp = tempfile.TemporaryDirectory()
        self._tmp_stack.append(tmp)
        return tmp

    @staticmethod
    def _load_probe(dir_path: Path) -> dict:
        return json.loads((dir_path / "redaction-probe.json").read_text())

    @staticmethod
    def _write_probe(dir_path: Path, data: dict) -> None:
        (dir_path / "redaction-probe.json").write_text(json.dumps(data, indent=2))

    # 1. unmutated copy (baseline vs identical after) -> exit 0
    def test_unmutated_copy_is_clean(self):
        baseline_dir, after_dir = self._make_dirs()
        result = run_diff_golden(baseline_dir, after_dir)
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)

    # 2. `note` differs -> exit 1
    def test_note_differs_hard_fails(self):
        baseline_dir, after_dir = self._make_dirs()
        probe = self._load_probe(after_dir)
        probe["note"] = probe["note"] + " MUTATED"
        self._write_probe(after_dir, probe)
        result = run_diff_golden(baseline_dir, after_dir)
        self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)

    # 3. new key added to `leak_checks` in after -> exit 1
    def test_leak_checks_new_key_hard_fails(self):
        baseline_dir, after_dir = self._make_dirs()
        probe = self._load_probe(after_dir)
        probe["leak_checks"]["new_check_field"] = False
        self._write_probe(after_dir, probe)
        result = run_diff_golden(baseline_dir, after_dir)
        self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)

    # 4. `leaked=true` in after -> exit 1
    def test_leaked_true_in_after_hard_fails(self):
        baseline_dir, after_dir = self._make_dirs()
        probe = self._load_probe(after_dir)
        probe["leaked"] = True
        self._write_probe(after_dir, probe)
        result = run_diff_golden(baseline_dir, after_dir)
        self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)

    # 5. `leaked` key deleted from after -> exit 1 (Change 1's new behavior;
    #    this used to be exit 0 before the missing-key guard was added)
    def test_leaked_key_absent_in_after_hard_fails(self):
        baseline_dir, after_dir = self._make_dirs()
        probe = self._load_probe(after_dir)
        del probe["leaked"]
        self._write_probe(after_dir, probe)
        result = run_diff_golden(baseline_dir, after_dir)
        self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)

    # 6. baseline itself has `leaked=true` -> exit 1
    def test_leaked_true_in_baseline_hard_fails(self):
        baseline_dir, after_dir = self._make_dirs()
        probe = self._load_probe(baseline_dir)
        probe["leaked"] = True
        self._write_probe(baseline_dir, probe)
        result = run_diff_golden(baseline_dir, after_dir)
        self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)

    # 7. `trigger_tool` differs -> exit 1
    def test_trigger_tool_differs_hard_fails(self):
        baseline_dir, after_dir = self._make_dirs()
        probe = self._load_probe(after_dir)
        probe["trigger_tool"] = "novada_unblock"
        self._write_probe(after_dir, probe)
        result = run_diff_golden(baseline_dir, after_dir)
        self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)

    # 8. only `sample_markers` differs -> exit 0 (advisory, not gated)
    def test_sample_markers_differ_is_advisory_only(self):
        baseline_dir, after_dir = self._make_dirs()
        probe = self._load_probe(after_dir)
        probe["sample_markers"] = ["Completely", "Different", "Headings"]
        self._write_probe(after_dir, probe)
        result = run_diff_golden(baseline_dir, after_dir)
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)

    # 9. redaction-probe.json missing from after dir -> exit 1
    def test_redaction_probe_missing_from_after_hard_fails(self):
        baseline_dir, after_dir = self._make_dirs()
        (after_dir / "redaction-probe.json").unlink()
        result = run_diff_golden(baseline_dir, after_dir)
        self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)

    # 10. redaction-probe.json missing from baseline dir -> exit 1
    def test_redaction_probe_missing_from_baseline_hard_fails(self):
        baseline_dir, after_dir = self._make_dirs()
        (baseline_dir / "redaction-probe.json").unlink()
        result = run_diff_golden(baseline_dir, after_dir)
        self.assertEqual(result.returncode, 1, msg=result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
