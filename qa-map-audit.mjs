/**
 * qa-map-audit.mjs — Live availability audit for novada_map
 * Runs 6 scenarios covering: basic discovery, max_depth, search filter,
 * SPA handling, large site, no-key error path.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = process.env.QA_KEY || "dummy";
const SERVER = "/Users/tongwu/Projects/novada-mcp/build/index.js";

async function makeClient() {
  const t = new StdioClientTransport({
    command: "node",
    args: [SERVER],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
  });
  const c = new Client({ name: "qa-map-audit", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { c, t };
}

async function callMap(c, args) {
  const start = Date.now();
  try {
    const r = await c.callTool({ name: "novada_map", arguments: args });
    const elapsed = Date.now() - start;
    return { ok: true, result: r, elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { ok: false, error: err.message ?? String(err), elapsed };
  }
}

function extractText(result) {
  if (!result?.content) return "";
  return result.content.map(c => c.text ?? "").join("\n");
}

const scenarios = [
  {
    id: "S1-basic",
    desc: "Basic map of docs.novada.com — expects multiple URLs",
    args: { url: "https://docs.novada.com" },
  },
  {
    id: "S2-max-depth-1",
    desc: "Shallow map with max_depth=1 — should return fewer URLs",
    args: { url: "https://docs.novada.com", max_depth: 1 },
  },
  {
    id: "S3-max-depth-3",
    desc: "Deeper map with max_depth=3 — should return more URLs",
    args: { url: "https://docs.novada.com", max_depth: 3 },
  },
  {
    id: "S4-search-filter",
    desc: "Search filter 'api' — should return only API-related URLs",
    args: { url: "https://docs.novada.com", search: "api" },
  },
  {
    id: "S5-spa",
    desc: "Map a known SPA site — should return SPA warning, not empty silently",
    args: { url: "https://react.dev" },
  },
  {
    id: "S6-no-match-search",
    desc: "Search filter with no match 'zzznomatch999' — should return friendly no-match message",
    args: { url: "https://docs.novada.com", search: "zzznomatch999" },
  },
  {
    id: "S7-static-site",
    desc: "Map a static site with sitemap — github.com docs",
    args: { url: "https://developer.mozilla.org/en-US/docs/Web/API", max_depth: 1, limit: 20 },
  },
  {
    id: "S8-subdomains",
    desc: "include_subdomains=true — check subdomain URLs included",
    args: { url: "https://novada.com", include_subdomains: true, limit: 30 },
  },
];

const results = [];

const { c, t } = await makeClient();

for (const scenario of scenarios) {
  console.error(`\n[${scenario.id}] ${scenario.desc}`);
  console.error(`  args: ${JSON.stringify(scenario.args)}`);

  const res = await callMap(c, scenario.args);

  const text = res.ok ? extractText(res.result) : res.error;
  const lines = text.split("\n").filter(Boolean);
  const urlCount = lines.filter(l => /^\d+\. https?:\/\//.test(l)).length;
  const hasError = res.result?.isError === true;
  const hasSpaWarning = text.includes("JavaScript SPA") || text.includes("Only") || text.includes("urls:0");
  const hasSitemapDiscovery = text.includes("discovery:sitemap");
  const hasCrawlDiscovery = text.includes("discovery:crawl");
  const firstUrls = lines.filter(l => /^\d+\. https?:\/\//.test(l)).slice(0, 5);

  console.error(`  ok: ${res.ok}, elapsed: ${res.elapsed}ms, urlCount: ${urlCount}, isError: ${hasError}`);
  if (firstUrls.length > 0) console.error(`  first URLs: ${firstUrls.join(" | ")}`);
  console.error(`  text[:300]: ${text.slice(0, 300)}`);

  results.push({
    id: scenario.id,
    desc: scenario.desc,
    args: scenario.args,
    ok: res.ok,
    elapsed: res.elapsed,
    hasError,
    urlCount,
    hasSpaWarning,
    hasSitemapDiscovery,
    hasCrawlDiscovery,
    textSample: text.slice(0, 500),
    error: res.ok ? undefined : res.error,
  });
}

await c.close();

console.log(JSON.stringify(results, null, 2));
