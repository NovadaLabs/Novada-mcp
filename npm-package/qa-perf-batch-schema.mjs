/**
 * QA: Investigate batch/urls schema failure
 * Finding: 'urls' alone fails because 'url' is a required field in schema
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
  const c = new Client({ name: "qa-batch-schema", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { c, t };
}

async function callTool(c, name, args, label) {
  const start = Date.now();
  try {
    const r = await c.callTool({ name, arguments: args });
    const elapsed = Date.now() - start;
    const content = r?.content?.[0]?.text ?? JSON.stringify(r);
    return { ok: true, elapsed, content, label };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { ok: false, elapsed, error: err.message, label };
  }
}

async function run() {
  const { c } = await makeClient();

  // Test 1: urls-only (no url) - should fail
  const r1 = await callTool(c, "novada_extract", {
    urls: ["https://example.com"],
    render: "static",
  }, "urls-only-no-url");
  console.log(`[T1] urls-only-no-url: ok=${r1.ok} elapsed=${r1.elapsed}ms`);
  console.log(`  content: ${r1.content?.slice(0, 300)}`);

  // Test 2: url + urls together
  const r2 = await callTool(c, "novada_extract", {
    url: "https://example.com",
    urls: ["https://example.com", "https://example.org"],
    render: "static",
  }, "url-and-urls");
  console.log(`[T2] url-and-urls: ok=${r2.ok} elapsed=${r2.elapsed}ms`);
  console.log(`  content: ${r2.content?.slice(0, 300)}`);

  // Test 3: url as single string (works)
  const r3 = await callTool(c, "novada_extract", {
    url: "https://example.com",
    render: "static",
  }, "url-single");
  console.log(`[T3] url-single: ok=${r3.ok} elapsed=${r3.elapsed}ms`);
  console.log(`  content: ${r3.content?.slice(0, 200)}`);

  // Test 4: url as array (works — this is the batch path)
  const r4 = await callTool(c, "novada_extract", {
    url: ["https://example.com", "https://example.org"],
    render: "static",
  }, "url-array");
  console.log(`[T4] url-array: ok=${r4.ok} elapsed=${r4.elapsed}ms`);
  console.log(`  content: ${r4.content?.slice(0, 300)}`);

  // Test 5: Check the full error message for urls-only
  console.log("\n=== FULL ERROR for urls-only ===");
  console.log(r1.content);

  // Summary: 'urls' alone fails because 'url' is not marked optional in ExtractParamsSchema
  // The docs say "pass urls for batch" but the schema requires 'url' to always be present
  // This is a contract violation: the documented interface says urls=array triggers batch,
  // but the schema enforces url as required (no .optional())

  await c.close();
}

run().catch(e => { console.error(e); process.exit(1); });
