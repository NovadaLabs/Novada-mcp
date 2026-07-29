#!/usr/bin/env bash
# monitoring/report/run-daily-report.sh
#
# Runs Layer D's full-tools probe and appends the result as today's sheet in
# the ONE accumulating local Excel workbook (see append-daily-sheet.py).
# Meant to be invoked by a local launchd job (~2:57am) on the owner's Mac —
# called by ABSOLUTE PATH, so it must not depend on the caller's cwd.
#
# Secrets: the test key lives OUTSIDE this repo at ~/.novada/monitor.env
# (chmod 600) and is sourced, never hardcoded here.
#
# Exit code: 0 unless the probe could not run at all (e.g. `node` missing, no
# report JSON produced) or the Excel appender itself failed. A backend-only
# (③) tool red is NOT a failure of this job — the whole point is to RECORD
# the day, including reds, in the workbook. The probe's own exit code (0 or
# 1 — 1 only on an ours-domain ①/② P0/P1 finding or a missing tool, see
# monitoring/smoke/full-tools-probe.mjs) is logged but never aborts this
# script.
set -euo pipefail

# ── Resolve repo root from this script's own location (launchd calls this
# by absolute path with no meaningful cwd) ──────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

# Timestamp the run start so we can verify the probe produced a FRESH report
# below (never silently re-append a stale one from a prior run/day).
RUN_START_EPOCH="$(date +%s)"

# ── Load the test key from OUTSIDE the repo. NEVER hardcode it here. ───────
ENV_FILE="${HOME}/.novada/monitor.env"
if [ ! -f "${ENV_FILE}" ]; then
  echo "[run-daily-report] FATAL: ${ENV_FILE} not found — cannot load NOVADA_TEST_KEY." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a

if [ -z "${NOVADA_TEST_KEY:-}" ]; then
  echo "[run-daily-report] FATAL: NOVADA_TEST_KEY is empty after sourcing ${ENV_FILE}." >&2
  exit 1
fi

# ── Run the probe. Its exit code (0 or 1) reflects ours-domain findings —
# NOT whether we should record the day — so capture it without aborting the
# script (temporarily disable -e around just this command). ────────────────
set +e
MONITOR_QUIET=1 NOVADA_TEST_KEY="${NOVADA_TEST_KEY}" node monitoring/smoke/full-tools-probe.mjs
PROBE_EXIT=$?
set -e
echo "[run-daily-report] probe exit code: ${PROBE_EXIT} (informational only — not fatal to this job)"

# ── Find the newest report JSON. If none exists, the probe genuinely could
# not run (e.g. it crashed before ever writing a report) — that IS fatal. ──
NEWEST_JSON="$(ls -t monitoring/reports/full-*.json 2>/dev/null | head -1 || true)"
if [ -z "${NEWEST_JSON}" ]; then
  echo "[run-daily-report] FATAL: no monitoring/reports/full-*.json found — the probe did not run at all." >&2
  exit 1
fi
echo "[run-daily-report] using report: ${NEWEST_JSON}"

# ── Freshness guard: the newest report must have been written DURING this run.
# A catastrophic failure (missing `node`, a syntax error in the probe itself,
# an OOM-kill before the probe's own crash-fallback writes a report) would
# leave only a stale file, and `ls -t` would then pick YESTERDAY's report — so
# we'd silently record stale data as "today". Compare mtime to the run start.
# BSD stat (macOS/launchd) first, GNU stat (`-c %Y`) fallback. ──────────────
NEWEST_MTIME="$(stat -f %m "${NEWEST_JSON}" 2>/dev/null || stat -c %Y "${NEWEST_JSON}" 2>/dev/null || echo 0)"
if [ "${NEWEST_MTIME}" -lt "${RUN_START_EPOCH}" ]; then
  echo "[run-daily-report] FATAL: newest report ${NEWEST_JSON} (mtime ${NEWEST_MTIME}) predates this run's start (${RUN_START_EPOCH}) — the probe did not produce a fresh report this run; refusing to append stale data as today." >&2
  exit 1
fi

# ── Append today's sheet into the accumulating workbook. ──────────────────
XLSX_PATH="${NOVADA_MONITOR_XLSX:-${HOME}/Projects/novada-mcp/reports/novada-mcp-daily-monitor.xlsx}"
mkdir -p "$(dirname "${XLSX_PATH}")"

# Use ${PYTHON:-python3}: openpyxl may live in a DIFFERENT python3 than the one
# a minimal launchd PATH resolves (e.g. homebrew's python3 lacks it here). The
# launchd plist sets PYTHON to the interpreter that has openpyxl; interactive
# runs fall back to bare python3. Keeps this script portable (no hardcoded path).
"${PYTHON:-python3}" monitoring/report/append-daily-sheet.py "${NEWEST_JSON}" "${XLSX_PATH}"
echo "[run-daily-report] done -> ${XLSX_PATH}"
