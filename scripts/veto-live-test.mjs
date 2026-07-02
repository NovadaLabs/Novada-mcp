/**
 * Live veto verification script.
 * Tests: (1) large site with limit→map_partial not map_complete,
 *        (2) search active with under-delivery→no "matching" ambiguity,
 *        (3) BFS fallback still returns map_complete on a small genuine site (unit only).
 * Run: NOVADA_API_KEY=<key> node scripts/veto-live-test.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const API_KEY = process.env.NOVADA_API_KEY;
if (!API_KEY) { console.error("NOVADA_API_KEY not set"); process.exit(1); }

const transport = new StdioClientTransport({
  command: "node",
  args: ["build/index.js"],
  env: { ...process.env, NOVADA_API_KEY: API_KEY },
});
const client = new Client({ name: "veto-verify", version: "0.0.1" });
await client.connect(transport);

let passed = 0, failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}\n         ${detail}`);
    failed++;
  }
}

// --- Test 1: docs.firecrawl.dev limit=30 ---
console.log("\n[Test 1] novada_map docs.firecrawl.dev limit=30 max_depth=2");
const r1 = await client.callTool({ name: "novada_map", arguments: { url: "https://docs.firecrawl.dev", limit: 30, max_depth: 2 } });
const t1 = r1.content?.[0]?.text ?? "";
console.log("  snippet:", t1.slice(0, 400));
const urlCount1 = (t1.match(/^\d+\. /gm) ?? []).length;
check("returns ~30 URLs", urlCount1 >= 20, `got ${urlCount1}`);
check("does NOT contain map_complete (site has >>30 pages)", !t1.includes("map_complete"), "map_complete found in output");
check("contains map_partial (limit-capped)", t1.includes("map_partial"), "map_partial not found — unconditional map_complete emitted");

// --- Test 2: search active, underdelivery wording ---
console.log("\n[Test 2] novada_map docs.firecrawl.dev search=api limit=5");
const r2 = await client.callTool({ name: "novada_map", arguments: { url: "https://docs.firecrawl.dev", limit: 5, max_depth: 2, search: "api" } });
const t2 = r2.content?.[0]?.text ?? "";
console.log("  snippet:", t2.slice(0, 500));
check("under-delivery wording does NOT say 'matching URLs in scope'", !/sitemap has \d+ matching URLs in scope/.test(t2), "ambiguous 'matching' wording still present");

await client.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
