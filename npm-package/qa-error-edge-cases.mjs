/**
 * Edge cases:
 * 1. scraper_status with a fake task_id — should get TASK_NOT_FOUND with agent_instruction
 * 2. novada_account_summary — should succeed or fail with proper agent_instruction
 * 3. Check if retry_after_ms appears for RATE_LIMITED (simulate 429 error path)
 * 4. ZodError with 'invalid_value' enum shows valid values inline
 * 5. novada_monitor missing url
 * 6. novada_browser_flow empty actions array
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const makeClient = async (key = "dummy") => {
  const env = Object.assign({}, process.env, { NOVADA_API_KEY: key, NOVADA_DEVELOPER_API_KEY: key });
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env,
  });
  const c = new Client({ name: "qa-edge", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { client: c };
};

// ── 1. scraper_status fake task_id ────────────────────────────────────────────
{
  const { client: c } = await makeClient();
  const r = await c.callTool({ name: "novada_scraper_status", arguments: { task_id: "fake-task-id-99999" } });
  const txt = r.content?.[0]?.text ?? "";
  console.log("=== scraper_status fake task_id:");
  console.log("  isError:", r.isError);
  console.log("  txt:", txt.slice(0, 500));
  await c.close();
}

// ── 2. scraper_result fake task_id ────────────────────────────────────────────
{
  const { client: c } = await makeClient();
  const r = await c.callTool({ name: "novada_scraper_result", arguments: { task_id: "fake-task-id-99999" } });
  const txt = r.content?.[0]?.text ?? "";
  console.log("\n=== scraper_result fake task_id:");
  console.log("  isError:", r.isError);
  console.log("  txt:", txt.slice(0, 500));
  await c.close();
}

// ── 3. novada_monitor — missing url ───────────────────────────────────────────
{
  const { client: c } = await makeClient();
  const r = await c.callTool({ name: "novada_monitor", arguments: {} });
  const txt = r.content?.[0]?.text ?? "";
  console.log("\n=== novada_monitor missing url:");
  console.log("  isError:", r.isError);
  console.log("  txt:", txt.slice(0, 400));
  await c.close();
}

// ── 4. novada_browser_flow empty actions ──────────────────────────────────────
{
  const { client: c } = await makeClient();
  const r = await c.callTool({ name: "novada_browser_flow", arguments: { url: "https://example.com", actions: [], country: "" } });
  const txt = r.content?.[0]?.text ?? "";
  console.log("\n=== novada_browser_flow empty actions:");
  console.log("  isError:", r.isError);
  console.log("  txt:", txt.slice(0, 400));
  await c.close();
}

// ── 5. novada_scrape empty operation ──────────────────────────────────────────
{
  const { client: c } = await makeClient();
  const r = await c.callTool({ name: "novada_scrape", arguments: { platform: "amazon.com", operation: "", params: {}, limit: 20, format: "markdown" } });
  const txt = r.content?.[0]?.text ?? "";
  console.log("\n=== novada_scrape empty operation (minLength:1):");
  console.log("  isError:", r.isError);
  console.log("  txt:", txt.slice(0, 400));
  await c.close();
}

// ── 6. novada_extract — localhost URL (should be rejected as INVALID_PARAMS) ──
{
  const { client: c } = await makeClient();
  const r = await c.callTool({ name: "novada_extract", arguments: { url: "http://localhost:8080/admin", format: "markdown", render: "auto" } });
  const txt = r.content?.[0]?.text ?? "";
  console.log("\n=== novada_extract localhost URL:");
  console.log("  isError:", r.isError);
  console.log("  txt:", txt.slice(0, 400));
  // Check if INVALID_PARAMS + specific instruction about no-localhost
  console.log("  has agent_instruction:", txt.includes("agent_instruction"));
  await c.close();
}

// ── 7. novada_extract — private IP (192.168.x.x) ──────────────────────────────
{
  const { client: c } = await makeClient();
  const r = await c.callTool({ name: "novada_extract", arguments: { url: "http://192.168.1.1/", format: "markdown", render: "auto" } });
  const txt = r.content?.[0]?.text ?? "";
  console.log("\n=== novada_extract private IP:");
  console.log("  isError:", r.isError);
  console.log("  txt:", txt.slice(0, 400));
  console.log("  has agent_instruction:", txt.includes("agent_instruction"));
  await c.close();
}

// ── 8. novada_search — query 600 chars (over limit) ───────────────────────────
{
  const { client: c } = await makeClient();
  const r = await c.callTool({ name: "novada_search", arguments: { query: "x".repeat(600) } });
  const txt = r.content?.[0]?.text ?? "";
  console.log("\n=== novada_search 600-char query:");
  console.log("  isError:", r.isError);
  console.log("  txt:", txt.slice(0, 400));
  await c.close();
}
