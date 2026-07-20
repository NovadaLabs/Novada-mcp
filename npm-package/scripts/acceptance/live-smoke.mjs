#!/usr/bin/env node
/**
 * npm-package/scripts/acceptance/live-smoke.mjs
 *
 * LIVE SMOKE TEST — one real, billed call per platform-scraper tool (all 15 of the
 * novada_scrape_<platform> family), proving the wire format actually reaches the live
 * Novada Scraper API and is accepted — not just a mocked unit test. Gate 7 of the
 * release-acceptance run (scripts/acceptance/run.mjs). Cost-aware: ONE call per platform
 * (plus at most one retry for a target-side flake), ~90s timeout each, never a full sweep.
 *
 * Params are catalog-derived (see pickOperation/buildParams) so they can't silently rot.
 *
 * THREE-WAY OUTCOME (see classify.mjs for the why):
 *   - pass      — accepted + data/task/progress.
 *   - wire_fail — OUR integration is wrong (11006/10001/unknown platform/auth). BLOCKS.
 *   - flake     — the scraper accepted the request but the TARGET site returned a
 *                 CAPTCHA/403/5xx or the upstream timed out. Transient, target-side, NOT
 *                 our bug. Retried once; reported; NEVER blocks the release.
 * Only wire_fail sets a non-zero exit code. A release is not held hostage to a target site
 * being flaky at the instant the smoke test ran.
 *
 * KEY: process.env.NOVADA_SCRAPER_KEY ONLY — never hardcoded, never a default. Missing key
 * is a SKIP (exit 0): every call here is REAL and BILLED (external effect ⇒ REDLINE).
 *
 * Usage: npm run build && NOVADA_SCRAPER_KEY=... node scripts/acceptance/live-smoke.mjs
 */
import { dispatch } from "../../build/core.js";
import { PLATFORM_SCRAPER_TOOLS } from "../../build/tools/platform_scrapers.js";
import { SCRAPER_CATALOG } from "../../build/data/scraper_catalog.js";
import { classify, flakeReason } from "./classify.mjs";

const KEY = process.env.NOVADA_SCRAPER_KEY;
const PER_CALL_TIMEOUT_MS = 90_000;

/**
 * Build guaranteed-valid params for one catalog op from its own `dflt`/`opts` fields.
 * Returns null if any required param has neither — that op cannot be safely smoke-tested
 * without inventing a value, which this script deliberately refuses to do.
 */
function buildParams(catalogOp) {
  const params = {};
  for (const p of catalogOp.params) {
    if (!p.required) continue;
    if (p.dflt !== undefined && p.dflt !== "") {
      params[p.key] = p.dflt;
    } else if (p.opts && p.opts.length > 0) {
      params[p.key] = p.opts[0];
    } else {
      return null;
    }
  }
  return params;
}

/**
 * Pick the first operation (declared order) this tool's config can smoke-test with
 * guaranteed-valid, catalog-derived params. Throws if NONE qualify.
 */
function pickOperation(tool) {
  const platformEntry = SCRAPER_CATALOG.find((p) => p.domain === tool.config.platform);
  if (!platformEntry) {
    throw new Error(
      `platform "${tool.config.platform}" (${tool.toolDefinition.name}) not found in SCRAPER_CATALOG`,
    );
  }
  const opsBySlug = new Map(platformEntry.ops.map((op) => [op.slug, op]));
  for (const [friendlyName, opConfig] of Object.entries(tool.config.operations)) {
    const catalogOp = opsBySlug.get(opConfig.scraperId);
    if (!catalogOp || catalogOp.status !== "ok") continue;
    const params = buildParams(catalogOp);
    if (params) return { operation: friendlyName, params };
  }
  throw new Error(
    `no operation for ${tool.toolDefinition.name} (platform "${tool.config.platform}") has every ` +
      `required param covered by a catalog dflt/opts value — extend buildParams() or the catalog entry`,
  );
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function callOnce(name, operation, params) {
  try {
    return await withTimeout(dispatch(name, { operation, params }, KEY), PER_CALL_TIMEOUT_MS);
  } catch (err) {
    return typeof err?.toAgentString === "function" ? err.toAgentString() : String(err?.message ?? err);
  }
}

async function main() {
  if (!KEY) {
    console.log("SKIP (set NOVADA_SCRAPER_KEY to run live)");
    process.exit(0);
    return;
  }

  const rows = [];
  for (const tool of PLATFORM_SCRAPER_TOOLS) {
    const name = tool.toolDefinition.name;
    let operation;
    let params;
    try {
      ({ operation, params } = pickOperation(tool));
    } catch (err) {
      // A platform with no safely-callable default op is a real harness/catalog gap — surface
      // it as a wire_fail (it means we cannot even attempt this tool), so it blocks + gets fixed.
      rows.push({ platform: name, op: "-", verdict: "wire_fail", ms: 0, note: String(err?.message ?? err) });
      continue;
    }

    const start = Date.now();
    let text = await callOnce(name, operation, params);
    let verdict = classify(text);
    // Retry a target-side flake ONCE — transients (CAPTCHA/5xx/timeout) often clear immediately.
    if (verdict === "flake") {
      const retry = await callOnce(name, operation, params);
      const rv = classify(retry);
      if (rv !== "flake") { text = retry; verdict = rv; }
    }
    const ms = Date.now() - start;
    const note = verdict === "pass" ? "" : `${verdict === "flake" ? flakeReason(text) + " — " : ""}${String(text).slice(0, 150).replace(/\s+/g, " ")}`;
    rows.push({ platform: name, op: operation, verdict, ms, note });
  }

  const nameWidth = Math.max(...rows.map((r) => r.platform.length), "platform".length);
  const opWidth = Math.max(...rows.map((r) => r.op.length), "op".length);
  console.log(`${"platform".padEnd(nameWidth)} | ${"op".padEnd(opWidth)} | status    | ms`);
  console.log(`${"-".repeat(nameWidth)}-|-${"-".repeat(opWidth)}-|-----------|------`);

  const label = { pass: "PASS     ", wire_fail: "WIRE-FAIL", flake: "flake    " };
  let pass = 0, wireFail = 0, flake = 0;
  for (const r of rows) {
    if (r.verdict === "pass") pass++; else if (r.verdict === "wire_fail") wireFail++; else flake++;
    const line = `${r.platform.padEnd(nameWidth)} | ${r.op.padEnd(opWidth)} | ${label[r.verdict]} | ${String(r.ms).padStart(5)}`;
    console.log(r.note ? `${line}  (${r.note})` : line);
  }

  // Only wire-integration failures block. Target-side flakes are reported, not fatal.
  console.log(`\n${pass}/${rows.length} pass · ${flake} upstream-flake (non-blocking) · ${wireFail} wire-fail`);
  console.log(wireFail > 0
    ? `WIRE FAILURES (${wireFail}) — integration broken, release BLOCKED.`
    : `Wire integration OK${flake > 0 ? ` (${flake} target-side flake${flake > 1 ? "s" : ""} — retry/ignore; not our bug)` : ""}.`);
  process.exit(wireFail > 0 ? 1 : 0);
}

// Only run when executed directly — importing this module (e.g. from a unit test that pulls
// in classify) must NOT boot main() and its live calls.
const isDirectRun = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scripts/acceptance/live-smoke.mjs");
if (isDirectRun) {
  main().catch((err) => {
    console.error("live-smoke: unexpected failure:", err);
    process.exit(1);
  });
}

export { classify, pickOperation, buildParams };
