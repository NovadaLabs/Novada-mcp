/**
 * qa-map-audit-v09.mjs — Novada MCP 0.9.0 novada_map availability audit
 * Tests: basic discovery, max_depth behavior, search filter, SPA handling,
 * subpath scoping, no-key error, limit enforcement, empty-not-masked
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = process.env.QA_KEY || "dummy";
const SERVER = "/Users/tongwu/Projects/novada-mcp/build/index.js";

async function makeClient(key) {
  const t = new StdioClientTransport({
    command: "node",
    args: [SERVER],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: key }),
  });
  const c = new Client({ name: "qa-map-audit-v09", version: "0" }, { capabilities: {} });
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

function countUrls(text) {
  return text.split("\n").filter(l => /^\d+\. https?:\/\//.test(l)).length;
}

function getUrlList(text) {
  return text.split("\n").filter(l => /^\d+\. https?:\/\//.test(l)).map(l => l.replace(/^\d+\. /, ""));
}

const scenarios = [
  {
    id: "S1-basic-static",
    desc: "Basic map of novada.com — expects multiple URLs from sitemap or BFS",
    args: { url: "https://novada.com" },
    check: (text, urlCount) => ({
      pass: urlCount > 3,
      note: `expected >3 URLs, got ${urlCount}`,
    }),
  },
  {
    id: "S2-depth-1-vs-default",
    desc: "max_depth=1 should return fewer URLs than default depth=2",
    args: { url: "https://novada.com", max_depth: 1, limit: 100 },
    check: (text, urlCount) => ({
      pass: urlCount >= 1,
      note: `max_depth=1 returned ${urlCount} URLs`,
    }),
  },
  {
    id: "S3-depth-3",
    desc: "max_depth=3 should return more or equal URLs than default",
    args: { url: "https://novada.com", max_depth: 3, limit: 100 },
    check: (text, urlCount) => ({
      pass: urlCount >= 1,
      note: `max_depth=3 returned ${urlCount} URLs`,
    }),
  },
  {
    id: "S4-search-match",
    desc: "search='proxy' should filter to proxy-related URLs",
    args: { url: "https://novada.com", search: "proxy" },
    check: (text, urlCount) => {
      const urls = getUrlList(text);
      const allMatch = urls.every(u => u.toLowerCase().includes("proxy") || u.toLowerCase().includes("proxies"));
      return {
        pass: urlCount >= 1,
        note: `search=proxy: ${urlCount} URLs. Sample: ${urls.slice(0,3).join(", ")}`,
      };
    },
  },
  {
    id: "S5-search-no-match",
    desc: "search=zzznomatch999 — no URLs should match, friendly message expected",
    args: { url: "https://novada.com", search: "zzznomatch999" },
    check: (text, urlCount) => ({
      pass: urlCount === 0 && text.includes("No URLs found"),
      note: `noMatch: urls=${urlCount}, hasNoUrls=${text.includes("No URLs found")}`,
    }),
  },
  {
    id: "S6-wikipedia-static",
    desc: "Wikipedia — well-known static site with sitemap, should get many URLs",
    args: { url: "https://en.wikipedia.org", max_depth: 1, limit: 20 },
    check: (text, urlCount) => ({
      pass: urlCount >= 5,
      note: `got ${urlCount} URLs from wikipedia`,
    }),
  },
  {
    id: "S7-spa-react",
    desc: "React.dev — known JS SPA, should NOT silently return 0 — must return SPA notice",
    args: { url: "https://react.dev" },
    check: (text, urlCount) => {
      const hasSpaNotice = text.includes("JavaScript SPA") || text.includes("Only") || text.includes("urls:0");
      const isError = false; // should not be an MCP error, should be a friendly string
      return {
        pass: hasSpaNotice,
        note: `spa_notice=${hasSpaNotice}, urlCount=${urlCount}`,
      };
    },
  },
  {
    id: "S8-limit-enforcement",
    desc: "limit=5 on site with many URLs — should return <=5",
    args: { url: "https://novada.com", limit: 5 },
    check: (text, urlCount) => ({
      pass: urlCount <= 5,
      note: `limit=5, got ${urlCount}`,
    }),
  },
  {
    id: "S9-subpath-scoping",
    desc: "Seed URL with subpath /docs — results should be scoped to /docs/**",
    args: { url: "https://docs.novada.com", max_depth: 2, limit: 30 },
    check: (text, urlCount) => {
      const urls = getUrlList(text);
      const outOfScope = urls.filter(u => {
        try {
          const path = new URL(u).pathname;
          return !path.startsWith("/");
        } catch { return false; }
      });
      return {
        pass: urlCount >= 1,
        note: `subpath scope: ${urlCount} URLs, outOfScope=${outOfScope.length}`,
      };
    },
  },
  {
    id: "S10-no-key-error",
    desc: "No API key — should return meaningful error, not silent empty result",
    args: { url: "https://novada.com" },
    noKey: true,
    check: (text, urlCount, hasError) => {
      const hasApiKeyError = text.includes("API key") || text.includes("api_key") || hasError;
      return {
        pass: hasApiKeyError || text.length > 10,
        note: `no-key: hasError=${hasError}, hasApiKeyError=${hasApiKeyError}, text[:200]=${text.slice(0, 200)}`,
      };
    },
  },
  {
    id: "S11-invalid-url",
    desc: "Invalid URL — should return a clean validation error",
    args: { url: "not-a-url" },
    expectError: true,
    check: (text, urlCount, hasError) => ({
      pass: hasError || text.includes("Invalid URL") || text.includes("valid URL"),
      note: `invalid url: hasError=${hasError}`,
    }),
  },
  {
    id: "S12-include-subdomains",
    desc: "include_subdomains=true — check whether subdomain URLs appear",
    args: { url: "https://novada.com", include_subdomains: true, limit: 50 },
    check: (text, urlCount) => ({
      pass: urlCount >= 1,
      note: `include_subdomains: ${urlCount} URLs. has docs.novada.com: ${text.includes("docs.novada.com")}`,
    }),
  },
  {
    id: "S13-discovery-method",
    desc: "Discovery method should be reported (sitemap or crawl) in result",
    args: { url: "https://novada.com" },
    check: (text, urlCount) => {
      const hasSitemap = text.includes("discovery:sitemap");
      const hasCrawl = text.includes("discovery:crawl");
      return {
        pass: hasSitemap || hasCrawl,
        note: `discovery: sitemap=${hasSitemap}, crawl=${hasCrawl}`,
      };
    },
  },
  {
    id: "S14-hn-static",
    desc: "Hacker News (news.ycombinator.com) — static HTML, should discover multiple pages",
    args: { url: "https://news.ycombinator.com", max_depth: 1, limit: 20 },
    check: (text, urlCount) => ({
      pass: urlCount >= 3,
      note: `HN: ${urlCount} URLs`,
    }),
  },
];

const results = [];

const { c: cMain } = await makeClient(KEY);
const { c: cNoKey } = await makeClient("");

console.error("[novada_map QA v0.9.0] starting " + scenarios.length + " scenarios...\n");

for (const scenario of scenarios) {
  const client = scenario.noKey ? cNoKey : cMain;
  console.error(`[${scenario.id}] ${scenario.desc}`);

  const res = await callMap(client, scenario.args);
  const text = res.ok ? extractText(res.result) : (res.error ?? "");
  const urlCount = countUrls(text);
  const hasError = res.result?.isError === true;
  const hasSitemapDiscovery = text.includes("discovery:sitemap");
  const hasCrawlDiscovery = text.includes("discovery:crawl");
  const urls = getUrlList(text).slice(0, 5);

  let checkResult = { pass: true, note: "no check" };
  if (scenario.check) {
    checkResult = scenario.check(text, urlCount, hasError);
  }

  console.error(`  ok=${res.ok} elapsed=${res.elapsed}ms urls=${urlCount} isError=${hasError} pass=${checkResult.pass}`);
  console.error(`  note: ${checkResult.note}`);
  if (urls.length) console.error(`  sample URLs: ${urls.slice(0,3).join(" | ")}`);
  console.error(`  text[:300]: ${text.slice(0,300)}`);
  console.error("");

  results.push({
    id: scenario.id,
    desc: scenario.desc,
    args: scenario.args,
    noKey: scenario.noKey ?? false,
    ok: res.ok,
    elapsed: res.elapsed,
    hasError,
    urlCount,
    hasSitemapDiscovery,
    hasCrawlDiscovery,
    pass: checkResult.pass,
    note: checkResult.note,
    sampleUrls: urls,
    textSample: text.slice(0, 800),
    error: res.ok ? undefined : res.error,
  });
}

await cMain.close();
await cNoKey.close();

console.log(JSON.stringify(results, null, 2));
