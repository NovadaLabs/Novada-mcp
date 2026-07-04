/**
 * QA: Performance — batch/token perspective
 * Tests: batch URL limits, max_chars enforcement, perItemBudget arithmetic,
 * truncatePreservingTable logic, token overflow scenarios
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy"; // offline validation only

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
});
const c = new Client({ name: "qa-perf-batch", version: "0" }, { capabilities: {} });
await c.connect(t);

const results = [];

// ── Helper ────────────────────────────────────────────────────────────────────
async function probe(name, toolName, args) {
  try {
    const r = await c.callTool({ name: toolName, arguments: args });
    const text = r.content?.[0]?.text ?? JSON.stringify(r);
    return { name, ok: !r.isError, isError: r.isError, text };
  } catch (e) {
    return { name, ok: false, isError: true, text: e.message };
  }
}

// ── Scenario 1: Batch URL count = exactly 10 (boundary, should pass schema) ──
{
  const urls = Array.from({ length: 10 }, (_, i) => `https://example${i}.com/`);
  const r = await probe("batch-10-urls-boundary", "novada_extract", { url: urls });
  results.push({ scenario: "S1-batch-10-urls-boundary", isError: r.isError, excerpt: r.text.slice(0, 300) });
  console.log("S1:", r.isError ? "ERROR" : "OK", r.text.slice(0, 200));
}

// ── Scenario 2: Batch URL count = 11 (should be rejected immediately) ─────────
{
  const urls = Array.from({ length: 11 }, (_, i) => `https://example${i}.com/`);
  const r = await probe("batch-11-urls-over-limit", "novada_extract", { url: urls });
  results.push({ scenario: "S2-batch-11-urls-over-limit", isError: r.isError, excerpt: r.text.slice(0, 300) });
  console.log("S2 (expect error):", r.text.slice(0, 200));
}

// ── Scenario 3: max_chars=1000 (min boundary) ──────────────────────────────────
{
  const r = await probe("max-chars-1000-min", "novada_extract", {
    url: "https://example.com/",
    max_chars: 1000,
  });
  results.push({ scenario: "S3-max-chars-1000-min", isError: r.isError, excerpt: r.text.slice(0, 300) });
  console.log("S3:", r.isError ? "ERROR" : "OK", r.text.slice(0, 200));
}

// ── Scenario 4: max_chars=999 (below min boundary, should be rejected) ─────────
{
  const r = await probe("max-chars-999-below-min", "novada_extract", {
    url: "https://example.com/",
    max_chars: 999,
  });
  results.push({ scenario: "S4-max-chars-999-below-min", isError: r.isError, excerpt: r.text.slice(0, 300) });
  console.log("S4 (expect error):", r.text.slice(0, 200));
}

// ── Scenario 5: max_chars=100000 (max boundary) ─────────────────────────────────
{
  const r = await probe("max-chars-100000-max", "novada_extract", {
    url: "https://example.com/",
    max_chars: 100000,
  });
  results.push({ scenario: "S5-max-chars-100000-max", isError: r.isError, excerpt: r.text.slice(0, 300) });
  console.log("S5:", r.isError ? "ERROR" : "OK", r.text.slice(0, 200));
}

// ── Scenario 6: max_chars=100001 (above max, should be rejected) ────────────────
{
  const r = await probe("max-chars-100001-above-max", "novada_extract", {
    url: "https://example.com/",
    max_chars: 100001,
  });
  results.push({ scenario: "S6-max-chars-100001-above-max", isError: r.isError, excerpt: r.text.slice(0, 300) });
  console.log("S6 (expect error):", r.text.slice(0, 200));
}

// ── Scenario 7: batch 10 URLs with max_chars=1000 → perItemBudget = 100 each ──
// Budget math: max(500, floor(1000/10)) = max(500, 100) = 500
// So min floor kicks in and each item gets 500 chars
{
  const urls = Array.from({ length: 10 }, (_, i) => `https://example${i}.com/`);
  const r = await probe("batch-10-max-chars-1000", "novada_extract", {
    url: urls,
    max_chars: 1000,
  });
  results.push({ scenario: "S7-batch-10-max-chars-1000-perItemBudget", isError: r.isError, excerpt: r.text.slice(0, 500) });
  console.log("S7:", r.isError ? "ERROR" : "OK", r.text.slice(0, 300));
}

// ── Scenario 8: batch 1 URL (single via url array) ──────────────────────────────
{
  const r = await probe("batch-1-url-array", "novada_extract", {
    url: ["https://example.com/"],
    max_chars: 5000,
  });
  results.push({ scenario: "S8-batch-1-url-array", isError: r.isError, excerpt: r.text.slice(0, 300) });
  console.log("S8:", r.isError ? "ERROR" : "OK", r.text.slice(0, 200));
}

// ── Scenario 9: urls param (alias) with 2 URLs ───────────────────────────────────
{
  const r = await probe("urls-param-alias-2", "novada_extract", {
    urls: ["https://example.com/", "https://example.org/"],
    max_chars: 5000,
  });
  results.push({ scenario: "S9-urls-param-alias-2", isError: r.isError, excerpt: r.text.slice(0, 300) });
  console.log("S9:", r.isError ? "ERROR" : "OK", r.text.slice(0, 200));
}

// ── Scenario 10: Research question at max length (2000 chars) ──────────────────
{
  const longQuestion = "what is AI".padEnd(2000, " artificial intelligence");
  const r = await probe("research-max-question-length", "novada_research", {
    question: longQuestion.slice(0, 2000),
    depth: "quick",
  });
  results.push({ scenario: "S10-research-max-question", isError: r.isError, excerpt: r.text.slice(0, 300) });
  console.log("S10:", r.isError ? "ERROR" : "OK", r.text.slice(0, 200));
}

// ── Scenario 11: Research question over 2000 chars → should be rejected ─────────
{
  const overLongQuestion = "x".repeat(2001);
  const r = await probe("research-over-max-question-length", "novada_research", {
    question: overLongQuestion,
    depth: "quick",
  });
  results.push({ scenario: "S11-research-over-max-question", isError: r.isError, excerpt: r.text.slice(0, 300) });
  console.log("S11 (expect error):", r.text.slice(0, 200));
}

// ── Scenario 12: extract with max_chars=0 (invalid) ─────────────────────────────
{
  const r = await probe("max-chars-zero-invalid", "novada_extract", {
    url: "https://example.com/",
    max_chars: 0,
  });
  results.push({ scenario: "S12-max-chars-zero", isError: r.isError, excerpt: r.text.slice(0, 300) });
  console.log("S12 (expect error):", r.text.slice(0, 200));
}

// ── Scenario 13: batch 2 URLs - check perItemBudget math ────────────────────────
// max_chars=2000, 2 URLs → perItemBudget = max(500, floor(2000/2)) = max(500, 1000) = 1000
{
  const urls = ["https://example.com/", "https://example.org/"];
  const r = await probe("batch-2-budget-math", "novada_extract", {
    url: urls,
    max_chars: 2000,
  });
  results.push({ scenario: "S13-batch-2-budget-1000-each", isError: r.isError, excerpt: r.text.slice(0, 500) });
  console.log("S13:", r.isError ? "ERROR" : "OK", r.text.slice(0, 300));
}

// ── Scenario 14: extract format=html large page ───────────────────────────────────
// HTML format hardcodes 10000 char truncation, ignores max_chars
// Test: does max_chars override the 10K HTML cap?
{
  const r = await probe("html-format-10k-cap", "novada_extract", {
    url: "https://example.com/",
    format: "html",
    max_chars: 50000,  // should be ignored - HTML caps at 10K
  });
  results.push({ scenario: "S14-html-format-ignores-max-chars", isError: r.isError, excerpt: r.text.slice(0, 500) });
  console.log("S14:", r.isError ? "ERROR" : "OK", r.text.slice(0, 300));
}

// ── Scenario 15: unblock max_chars upper bound (500000) ─────────────────────────
{
  const r = await probe("unblock-max-chars-500000", "novada_unblock", {
    url: "https://example.com/",
    method: "render",
    timeout: 30000,
    max_chars: 500000,
  });
  results.push({ scenario: "S15-unblock-max-chars-500000", isError: r.isError, excerpt: r.text.slice(0, 300) });
  console.log("S15:", r.isError ? "ERROR" : "OK", r.text.slice(0, 200));
}

// ── Scenario 16: unblock max_chars=500001 (over limit) ──────────────────────────
{
  const r = await probe("unblock-max-chars-over-limit", "novada_unblock", {
    url: "https://example.com/",
    method: "render",
    timeout: 30000,
    max_chars: 500001,
  });
  results.push({ scenario: "S16-unblock-max-chars-over-limit", isError: r.isError, excerpt: r.text.slice(0, 300) });
  console.log("S16 (expect error):", r.text.slice(0, 200));
}

// ── Scenario 17: extract max_chars float (non-int) ────────────────────────────────
{
  const r = await probe("max-chars-float", "novada_extract", {
    url: "https://example.com/",
    max_chars: 5000.5,
  });
  results.push({ scenario: "S17-max-chars-float", isError: r.isError, excerpt: r.text.slice(0, 300) });
  console.log("S17 (expect error - not int):", r.text.slice(0, 200));
}

// ── Scenario 18: extract with wait_ms at boundary (30000) ────────────────────────
{
  const r = await probe("wait-ms-boundary-30000", "novada_extract", {
    url: "https://example.com/",
    wait_ms: 30000,
  });
  results.push({ scenario: "S18-wait-ms-30000", isError: r.isError, excerpt: r.text.slice(0, 200) });
  console.log("S18:", r.isError ? "ERROR" : "OK", r.text.slice(0, 200));
}

// ── Scenario 19: extract with wait_ms over boundary (30001) ──────────────────────
{
  const r = await probe("wait-ms-over-boundary-30001", "novada_extract", {
    url: "https://example.com/",
    wait_ms: 30001,
  });
  results.push({ scenario: "S19-wait-ms-over-30001", isError: r.isError, excerpt: r.text.slice(0, 300) });
  console.log("S19 (expect error):", r.text.slice(0, 200));
}

// ── Scenario 20: research max_chars not a thing - research doesn't accept max_chars ──
// novada_research has no max_chars param - output can be unbounded
{
  const r = await probe("research-no-max-chars", "novada_research", {
    question: "test query",
    depth: "quick",
    max_chars: 5000, // unknown param - should be ignored or error
  });
  results.push({ scenario: "S20-research-no-max-chars-param", isError: r.isError, excerpt: r.text.slice(0, 300) });
  console.log("S20:", r.isError ? "ERROR" : "OK", r.text.slice(0, 200));
}

await c.close();

// Output results as JSON
import { writeFileSync } from "fs";
writeFileSync("/tmp/novada-qa-0.9.0/perf-batch-raw.json", JSON.stringify(results, null, 2));
console.log("\n\nAll scenarios completed. Results:", results.length);
