#!/usr/bin/env node
/**
 * monitoring/smoke/scraper-substance-c2-v3n1.selftest.mjs
 *
 * Dedicated, OFFLINE RED/GREEN self-test for the V3-N1 / C-2 fix in
 * full-tools-probe.mjs (2026-09-03). Makes ZERO network calls, needs NO
 * NOVADA_TEST_KEY.
 *
 * FINDING (novada-test-engineering ledger 2026-09-02-full-evaluation,
 * findings/V3-verification-CX.md §C-2 + §V3-N1): the daily synthetic
 * monitor's scraper PASS predicate was `records >= 1` — and a bare SERP
 * envelope with ZERO organic results (duckduckgo's `web_search` operation,
 * when the upstream response has no `organic_results` array anywhere)
 * counts as `records: 1` because scrape.ts's own extractRecords() fallback
 * (npm-package/src/tools/scrape.ts:875-892, RECORD_ARRAY_KEYS) wraps the
 * WHOLE envelope object as a single synthetic "record" when no known array
 * key is found. The monitor scored this PASS on 3/3 live samples across two
 * sessions (evidence/C-live-transcripts.md) — it was blind to a persistent
 * upstream failure for weeks.
 *
 * This file verifies ALL layers of the fix (Layer D directly, Layer B/Tier-3
 * as a 2026-09-03 CLASS-NOT-INSTANCE closure — a reviewer found Tier-3's
 * runTier3() in all-tools-smoke.mjs had the SAME `res.ok`-only PASS
 * predicate, and TIER3_SAFE_SAMPLE in tool-probes.mjs includes
 * novada_scrape_duckduckgo/web_search, the exact operation that reproduces
 * C-2 — currently inert behind SMOKE_SCRAPERS=1/manual workflow_dispatch,
 * but the same class one flag away from live):
 *   1. Unit-level: checkScraperSubstance()/extractJsonRecords() directly,
 *      against fixtures built from the RECORDED evidence shape (RED) and
 *      recorded-healthy shapes for >=5 OTHER platforms + github (GREEN).
 *   2. Pipeline-level (Layer D): the full runAllProbes() pipeline (stubbed
 *      callTool), proving the fix is actually WIRED IN to runProbe()'s
 *      classification — not just a correct standalone helper nobody calls.
 *   3. Coverage + no-allowlist invariants: every isScraper:true PROBES entry
 *      has a SUBSTANCE_TABLE row (class-not-instance completeness), and
 *      duckduckgo/novada_scrape_duckduckgo is NOT in
 *      BACKEND_KNOWN_FLAKY_PLATFORMS / BACKEND_KNOWN_FLAKY_TOOL_NAMES — that
 *      would BE the "allowlist that hides DDG" this fix exists to prevent.
 *   4. Layer B / Tier-3: the SAME checkScraperSubstance() (imported, never
 *      forked) reused inside all-tools-smoke.mjs's runTier3() (now
 *      dependency-injectable, mirroring full-tools-probe.mjs's runProbe DI
 *      pattern) — RED on the recorded DDG bare envelope (status
 *      "fail-backend", never "pass" and never "fail-backend-known"), GREEN
 *      on 2 recorded-healthy fixtures (github, amazon).
 *
 * Run after any change to full-tools-probe.mjs's SUBSTANCE_TABLE or
 * substance-gate wiring:
 *
 *   node monitoring/smoke/scraper-substance-c2-v3n1.selftest.mjs
 *
 * Exit code: non-zero on ANY assertion mismatch or an uncaught pipeline
 * error (caught by the outer .catch() below).
 */

import {
  PROBES,
  SUBSTANCE_TABLE,
  extractJsonRecords,
  checkScraperSubstance,
  runAllProbes,
  applySeverityEscalations,
  buildSummary,
} from "./full-tools-probe.mjs";
import { BACKEND_KNOWN_FLAKY_PLATFORMS, BACKEND_KNOWN_FLAKY_TOOL_NAMES, isBackendKnownFlaky } from "./tool-probes.mjs";

let failureCount = 0;
function expect(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failureCount += 1;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

// ─── Fixture builder ─────────────────────────────────────────────────────
// Renders the EXACT response-text shape scrape.ts's `format: "json"` branch
// produces (npm-package/src/tools/scrape.ts:1687-1706) — the header line
// (byte-identical across every format) plus a ```json fence containing
// `cleanRecords` (the raw, unflattened per-record objects).
function renderJsonResponse({ platform, operation, records }) {
  const header = `## Scrape Results\nplatform: ${platform} | operation: ${operation} | records: ${records.length} | source: live | format: json`;
  return `${header}\n\n\`\`\`json\n${JSON.stringify(records, null, 2)}\n\`\`\`\n\n---\n## Agent Hints\n- Increase limit (max 100) to retrieve more records.`;
}

// ─── RED fixture: duckduckgo's recorded bare SERP envelope ──────────────
// Field names verbatim from evidence/C-live-transcripts.md line 71 ("payload
// has NO organic-results key at all ... search_metadata,spider_parameter,
// search_information,related_searches,get_news,cache_status,code") and
// findings/V3-verification-CX.md §C-2 ("No organic-results key at all").
// scrape.ts's extractRecords() fallback (RECORD_ARRAY_KEYS miss -> `[d]`)
// wraps this WHOLE object as ONE synthetic record, so `records: 1` is
// exactly what the real broken response renders.
//
// CRITICAL TRAP built into this fixture: `get_news` entries carry a REAL,
// non-empty `title` (and `link`) field — genuine news headlines, not organic
// search results. A substance check that loosely substring-matched "title"
// against ANY nested/flattened key would false-positive PASS on this exact
// fixture. checkScraperSubstance() must only accept a field on the
// TOP-LEVEL of `records[0]` — this fixture is the regression test for that.
const DDG_BARE_ENVELOPE_RECORD = {
  search_metadata: { id: "ddg-abc123", status: "Success" },
  spider_parameter: { q: "anthropic claude" },
  search_information: { total_results: null },
  related_searches: ["claude ai", "anthropic careers", "claude vs chatgpt"],
  get_news: [
    { title: "Anthropic raises new funding round", link: "https://news.example.com/1", date: "2026-09-01" },
    { title: "Claude model update announced", link: "https://news.example.com/2", date: "2026-09-02" },
  ],
  cache_status: "MISS",
  code: 200,
};
const DDG_BARE_ENVELOPE_TEXT = renderJsonResponse({
  platform: "duckduckgo.com",
  operation: "web_search",
  records: [DDG_BARE_ENVELOPE_RECORD],
});

// ─── GREEN fixtures: recorded-healthy shapes, github + >=5 other platforms ─
// Field names grounded in evidence/C-live-transcripts.md's live descriptions
// (youtube title+views+channel; x followers+location; tiktok followers+
// create_time; github stars+forks+file rows; bing titles+redirection_link)
// and scrape.ts's own KEY_COLUMN_PRIORITY vocabulary.
const GREEN_FIXTURES = {
  github: renderJsonResponse({
    platform: "github.com",
    operation: "repository_by_url",
    records: [{ full_name: "gin-gonic/gin", stargazers_count: 89165, forks_count: 8681, language: "Go" }],
  }),
  bing: renderJsonResponse({
    platform: "bing.com",
    operation: "web_search",
    records: [
      { title: "Claude — Anthropic", link: "https://claude.com", description: "Claude is a family of AI models." },
      { title: "Claude Product", link: "https://claude.com/product", description: "Explore Claude." },
    ],
  }),
  amazon: renderJsonResponse({
    platform: "amazon.com",
    operation: "products_by_keywords",
    records: [{ title: "Wireless Earbuds Pro", final_price: 49.99, rating: 4.5, asin: "B0BWBK8F37" }],
  }),
  x: renderJsonResponse({
    platform: "x.com",
    operation: "profile_by_username",
    records: [{ username: "BillGates", followers_count: 64964983, location: "Seattle" }],
  }),
  tiktok: renderJsonResponse({
    platform: "tiktok.com",
    operation: "profile_by_url",
    records: [{ username: "tiktok", follower_count: 95500000, create_time: "2015-02-28" }],
  }),
  youtube: renderJsonResponse({
    platform: "youtube.com",
    operation: "video_by_id",
    records: [{ title: "Real Video Title", view_count: 463159, channel: "Example Channel" }],
  }),
  linkedin: renderJsonResponse({
    platform: "linkedin.com",
    operation: "company_by_url",
    records: [{ name: "Microsoft", follower_count: 22000000, industry: "Software" }],
  }),
  perplexity: renderJsonResponse({
    platform: "perplexity.ai",
    operation: "answer_by_search_term",
    records: [{ answer: "Today's weather is sunny with a high of 72F.", sources: ["https://weather.example.com"] }],
  }),
};

async function main() {
  // ── 1. Unit-level: checkScraperSubstance() directly ─────────────────────
  console.log("[selftest] unit-level: checkScraperSubstance() against fixtures\n");

  const redResult = checkScraperSubstance("duckduckgo", DDG_BARE_ENVELOPE_TEXT);
  expect(redResult.ok === false, `RED: duckduckgo bare-envelope fixture fails substance check (got ok=${redResult.ok})`);
  expect(
    typeof redResult.reason === "string" && /organic search result/.test(redResult.reason),
    `RED: failure reason names the missing substance ("organic search result") — got: ${JSON.stringify(redResult.reason)}`
  );
  // The false-positive trap: confirm the parsed record really does carry a
  // nested get_news[].title, so a pass here would prove the check is doing
  // EXACT top-level matching, not a loose substring scan.
  const redRecords = extractJsonRecords(DDG_BARE_ENVELOPE_TEXT);
  expect(Array.isArray(redRecords) && redRecords.length === 1, "RED fixture parses to exactly 1 record (matches the real records:1 bug)");
  expect(
    redRecords?.[0]?.title === undefined,
    "RED fixture has NO top-level `title` key (only nested get_news[].title) — the false-positive trap is real"
  );
  expect(
    Array.isArray(redRecords?.[0]?.get_news) && redRecords[0].get_news[0]?.title === "Anthropic raises new funding round",
    "RED fixture's get_news[0].title IS present (the trap) — checkScraperSubstance must not have matched on it"
  );

  const greenChecks = [
    ["github_repository_repo-url", GREEN_FIXTURES.github, "github"],
    ["bing_search", GREEN_FIXTURES.bing, "bing"],
    ["amazon_product_keywords", GREEN_FIXTURES.amazon, "amazon"],
    ["twitter_profile_username", GREEN_FIXTURES.x, "x/twitter"],
    ["tiktok_profiles_url", GREEN_FIXTURES.tiktok, "tiktok"],
    ["youtube_product-videoid", GREEN_FIXTURES.youtube, "youtube"],
    ["linkedin_company_information_url", GREEN_FIXTURES.linkedin, "linkedin"],
    ["perplexity_answer_searchterm", GREEN_FIXTURES.perplexity, "perplexity"],
  ];
  console.log("");
  for (const [catalogOpId, text, label] of greenChecks) {
    const res = checkScraperSubstance(catalogOpId, text);
    expect(res.ok === true, `GREEN (${label}): recorded-healthy fixture PASSES substance check (got: ${JSON.stringify(res)})`);
  }
  const nonGithubGreenCount = greenChecks.filter(([, , label]) => label !== "github").length;
  expect(nonGithubGreenCount >= 5, `GREEN fixture set covers >=5 OTHER platforms besides github (got ${nonGithubGreenCount})`);

  // ── 2. Class-not-instance coverage: every scraper PROBES entry has a row ─
  console.log("\n[selftest] SUBSTANCE_TABLE coverage over every isScraper:true PROBES entry\n");
  const scraperProbes = PROBES.filter((p) => p.isScraper);
  expect(scraperProbes.length >= 16, `>=16 isScraper:true PROBES entries exist to cover (got ${scraperProbes.length})`);
  for (const p of scraperProbes) {
    expect(
      Object.prototype.hasOwnProperty.call(SUBSTANCE_TABLE, p.catalogOpId),
      `${p.name} (catalogOpId="${p.catalogOpId}"): has a SUBSTANCE_TABLE row`
    );
  }
  const distinctCatalogOpIds = new Set(scraperProbes.map((p) => p.catalogOpId));
  expect(
    distinctCatalogOpIds.size === Object.keys(SUBSTANCE_TABLE).length,
    `SUBSTANCE_TABLE has exactly one row per distinct catalogOpId the monitor exercises (no orphan rows, no gaps) — table has ${Object.keys(SUBSTANCE_TABLE).length}, probes reference ${distinctCatalogOpIds.size}`
  );

  // ── 3. No-allowlist invariant: duckduckgo must NOT be swept into
  //      known-flaky (that would silence, not report, the incident) ───────
  console.log("\n[selftest] no-allowlist invariant: duckduckgo is NOT in BACKEND_KNOWN_FLAKY_PLATFORMS\n");
  expect(
    !BACKEND_KNOWN_FLAKY_PLATFORMS.includes("duckduckgo"),
    "duckduckgo is NOT in BACKEND_KNOWN_FLAKY_PLATFORMS — adding it would silence (P3, never-escalate) the C-2 incident instead of reporting it"
  );
  expect(
    !BACKEND_KNOWN_FLAKY_TOOL_NAMES.has("novada_scrape_duckduckgo"),
    "novada_scrape_duckduckgo is NOT in BACKEND_KNOWN_FLAKY_TOOL_NAMES"
  );
  expect(!isBackendKnownFlaky("novada_scrape_duckduckgo"), "isBackendKnownFlaky('novada_scrape_duckduckgo') === false");

  // ── 4. Pipeline-level: the fix is actually WIRED into runProbe() ────────
  console.log("\n[selftest] pipeline-level: runAllProbes() end-to-end with a stubbed live server\n");

  function stubListTools() {
    return Promise.resolve(PROBES.map((p) => ({ name: p.name, annotations: null, inputSchema: null })));
  }

  const RESPONSE_BY_TOOL = {
    novada_scrape_duckduckgo: DDG_BARE_ENVELOPE_TEXT, // RED
    novada_scrape_github: GREEN_FIXTURES.github,
    novada_scrape_bing: GREEN_FIXTURES.bing,
    novada_scrape_amazon: GREEN_FIXTURES.amazon,
    novada_scrape_x: GREEN_FIXTURES.x,
    novada_scrape_tiktok: GREEN_FIXTURES.tiktok,
    novada_scrape_youtube: GREEN_FIXTURES.youtube,
    novada_scrape_linkedin: GREEN_FIXTURES.linkedin,
    novada_scrape_perplexity: GREEN_FIXTURES.perplexity,
  };

  function stubCallTool(name) {
    if (Object.prototype.hasOwnProperty.call(RESPONSE_BY_TOOL, name)) {
      return Promise.resolve({ ok: true, httpStatus: 200, timeMs: 400, text: RESPONSE_BY_TOOL[name], error: null });
    }
    // Every other probe (meta tools + scrapers not under test here): a
    // harmless generic pass, no "records:" pattern -> substance gate never
    // engages (records extraction returns null, gate is a no-op) -> PASS.
    return Promise.resolve({ ok: true, httpStatus: 200, timeMs: 50, text: `${name} ok (default self-test stub)`, error: null });
  }

  const { results } = await runAllProbes(PROBES, {
    callToolFn: stubCallTool,
    listToolsFn: stubListTools,
    delayMs: 0,
    networkRetryBackoffMs: 5,
    processingPollMaxAttempts: 1,
    processingPollIntervalMs: 0,
  });
  applySeverityEscalations(results);
  const summary = buildSummary(results);
  const byName = Object.fromEntries(results.map((r) => [r.name, r]));

  console.log("");
  const ddgRow = byName.novada_scrape_duckduckgo;
  expect(Boolean(ddgRow), "novada_scrape_duckduckgo: row present in the pipeline run");
  if (ddgRow) {
    expect(ddgRow.status === "FAIL", `RED (pipeline): novada_scrape_duckduckgo status === "FAIL" (got "${ddgRow.status}") — the C-2 bug is FIXED`);
    expect(ddgRow.domain === "③-backend", `RED (pipeline): domain === "③-backend" (got "${ddgRow.domain}") — an upstream incident, not ①/②`);
    expect(ddgRow.severity === "P2", `RED (pipeline): severity === "P2" (got "${ddgRow.severity}") — visible, not swept to P3 known-flaky`);
    expect(ddgRow.configFault !== true, "RED (pipeline): configFault is falsy — this is a real product/upstream finding, not a test-key state");
    expect(
      typeof ddgRow.note === "string" && ddgRow.note.includes("substance check failed"),
      `RED (pipeline): note documents the substance-check failure (got: ${JSON.stringify(ddgRow.note)})`
    );
    expect(
      typeof ddgRow.advice === "string" && ddgRow.advice.includes("灵匠") && !ddgRow.advice.includes("Known-flaky"),
      `RED (pipeline): advice routes to the backend team (灵匠) and is NOT the "Known-flaky platform" P3 advice (got: ${JSON.stringify(ddgRow.advice)})`
    );
  }

  console.log("");
  for (const toolName of Object.keys(RESPONSE_BY_TOOL)) {
    if (toolName === "novada_scrape_duckduckgo") continue;
    const row = byName[toolName];
    expect(Boolean(row), `${toolName}: row present in the pipeline run`);
    if (!row) continue;
    expect(
      row.status === "PASS" || row.status === "SLOW",
      `GREEN (pipeline): ${toolName} status is PASS/SLOW (got "${row.status}") — recorded-healthy fixture must not be misclassified`
    );
    expect(row.domain === "-", `GREEN (pipeline): ${toolName} domain === "-" (got "${row.domain}")`);
  }

  console.log("");
  const oursP0P1 = results.filter(
    (r) => (r.domain === "①-mcp-code" || r.domain === "②-gateway") && (r.severity === "P0" || r.severity === "P1") && !r.configFault
  );
  expect(
    !oursP0P1.includes(ddgRow),
    "the DDG substance failure never contributes to oursP0P1 (backend-only findings never fail the run's exit code — unchanged pre-existing policy, this fix only corrects the CLASSIFICATION)"
  );
  expect(summary.backendCount >= 1, `summary.backendCount includes the DDG substance failure (got ${summary.backendCount})`);
  expect((summary.byStatus.FAIL || 0) >= 1, "summary.byStatus.FAIL includes the DDG row — reported, not silenced");

  // ── 5. Layer B / Tier-3: SAME class, SAME defect, reviewer-found follow-up ─
  // CLASS-NOT-INSTANCE closure (2026-09-03): the reviewer found
  // all-tools-smoke.mjs's Tier-3 (runTier3(), gated behind SMOKE_SCRAPERS=1,
  // manual workflow_dispatch only — currently inert in the default schedule,
  // but one flag away from live) used the SAME `res.ok`-only PASS predicate
  // this whole file exists to fix, and TIER3_SAFE_SAMPLE
  // (tool-probes.mjs) includes novada_scrape_duckduckgo/web_search — the
  // EXACT operation that reproduces C-2. Fixed by importing (never forking)
  // this file's own checkScraperSubstance() into all-tools-smoke.mjs's
  // runTier3(). Verified here end-to-end through the REAL runTier3()
  // function (dependency-injected callToolFn/probeOverride, mirroring
  // full-tools-probe.mjs's runProbe DI pattern) — not a reimplementation.
  //
  // SMOKE_SCRAPERS is read into a module-load-time const in
  // all-tools-smoke.mjs, so it MUST be set in process.env BEFORE that
  // module's body evaluates — a static top-of-file `import` would be hoisted
  // ahead of any env-var assignment in this file, so a dynamic `import()` is
  // used here specifically to control that ordering.
  console.log("\n[selftest] Layer B / Tier-3: the SAME class-level fix, applied to all-tools-smoke.mjs\n");
  process.env.SMOKE_SCRAPERS = "1";
  const { runTier3 } = await import("./all-tools-smoke.mjs");

  const tier3DdgProbe = { name: "novada_scrape_duckduckgo", catalogOpId: "duckduckgo", args: { operation: "web_search", params: { q: "anthropic claude" }, limit: 1, format: "json" } };
  const tier3DdgRows = await runTier3({
    callToolFn: async () => ({ ok: true, httpStatus: 200, timeMs: 300, text: DDG_BARE_ENVELOPE_TEXT, error: null }),
    probeOverride: tier3DdgProbe,
  });
  expect(tier3DdgRows.length === 1, `Tier-3 RED: runTier3() returns exactly 1 row (got ${tier3DdgRows.length})`);
  const tier3DdgRow = tier3DdgRows[0];
  expect(
    tier3DdgRow.status === "fail-backend",
    `Tier-3 RED: novada_scrape_duckduckgo status === "fail-backend" (got "${tier3DdgRow.status}") — the SAME bare envelope must FAIL here too`
  );
  expect(
    tier3DdgRow.status !== "pass" && tier3DdgRow.status !== "fail-backend-known",
    `Tier-3 RED: NOT "pass" (the pre-fix bug) and NOT "fail-backend-known" (that would be an allowlist — duckduckgo is deliberately absent from BACKEND_KNOWN_FLAKY_PLATFORMS)`
  );
  expect(
    typeof tier3DdgRow.error === "string" && /organic search result/.test(tier3DdgRow.error),
    `Tier-3 RED: error names the missing substance (got: ${JSON.stringify(tier3DdgRow.error)})`
  );

  const tier3GithubProbe = { name: "novada_scrape_github", catalogOpId: "github_repository_repo-url", args: { operation: "repository_by_url", params: { url: "https://github.com/gin-gonic/gin" }, format: "json" } };
  const tier3GithubRows = await runTier3({
    callToolFn: async () => ({ ok: true, httpStatus: 200, timeMs: 300, text: GREEN_FIXTURES.github, error: null }),
    probeOverride: tier3GithubProbe,
  });
  expect(
    tier3GithubRows[0]?.status === "pass" || tier3GithubRows[0]?.status === "slow",
    `Tier-3 GREEN: a recorded-healthy fixture (github) still PASSES through runTier3() (got "${tier3GithubRows[0]?.status}")`
  );

  const tier3AmazonRows = await runTier3({
    callToolFn: async () => ({ ok: true, httpStatus: 200, timeMs: 300, text: GREEN_FIXTURES.amazon, error: null }),
    probeOverride: { name: "novada_scrape_amazon", catalogOpId: "amazon_product_keywords", args: { operation: "products_by_keywords", params: { keyword: "wireless earbuds" }, format: "json" } },
  });
  expect(
    tier3AmazonRows[0]?.status === "pass" || tier3AmazonRows[0]?.status === "slow",
    `Tier-3 GREEN: a recorded-healthy fixture (amazon) still PASSES through runTier3() (got "${tier3AmazonRows[0]?.status}")`
  );
  // Hygiene only — process exits right after this function returns either
  // way, so this has no behavioral effect; kept so this file never leaves a
  // stray env var set for any hypothetical future caller.
  delete process.env.SMOKE_SCRAPERS;

  console.log("");
  if (failureCount > 0) {
    console.error(`[selftest] FAILED: ${failureCount} assertion(s) did not hold.`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `[selftest] OK — V3-N1/C-2 substance gate verified RED (duckduckgo) + GREEN (${nonGithubGreenCount} other platforms + github) on Layer D, ` +
      `AND RED/GREEN on Layer B's Tier-3 (class-not-instance closure), 0 crashes.`
  );
  process.exitCode = 0;
}

main().catch((err) => {
  console.error(`[selftest] FATAL: ${err?.stack || err}`);
  process.exitCode = 1;
});
