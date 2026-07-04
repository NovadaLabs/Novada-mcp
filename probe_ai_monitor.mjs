/**
 * Red-team probe for novada_ai_monitor
 * Real MCP calls over stdio to build/index.js
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CREDS = {
  NOVADA_API_KEY: "1f35b477c9e1802778ec64aee2a6adfa",
  NOVADA_PROXY_USER: "tongwu_TRDI7X",
  NOVADA_PROXY_PASS: "_Asd1644asd_",
  NOVADA_BROWSER_WS: "wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com",
};

// Create a client + transport connected to build/index.js
async function makeClient() {
  const indexPath = resolve(__dirname, "build/index.js");
  const transport = new StdioClientTransport({
    command: "node",
    args: [indexPath],
    env: { ...process.env, ...CREDS },
  });
  const client = new Client({ name: "probe", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
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

function summarize(label, r) {
  console.log(`\n=== ${label} ===`);
  console.log(`ok: ${r.ok}, elapsed: ${r.elapsed}ms`);
  if (!r.ok) {
    console.log("ERROR:", JSON.stringify(r.error, null, 2));
    // Also log code/message
    if (r.error?.code !== undefined) console.log("code:", r.error.code);
    if (r.error?.message) console.log("message:", r.error.message);
  } else {
    const content = r.result?.content;
    if (Array.isArray(content) && content[0]?.text) {
      const text = content[0].text;
      console.log("output (first 600 chars):", text.slice(0, 600));
      // Check for agent_instruction
      if (text.includes("agent_instruction")) {
        console.log("HAS agent_instruction: yes");
      } else {
        console.log("HAS agent_instruction: NO");
      }
      // Check for isError flag
      if (r.result.isError) console.log("isError: TRUE");
    } else {
      console.log("raw result:", JSON.stringify(r.result, null, 2).slice(0, 800));
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const { client } = await makeClient();

// 1. listTools — confirm schema
const toolList = await client.listTools();
const aiMonitorTool = toolList.tools.find(t => t.name === "novada_ai_monitor");
console.log("\n=== listTools: novada_ai_monitor schema ===");
console.log(JSON.stringify(aiMonitorTool?.inputSchema, null, 2));

// 2. Happy-path: known brand, defaults
const r1 = await callTool(client, "novada_ai_monitor", { brand: "Firecrawl" });
summarize("HAPPY PATH — brand=Firecrawl, default models", r1);

// 3. Happy-path: explicit models + topic
const r2 = await callTool(client, "novada_ai_monitor", { brand: "Stripe", models: ["claude", "gemini"], topics: ["pricing"] });
summarize("HAPPY PATH — brand=Stripe, models=[claude,gemini], topic=pricing", r2);

// 4. Missing required `brand`
const r3 = await callTool(client, "novada_ai_monitor", {});
summarize("MISSING brand (required) — expect -32602 or ZodError", r3);

// 5. Wrong type: brand is a number
const r4 = await callTool(client, "novada_ai_monitor", { brand: 12345 });
summarize("WRONG TYPE: brand=number", r4);

// 6. brand is empty string (violates min(1))
const r5 = await callTool(client, "novada_ai_monitor", { brand: "" });
summarize("EMPTY brand string", r5);

// 7. models contains unknown/garbage model name — should degrade gracefully
const r6 = await callTool(client, "novada_ai_monitor", { brand: "OpenAI", models: ["nonexistent_model_xyz"] });
summarize("UNKNOWN model name — should gracefully fallback or report not_found", r6);

// 8. models is a string (wrong type; should be array)
const r7 = await callTool(client, "novada_ai_monitor", { brand: "Anthropic", models: "chatgpt" });
summarize("WRONG TYPE: models=string (should be array)", r7);

// 9. Extra/unknown parameter injection
const r8 = await callTool(client, "novada_ai_monitor", { brand: "novada", __proto__: { polluted: true }, extra_unknown: "bad" });
summarize("UNKNOWN EXTRA PARAMS — prototype pollution probe", r8);

// 10. Unicode / injection in brand name
const r9 = await callTool(client, "novada_ai_monitor", { brand: "'; DROP TABLE users; --" });
summarize("SQL INJECTION in brand", r9);

// 11. Very long brand name (1000 chars)
const r10 = await callTool(client, "novada_ai_monitor", { brand: "a".repeat(1000) });
summarize("HUGE brand (1000 chars)", r10);

// 12. brand with newlines/control chars
const r11 = await callTool(client, "novada_ai_monitor", { brand: "novada\n\r\x00evil" });
summarize("CONTROL CHARS in brand", r11);

// 13. models=[] empty array — what happens with zero models?
const r12 = await callTool(client, "novada_ai_monitor", { brand: "novada", models: [] });
summarize("EMPTY models array — 0 models to check", r12);

// 14. topics with injection
const r13 = await callTool(client, "novada_ai_monitor", { brand: "novada", topics: ["pricing\"><script>alert(1)</script>"] });
summarize("XSS injection in topics", r13);

// 15. Very large models array with duplicates
const r14 = await callTool(client, "novada_ai_monitor", { brand: "novada", models: ["chatgpt","chatgpt","chatgpt","chatgpt","chatgpt","chatgpt","chatgpt","chatgpt","chatgpt","chatgpt"] });
summarize("LARGE models array with 10 dupes", r14);

console.log("\n=== PROBE COMPLETE ===");
process.exit(0);
