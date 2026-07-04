/**
 * Targeted follow-up probes for identified issues
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CREDS = {
  NOVADA_API_KEY: "1f35b477c9e1802778ec64aee2a6adfa",
  NOVADA_PROXY_USER: "tongwu_TRDI7X",
  NOVADA_PROXY_PASS: "_Asd1644asd_",
  NOVADA_BROWSER_WS: "wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com",
};

async function makeClient() {
  const indexPath = resolve(__dirname, "build/index.js");
  const transport = new StdioClientTransport({
    command: "node",
    args: [indexPath],
    env: { ...process.env, ...CREDS },
  });
  const client = new Client({ name: "probe-targeted", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return { client };
}

async function callTool(client, name, args) {
  const start = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args });
    const elapsed = Date.now() - start;
    return { ok: true, elapsed, result };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { ok: false, elapsed, error: err };
  }
}

function inspect(label, r) {
  console.log(`\n=== ${label} ===`);
  console.log(`ok:${r.ok} elapsed:${r.elapsed}ms isError:${r.result?.isError}`);
  if (!r.ok) {
    console.log("MCP error:", JSON.stringify(r.error, null, 2));
    return;
  }
  const content = r.result?.content;
  const text = Array.isArray(content) && content[0]?.text ? content[0].text : JSON.stringify(r.result);
  console.log("output (800 chars):", text.slice(0, 800));
  // Specific checks
  console.log("has agent_instruction:", text.includes("agent_instruction"));
  console.log("has 'Next step:':", text.includes("Next step:"));
}

const { client } = await makeClient();

// Test 1: models=[] empty — this returns "All 0 searches failed" which is wrong message
// Verify full output
const r1 = await callTool(client, "novada_ai_monitor", { brand: "novada", models: [] });
inspect("EMPTY models=[] FULL OUTPUT", r1);
// Print the full output
const content1 = r1.result?.content?.[0]?.text || "";
console.log("\n--- FULL OUTPUT ---\n", content1);

// Test 2: Verify validation errors lack agent_instruction
const r2 = await callTool(client, "novada_ai_monitor", {});
inspect("MISSING brand — check for agent_instruction", r2);
const content2 = r2.result?.content?.[0]?.text || "";
console.log("\n--- FULL OUTPUT ---\n", content2);

// Test 3: unknown model — does it warn the user that the model is unrecognized?
const r3 = await callTool(client, "novada_ai_monitor", { brand: "novada", models: ["badmodel"] });
inspect("UNKNOWN MODEL — full output", r3);
const content3 = r3.result?.content?.[0]?.text || "";
console.log("\n--- FULL OUTPUT ---\n", content3);

// Test 4: topics array with only empty strings
const r4 = await callTool(client, "novada_ai_monitor", { brand: "novada", topics: ["", "  ", ""] });
inspect("EMPTY TOPIC STRINGS", r4);
const content4 = r4.result?.content?.[0]?.text || "";
console.log("\n--- FULL OUTPUT ---\n", content4);

// Test 5: models with valid but ALL timing out — simulate by checking what brand "novada" returns
// since it returns 0 mentions normally. Confirm it returns isError: false even when no data.
const r5 = await callTool(client, "novada_ai_monitor", { brand: "novada", models: ["chatgpt"] });
inspect("novada/chatgpt — zero mentions path", r5);

// Test 6: Check that brand with control chars doesn't corrupt query construction
const r6 = await callTool(client, "novada_ai_monitor", { brand: "novada\x00\x01\x1f", models: ["chatgpt"] });
inspect("NULL BYTE in brand", r6);
const content6 = r6.result?.content?.[0]?.text || "";
console.log("\n--- query line check ---");
const queryLine = content6.split('\n').find(l => l.startsWith('query:'));
console.log("query line:", JSON.stringify(queryLine));

// Test 7: topics array uses only first topic — confirm by passing 3 topics
const r7 = await callTool(client, "novada_ai_monitor", { brand: "Firecrawl", models: ["chatgpt"], topics: ["pricing", "comparison", "api"] });
inspect("3 topics — only first used?", r7);
const content7 = r7.result?.content?.[0]?.text || "";
const queryLine7 = content7.split('\n').find(l => l.startsWith('query:'));
console.log("query line (check if all 3 topics used):", queryLine7);

console.log("\n=== TARGETED PROBE COMPLETE ===");
process.exit(0);
