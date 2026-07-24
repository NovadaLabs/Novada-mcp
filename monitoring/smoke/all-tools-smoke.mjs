#!/usr/bin/env node
/**
 * monitoring/smoke/all-tools-smoke.mjs
 *
 * Layer B of the synthetic monitor for the live Novada hosted MCP
 * (https://mcp.novada.com) — see monitoring/README.md for the full
 * three-layer picture (A: external liveness ping, B: this script, C: k6
 * stress). Dependency-free Node >=20 script; run directly with `node`.
 *
 * Usage:
 *   NOVADA_TEST_KEY=<key> node monitoring/smoke/all-tools-smoke.mjs
 *   NOVADA_TEST_KEY=<key> SMOKE_SCRAPERS=1 node monitoring/smoke/all-tools-smoke.mjs
 *   NOVADA_TEST_KEY=<key> UPDATE_BASELINE=1 node monitoring/smoke/all-tools-smoke.mjs
 *
 * Env vars:
 *   NOVADA_TEST_KEY  (required) test API key — NEVER hardcode, env only.
 *   MCP_URL          (optional) override the endpoint (see lib/mcp-client.mjs).
 *   SMOKE_SCRAPERS   (optional) "1" to also execute one real Tier-3 scraper
 *                    call (costs credits). Default off.
 *   SMOKE_SLOW_MS    (optional) threshold in ms above which a passing call is
 *                    classified "slow" instead of "pass". Default 15000.
 *   SMOKE_DELAY_MS   (optional) delay between sequential probe calls, to stay
 *                    friendly to the rate limiter. Default 300.
 *   UPDATE_BASELINE  (optional) "1" to intentionally rewrite
 *                    monitoring/smoke/baseline-tools.json from this run's
 *                    live `tools/list` (e.g. after a deliberate tool
 *                    add/rename). Not for routine CI use.
 *   MONITOR_QUIET    (optional) "1" to suppress the per-tool table, the
 *                    new/missing tool name lists, and the detailed
 *                    `SUMMARY: {...}` line from stdout, printing only a
 *                    single non-revealing completion line instead (no tool
 *                    names). The full detail is UNAFFECTED in the JSON
 *                    report file. This repo's GitHub Actions logs are PUBLIC
 *                    (world-readable), so the CI workflow sets this to "1";
 *                    local/manual runs leave it unset for full output.
 *
 * What it does:
 *   1. `tools/list` (live) -> single source of truth for the tool inventory.
 *      NEVER hardcodes the tool-name list.
 *   2. Tier-1: executes a handful of free/cheap read-only tools, every run.
 *   3. Tier-2: presence-checks EVERY live tool (no execution) and diffs
 *      against the COMMITTED baseline file
 *      (monitoring/smoke/baseline-tools.json — checked into git, unlike
 *      monitoring/reports/ which is gitignored and therefore empty on every
 *      fresh CI checkout) to catch removed/renamed tools (contract drift):
 *        - a baseline tool missing from live tools/list = REGRESSION (fails
 *          the run, non-zero exit).
 *        - a live tool not yet in the baseline = informational "new tool"
 *          warning only (never fails) — run with UPDATE_BASELINE=1 to adopt
 *          it into the baseline once the addition is intentional.
 *        - if baseline-tools.json is missing entirely, this run bootstraps
 *          it from the live tool list and passes (nothing to diff against
 *          yet).
 *   4. Tier-3: only when SMOKE_SCRAPERS=1, executes ONE rotating, known-good
 *      scraper call. Scrapers with a documented backend-side flakiness
 *      history (TOW2-305) are never classified as a regression.
 *   5. Prints a human summary table, writes a JSON report to
 *      monitoring/reports/smoke-<UTC timestamp>.json (an artifact only — it
 *      is NOT read back as a baseline on the next run), and exits non-zero
 *      ONLY for a real regression (a Tier-1 failure, or a baseline tool
 *      going missing) — never for `fail-backend-known` or a skipped Tier-3.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callTool, listTools, MCP_URL, requireTestKey } from "../lib/mcp-client.mjs";
import {
  NEVER_EXECUTE_TOOL_NAMES,
  TIER1_PROBES,
  isBackendKnownFlaky,
  pickTier3Sample,
} from "./tool-probes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONITORING_DIR = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(MONITORING_DIR, "reports");
const BASELINE_FILE = path.join(__dirname, "baseline-tools.json");
const BASELINE_FILE_REL = "monitoring/smoke/baseline-tools.json";

const RUN_SCRAPERS = process.env.SMOKE_SCRAPERS === "1";
const UPDATE_BASELINE = process.env.UPDATE_BASELINE === "1";
const SLOW_MS = Number(process.env.SMOKE_SLOW_MS) > 0 ? Number(process.env.SMOKE_SLOW_MS) : 15000;
const CALL_DELAY_MS = Number(process.env.SMOKE_DELAY_MS) >= 0 ? Number(process.env.SMOKE_DELAY_MS) : 300;

// See the MONITOR_QUIET doc comment above.
const QUIET = process.env.MONITOR_QUIET === "1";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sortable-as-string, filesystem-safe timestamp: 2026-07-23T14-05-00-123Z */
function isoForFilename(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

/**
 * Load the committed Tier-2 drift baseline (monitoring/smoke/baseline-tools.json).
 * This file IS checked into git (unlike monitoring/reports/, which is
 * gitignored) so it survives a fresh CI checkout — the whole point of FIX 1.
 * A missing file returns `null` (caller bootstraps it); a corrupt/malformed
 * file is treated the same way (non-fatal, logged) rather than crashing the
 * run.
 *
 * @returns {{capturedAt: string, tools: string[]}|null}
 */
function loadBaseline() {
  let raw;
  try {
    raw = readFileSync(BASELINE_FILE, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    console.error(`[all-tools-smoke] WARN: could not read baseline "${BASELINE_FILE_REL}": ${err.message}`);
    return null;
  }
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data.tools)) {
      console.error(`[all-tools-smoke] WARN: baseline "${BASELINE_FILE_REL}" has no "tools" array — treating as absent`);
      return null;
    }
    return data;
  } catch (err) {
    console.error(`[all-tools-smoke] WARN: could not parse baseline "${BASELINE_FILE_REL}": ${err.message}`);
    return null;
  }
}

/**
 * (Re)write the committed baseline from a live tool-name list, sorted for a
 * clean, stable diff in git history.
 *
 * @param {string[]} toolNames
 * @returns {{capturedAt: string, tools: string[]}}
 */
function writeBaseline(toolNames) {
  const data = {
    capturedAt: new Date().toISOString(),
    tools: [...toolNames].sort(),
  };
  writeFileSync(BASELINE_FILE, `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

/** Refuse (hard throw) to execute a write-tool, no matter where it came from. */
function assertExecutable(toolName, tierLabel) {
  if (NEVER_EXECUTE_TOOL_NAMES.has(toolName)) {
    throw new Error(
      `[all-tools-smoke] REFUSING to execute write-tool "${toolName}" from ${tierLabel} — ` +
        `this is a hard safety invariant, not a bug in the probe registry.`
    );
  }
}

function classifyExecuted(ok, timeMs) {
  if (!ok) return "fail-server";
  if (timeMs > SLOW_MS) return "slow";
  return "pass";
}

/** Tier-1: sequential, small delay between calls, every run. */
async function runTier1() {
  const rows = [];
  for (const probe of TIER1_PROBES) {
    assertExecutable(probe.name, "Tier-1");
    let res;
    try {
      res = await callTool(probe.name, probe.args, { timeoutMs: 30000 });
    } catch (err) {
      res = { ok: false, httpStatus: 0, timeMs: 0, text: null, error: String(err?.message || err) };
    }
    rows.push({
      tier: 1,
      name: probe.name,
      args: probe.args,
      status: classifyExecuted(res.ok, res.timeMs),
      httpStatus: res.httpStatus,
      timeMs: res.timeMs,
      error: res.ok ? null : res.error,
    });
    await sleep(CALL_DELAY_MS);
  }
  return rows;
}

/**
 * Tier-2: presence-only, zero tool execution. Every tool the live
 * `tools/list` returns is "pass" by construction (it IS present in this
 * run). The real signal is the diff against the committed baseline.
 */
function runTier2(liveTools, baseline) {
  const currentNames = liveTools.map((t) => t.name);
  const currentNameSet = new Set(currentNames);
  const baselineNames = Array.isArray(baseline?.tools) ? baseline.tools : [];
  const baselineNameSet = new Set(baselineNames);

  const rows = liveTools.map((t) => ({
    tier: 2,
    name: t.name,
    status: "pass",
    hasAnnotations: t.annotations != null,
    hasInputSchema: t.inputSchema != null,
  }));

  const missingNames = baselineNames.filter((n) => !currentNameSet.has(n));
  for (const name of missingNames) {
    rows.push({
      tier: 2,
      name,
      status: "missing",
      error: `present in committed baseline (${BASELINE_FILE_REL}), absent from live tools/list this run`,
    });
  }

  const newNames = currentNames.filter((n) => !baselineNameSet.has(n));

  return { rows, currentNames, missingNames, newNames };
}

/** Tier-3: gated, ONE rotating scraper call, or a "skipped" placeholder row. */
async function runTier3() {
  const probe = pickTier3Sample();

  if (!RUN_SCRAPERS) {
    return [
      {
        tier: 3,
        name: probe.name,
        args: probe.args,
        status: "skipped",
        error: null,
        note: "SMOKE_SCRAPERS != 1 (default off — real scraper calls cost credits)",
      },
    ];
  }

  assertExecutable(probe.name, "Tier-3");
  let res;
  try {
    res = await callTool(probe.name, probe.args, { timeoutMs: 45000 });
  } catch (err) {
    res = { ok: false, httpStatus: 0, timeMs: 0, text: null, error: String(err?.message || err) };
  }

  let status;
  if (!res.ok) {
    status = isBackendKnownFlaky(probe.name) ? "fail-backend-known" : "fail-server";
  } else {
    status = res.timeMs > SLOW_MS ? "slow" : "pass";
  }

  return [
    {
      tier: 3,
      name: probe.name,
      args: probe.args,
      status,
      httpStatus: res.httpStatus,
      timeMs: res.timeMs,
      error: res.ok ? null : res.error,
    },
  ];
}

/** Print an aligned, human-readable table for executed rows (Tier-1 + Tier-3). */
function printExecutedTable(rows) {
  const headers = ["tier", "name", "status", "http", "ms"];
  const cells = rows.map((r) => [
    String(r.tier),
    r.name,
    r.status,
    r.httpStatus != null ? String(r.httpStatus) : "-",
    r.timeMs != null ? String(r.timeMs) : "-",
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((row) => row[i].length)));
  const fmt = (row) => row.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(fmt(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of cells) console.log(fmt(row));
}

async function main() {
  requireTestKey(); // fail fast, before any network call, with a clear error

  // MCP_URL is gated too — defense-in-depth in case a future URL scheme
  // embeds a key (e.g. a `/:key/mcp` path form); QUIET must never leak
  // anything, even something that looks harmless today.
  if (!QUIET) {
    console.log(`[all-tools-smoke] MCP_URL=${MCP_URL}`);
  }
  console.log(
    `[all-tools-smoke] SMOKE_SCRAPERS=${RUN_SCRAPERS ? "1 (Tier-3 WILL execute a real scraper call)" : "0 (Tier-3 skipped by default)"}`
  );

  const startedAt = new Date();
  const liveTools = await listTools();
  console.log(`[all-tools-smoke] live tools/list returned ${liveTools.length} tool(s)`);

  let baseline = loadBaseline();
  let baselineBootstrapped = false;
  if (UPDATE_BASELINE) {
    baseline = writeBaseline(liveTools.map((t) => t.name));
    console.log(
      `[all-tools-smoke] UPDATE_BASELINE=1 — rewrote ${BASELINE_FILE_REL} with ${baseline.tools.length} tool(s) (captured ${baseline.capturedAt})`
    );
  } else if (!baseline) {
    baseline = writeBaseline(liveTools.map((t) => t.name));
    baselineBootstrapped = true;
    console.log(
      `[all-tools-smoke] ${BASELINE_FILE_REL} not found — bootstrapped it with ${baseline.tools.length} tool(s) ` +
        `(first run; no drift check performed this run — commit this file)`
    );
  } else {
    console.log(
      `[all-tools-smoke] drift baseline: ${BASELINE_FILE_REL} (captured ${baseline.capturedAt}, ${baseline.tools.length} tool(s))`
    );
  }

  const tier1Rows = await runTier1();
  const { rows: tier2Rows, currentNames, missingNames, newNames } = runTier2(liveTools, baseline);
  const tier3Rows = await runTier3();

  if (!QUIET) {
    console.log("");
    console.log("Tier-1 (executed every run) + Tier-3 (rotating scraper sample):");
    printExecutedTable([...tier1Rows, ...tier3Rows]);

    console.log("");
    console.log(
      `Tier-2 (presence-only, ${tier2Rows.filter((r) => r.status === "pass").length}/${liveTools.length} tool(s) present):`
    );
    if (newNames.length > 0) {
      console.log(`  + new since baseline (WARN only, not a failure): ${newNames.join(", ")}`);
      console.log(
        `    baseline out of date — run with UPDATE_BASELINE=1 to refresh ${BASELINE_FILE_REL}`
      );
    }
    if (missingNames.length > 0) {
      console.log(`  ! MISSING since baseline (regression): ${missingNames.join(", ")}`);
    } else if (!baselineBootstrapped) {
      console.log("  no drift — all baseline tools still present");
    }
  }

  const tier1Failures = tier1Rows.filter((r) => r.status === "fail-server");
  const regressions = [...tier1Failures, ...tier2Rows.filter((r) => r.status === "missing")];

  const allRows = [...tier1Rows, ...tier2Rows, ...tier3Rows];
  const byStatus = allRows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  const summary = {
    totalRows: allRows.length,
    byStatus,
    tier1Failures: tier1Failures.map((r) => r.name),
    missingTools: missingNames,
    newTools: newNames,
    regressionCount: regressions.length,
  };

  if (!QUIET) {
    console.log("");
    console.log(`SUMMARY: ${JSON.stringify(summary)}`);
  }

  mkdirSync(REPORTS_DIR, { recursive: true });
  const finishedAt = new Date();
  const exitCode = regressions.length > 0 ? 1 : 0;
  const reportPath = path.join(REPORTS_DIR, `smoke-${isoForFilename(finishedAt)}.json`);
  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    mcpUrl: MCP_URL,
    scrapersEnabled: RUN_SCRAPERS,
    slowThresholdMs: SLOW_MS,
    liveToolCount: liveTools.length,
    tier2ToolNames: currentNames, // informational only — NOT read back as a baseline; see baselineFile
    baselineFile: BASELINE_FILE_REL,
    baselineCapturedAt: baseline?.capturedAt ?? null,
    baselineBootstrapped,
    results: allRows,
    summary,
    exitCode,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`[all-tools-smoke] report written: ${reportPath}`);

  if (QUIET) {
    // The ONLY status line in quiet mode — deliberately non-revealing: a
    // total row count and an exit code, nothing that names a tool. See the
    // MONITOR_QUIET doc comment above.
    console.log(`[all-tools-smoke] complete: ${allRows.length} probed, exit ${exitCode}`);
  } else if (regressions.length > 0) {
    console.error(
      `[all-tools-smoke] REGRESSION (${regressions.length}): ${regressions
        .map((r) => `${r.name}:${r.status}`)
        .join(", ")}`
    );
  } else {
    console.log("[all-tools-smoke] OK — no regressions.");
  }
  process.exit(exitCode);
}

main().catch((err) => {
  // MONITOR_QUIET applies here too (HIGH fix, code review 2026-07-24): an
  // un-try/caught `listTools()` failure (endpoint down) used to bypass quiet
  // mode entirely, printing a raw stack trace / HTTP status / upstream error
  // text straight to this repo's PUBLIC Actions log at exactly the worst
  // moment (an outage). In quiet mode this now prints ONLY the same
  // non-revealing completion line normal quiet-mode completion uses.
  if (QUIET) {
    console.error(`[all-tools-smoke] complete: 0 probed, exit 1`);
  } else {
    console.error(`[all-tools-smoke] FATAL: ${err?.stack || err}`);
  }
  process.exit(1);
});
