import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const WORKTREE = "/Users/tongwu/Projects/novada-mcp/.worktrees/fix-extract-blockpage-5001";

const env = {
  ...process.env,
  NOVADA_API_KEY: process.env.NOVADA_API_KEY,
};

async function testExtract(url, description) {
  const t = new StdioClientTransport({
    command: "node",
    args: [`${WORKTREE}/build/index.js`],
    env,
  });
  const c = new Client({ name: "c1-verifier", version: "0.0.1" });
  await c.connect(t);
  try {
    console.log(`\n=== ${description} ===`);
    console.log(`URL: ${url}`);
    const r = await c.callTool({
      name: "novada_extract",
      arguments: { url, format: "markdown" },
    });
    const text = r.content?.[0]?.text ?? JSON.stringify(r);
    const snippet = text.slice(0, 600);
    const isBlocked = text.includes("## Extract Failed") || text.includes("status:error") || text.includes("bot challenge");
    const isSuccess = text.includes("status:success") || (!isBlocked && text.length > 200);
    console.log("Snippet:", snippet);
    console.log("→ Outcome:", isBlocked ? "BLOCKED" : isSuccess ? "SUCCESS" : "UNKNOWN");
    return { url, description, isBlocked, isSuccess };
  } finally {
    await c.close();
  }
}

console.log("API key set:", !!process.env.NOVADA_API_KEY);

// Test 1: Wikipedia article about Cloudflare — mentions "Ray ID" in prose → must NOT be blocked
const r1 = await testExtract(
  "https://en.wikipedia.org/wiki/Cloudflare",
  "Wikipedia/Cloudflare (mentions Ray ID in content) — must succeed"
);

// Test 2: httpbin simple HTML page — no bot markers → must succeed
const r2 = await testExtract(
  "https://httpbin.org/html",
  "httpbin/html (plain page, no bot markers) — must succeed"
);

console.log("\n\n=== LIVE VERIFICATION SUMMARY ===");
console.log("Wikipedia (Ray ID in prose):", r1.isBlocked ? "FAIL (false positive!)" : "PASS (no false block)");
console.log("httpbin/html:", r2.isBlocked ? "FAIL (false positive!)" : "PASS (no false block)");

const allPassed = !r1.isBlocked && !r2.isBlocked;
console.log("\nOverall:", allPassed ? "PASS" : "FAIL");
process.exit(allPassed ? 0 : 1);
