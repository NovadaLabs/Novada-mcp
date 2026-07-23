/**
 * monitoring/smoke/tool-probes.mjs
 *
 * Probe registry for the all-tools functional smoke suite (Layer B). Feeds
 * monitoring/smoke/all-tools-smoke.mjs, which owns the actual tiering logic
 * and execution. This file only holds probe DATA and pure classification
 * helpers — no network calls, no fs access.
 *
 * Three tiers (budget-aware by design):
 *
 *   Tier-1  ALWAYS executed — a handful of free/cheap read-only calls that
 *           prove the hosted endpoint's core surface is alive. Every run.
 *   Tier-2  ALWAYS checked, NEVER executed — presence-only. The actual tool
 *           list comes from a LIVE `tools/list` call in all-tools-smoke.mjs
 *           (single source of truth; nothing here hardcodes the 30/38+ tool
 *           names). This file only supplies the classification data Tier-2
 *           needs: which scraper platforms have a documented backend-side
 *           flakiness issue (TOW2-305), so a Tier-3 failure on one of them is
 *           never mistaken for a regression.
 *   Tier-3  OPTIONAL, gated by `SMOKE_SCRAPERS=1` (default OFF) — ONE real,
 *           credit-costing scraper call per run, rotated across a small
 *           SAFE (currently status:ok, non-flaky) sample so coverage spreads
 *           over time without paying for every platform on every run.
 *
 * READ-ONLY GUARANTEE: every probe/args pair below is a read operation.
 * Nothing in this file may ever describe a write-tool call — see
 * NEVER_EXECUTE_TOOL_NAMES, which all-tools-smoke.mjs checks defensively
 * before executing anything from Tier-1 or Tier-3.
 */

// ─── Tier-1: free/cheap core probes, executed every run ─────────────────────
// Kept intentionally small and cheap: novada_setup/novada_discover are free
// onboarding/catalog calls, novada_account(section:"balance") is a read-only
// wallet check, novada_search/novada_extract are capped to the smallest
// possible unit of work (num:1, a static example.com page).
export const TIER1_PROBES = Object.freeze([
  Object.freeze({ name: "novada_setup", args: Object.freeze({}) }),
  Object.freeze({ name: "novada_discover", args: Object.freeze({}) }),
  Object.freeze({ name: "novada_account", args: Object.freeze({ section: "balance" }) }),
  Object.freeze({ name: "novada_search", args: Object.freeze({ query: "anthropic", num: 1 }) }),
  Object.freeze({ name: "novada_extract", args: Object.freeze({ url: "https://example.com" }) }),
]);

// ─── Tier-3: rotating small sample of KNOWN-GOOD (status:ok) scraper ops ────
// Only executed when SMOKE_SCRAPERS=1 (see pickTier3Sample below — exactly
// ONE entry runs per invocation). Each op/param pair is verified against its
// tool's own source at the time this file was written:
//   - novada_scrape_google:     npm-package/src/tools/scrape_google.ts       GOOGLE_OPERATIONS.web_search     -> "google_search"
//   - novada_scrape_duckduckgo: npm-package/src/tools/scrape_duckduckgo.ts   DUCKDUCKGO_OPERATIONS.web_search  -> "duckduckgo"
//   - novada_scrape_amazon:     npm-package/src/tools/scrape_amazon.ts       AMAZON_OPERATIONS.products_by_keywords -> "amazon_product_keywords"
//   - novada_scrape_walmart:    npm-package/src/tools/scrape_walmart.ts      WALMART_OPERATIONS.product_by_keyword  -> "walmart_product_keywords"
// None of these platforms are in BACKEND_KNOWN_FLAKY_PLATFORMS below — this
// sample is deliberately restricted to platforms NOT already flagged flaky,
// so a failure here is a real signal, not backend noise.
export const TIER3_SAFE_SAMPLE = Object.freeze([
  Object.freeze({
    name: "novada_scrape_google",
    args: Object.freeze({ operation: "web_search", params: Object.freeze({ q: "anthropic claude", num: 1 }), limit: 1 }),
  }),
  Object.freeze({
    name: "novada_scrape_duckduckgo",
    args: Object.freeze({ operation: "web_search", params: Object.freeze({ q: "anthropic claude" }), limit: 1 }),
  }),
  Object.freeze({
    name: "novada_scrape_amazon",
    args: Object.freeze({ operation: "products_by_keywords", params: Object.freeze({ keyword: "wireless earbuds" }), limit: 1 }),
  }),
  Object.freeze({
    name: "novada_scrape_walmart",
    args: Object.freeze({
      operation: "product_by_keyword",
      params: Object.freeze({ domain: "https://www.walmart.com/", keyword: "shoes" }),
      limit: 1,
    }),
  }),
]);

/**
 * Pick this run's single Tier-3 sample, rotating deterministically by
 * day-of-year so coverage spreads across TIER3_SAFE_SAMPLE over time (every
 * ~4 days each platform gets exercised once) while any single run only ever
 * pays for exactly one scraper call.
 *
 * @param {Date} [now]
 * @returns {{name: string, args: Record<string, unknown>}}
 */
export function pickTier3Sample(now = new Date()) {
  const startOfYearUtc = Date.UTC(now.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - startOfYearUtc) / 86_400_000);
  const idx = ((dayOfYear % TIER3_SAFE_SAMPLE.length) + TIER3_SAFE_SAMPLE.length) % TIER3_SAFE_SAMPLE.length;
  return TIER3_SAFE_SAMPLE[idx];
}

// ─── Backend-known-flaky scraper platforms (TOW2-305) ───────────────────────
// These platform extractors have a documented, Novada-BACKEND-side outage
// history that is NOT a regression in this monitoring suite or in the MCP
// wrapper itself — see npm-package/CHANGELOG.md: "Backend extractor outages
// [...] are tracked separately as a Novada backend issue (TOW2-305), not
// fixable in this wrapper" (github/x/yandex/bing/youtube), extended per this
// task's brief to also include shein and perplexity. A failure on one of
// these tool names is classified `fail-backend-known` by
// all-tools-smoke.mjs, never a CI-failing regression.
export const BACKEND_KNOWN_FLAKY_PLATFORMS = Object.freeze([
  "github",
  "x",
  "youtube",
  "yandex",
  "bing",
  "shein",
  "perplexity",
]);

export const BACKEND_KNOWN_FLAKY_TOOL_NAMES = Object.freeze(
  new Set(BACKEND_KNOWN_FLAKY_PLATFORMS.map((platform) => `novada_scrape_${platform}`))
);

/**
 * Is `toolName` a per-platform scraper tool with a documented
 * backend-known-flaky platform (TOW2-305)? Used to classify a scraper
 * failure as `fail-backend-known` (honest, non-alerting) instead of
 * `fail-server` (a real regression).
 *
 * @param {string} toolName
 * @returns {boolean}
 */
export function isBackendKnownFlaky(toolName) {
  return BACKEND_KNOWN_FLAKY_TOOL_NAMES.has(toolName);
}

// ─── Write-tool guard (defense in depth) ────────────────────────────────────
// Tier-2 is presence-only and must NEVER execute any of these, regardless of
// future edits to this file or the runner. all-tools-smoke.mjs asserts (hard
// throw, not a silent skip) against this set before executing ANY probe, so
// an accidental future addition of one of these to TIER1_PROBES/
// TIER3_SAFE_SAMPLE fails loudly instead of quietly spending money or
// mutating account state.
export const NEVER_EXECUTE_TOOL_NAMES = Object.freeze(
  new Set([
    "novada_proxy_account_create",
    "novada_ip_whitelist",
    "novada_capture_apikey",
    "novada_static_ip_mgmt",
  ])
);
