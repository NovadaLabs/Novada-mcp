/**
 * QA: Error format consistency check
 * Compare ZodError path vs NovadaError path format
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function makeClient() {
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: "dummy" }),
  });
  const c = new Client({ name: "qa-fmt", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { t, c };
}

const { t, c } = await makeClient();

// Path A: NovadaError path (query too long → makeNovadaError inside novadaSearch)
const rA = await c.callTool({ name: "novada_search", arguments: { query: "x".repeat(600) } });
const textA = rA.content?.[0]?.text;
console.log("=== PATH A: NovadaError (search over-length query) ===");
console.log(textA);
console.log();

// Path B: ZodError path (missing required param)
const rB = await c.callTool({ name: "novada_extract", arguments: { format: "markdown", render: "auto" } });
const textB = rB.content?.[0]?.text;
console.log("=== PATH B: ZodError (missing url param in extract) ===");
console.log(textB);
console.log();

// Path C: ZodError path (wrong type in search)
const rC = await c.callTool({ name: "novada_search", arguments: { query: "test", include_domains: "not-array" } });
const textC = rC.content?.[0]?.text;
console.log("=== PATH C: ZodError (wrong type in search) ===");
console.log(textC);
console.log();

// Path D: Pre-validation error path in extract
const rD = await c.callTool({ name: "novada_extract", arguments: { url: "not-a-url", format: "markdown", render: "auto" } });
const textD = rD.content?.[0]?.text;
console.log("=== PATH D: Pre-validation in extract (invalid url format) ===");
console.log(textD);
console.log();

console.log("=== COMPARISON ===");
console.log("Path A has failure_class:", /failure_class:/.test(textA || ""));
console.log("Path A has retry_recommended:", /retry_recommended:/.test(textA || ""));
console.log("Path A has Error [code]:", /Error \[/.test(textA || ""));

console.log("Path B has failure_class:", /failure_class:/.test(textB || ""));
console.log("Path B has retry_recommended:", /retry_recommended:/.test(textB || ""));
console.log("Path B has Error [code]:", /Error \[/.test(textB || ""));

console.log("Path C has failure_class:", /failure_class:/.test(textC || ""));
console.log("Path C has retry_recommended:", /retry_recommended:/.test(textC || ""));
console.log("Path C has Error [code]:", /Error \[/.test(textC || ""));

console.log("Path D has failure_class:", /failure_class:/.test(textD || ""));
console.log("Path D has retry_recommended:", /retry_recommended:/.test(textD || ""));
console.log("Path D has Error [code]:", /Error \[/.test(textD || ""));

await c.close();
