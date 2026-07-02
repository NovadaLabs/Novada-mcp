/**
 * Live MCP verification for F3 + F9 fixes.
 * Runs two tool calls against the worktree build (not main).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const BASE_URL = "https://docs.firecrawl.dev";

async function runVerification() {
  const t = new StdioClientTransport({
    command: "node",
    args: ["build/index.js"],
    env: { ...process.env },
  });
  const c = new Client({ name: "lane-verify", version: "0.0.1" });
  await c.connect(t);

  console.log("=== F3: novada_map with deep sitemap URLs ===");
  try {
    const r1 = await c.callTool({
      name: "novada_map",
      arguments: { url: BASE_URL, limit: 30, max_depth: 2 },
    });
    const text1 = r1.content?.[0]?.text ?? JSON.stringify(r1).slice(0, 3000);
    console.log("--- Response (first 3000 chars) ---");
    console.log(text1.slice(0, 3000));

    // Validate: should have ~30 numbered items, not 3
    const numbered = (text1.match(/^\d+\. /gm) ?? []).length;
    console.log(`\nURL count: ${numbered} (expected ~30)`);
    console.log(`Has discovery:sitemap: ${text1.includes("discovery:sitemap")}`);
    console.log(`F3 PASS: ${numbered >= 20 ? "YES" : "NO - still broken"}`);
  } catch (err) {
    console.error("F3 call failed:", err.message);
  }

  console.log("\n=== F9: novada_map with search filter on deep site ===");
  try {
    const r2 = await c.callTool({
      name: "novada_map",
      arguments: { url: BASE_URL, limit: 30, max_depth: 2, search: "api" },
    });
    const text2 = r2.content?.[0]?.text ?? JSON.stringify(r2).slice(0, 3000);
    console.log("--- Response (first 3000 chars) ---");
    console.log(text2.slice(0, 3000));

    const numbered2 = (text2.match(/^\d+\. /gm) ?? []).length;
    const hasApiUrls = text2.includes("/api-reference/");
    console.log(`\nFiltered URL count: ${numbered2} (expected >0)`);
    console.log(`Has /api-reference/ URLs: ${hasApiUrls}`);
    console.log(`F9 PASS: ${numbered2 > 0 && hasApiUrls ? "YES" : "NO - still broken"}`);
  } catch (err) {
    console.error("F9 call failed:", err.message);
  }

  await c.close();
}

runVerification().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
