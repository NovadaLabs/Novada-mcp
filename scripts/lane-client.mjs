/**
 * lane-client.mjs — Live MCP stdio client for worktree verification.
 * Calls novada_search as a smoke test via the MCP stdio transport.
 * Run from worktree root after npm run build.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({
  command: "node",
  args: ["build/index.js"],
  env: { ...process.env },
});

const c = new Client({ name: "lane-verify", version: "0.0.1" });
await c.connect(t);

const r = await c.callTool({
  name: "novada_search",
  arguments: { query: "novada proxy API", engine: "google", num: 3 },
});
console.log(JSON.stringify(r).slice(0, 8000));
await c.close();
