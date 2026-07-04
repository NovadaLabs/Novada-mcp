/**
 * Precise boundary test: exactly 2000 chars should PASS
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";

async function makeClient() {
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
  });
  const c = new Client({ name: "qa-boundary", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { client: c, transport: t };
}

async function callResearch(client, args) {
  try {
    const r = await client.callTool({ name: "novada_research", arguments: args });
    return { result: r };
  } catch (e) {
    return { error: e };
  }
}

async function run() {
  const { client } = await makeClient();
  const results = [];

  // Exact 2000 chars: should PASS
  const q2000 = "x".repeat(2000);
  console.log(`q2000 length: ${q2000.length}`);
  const r1 = await callResearch(client, { question: q2000, depth: "quick" });
  const c1 = r1.result?.content?.[0]?.text || r1.error?.message || "unknown";
  console.log("2000 chars:", c1.includes("Research Unavailable") ? "PASS (got to research phase)" : "FAIL");
  console.log("2000 chars first 120:", c1.slice(0, 120));
  results.push({ chars: 2000, pass: c1.includes("Research Unavailable"), msg: c1.slice(0, 120) });

  // 1999 chars: should PASS
  const q1999 = "x".repeat(1999);
  console.log(`q1999 length: ${q1999.length}`);
  const r2 = await callResearch(client, { question: q1999, depth: "quick" });
  const c2 = r2.result?.content?.[0]?.text || r2.error?.message || "unknown";
  console.log("1999 chars:", c2.includes("Research Unavailable") ? "PASS" : "FAIL");
  results.push({ chars: 1999, pass: c2.includes("Research Unavailable"), msg: c2.slice(0, 120) });

  // 2001 chars: should FAIL
  const q2001 = "x".repeat(2001);
  console.log(`q2001 length: ${q2001.length}`);
  const r3 = await callResearch(client, { question: q2001, depth: "quick" });
  const c3 = r3.result?.content?.[0]?.text || r3.error?.message || "unknown";
  console.log("2001 chars:", c3.includes("INVALID_PARAMS") ? "PASS (correctly rejected)" : "FAIL");
  results.push({ chars: 2001, pass: c3.includes("INVALID_PARAMS"), msg: c3.slice(0, 120) });

  // Whitespace-only (5+ chars that becomes empty after trim) — should this fail?
  const qSpaces = " ".repeat(10);
  console.log(`qSpaces length: ${qSpaces.length}`);
  const r4 = await callResearch(client, { question: qSpaces, depth: "quick" });
  const c4 = r4.result?.content?.[0]?.text || r4.error?.message || "unknown";
  console.log("Whitespace 10 chars (trim→empty):", c4.slice(0, 200));
  results.push({ chars: "10-spaces", pass: "n/a", msg: c4.slice(0, 200) });

  // Only query (not question), exactly 4 chars — Zod min(1) on query, so should pass
  const r5 = await callResearch(client, { query: "test", depth: "quick" });
  const c5 = r5.result?.content?.[0]?.text || r5.error?.message || "unknown";
  console.log("query='test' (4 chars, no min 5 check on query):", c5.slice(0, 200));
  results.push({ test: "query-4-chars", msg: c5.slice(0, 200) });

  // query="" (empty string) — min(1) on 'question' but no min on 'query' in schema?
  const r6 = await callResearch(client, { query: "", depth: "quick" });
  const c6 = r6.result?.content?.[0]?.text || r6.error?.message || "unknown";
  console.log("query='' (empty string):", c6.slice(0, 200));
  results.push({ test: "query-empty", msg: c6.slice(0, 200) });

  await client.close();
  console.log("\n=== BOUNDARY RESULTS ===");
  console.log(JSON.stringify(results, null, 2));
}

run().catch(e => { console.error("Fatal:", e); process.exit(1); });
