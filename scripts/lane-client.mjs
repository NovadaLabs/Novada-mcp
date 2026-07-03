/**
 * F7 live verification client — checks two repro scenarios:
 *   1. "The Great Wall of China is visible from space with the naked eye."
 *      → bucket labels must be provenance-honest (no "Supporting Evidence")
 *      → agent_instruction must carry keyword-match caveat
 *   2. "Moderate coffee consumption is associated with a reduced risk of type 2 diabetes."
 *      → confidence must be capped (not 85+) when contradicting_count==0
 *
 * Run from the worktree directory after `npm run build`.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function runVerify(client, claim) {
  const r = await client.callTool({
    name: "novada_verify",
    arguments: { claim },
  });
  return JSON.stringify(r).slice(0, 8000);
}

const t = new StdioClientTransport({
  command: "node",
  args: ["build/index.js"],
  env: { ...process.env },
});

const c = new Client({ name: "lane-verify", version: "0.0.1" });
await c.connect(t);

console.log("=== REPRO 1: Great Wall of China (stance caveat + provenance labels) ===");
const r1 = await runVerify(c, "The Great Wall of China is visible from space with the naked eye.");
console.log(r1);

console.log("\n=== REPRO 2: Coffee & type 2 diabetes (hedged claim confidence cap) ===");
const r2 = await runVerify(c, "Moderate coffee consumption is associated with a reduced risk of type 2 diabetes.");
console.log(r2);

await c.close();
