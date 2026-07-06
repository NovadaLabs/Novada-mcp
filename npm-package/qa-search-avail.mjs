/**
 * QA Client: novada_search availability audit
 * Tests: all 4 working engines, num, time_range, dates, domain filters, enrich_top, search_id
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = process.env.QA_KEY || "dummy";
const INDEX = "/Users/tongwu/Projects/novada-mcp/build/index.js";

async function makeClient() {
  const t = new StdioClientTransport({
    command: "node",
    args: [INDEX],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
  });
  const c = new Client({ name: "audit-search", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { c, t };
}

function parseResult(r) {
  try {
    const text = r?.content?.[0]?.text || "";
    return { text, isError: r?.isError };
  } catch (e) {
    return { text: String(r), isError: true };
  }
}

async function runScenario(label, toolArgs, client) {
  console.error(`\n[TEST] ${label}`);
  try {
    const start = Date.now();
    const r = await client.callTool({ name: "novada_search", arguments: toolArgs });
    const elapsed = Date.now() - start;
    const { text, isError } = parseResult(r);
    const hasResults = text.includes("results:") || text.match(/## \d+\./);
    const searchId = text.match(/search_id[:\s]+([^\s|"]+)/)?.[1] || null;
    const resultCount = text.match(/results:(\d+)/)?.[1] || null;
    const urls = (text.match(/https?:\/\/[^\s)\]"]+/g) || []).slice(0, 3);
    console.error(`  isError=${isError} | elapsed=${elapsed}ms | results=${resultCount} | search_id=${searchId}`);
    console.error(`  urls: ${urls.join(", ") || "none"}`);
    console.error(`  snippet: ${text.slice(0, 300).replace(/\n/g, " | ")}`);
    return { label, ok: !isError && hasResults, elapsed, searchId, resultCount, urls, text: text.slice(0, 2000) };
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    return { label, ok: false, elapsed: 0, error: err.message };
  }
}

async function main() {
  const results = [];

  // ── Test 1: Google basic ──────────────────────────────────────────────────
  {
    const { c } = await makeClient();
    const r = await runScenario("google-basic", { query: "novada web scraping API", engine: "google" }, c);
    results.push(r);
    await c.close();
  }

  // ── Test 2: DuckDuckGo basic ──────────────────────────────────────────────
  {
    const { c } = await makeClient();
    const r = await runScenario("duckduckgo-basic", { query: "web scraping proxy service", engine: "duckduckgo" }, c);
    results.push(r);
    await c.close();
  }

  // ── Test 3: Bing basic ────────────────────────────────────────────────────
  {
    const { c } = await makeClient();
    const r = await runScenario("bing-basic", { query: "AI agent proxy tools", engine: "bing" }, c);
    results.push(r);
    await c.close();
  }

  // ── Test 4: Yandex basic ─────────────────────────────────────────────────
  {
    const { c } = await makeClient();
    const r = await runScenario("yandex-basic", { query: "web scraping tools", engine: "yandex" }, c);
    results.push(r);
    await c.close();
  }

  // ── Test 5: Yahoo (should return YAHOO_UNAVAILABLE message) ───────────────
  {
    const { c } = await makeClient();
    const r = await runScenario("yahoo-unavailable", { query: "web scraping", engine: "yahoo" }, c);
    // Yahoo should return degraded message, not crash
    r.label = "yahoo-unavailable";
    r.ok = r.text?.includes("Yahoo") || r.text?.includes("yahoo") || r.text?.includes("unsupported");
    results.push(r);
    await c.close();
  }

  // ── Test 6: num param ─────────────────────────────────────────────────────
  {
    const { c } = await makeClient();
    const r = await runScenario("google-num=3", { query: "MCP tools 2024", engine: "google", num: 3 }, c);
    const count = parseInt(r.resultCount || "0");
    r.numCheck = { requested: 3, returned: count, ok: count <= 3 };
    if (count > 3) r.ok = false;
    results.push(r);
    await c.close();
  }

  // ── Test 7: time_range param ──────────────────────────────────────────────
  {
    const { c } = await makeClient();
    const r = await runScenario("google-time_range=week", { query: "AI news", engine: "google", time_range: "week" }, c);
    // Verify filter is reflected in output metadata
    r.timeRangeInOutput = r.text?.includes("time:week") || r.text?.includes("time_range");
    results.push(r);
    await c.close();
  }

  // ── Test 8: start_date / end_date ─────────────────────────────────────────
  {
    const { c } = await makeClient();
    const r = await runScenario("google-date-range", {
      query: "Claude AI announcements",
      engine: "google",
      start_date: "2024-01-01",
      end_date: "2024-12-31",
    }, c);
    r.dateFilterInOutput = r.text?.includes("2024") || r.text?.includes("dates:");
    results.push(r);
    await c.close();
  }

  // ── Test 9: include_domains ───────────────────────────────────────────────
  {
    const { c } = await makeClient();
    const r = await runScenario("google-include_domains", {
      query: "machine learning tutorial",
      engine: "google",
      include_domains: ["github.com"],
    }, c);
    // Verify all result URLs are from github.com
    const nonGithub = r.urls?.filter(u => !u.includes("github.com")) || [];
    r.includeDomainsCheck = { allFromDomain: nonGithub.length === 0, nonGithub };
    results.push(r);
    await c.close();
  }

  // ── Test 10: exclude_domains ──────────────────────────────────────────────
  {
    const { c } = await makeClient();
    const r = await runScenario("google-exclude_domains", {
      query: "python tutorial",
      engine: "google",
      exclude_domains: ["reddit.com", "quora.com"],
    }, c);
    const allUrls = (r.text?.match(/https?:\/\/[^\s)\]"]+/g) || []);
    const hasExcluded = allUrls.some(u => u.includes("reddit.com") || u.includes("quora.com"));
    r.excludeDomainsCheck = { hasExcluded, ok: !hasExcluded };
    if (hasExcluded) r.ok = false;
    results.push(r);
    await c.close();
  }

  // ── Test 11: enrich_top ───────────────────────────────────────────────────
  {
    const { c } = await makeClient();
    const r = await runScenario("google-enrich_top", {
      query: "Anthropic Claude API documentation",
      engine: "google",
      enrich_top: true,
    }, c);
    r.enrichTopCheck = {
      hasExtractedContent: r.text?.includes("extracted_content") || r.text?.includes("# "),
      text: r.text?.slice(0, 500),
    };
    results.push(r);
    await c.close();
  }

  // ── Test 12: search_id present in markdown output ─────────────────────────
  {
    const { c } = await makeClient();
    const r = await runScenario("google-search_id-check", {
      query: "test search id presence",
      engine: "google",
    }, c);
    r.searchIdPresent = Boolean(r.searchId);
    if (!r.searchId) r.ok = false;
    results.push(r);
    await c.close();
  }

  // ── Test 13: JSON format output ────────────────────────────────────────────
  {
    const { c } = await makeClient();
    const r = await runScenario("google-json-format", {
      query: "JSON output test",
      engine: "google",
      format: "json",
      num: 3,
    }, c);
    let jsonValid = false;
    let searchIdInJson = false;
    try {
      const obj = JSON.parse(r.text.replace(/^📁[^\n]*\n\n/, ""));
      jsonValid = Array.isArray(obj.results) && obj.results.length > 0;
      searchIdInJson = Boolean(obj.search_id);
    } catch (e) {
      r.jsonParseError = e.message;
    }
    r.jsonCheck = { jsonValid, searchIdInJson };
    if (!jsonValid || !searchIdInJson) r.ok = false;
    results.push(r);
    await c.close();
  }

  // ── Test 14: exclude_social filter ────────────────────────────────────────
  {
    const { c } = await makeClient();
    const r = await runScenario("google-exclude_social", {
      query: "python programming tips",
      engine: "google",
      exclude_social: true,
    }, c);
    const allUrls = (r.text?.match(/https?:\/\/[^\s)\]"]+/g) || []);
    const socialDomains = ["reddit.com","twitter.com","x.com","linkedin.com","facebook.com","instagram.com","tiktok.com"];
    const hasSocial = allUrls.some(u => socialDomains.some(d => u.includes(d)));
    r.excludeSocialCheck = { hasSocial, ok: !hasSocial };
    results.push(r);
    await c.close();
  }

  // ── Test 15: country + language params pass-through ───────────────────────
  {
    const { c } = await makeClient();
    const r = await runScenario("google-country-language", {
      query: "news",
      engine: "google",
      country: "gb",
      language: "en",
    }, c);
    r.countryFilterInOutput = r.text?.includes("country:gb") || r.ok;
    results.push(r);
    await c.close();
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.error("\n\n====== SUMMARY ======");
  for (const r of results) {
    const status = r.ok ? "✓" : "✗";
    console.error(`${status} ${r.label}: elapsed=${r.elapsed}ms resultCount=${r.resultCount} searchId=${r.searchId}`);
    if (!r.ok) console.error(`  FAIL details: ${JSON.stringify({ error: r.error, checks: r.numCheck || r.jsonCheck || r.excludeDomainsCheck || r.enrichTopCheck || r.searchIdPresent })}`);
  }

  console.log(JSON.stringify({ scenarios: results }, null, 2));
}

main().catch(e => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
