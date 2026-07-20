#!/usr/bin/env node
/**
 * npm-package/scripts/acceptance/run.mjs — RELEASE ACCEPTANCE orchestrator.
 *
 * The repeatable, standardized test system: runs the SAME gate list every release
 * (not an ad-hoc set of manual commands), and writes a dated report proving "it still
 * works AND no new problem was introduced" — so shipping is a decision made from a
 * report, not a memory of what was checked last time.
 *
 * This script does not reimplement any check. It ORCHESTRATES existing gates, each of
 * which is the single source of truth for its own logic:
 *   1. build              — npm run build (tsc)
 *   2. test:coverage       — npm run test:coverage (vitest, full suite + coverage ratchet)
 *   3. lint                — npm run lint (tsc --noEmit)
 *   4. check-hosted-drift  — ../scripts/check-hosted-drift.mjs (repo-root script)
 *   5. eval Tier-A         — eval/baseline-selector.mjs (free, deterministic, always runs)
 *   6. eval Tier-B         — eval/model-eval-runner.mjs (real model call; RUN only if
 *                            ANTHROPIC_API_KEY is set, else SKIP)
 *   7. live-smoke          — scripts/acceptance/live-smoke.mjs (real scraper API calls;
 *                            RUN only if NOVADA_SCRAPER_KEY is set, else SKIP)
 *
 * SKIP is not FAIL: a gate that requires a key that is not present in this environment
 * is reported SKIPPED, and does not block the "no new problem introduced" verdict — but
 * the report's footer names every skipped gate explicitly, so the owner knows exactly
 * what still needs a keyed run before actually shipping.
 *
 * No secrets ever live in this script or its output — API keys are read from
 * process.env only (NOVADA_SCRAPER_KEY, ANTHROPIC_API_KEY) and never echoed into the
 * report; only whether each was present.
 *
 * Usage:
 *   node scripts/acceptance/run.mjs [--feature=<slug>] [--version=<v>] [--date=<YYYY-MM-DD>]
 *
 * Exit code: 0 = every gate that ran PASSED (skips allowed). Non-zero = at least one
 * executed gate FAILED.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NPM_PKG_ROOT = resolve(__dirname, "..", "..");
const REPO_ROOT = resolve(NPM_PKG_ROOT, "..");

// ─── CLI args ─────────────────────────────────────────────────────────────────
function argVal(flag, dflt) {
  const hit = process.argv.find((a) => a.startsWith(`--${flag}=`));
  if (!hit) return dflt;
  return hit.slice(`--${flag}=`.length);
}

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const FEATURE = argVal("feature", "release");
const PKG = JSON.parse(readFileSync(resolve(NPM_PKG_ROOT, "package.json"), "utf8"));
const VERSION = argVal("version", PKG.version);
const DATE = argVal("date", todayISO());

function getBranch() {
  const res = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() : "unknown (not a git checkout or git unavailable)";
}

async function getRegistryToolCount() {
  try {
    const { TOOL_REGISTRY } = await import(resolve(NPM_PKG_ROOT, "build", "tools", "registry.js"));
    return TOOL_REGISTRY.length;
  } catch (err) {
    return `unknown (registry import failed: ${err?.message ?? err})`;
  }
}

// ─── Gate runner ──────────────────────────────────────────────────────────────

/** Runs one gate as a child process, capturing status, duration, and combined output. */
function runCommand(cmd, args, opts = {}) {
  const start = Date.now();
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? NPM_PKG_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(opts.env ?? {}) },
    maxBuffer: 1024 * 1024 * 64,
  });
  const ms = Date.now() - start;
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  return { status: res.status ?? 1, ms, stdout, stderr, combined: `${stdout}\n${stderr}` };
}

function fmtMs(ms) {
  return ms >= 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

const gates = [];

function record(gate) {
  gates.push(gate);
  const statusLabel = gate.status === "SKIP" ? "SKIP" : gate.status === "PASS" ? "PASS" : "FAIL";
  console.log(`[${statusLabel}] ${gate.name} — ${gate.metric} (${fmtMs(gate.ms)})`);
}

// ─── Gate 1: build ─────────────────────────────────────────────────────────────
{
  const r = runCommand("npm", ["run", "build"]);
  record({
    name: "build",
    status: r.status === 0 ? "PASS" : "FAIL",
    metric: r.status === 0 ? "tsc clean" : "tsc errors — see log",
    ms: r.ms,
    log: r.combined,
  });
}

// ─── Gate 2: test:coverage ─────────────────────────────────────────────────────
{
  const r = runCommand("npm", ["run", "test:coverage"]);
  const passedMatch = r.combined.match(/Tests\s+(\d+)\s+passed/);
  const failedMatch = r.combined.match(/(\d+)\s+failed/);
  const passedCount = passedMatch ? passedMatch[1] : "?";
  const metric = failedMatch
    ? `${passedCount} tests passed, ${failedMatch[1]} failed`
    : `${passedCount} tests passed`;
  record({
    name: "test:coverage",
    status: r.status === 0 ? "PASS" : "FAIL",
    metric,
    ms: r.ms,
    log: r.combined,
  });
}

// ─── Gate 3: lint ──────────────────────────────────────────────────────────────
{
  const r = runCommand("npm", ["run", "lint"]);
  record({
    name: "lint",
    status: r.status === 0 ? "PASS" : "FAIL",
    metric: r.status === 0 ? "no type errors (tsc --noEmit)" : "type errors present — see log",
    ms: r.ms,
    log: r.combined,
  });
}

// ─── Gate 4: check-hosted-drift ────────────────────────────────────────────────
{
  const r = runCommand("node", [resolve(REPO_ROOT, "scripts", "check-hosted-drift.mjs")], { cwd: REPO_ROOT });
  const passCount = (r.combined.match(/\[check-hosted-drift\] PASS/g) || []).length;
  record({
    name: "check-hosted-drift",
    status: r.status === 0 ? "PASS" : "FAIL",
    metric: r.status === 0 ? `${passCount} gates passed` : `drift detected (${passCount} gates passed before failure) — see log`,
    ms: r.ms,
    log: r.combined,
  });
}

// ─── Gate 5: eval Tier-A (baseline-selector, always runs) ─────────────────────
{
  const r = runCommand("node", ["eval/baseline-selector.mjs", "--json"]);
  let metric = "could not parse JSON output — see log";
  let pass = r.status === 0;
  try {
    const parsed = JSON.parse(r.stdout);
    const { summary } = parsed;
    const correct = Math.round(summary.exact_accuracy * summary.task_count);
    metric = `${(summary.exact_accuracy * 100).toFixed(0)}% accuracy (${correct}/${summary.task_count})`;
    pass = pass && summary.gate_pass === true;
  } catch {
    pass = false;
  }
  record({
    name: "eval Tier-A (baseline-selector)",
    status: pass ? "PASS" : "FAIL",
    metric,
    ms: r.ms,
    log: r.combined,
  });
}

// ─── Gate 6: eval Tier-B (model-eval-runner, needs ANTHROPIC_API_KEY) ─────────
if (process.env.ANTHROPIC_API_KEY) {
  const r = runCommand("node", ["eval/model-eval-runner.mjs"]);
  let metric = "could not parse JSON output — see log";
  let pass = r.status === 0;
  try {
    const parsed = JSON.parse(r.stdout);
    const { summary } = parsed;
    metric = `${(summary.accuracy * 100).toFixed(0)}% accuracy (model-in-the-loop, ${summary.task_count} tasks)`;
    pass = pass && summary.gate_pass === true;
  } catch {
    pass = false;
  }
  record({
    name: "eval Tier-B (model-eval-runner)",
    status: pass ? "PASS" : "FAIL",
    metric,
    ms: r.ms,
    log: r.combined,
  });
} else {
  record({
    name: "eval Tier-B (model-eval-runner)",
    status: "SKIP",
    metric: "no ANTHROPIC_API_KEY",
    ms: 0,
    log: "",
  });
}

// ─── Gate 7: live-smoke (needs NOVADA_SCRAPER_KEY) ────────────────────────────
if (process.env.NOVADA_SCRAPER_KEY) {
  const r = runCommand("node", ["scripts/acceptance/live-smoke.mjs"]);
  const acceptedMatch = r.combined.match(/(\d+)\/(\d+)\s+accepted/);
  const metric = acceptedMatch ? `${acceptedMatch[1]}/${acceptedMatch[2]} accepted` : "no summary line found — see log";
  record({
    name: "live-smoke",
    status: r.status === 0 ? "PASS" : "FAIL",
    metric,
    ms: r.ms,
    log: r.combined,
  });
} else {
  record({
    name: "live-smoke",
    status: "SKIP",
    metric: "no NOVADA_SCRAPER_KEY",
    ms: 0,
    log: "",
  });
}

// ─── Report ────────────────────────────────────────────────────────────────────
async function writeReport() {
  const branch = getBranch();
  const toolCount = await getRegistryToolCount();

  const anyFail = gates.some((g) => g.status === "FAIL");
  const skipped = gates.filter((g) => g.status === "SKIP");
  const failed = gates.filter((g) => g.status === "FAIL");

  const verdict = anyFail
    ? `BLOCKED: ${failed.map((g) => g.name).join(", ")}`
    : "ACCEPTED — no new problem introduced";

  const rows = gates
    .map((g) => `| ${g.name} | ${g.status} | ${g.metric} | ${fmtMs(g.ms)} |`)
    .join("\n");

  const footer =
    skipped.length > 0
      ? skipped
          .map((g) => `- **${g.name}** skipped (${g.metric}) — run with the required key before shipping if this gate has never been run keyed for this release.`)
          .join("\n")
      : "- None. Every gate ran (no keys were missing).";

  const report = `# Release Acceptance Report

- **Date:** ${DATE}
- **Feature:** ${FEATURE}
- **Version:** ${VERSION}
- **Branch:** ${branch}
- **Tool count (from registry):** ${toolCount}

## Gates

| Gate | Status | Metric | Duration |
|------|--------|--------|----------|
${rows}

## Verdict

**${verdict}**

## Skipped gates (lack of a key)

${footer}
`;

  const reportDir = resolve(REPO_ROOT, "reports", `${DATE}-${FEATURE}`);
  mkdirSync(reportDir, { recursive: true });
  const reportPath = resolve(reportDir, `${DATE}-${FEATURE}-release-acceptance.md`);
  writeFileSync(reportPath, report);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Verdict: ${verdict}`);
  console.log(`Report:  ${reportPath}`);
  console.log(`${"=".repeat(60)}`);

  process.exit(anyFail ? 1 : 0);
}

await writeReport();
