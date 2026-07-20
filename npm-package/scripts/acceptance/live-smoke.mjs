#!/usr/bin/env node
/**
 * npm-package/scripts/acceptance/live-smoke.mjs
 *
 * LIVE SMOKE TEST — one real, billed call per platform-scraper tool (all 15 of the
 * novada_scrape_<platform> family), proving the wire format actually returns data from
 * the live Novada Scraper API — not just a mocked unit test. This is gate 7 of the
 * release-acceptance run (scripts/acceptance/run.mjs). Cost-aware by design: exactly
 * ONE call per platform, ~90s timeout each, never a full-catalog sweep.
 *
 * Params are NOT hand-typed per platform (that would silently rot the day a platform's
 * catalog op changes). For each of the 15 platform-scraper tools, this script:
 *   1. Reads the tool's declarative config (PLATFORM_SCRAPER_TOOLS[i].config) — the
 *      friendly-operation-name -> catalog-scraperId map, the SAME object
 *      tests/tools/platform-scraper-catalog.test.ts cross-checks against SCRAPER_CATALOG.
 *   2. Iterates that platform's operations in declared order and picks the FIRST one
 *      whose catalog op is status:"ok" AND every required param can be filled from the
 *      catalog's own `dflt` value — or, when a required param has no `dflt` but DOES
 *      carry an `opts` enum (e.g. the `json` output-format field most search-engine ops
 *      require), falls back to `opts[0]`, which is just as guaranteed-valid.
 *   3. Dispatches novada_scrape_<platform>({ operation: <friendlyName>, params }) through
 *      the real dispatch() router (src/core.ts's compiled build/core.js) — the exact same
 *      code path a customer's MCP call hits, not a hand-rolled HTTP request.
 *
 * Self-maintaining: add a 16th platform-scraper config and this script covers it with
 * zero hand-added fixture data (see npm-package/docs/RELEASE-ACCEPTANCE.md's "when you
 * add a tool" checklist for the one thing that still needs a manual touch: adding the
 * platform to `docs/RELEASE-ACCEPTANCE.md` coverage note — the pickOperation() logic
 * itself needs no per-platform code).
 *
 * KEY: read from process.env.NOVADA_SCRAPER_KEY ONLY — never hardcoded, never a default.
 * Missing key is a SKIP (exit 0), not a FAIL: every call this script makes is REAL and
 * BILLED against the live Novada Scraper API, an external effect that requires the key
 * to even be attempted (REDLINE — no credential ever lives in this repo).
 *
 * Usage:
 *   npm run build && NOVADA_SCRAPER_KEY=... node scripts/acceptance/live-smoke.mjs
 */
import { dispatch } from "../../build/core.js";
import { PLATFORM_SCRAPER_TOOLS } from "../../build/tools/platform_scrapers.js";
import { SCRAPER_CATALOG } from "../../build/data/scraper_catalog.js";

const KEY = process.env.NOVADA_SCRAPER_KEY;
const PER_CALL_TIMEOUT_MS = 90_000;

// A call is accepted if the returned/thrown text carries one of these signals...
const ACCEPT_PATTERNS = [/source:\s*live/i, /records:\s*\d+/i, /task_id/i, /status:\s*processing/i];
// ...and does NOT also carry one of these known error signals (scrape.ts's own error
// vocabulary — see src/tools/scrape.ts's 11006/10001/"Unknown platform" handling and
// src/_core/errors.ts's NovadaError.toAgentString() "failure_class: auth" rendering).
const ERROR_PATTERNS = [/\b11006\b/, /\b10001\b/, /Unknown platform/i, /failure_class:\s*auth/i, /auth error/i, /INVALID_API_KEY/i];

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
 * Pick the first operation (in declared order) this tool's config can smoke-test with
 * guaranteed-valid, catalog-derived params. Throws if NONE qualify — a platform added
 * with no safely-callable default operation is a real gap to fix, not a soft skip.
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

function classify(text) {
  const accepted = ACCEPT_PATTERNS.some((re) => re.test(text));
  const errored = ERROR_PATTERNS.some((re) => re.test(text));
  return accepted && !errored;
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
      rows.push({ platform: name, op: "-", pass: false, ms: 0, note: String(err?.message ?? err) });
      continue;
    }

    const start = Date.now();
    let text;
    try {
      text = await withTimeout(dispatch(name, { operation, params }, KEY), PER_CALL_TIMEOUT_MS);
    } catch (err) {
      text = typeof err?.toAgentString === "function" ? err.toAgentString() : String(err?.message ?? err);
    }
    const ms = Date.now() - start;
    const pass = classify(text);
    rows.push({ platform: name, op: operation, pass, ms, note: pass ? "" : String(text).slice(0, 160).replace(/\s+/g, " ") });
  }

  const nameWidth = Math.max(...rows.map((r) => r.platform.length), "platform".length);
  const opWidth = Math.max(...rows.map((r) => r.op.length), "op".length);
  console.log(`${"platform".padEnd(nameWidth)} | ${"op".padEnd(opWidth)} | status | ms`);
  console.log(`${"-".repeat(nameWidth)}-|-${"-".repeat(opWidth)}-|--------|------`);

  let failCount = 0;
  for (const r of rows) {
    if (!r.pass) failCount++;
    const line = `${r.platform.padEnd(nameWidth)} | ${r.op.padEnd(opWidth)} | ${r.pass ? "PASS  " : "FAIL  "} | ${String(r.ms).padStart(5)}`;
    console.log(r.note ? `${line}  (${r.note})` : line);
  }

  console.log(`\n${rows.length - failCount}/${rows.length} accepted`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("live-smoke: unexpected failure:", err);
  process.exit(1);
});
