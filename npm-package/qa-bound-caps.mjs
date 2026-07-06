/**
 * Boundary/fuzz QA: input caps for Novada MCP 0.9.0
 * Tests: query 500 / question 2000 / scraper 60KB exact boundaries, off-by-one, empty, whitespace-only
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFileSync } from "fs";

const KEY = "dummy";
const RESULTS = [];

function makeClient() {
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
  });
  const c = new Client({ name: "qa-bound", version: "0" }, { capabilities: {} });
  return { t, c };
}

async function callTool(c, name, args) {
  try {
    const r = await c.callTool({ name, arguments: args });
    return { ok: true, result: r, text: JSON.stringify(r).slice(0, 2000) };
  } catch (e) {
    return { ok: false, error: e.message ?? String(e), text: String(e).slice(0, 2000) };
  }
}

function record(scenario, toolName, args, result, expected, actual, finding) {
  RESULTS.push({ scenario, toolName, args: JSON.stringify(args).slice(0, 300), result, expected, actual, finding });
  console.log(`[${finding ? "FINDING" : "OK"}] ${scenario}`);
  if (finding) console.log(`  -> ${actual}`);
}

async function runTests() {
  const { t, c } = makeClient();
  await c.connect(t);

  // ─── 1. novada_search: query boundary tests ───────────────────────────────────

  // 1a. query = "" (empty) — should reject (min(1))
  {
    const res = await callTool(c, "novada_search", { query: "" });
    const isError = res.ok && res.result?.isError;
    const isRejected = !res.ok || isError;
    record("search/query-empty", "novada_search", { query: "" }, res,
      "Zod validation error: min(1) requires at least 1 char",
      isRejected ? "Correctly rejected" : `ACCEPTED: ${res.text.slice(0,200)}`,
      !isRejected ? "FINDING: empty query accepted" : null
    );
  }

  // 1b. query = " " (single whitespace) — schema has min(1), but no .trim() → passes
  {
    const res = await callTool(c, "novada_search", { query: " " });
    const isError = res.ok && res.result?.isError;
    // Check if the content has the actual whitespace or was trimmed
    const text = res.text;
    record("search/query-whitespace-only", "novada_search", { query: " " }, res,
      "Should reject whitespace-only query (single space, no semantic value)",
      res.ok && !isError ? `ACCEPTED whitespace query, response: ${text.slice(0,300)}`
                         : `Rejected: ${text.slice(0,200)}`,
      res.ok && !isError ? "FINDING: whitespace-only query accepted without rejection" : null
    );
  }

  // 1c. query = "   " (whitespace-only, multiple spaces) — same test
  {
    const res = await callTool(c, "novada_search", { query: "   " });
    const isError = res.ok && res.result?.isError;
    record("search/query-whitespace-multi", "novada_search", { query: "   " }, res,
      "Should reject or handle multi-space whitespace-only query",
      res.ok && !isError ? `ACCEPTED: ${res.text.slice(0,300)}`
                         : `Rejected/error: ${res.text.slice(0,200)}`,
      res.ok && !isError ? "FINDING: multi-whitespace query accepted without rejection" : null
    );
  }

  // 1d. query = 499 chars (under documented 500 limit — but no schema max set)
  {
    const q499 = "x".repeat(499);
    const res = await callTool(c, "novada_search", { query: q499 });
    const isError = res.ok && res.result?.isError;
    record("search/query-499-chars", "novada_search", { query: q499 }, res,
      "Should accept 499-char query (no schema max on query)",
      isError ? `Rejected with error: ${res.text.slice(0,200)}` : `Accepted (expected)`,
      null
    );
  }

  // 1e. query = 500 chars (at documented 500 limit)
  {
    const q500 = "x".repeat(500);
    const res = await callTool(c, "novada_search", { query: q500 });
    const isError = res.ok && res.result?.isError;
    record("search/query-500-chars", "novada_search", { query: q500 }, res,
      "Behavior at 500-char query boundary (no schema max, docs may differ from implementation)",
      `isError=${isError}: ${res.text.slice(0,200)}`,
      null
    );
  }

  // 1f. query = 501 chars (over 500)
  {
    const q501 = "x".repeat(501);
    const res = await callTool(c, "novada_search", { query: q501 });
    const isError = res.ok && res.result?.isError;
    record("search/query-501-chars", "novada_search", { query: q501 }, res,
      "Should accept or consistently handle 501-char query",
      `isError=${isError}: ${res.text.slice(0,200)}`,
      null
    );
  }

  // 1g. query = 10000 chars (very long — no schema limit defined)
  {
    const q10k = "x".repeat(10000);
    const res = await callTool(c, "novada_search", { query: q10k });
    const isError = res.ok && res.result?.isError;
    record("search/query-10000-chars", "novada_search", { query: q10k }, res,
      "No schema max defined on query — should either enforce a cap or pass through",
      `isError=${isError}: ${res.text.slice(0,200)}`,
      !isError ? "FINDING: 10000-char query accepted with no schema max — docs claim 500 limit but no enforcement" : null
    );
  }

  // ─── 2. novada_research: question boundary tests ───────────────────────────────

  // 2a. question = "" (empty) — should reject (min(5))
  {
    const res = await callTool(c, "novada_research", { question: "" });
    const isError = res.ok && res.result?.isError;
    record("research/question-empty", "novada_research", { question: "" }, res,
      "Should reject empty question (Zod min(5))",
      isError || !res.ok ? "Correctly rejected" : `ACCEPTED: ${res.text.slice(0,200)}`,
      res.ok && !isError ? "FINDING: empty question accepted" : null
    );
  }

  // 2b. question = "   " (whitespace-only, < 5 chars) — schema min(5) but space counts
  {
    const res = await callTool(c, "novada_research", { question: "   " });
    const isError = res.ok && res.result?.isError;
    record("research/question-whitespace-3", "novada_research", { question: "   " }, res,
      "3-space whitespace should fail min(5) unless length counts spaces",
      isError || !res.ok ? "Rejected" : `ACCEPTED: ${res.text.slice(0,200)}`,
      null
    );
  }

  // 2c. question = "     " (exactly 5 spaces) — passes min(5) but is whitespace-only
  {
    const res = await callTool(c, "novada_research", { question: "     " });
    const isError = res.ok && res.result?.isError;
    record("research/question-whitespace-5-spaces", "novada_research", { question: "     " }, res,
      "5 spaces: passes min(5) but semantically empty — should trim+reject",
      res.ok && !isError ? `ACCEPTED whitespace research: ${res.text.slice(0,300)}`
                         : `Rejected: ${res.text.slice(0,200)}`,
      res.ok && !isError ? "FINDING: 5-space whitespace question bypasses min(5) check (no .trim() before validation)" : null
    );
  }

  // 2d. question = 1999 chars (one under max)
  {
    const q1999 = "research question: " + "x".repeat(1980);
    const res = await callTool(c, "novada_research", { question: q1999 });
    const isError = res.ok && res.result?.isError;
    record("research/question-1999-chars", "novada_research", { question: q1999 }, res,
      "1999-char question should pass (below 2000 limit)",
      isError ? `Rejected: ${res.text.slice(0,200)}` : "Accepted (expected)",
      null
    );
  }

  // 2e. question = 2000 chars (at the limit — note: research.ts checks > 2000, so 2000 should pass)
  {
    const q2000 = "research question: " + "x".repeat(1981);
    const res = await callTool(c, "novada_research", { question: q2000 });
    const isError = res.ok && res.result?.isError;
    // The code does: if (questionText.length > QUESTION_MAX_LENGTH) throw
    // So exactly 2000 chars should NOT throw (> 2000, not >= 2000)
    record("research/question-2000-chars-exact", "novada_research", { question: q2000 }, res,
      "2000-char question should pass (limit is >2000, not >=2000)",
      isError ? `Rejected (unexpected): ${res.text.slice(0,300)}` : "Accepted (correct: > check means 2000 is allowed)",
      isError && res.text?.includes("exceeds maximum") ? "FINDING: off-by-one — exactly 2000 chars rejected when limit should be >2000" : null
    );
  }

  // 2f. question = 2001 chars (one over max) — must be rejected
  {
    const q2001 = "research question: " + "x".repeat(1982);
    const res = await callTool(c, "novada_research", { question: q2001 });
    const isError = res.ok && res.result?.isError;
    const errText = JSON.stringify(res.result ?? res.error ?? "");
    record("research/question-2001-chars", "novada_research", { question: q2001 }, res,
      "2001-char question must be rejected with clear error",
      isError ? `Correctly rejected: ${errText.slice(0,300)}` : `ACCEPTED: ${res.text.slice(0,200)}`,
      !isError ? "FINDING: 2001-char question not rejected" : null
    );
  }

  // 2g. query alias at 2001 chars (alias path — does it also check length?)
  {
    const q2001 = "research question: " + "x".repeat(1982);
    const res = await callTool(c, "novada_research", { query: q2001 });
    const isError = res.ok && res.result?.isError;
    const errText = JSON.stringify(res.result ?? res.error ?? "");
    record("research/query-alias-2001-chars", "novada_research", { query: q2001 }, res,
      "2001-char query alias must also be rejected",
      isError ? `Correctly rejected: ${errText.slice(0,300)}` : `ACCEPTED: ${res.text.slice(0,200)}`,
      !isError ? "FINDING: query alias bypasses question length check" : null
    );
  }

  // ─── 3. novada_scrape: params record boundary tests ───────────────────────────

  // 3a. params = {} (empty record) — should trigger preflight missing param error
  {
    const res = await callTool(c, "novada_scrape", {
      platform: "amazon.com",
      operation: "amazon_product_keywords",
      params: {}
    });
    const isError = res.ok && res.result?.isError;
    record("scrape/params-empty", "novada_scrape",
      { platform: "amazon.com", operation: "amazon_product_keywords", params: {} }, res,
      "Should reject: preflight catches missing required 'keyword' param",
      isError ? `Correctly rejected: ${JSON.stringify(res.result).slice(0,300)}`
              : `ACCEPTED empty params: ${res.text.slice(0,200)}`,
      null
    );
  }

  // 3b. params with a single value of 60KB string
  {
    const val60k = "x".repeat(60 * 1024);
    const res = await callTool(c, "novada_scrape", {
      platform: "amazon.com",
      operation: "amazon_product_keywords",
      params: { keyword: val60k }
    });
    const isError = res.ok && res.result?.isError;
    record("scrape/params-60kb-value", "novada_scrape",
      { platform: "amazon.com", operation: "amazon_product_keywords", params: { keyword: "[60KB]" } }, res,
      "60KB param value — no schema max on params.keyword, should either send to backend or reject gracefully",
      `isError=${isError}: ${res.text.slice(0,300)}`,
      !isError ? "FINDING: 60KB param value accepted and sent to backend (no input cap on scrape params values)" : null
    );
  }

  // 3c. params with 60KB+1 byte string
  {
    const val60k1 = "x".repeat(60 * 1024 + 1);
    const res = await callTool(c, "novada_scrape", {
      platform: "amazon.com",
      operation: "amazon_product_keywords",
      params: { keyword: val60k1 }
    });
    const isError = res.ok && res.result?.isError;
    record("scrape/params-60kb-plus1-value", "novada_scrape",
      { platform: "amazon.com", operation: "amazon_product_keywords", params: { keyword: "[60KB+1]" } }, res,
      "60KB+1 param value — should be consistent with 60KB behavior",
      `isError=${isError}: ${res.text.slice(0,300)}`,
      null
    );
  }

  // 3d. params with whitespace-only keyword value (passes preflight hasOne check but semantically empty)
  {
    const res = await callTool(c, "novada_scrape", {
      platform: "amazon.com",
      operation: "amazon_product_keywords",
      params: { keyword: "   " }
    });
    const isError = res.ok && res.result?.isError;
    const errText = JSON.stringify(res.result ?? "");
    record("scrape/params-whitespace-keyword", "novada_scrape",
      { platform: "amazon.com", operation: "amazon_product_keywords", params: { keyword: "   " } }, res,
      "Whitespace-only keyword: preflight uses String(v).trim().length > 0 but Zod record allows it",
      isError ? `Correctly rejected: ${errText.slice(0,300)}` : `ACCEPTED: ${res.text.slice(0,200)}`,
      // Check if preflight actually catches this (preflightScrape does .trim().length > 0)
      null // will determine from result
    );
  }

  // ─── 4. novada_extract: max_chars boundary ────────────────────────────────────

  // 4a. max_chars = 999 (one below min 1000)
  {
    const res = await callTool(c, "novada_extract", {
      url: "https://example.com",
      format: "markdown",
      render: "auto",
      max_chars: 999
    });
    const isError = res.ok && res.result?.isError;
    record("extract/max_chars-999", "novada_extract",
      { url: "https://example.com", max_chars: 999 }, res,
      "Should reject: max_chars 999 is below min(1000)",
      isError ? `Correctly rejected: ${res.text.slice(0,200)}` : `ACCEPTED 999: ${res.text.slice(0,200)}`,
      !isError ? "FINDING: max_chars=999 accepted (below min:1000)" : null
    );
  }

  // 4b. max_chars = 1000 (at minimum)
  {
    const res = await callTool(c, "novada_extract", {
      url: "https://example.com",
      format: "markdown",
      render: "auto",
      max_chars: 1000
    });
    const isError = res.ok && res.result?.isError;
    record("extract/max_chars-1000", "novada_extract",
      { url: "https://example.com", max_chars: 1000 }, res,
      "Should accept: max_chars=1000 is at minimum",
      isError ? `Rejected (unexpected): ${res.text.slice(0,200)}` : "Accepted (expected)",
      isError && !res.text?.includes("API key") ? "FINDING: max_chars=1000 unexpectedly rejected" : null
    );
  }

  // 4c. max_chars = 100001 (one above max 100000)
  {
    const res = await callTool(c, "novada_extract", {
      url: "https://example.com",
      format: "markdown",
      render: "auto",
      max_chars: 100001
    });
    const isError = res.ok && res.result?.isError;
    record("extract/max_chars-100001", "novada_extract",
      { url: "https://example.com", max_chars: 100001 }, res,
      "Should reject: max_chars=100001 is above max(100000)",
      isError ? `Correctly rejected: ${res.text.slice(0,200)}` : `ACCEPTED 100001: ${res.text.slice(0,200)}`,
      !isError ? "FINDING: max_chars=100001 accepted (above max:100000)" : null
    );
  }

  // 4d. max_chars = 100000 (at maximum)
  {
    const res = await callTool(c, "novada_extract", {
      url: "https://example.com",
      format: "markdown",
      render: "auto",
      max_chars: 100000
    });
    const isError = res.ok && res.result?.isError;
    record("extract/max_chars-100000", "novada_extract",
      { url: "https://example.com", max_chars: 100000 }, res,
      "Should accept: max_chars=100000 is at maximum",
      isError && res.text?.includes("Invalid API") ? "API error (expected with dummy key, schema passed)" : `${isError}: ${res.text.slice(0,200)}`,
      null
    );
  }

  // ─── 5. novada_extract: url batch boundary ───────────────────────────────────

  // 5a. urls array with 11 elements (one over max(10))
  {
    const urls11 = Array(11).fill("https://example.com");
    const res = await callTool(c, "novada_extract", {
      url: urls11,
      format: "markdown",
      render: "auto",
    });
    const isError = res.ok && res.result?.isError;
    record("extract/url-batch-11", "novada_extract",
      { url: "[11 URLs]", format: "markdown" }, res,
      "Should reject: url array of 11 is above max(10)",
      isError ? `Correctly rejected: ${res.text.slice(0,200)}` : `ACCEPTED 11 URLs: ${res.text.slice(0,200)}`,
      !isError ? "FINDING: 11-URL batch accepted (above max:10)" : null
    );
  }

  // 5b. urls array with exactly 10 elements (at max)
  {
    const urls10 = Array(10).fill("https://example.com");
    const res = await callTool(c, "novada_extract", {
      url: urls10,
      format: "markdown",
      render: "auto",
    });
    const isError = res.ok && res.result?.isError;
    record("extract/url-batch-10", "novada_extract",
      { url: "[10 URLs]", format: "markdown" }, res,
      "Should accept: url array of 10 is at max",
      isError && res.text?.includes("API key") ? "API error (expected with dummy key)" : `isError=${isError}: ${res.text.slice(0,200)}`,
      null
    );
  }

  // ─── 6. novada_unblock: max_chars boundary ───────────────────────────────────

  // 6a. max_chars = 500001 (one over max 500000 for unblock)
  {
    const res = await callTool(c, "novada_unblock", {
      url: "https://example.com",
      method: "render",
      timeout: 30000,
      max_chars: 500001
    });
    const isError = res.ok && res.result?.isError;
    record("unblock/max_chars-500001", "novada_unblock",
      { url: "https://example.com", max_chars: 500001 }, res,
      "Should reject: max_chars=500001 above max(500000)",
      isError ? `Correctly rejected: ${res.text.slice(0,200)}` : `ACCEPTED 500001: ${res.text.slice(0,200)}`,
      !isError ? "FINDING: max_chars=500001 accepted in unblock (above max:500000)" : null
    );
  }

  // 6b. max_chars = 500000 (at max)
  {
    const res = await callTool(c, "novada_unblock", {
      url: "https://example.com",
      method: "render",
      timeout: 30000,
      max_chars: 500000
    });
    const isError = res.ok && res.result?.isError;
    record("unblock/max_chars-500000", "novada_unblock",
      { url: "https://example.com", max_chars: 500000 }, res,
      "Should accept: max_chars=500000 at max",
      isError && res.text?.includes("API key") ? "API error (expected)" : `isError=${isError}: ${res.text.slice(0,200)}`,
      null
    );
  }

  // ─── 7. novada_crawl: max_pages boundary ─────────────────────────────────────

  // 7a. max_pages = 21 (one over max 20)
  {
    const res = await callTool(c, "novada_crawl", {
      url: "https://example.com",
      max_pages: 21,
      strategy: "bfs",
      format: "markdown",
      render: "auto"
    });
    const isError = res.ok && res.result?.isError;
    record("crawl/max_pages-21", "novada_crawl",
      { url: "https://example.com", max_pages: 21 }, res,
      "Should reject: max_pages=21 above max(20)",
      isError ? `Correctly rejected: ${res.text.slice(0,200)}` : `ACCEPTED 21: ${res.text.slice(0,200)}`,
      !isError ? "FINDING: max_pages=21 accepted (above max:20)" : null
    );
  }

  // 7b. max_pages = 20 (at max)
  {
    const res = await callTool(c, "novada_crawl", {
      url: "https://example.com",
      max_pages: 20,
      strategy: "bfs",
      format: "markdown",
      render: "auto"
    });
    const isError = res.ok && res.result?.isError;
    record("crawl/max_pages-20", "novada_crawl",
      { url: "https://example.com", max_pages: 20 }, res,
      "Should accept: max_pages=20 at max",
      isError && res.text?.includes("API key") ? "API error (expected)" : `isError=${isError}: ${res.text.slice(0,200)}`,
      null
    );
  }

  // ─── 8. novada_browser evaluate script boundary ──────────────────────────────

  // 8a. script = 2000 chars (at max)
  {
    const script2000 = "/* " + "x".repeat(1997); // ASCII
    const res = await callTool(c, "novada_browser", {
      actions: [{ action: "evaluate", script: script2000 }],
      timeout: 10000
    });
    const isError = res.ok && res.result?.isError;
    record("browser/evaluate-script-2000", "novada_browser",
      { script: "[2000 chars]" }, res,
      "Should accept: evaluate script at max 2000 chars",
      isError && res.text?.includes("BROWSER") ? "Browser not configured (expected without WS)" : `isError=${isError}: ${res.text.slice(0,200)}`,
      null
    );
  }

  // 8b. script = 2001 chars (one over max)
  {
    const script2001 = "/* " + "x".repeat(1998);
    const res = await callTool(c, "novada_browser", {
      actions: [{ action: "evaluate", script: script2001 }],
      timeout: 10000
    });
    const isError = res.ok && res.result?.isError;
    record("browser/evaluate-script-2001", "novada_browser",
      { script: "[2001 chars]" }, res,
      "Should reject: evaluate script over max 2000 chars",
      isError ? `Correctly rejected: ${res.text.slice(0,200)}` : `ACCEPTED 2001: ${res.text.slice(0,200)}`,
      !isError ? "FINDING: evaluate script over 2000 chars accepted" : null
    );
  }

  // 8c. empty actions array (below min(1))
  {
    const res = await callTool(c, "novada_browser", {
      actions: [],
      timeout: 10000
    });
    const isError = res.ok && res.result?.isError;
    record("browser/actions-empty-array", "novada_browser",
      { actions: [] }, res,
      "Should reject: actions array below min(1)",
      isError ? `Correctly rejected: ${res.text.slice(0,200)}` : `ACCEPTED empty: ${res.text.slice(0,200)}`,
      !isError ? "FINDING: empty actions array accepted" : null
    );
  }

  // ─── 9. novada_verify: claim boundary ────────────────────────────────────────

  // 9a. claim = 9 chars (one under min(10))
  {
    const res = await callTool(c, "novada_verify", { claim: "123456789" });
    const isError = res.ok && res.result?.isError;
    record("verify/claim-9-chars", "novada_verify",
      { claim: "123456789" }, res,
      "Should reject: claim below min(10)",
      isError ? `Correctly rejected: ${res.text.slice(0,200)}` : `ACCEPTED 9: ${res.text.slice(0,200)}`,
      !isError ? "FINDING: 9-char claim accepted (below min:10)" : null
    );
  }

  // 9b. claim = 10 chars (at minimum)
  {
    const res = await callTool(c, "novada_verify", { claim: "1234567890" });
    const isError = res.ok && res.result?.isError;
    record("verify/claim-10-chars", "novada_verify",
      { claim: "1234567890" }, res,
      "Should accept: claim at min(10)",
      isError && res.text?.includes("API key") ? "API error (expected with dummy key)" : `isError=${isError}: ${res.text.slice(0,200)}`,
      null
    );
  }

  // ─── 10. novada_research: query alias whitespace ─────────────────────────────

  // 10a. query alias with 5 spaces (passes min(5) if not trimmed — same as question)
  {
    const res = await callTool(c, "novada_research", { query: "     " });
    const isError = res.ok && res.result?.isError;
    record("research/query-alias-whitespace-5", "novada_research",
      { query: "     " }, res,
      "5 spaces via query alias: z.string() with no min check on query (query has no min!)",
      res.ok && !isError ? `ACCEPTED: ${res.text.slice(0,300)}` : `Rejected: ${res.text.slice(0,200)}`,
      res.ok && !isError ? "FINDING: query alias with whitespace-only content accepted (no min validation on query field)" : null
    );
  }

  // 10b. query alias with single space
  {
    const res = await callTool(c, "novada_research", { query: " " });
    const isError = res.ok && res.result?.isError;
    record("research/query-alias-1-space", "novada_research",
      { query: " " }, res,
      "1 space via query alias: query field has no min, only question has min(5)",
      res.ok && !isError ? `ACCEPTED: ${res.text.slice(0,300)}` : `Rejected: ${res.text.slice(0,200)}`,
      res.ok && !isError ? "FINDING: single-space query accepted via alias path" : null
    );
  }

  // ─── 11. novada_map: limit boundary ──────────────────────────────────────────

  // 11a. limit = 0 (below min(1))
  {
    const res = await callTool(c, "novada_map", {
      url: "https://example.com",
      limit: 0,
      include_subdomains: false,
      max_depth: 2
    });
    const isError = res.ok && res.result?.isError;
    record("map/limit-0", "novada_map",
      { limit: 0 }, res,
      "Should reject: limit=0 below min(1)",
      isError ? `Correctly rejected: ${res.text.slice(0,200)}` : `ACCEPTED 0: ${res.text.slice(0,200)}`,
      !isError ? "FINDING: limit=0 accepted in map" : null
    );
  }

  // 11b. limit = 101 (above max(100))
  {
    const res = await callTool(c, "novada_map", {
      url: "https://example.com",
      limit: 101,
      include_subdomains: false,
      max_depth: 2
    });
    const isError = res.ok && res.result?.isError;
    record("map/limit-101", "novada_map",
      { limit: 101 }, res,
      "Should reject: limit=101 above max(100)",
      isError ? `Correctly rejected: ${res.text.slice(0,200)}` : `ACCEPTED 101: ${res.text.slice(0,200)}`,
      !isError ? "FINDING: limit=101 accepted in map" : null
    );
  }

  // ─── 12. Null/undefined/wrong type boundary tests ───────────────────────────

  // 12a. novada_search with null query
  {
    const res = await callTool(c, "novada_search", { query: null });
    const isError = res.ok && res.result?.isError;
    record("search/query-null", "novada_search",
      { query: null }, res,
      "Should reject: query=null is not a string",
      isError ? `Correctly rejected: ${res.text.slice(0,200)}` : `ACCEPTED null: ${res.text.slice(0,200)}`,
      !isError ? "FINDING: null query accepted" : null
    );
  }

  // 12b. novada_search with numeric query
  {
    const res = await callTool(c, "novada_search", { query: 12345 });
    const isError = res.ok && res.result?.isError;
    record("search/query-numeric", "novada_search",
      { query: 12345 }, res,
      "Numeric query — Zod may coerce or reject",
      `isError=${isError}: ${res.text.slice(0,200)}`,
      null
    );
  }

  // 12c. novada_extract with no url
  {
    const res = await callTool(c, "novada_extract", {
      format: "markdown",
      render: "auto"
    });
    const isError = res.ok && res.result?.isError;
    record("extract/url-missing", "novada_extract",
      { format: "markdown" }, res,
      "Should reject: url is required",
      isError ? `Correctly rejected: ${res.text.slice(0,200)}` : `ACCEPTED no url: ${res.text.slice(0,200)}`,
      !isError ? "FINDING: url-less extract accepted" : null
    );
  }

  await c.close();

  // Write results
  writeFileSync("/tmp/novada-qa-0.9.0/bound-caps.json", JSON.stringify(RESULTS, null, 2));
  console.log(`\n\nAll tests complete. Results written to /tmp/novada-qa-0.9.0/bound-caps.json`);

  // Print findings summary
  const findings = RESULTS.filter(r => r.finding);
  console.log(`\nFindings (${findings.length}/${RESULTS.length} scenarios):`);
  findings.forEach((f, i) => {
    console.log(`  ${i+1}. [${f.scenario}] ${f.finding}`);
  });

  return RESULTS;
}

runTests().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
