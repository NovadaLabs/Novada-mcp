/**
 * Full tool test — all novada-mcp tools with unified API key
 * Tests every tool that can be called without special credentials
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD = resolve(__dirname, "../../build");
const API_KEY = "1f35b477c9e1802778ec64aee2a6adfa";

const results = [];
const now = () => Date.now();

function log(tool, status, ms, detail) {
  const icon = status === "PASS" ? "✅" : status === "SKIP" ? "⏭️" : "❌";
  console.log(`  ${icon} ${tool.padEnd(25)} ${String(ms + "ms").padEnd(8)} ${detail}`);
  results.push({ tool, status, ms, detail });
}

async function test(tool, fn) {
  const t0 = now();
  try {
    const r = await fn();
    log(tool, "PASS", now() - t0, r);
  } catch (e) {
    log(tool, "FAIL", now() - t0, e.message?.slice(0, 120) || String(e).slice(0, 120));
  }
}

// Import all tools
const T = await import(`${BUILD}/tools/index.js`);

console.log("\n═══ FULL TOOL TEST — novada-mcp 0.7.10 ═══\n");
console.log("API Key: ...adfa (unified all-in-one)\n");

// ─── 1. SEARCH ───
await test("novada_search", async () => {
  const r = await T.novadaSearch({ query: "novada mcp server", engine: "duckduckgo", num: 3, country: "", language: "", format: "markdown" }, API_KEY);
  const count = (r.match(/https?:\/\//g) || []).length;
  return `${count} results, ${r.length} chars`;
});

// ─── 2. EXTRACT (static) ───
await test("novada_extract (static)", async () => {
  const r = await T.novadaExtract({ url: "https://example.com", format: "markdown", render: "auto" }, API_KEY);
  return `quality:${r.match(/quality:(\d+)/)?.[1]}/100, ${r.match(/chars:(\d+)/)?.[1]} chars`;
});

// ─── 3. EXTRACT (render) ───
await test("novada_extract (render)", async () => {
  const r = await T.novadaExtract({ url: "https://www.amazon.com/dp/B0FTC2PRVZ", format: "markdown", render: "auto" }, API_KEY);
  const ab = r.match(/anti_bot:\s*(\w+)/)?.[1];
  return `quality:${r.match(/quality:(\d+)/)?.[1]}/100, mode:${r.match(/mode: (\w+)/)?.[1]}${ab ? `, anti_bot:${ab}` : ""}`;
});

// ─── 4. EXTRACT (batch) ───
await test("novada_extract (batch)", async () => {
  const r = await T.novadaExtract({ url: ["https://news.ycombinator.com", "https://techcrunch.com"], format: "markdown", render: "auto" }, API_KEY);
  const ok = (r.match(/successful:(\d+)/)?.[1]) || "?";
  return `batch ${ok}/2 successful, ${r.length} chars`;
});

// ─── 5. CRAWL ───
await test("novada_crawl", async () => {
  const r = await T.novadaCrawl({ url: "https://docs.python.org/3/library/asyncio.html", max_pages: 2, format: "markdown" }, API_KEY);
  const pages = r.match(/pages:(\d+)/)?.[1];
  return `${pages} pages crawled, ${r.length} chars`;
});

// ─── 6. RESEARCH ───
await test("novada_research", async () => {
  const r = await T.novadaResearch({ question: "What is novada MCP server?", depth: "quick" }, API_KEY);
  const q = r.match(/queries:\s*(\d+)\/(\d+)/);
  const s = r.match(/sources_extracted:\s*(\d+)/);
  return `queries:${q?`${q[1]}/${q[2]}`:"?"}, sources:${s?s[1]:"?"}, ${r.length} chars`;
});

// ─── 7. MAP ───
await test("novada_map", async () => {
  const r = await T.novadaMap({ url: "https://docs.python.org/3/", limit: 10 }, API_KEY);
  const urls = r.match(/urls:(\d+)/)?.[1];
  return `${urls} URLs discovered`;
});

// ─── 8. SCRAPE (Google search — faster than Amazon) ───
await test("novada_scrape", async () => {
  const r = await T.novadaScrape({ platform: "google.com", operation: "google_search", params: { q: "novada mcp" }, limit: 5, format: "markdown" }, API_KEY);
  const records = r.match(/records:\s*(\d+)/)?.[1];
  return `${records || "?"} records, ${r.length} chars`;
});

// ─── 9. VERIFY ───
await test("novada_verify", async () => {
  const r = await T.novadaVerify({ claim: "Claude is made by Anthropic" }, API_KEY);
  const verdict = r.match(/verdict:\s*(\w+)/)?.[1];
  const conf = r.match(/confidence:\s*(\d+)/)?.[1];
  return `verdict:${verdict}, confidence:${conf}`;
});

// ─── 10. MONITOR (baseline) ───
await test("novada_monitor (baseline)", async () => {
  const r = await T.novadaMonitor({ url: "https://news.ycombinator.com" }, API_KEY);
  const state = /first.check|baseline/i.test(r) ? "baseline" : /unchanged/i.test(r) ? "unchanged" : "changed";
  return `state:${state}, ${r.length} chars`;
});

// ─── 11. MONITOR (unchanged) ───
await test("novada_monitor (unchanged)", async () => {
  const r = await T.novadaMonitor({ url: "https://news.ycombinator.com" }, API_KEY);
  const state = /first.check|baseline/i.test(r) ? "baseline" : /unchanged/i.test(r) ? "unchanged" : "changed";
  return `state:${state}`;
});

// ─── 12. UNBLOCK ───
await test("novada_unblock", async () => {
  const r = await T.novadaUnblock({ url: "https://example.com", method: "render" }, API_KEY);
  const hasHtml = r.includes("<html") || r.includes("<!DOCTYPE") || r.includes("<head");
  return `raw HTML: ${hasHtml ? "yes" : "no"}, ${r.length} chars`;
});

// ─── 13. HEALTH ───
await test("novada_health", async () => {
  const r = await T.novadaHealth({}, API_KEY);
  const active = (r.match(/✅|ACTIVE/gi) || []).length;
  return `${active} products active`;
});

// ─── 14. HEALTH_ALL ───
await test("novada_health_all", async () => {
  const r = await T.novadaHealthAll({}, API_KEY);
  const active = (r.match(/✅|active|reachable/gi) || []).length;
  return `${active} endpoints reachable, ${r.length} chars`;
});

// ─── 15. DISCOVER ───
await test("novada_discover", async () => {
  const r = await T.novadaDiscover({});
  const tools = (r.match(/novada_/g) || []).length;
  return `${tools} tool mentions listed`;
});

// ─── 16. PROXY (residential) ───
await test("novada_proxy_residential", async () => {
  const r = await T.novadaProxyResidential({ country: "US", format: "url" });
  const hasProxy = r.includes("http") || r.includes("proxy") || r.includes("://");
  return hasProxy ? "proxy URL generated" : `output: ${r.slice(0, 80)}`;
});

// ─── 17. AI MONITOR ───
await test("novada_ai_monitor", async () => {
  const r = await T.novadaAiMonitor({ brand: "Novada", models: ["perplexity"] }, API_KEY);
  return `${r.length} chars, ${r.includes("sentiment") || r.includes("Sentiment") ? "has sentiment" : "no sentiment"}`;
});

// ─── 18. SCRAPER_SUBMIT ───
await test("novada_scraper_submit", async () => {
  const r = await T.novadaScraperSubmit({ platform: "amazon.com", operation: "amazon_product_asin", params: { asin: "B0FTC2PRVZ" } }, API_KEY);
  const hasTaskId = r.includes("task_id") || r.includes("taskId");
  return hasTaskId ? "task submitted" : `output: ${r.slice(0, 80)}`;
});

// ─── SUMMARY ───
const passed = results.filter(r => r.status === "PASS").length;
const failed = results.filter(r => r.status === "FAIL").length;
const skipped = results.filter(r => r.status === "SKIP").length;
const total = results.length;

console.log(`\n═══ SUMMARY ═══`);
console.log(`  PASS: ${passed}/${total}`);
if (failed) console.log(`  FAIL: ${failed}/${total}`);
if (skipped) console.log(`  SKIP: ${skipped}/${total}`);
console.log(`  SR: ${(passed/total*100).toFixed(0)}%`);

if (failed) {
  console.log(`\n  Failed tools:`);
  results.filter(r => r.status === "FAIL").forEach(r => console.log(`    ❌ ${r.tool}: ${r.detail}`));
}

console.log("");
