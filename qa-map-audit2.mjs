/**
 * qa-map-audit2.mjs — Follow-up targeted audit
 * Focus: verify docs.novada.com is genuinely a SPA, test well-known static sites,
 * verify max_depth changes behavior, test error masking, test subpath scoping.
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
  const c = new Client({ name: "qa-map-audit2", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { c, t };
}

async function callMap(c, args, timeoutMs = 45000) {
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
    id: "S9-example-com",
    desc: "Map example.com — simple static site should return multiple URLs or SPA notice",
    args: { url: "https://example.com" },
  },
  {
    id: "S10-wikipedia",
    desc: "Wikipedia static page — should find URLs via BFS/sitemap",
    args: { url: "https://en.wikipedia.org/wiki/Web_scraping", max_depth: 1, limit: 10 },
  },
  {
    id: "S11-static-blog",
    desc: "ycombinator news — static page map",
    args: { url: "https://news.ycombinator.com", max_depth: 1, limit: 20 },
  },
  {
    id: "S12-search-filter-match",
    desc: "Search filter that SHOULD match on a site with content",
    args: { url: "https://novada.com", search: "scraping" },
  },
  {
    id: "S13-search-filter-hyphen",
    desc: "Search filter with hyphenated term — tests token normalization",
    args: { url: "https://novada.com", search: "web-scraping" },
  },
  {
    id: "S14-no-api-key",
    desc: "No API key — should get meaningful error, not silent empty",
    args: { url: "https://novada.com" },
    noKey: true,
  },
  {
    id: "S15-subpath-scoping",
    desc: "Subpath URL — should scope results to /use-cases/**",
    args: { url: "https://www.novada.com/use-cases/", max_depth: 2, limit: 30 },
  },
  {
    id: "S16-limit-enforcement",
    desc: "Limit=5 on site with many URLs — should return exactly 5",
    args: { url: "https://novada.com", limit: 5 },
  },
];

const results = [];

const { c: c1, t: t1 } = await makeClient();
// No-key client
const t2 = new StdioClientTransport({
  command: "node",
  args: [SERVER],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: "" }),
});
const c2 = new Client({ name: "qa-map-nokey", version: "0" }, { capabilities: {} });
await c2.connect(t2);

for (const scenario of scenarios) {
  console.error(`\n[${scenario.id}] ${scenario.desc}`);
  const client = scenario.noKey ? c2 : c1;
  const res = await callMap(client, scenario.args);

  const text = res.ok ? extractText(res.result) : res.error;
  const lines = text.split("\n").filter(Boolean);
  const urlCount = lines.filter(l => /^\d+\. https?:\/\//.test(l)).length;
  const hasError = res.result?.isError === true;
  const firstUrls = lines.filter(l => /^\d+\. https?:\/\//.test(l)).slice(0, 3);

  console.error(`  ok:${res.ok} elapsed:${res.elapsed}ms urls:${urlCount} isError:${hasError}`);
  if (firstUrls.length > 0) console.error(`  sample: ${firstUrls.slice(0,3).join(" | ")}`);
  console.error(`  text[:400]: ${text.slice(0, 400)}`);

  results.push({
    id: scenario.id,
    desc: scenario.desc,
    args: scenario.args,
    noKey: scenario.noKey ?? false,
    ok: res.ok,
    elapsed: res.elapsed,
    hasError,
    urlCount,
    textSample: text.slice(0, 600),
    error: res.ok ? undefined : res.error,
  });
}

await c1.close();
await c2.close();

console.log(JSON.stringify(results, null, 2));
