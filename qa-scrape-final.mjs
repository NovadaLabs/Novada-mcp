/**
 * Final QA checks for novada_scrape — specific edge cases and static analysis
 */

import { readFileSync, writeFileSync } from "fs";

const findings = [];

// ── F1: Description names wrong platforms for "13 platforms" ──────────────
// Description says: "Amazon, Reddit, TikTok, LinkedIn, Google Shopping, Glassdoor, GitHub, Zillow, Airbnb"
// PLATFORM_OPERATIONS has: amazon.com, walmart.com, google.com, bing.com, duckduckgo.com,
//   yandex.com, x.com, tiktok.com, instagram.com, facebook.com, youtube.com, linkedin.com, github.com
// Reddit, Glassdoor, Zillow, Airbnb are NOT in the map.
// Walmart, Bing, DuckDuckGo, Yandex, Instagram, Facebook, YouTube, X are in the map but not named.
const descriptionPlatformExamples = ["Reddit", "Glassdoor", "Zillow", "Airbnb"];
const notInPlatformOps = descriptionPlatformExamples; // verified by inspection

if (notInPlatformOps.length > 0) {
  findings.push({
    title: "Tool description names platforms not in PLATFORM_OPERATIONS preflight map",
    severity: "Medium",
    category: "functional",
    component: "novada_scrape / tool description",
    environment: "both",
    repro_steps:
      "1. list_tools and read novada_scrape description. " +
      "2. Note it says '13 platforms (~78 operations): Amazon, Reddit, TikTok, LinkedIn, Google Shopping, Glassdoor, GitHub, Zillow, Airbnb'. " +
      "3. Inspect PLATFORM_OPERATIONS in src/tools/scrape.ts — reddit.com, glassdoor.com, zillow.com, airbnb.com are absent. " +
      "4. Call novada_scrape with platform='glassdoor.com', operation='glassdoor_job_search', params={keyword:'engineer'} — passes to backend without preflight, then hangs ~14s before IP block error.",
    expected:
      "Either: (a) description examples match the 13 platforms that actually have preflight validation, OR " +
      "(b) description clarifies which platforms have fast-fail preflight and which rely on backend validation",
    actual:
      "Description names Reddit, Glassdoor, Zillow, Airbnb as examples of the '13 platforms' — but these 4 are NOT in PLATFORM_OPERATIONS. " +
      "The actual 13 are: amazon.com, walmart.com, google.com, bing.com, duckduckgo.com, yandex.com, x.com, tiktok.com, instagram.com, facebook.com, youtube.com, linkedin.com, github.com. " +
      "Calling with glassdoor.com/reddit.com skips preflight and hangs ~14s.",
    root_cause:
      "The 13 platforms in PLATFORM_OPERATIONS are those with pre-flight validation; the description's example list was written for the broader backend catalog (~129 platforms) without checking which ones have preflight coverage.",
    suggested_fix:
      "Update description to list the correct 13 platform examples: " +
      "Amazon, Walmart, Google, Bing, DuckDuckGo, Yandex, X (Twitter), TikTok, Instagram, Facebook, YouTube, LinkedIn, GitHub. " +
      "Or add reddit.com, glassdoor.com, zillow.com, airbnb.com to PLATFORM_OPERATIONS if they have live operations.",
    code_location: "src/index.ts:280 (description) vs src/tools/scrape.ts:299-403 (PLATFORM_OPERATIONS)",
    evidence:
      "Description: 'Amazon, Reddit, TikTok, LinkedIn, Google Shopping, Glassdoor, GitHub, Zillow, Airbnb' | " +
      "PLATFORM_OPERATIONS keys: amazon.com, walmart.com, google.com, bing.com, duckduckgo.com, yandex.com, x.com, tiktok.com, instagram.com, facebook.com, youtube.com, linkedin.com, github.com",
    confidence: "high",
  });
}

// ── F2: Dead variable `title` in novadaScrape ──────────────────────────────
// const title = `${platform} — ${operation}` at line 571 — assigned but never read
// Low severity: lint issue, no functional impact
findings.push({
  title: "Dead variable `title` assigned but never used in novadaScrape",
  severity: "Low",
  category: "other",
  component: "novada_scrape / novadaScrape function",
  environment: "local",
  repro_steps: "Static analysis: grep 'const title' in scrape.ts — assigned at line 571, never referenced elsewhere in the function",
  expected: "Either `title` is used in output or it is removed",
  actual: "const title = `${platform} — ${operation}` is assigned at line 571 but never used in any format branch",
  root_cause: "Dead code from a previous implementation that used title in the markdown header; not cleaned up when format branches were refactored",
  suggested_fix: "Remove `const title = ...` at line 571",
  code_location: "src/tools/scrape.ts:571",
  evidence: "Line 571: `const title = \\`${platform} — ${operation}\\`;` — no other reference to `title` in novadaScrape",
  confidence: "high",
});

// ── F3: json format missing Agent Memory and Chainable Output sections ─────
// markdown format includes `## Chainable Output` and `## Agent Memory`
// json format does NOT include these sections
// This means agents using format='json' don't get the agent_instruction for follow-up actions
// and don't get the remember hint — potentially degrading multi-step agent workflows
findings.push({
  title: "format='json' output missing '## Chainable Output' and '## Agent Memory' sections present in markdown format",
  severity: "Low",
  category: "mcp-contract",
  component: "novada_scrape / json format branch",
  environment: "local",
  repro_steps:
    "Static analysis: compare format='json' output (lines 575-590) vs format='markdown' output (lines 625-648). " +
    "The json branch does not include '## Chainable Output' (with agent_instruction for next steps) or '## Agent Memory' (remember hint). " +
    "Agents using format='json' for programmatic processing won't receive next-step guidance.",
  expected: "Consistent agent-instruction metadata across all formats (or deliberate omission documented in description)",
  actual:
    "format='markdown' includes '## Chainable Output' with agent_instruction + '## Agent Memory' with remember hint. " +
    "format='json' includes neither — only '## Agent Hints' with 3 bullet points. " +
    "format='toon' includes '## Agent Memory' but also lacks '## Chainable Output'.",
  root_cause:
    "The json and toon format branches were written with different Agent Hints content from the markdown branch. " +
    "Likely intentional for token savings in agent-facing formats, but not documented.",
  suggested_fix:
    "Either: (a) Add agent_instruction to json/toon Agent Hints explicitly, or " +
    "(b) Document in description that json/toon formats omit chainable output hints",
  code_location: "src/tools/scrape.ts:585-588 (json) vs 635-646 (markdown)",
  evidence:
    "json branch ends at line 590 without agent_instruction. " +
    "markdown branch line 643: 'agent_instruction: Scrape complete. To read a related URL use novada_extract...'",
  confidence: "high",
});

// ── F4: "ip blocked, retry later" returned for dummy API key ──────────────
// When NOVADA_API_KEY=dummy is used, the Scraper API returns code 10000 "ip blocked, retry later"
// INSTEAD of an auth error (50001/50002/50003). The error is classified as NovadaErrorCode.UNKNOWN
// with failure_class: "permanent". This is a server-side behavior but the MCP error handling
// doesn't distinguish between "ip blocked" (transient) and true auth failure (permanent).
// An agent receiving "ip blocked, retry later" with failure_class:permanent would be confused.
findings.push({
  title: "Dummy/invalid API key returns 'ip blocked, retry later' (code 10000) instead of auth error — misclassified as permanent failure",
  severity: "Medium",
  category: "error-recovery",
  component: "novada_scrape / submitScrapeTask error handling",
  environment: "local",
  repro_steps:
    "1. Set NOVADA_API_KEY=dummy. " +
    "2. Call novada_scrape with valid platform, operation, params that pass preflight. " +
    "3. Observe: error text is 'Scraper error (code 10000): ip blocked, retry later' with failure_class: permanent, retry_recommended: false. " +
    "4. Expected: auth error (code 50001/50002/50003) with INVALID_API_KEY error code.",
  expected:
    "Backend should return auth error (50001-50003) for invalid API key; MCP should surface INVALID_API_KEY with auth failure_class",
  actual:
    "Backend returns code 10000 'ip blocked, retry later'; MCP classifies as UNKNOWN/permanent. " +
    "Agent receives 'ip blocked' message but the real cause is invalid API key — misleading diagnosis.",
  root_cause:
    "The Scraper API backend does not distinguish between IP-blocked requests and auth-failed requests in its error response for invalid keys. " +
    "code 10000 is handled in pollForResult (lines 190-193) as 'result not yet available' (continue polling) — but here it comes from submitScrapeTask body.code (lines 121-126), falling through to generic error. " +
    "The MCP error handler then classifies the generic Error (not NovadaError) via classifyError, mapping it to UNKNOWN.",
  suggested_fix:
    "Add detection for 'ip blocked' in the error message from code 10000 and map it to INVALID_API_KEY or a new IP_BLOCKED code; " +
    "or work with backend to return 50001-50003 for invalid keys. " +
    "At minimum, add a code 10000 special case in submitScrapeTask to provide a clearer agent_instruction: " +
    "'Received ip blocked error — this may indicate an invalid API key or that your IP is rate-limited. Verify NOVADA_API_KEY is correct.'",
  code_location: "src/tools/scrape.ts:121-126 (generic error handler for non-zero codes without special-case)",
  evidence:
    "Test output S3: 'Error [UNKNOWN]: Scraper error (code 10000): ip blocked, retry later\\nfailure_class: permanent\\nretry_recommended: false'. " +
    "Real cause: dummy API key. Agent gets no hint about auth failure.",
  confidence: "high",
});

// Write final results
console.log("=== Final Static Analysis Findings ===");
for (const f of findings) {
  console.log(`[${f.severity}] ${f.title}`);
}

// Merge with existing
let existing = { findings: [], scenarios_run: 0 };
try {
  existing = JSON.parse(readFileSync("/tmp/novada-qa-0.9.0/func-scrape.json", "utf8"));
} catch {}

const merged = {
  perspective: "Functional — scrape",
  summary:
    `Ran 29 total scenarios: offline validation (S1-S19), deep behavioral tests (DA1-DA9), and static analysis. ` +
    `Validated: preflight rejection for unknown ops (correct), missing-param errors (correct), operation alias resolution (correct), platform alias (twitter→x) (correct), schema boundary enforcement (correct), concurrent call stability (correct), all format error paths produce isError:true (correct). ` +
    `Found 6 real issues: 1 Medium (description names wrong platform examples for '13 platforms'), 1 Medium (dummy key returns misleading 'ip blocked' instead of auth error), 1 Medium (Agent Hints platform count inconsistency 13 vs 129), 1 Low (json/toon missing Chainable Output + Agent Memory sections vs markdown), 1 Low (dead 'title' variable), 1 Low (platform count string "129" vs "13" in same tool).`,
  scenarios_run: 29,
  findings: [...existing.findings, ...findings],
};
writeFileSync("/tmp/novada-qa-0.9.0/func-scrape.json", JSON.stringify(merged, null, 2));
console.log(`\nTotal findings: ${merged.findings.length}`);
console.log("Written to /tmp/novada-qa-0.9.0/func-scrape.json");
