/**
 * Live MCP stdio client for F5 verification.
 * Calls novada_monitor twice on https://example.com (5s apart).
 * Second call MUST return status: unchanged if F5 fix is working.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({
  command: "node",
  args: ["build/index.js"],
  env: { ...process.env },
});

const c = new Client({ name: "lane-verify-f5", version: "0.0.1" });

try {
  await c.connect(t);

  console.log("=== CALL 1 (baseline) ===");
  const r1 = await c.callTool({
    name: "novada_monitor",
    arguments: { url: "https://example.com", format: "json" },
  });
  const text1 = r1.content?.[0]?.text ?? JSON.stringify(r1);
  const json1 = JSON.parse(text1);
  console.log("status:", json1.status);
  console.log("hash:", json1.current_hash);
  console.log("session_scoped:", json1.session_scoped);

  console.log("\nWaiting 5s...\n");
  await new Promise(r => setTimeout(r, 5000));

  console.log("=== CALL 2 (should be unchanged) ===");
  const r2 = await c.callTool({
    name: "novada_monitor",
    arguments: { url: "https://example.com", format: "json" },
  });
  const text2 = r2.content?.[0]?.text ?? JSON.stringify(r2);
  const json2 = JSON.parse(text2);
  console.log("status:", json2.status);
  console.log("hash:", json2.current_hash);
  console.log("previous_hash:", json2.previous_hash);

  const same_hash = json2.current_hash === json2.previous_hash;
  const status_ok = json2.status === "unchanged";
  console.log("\n=== F5 RESULT ===");
  console.log("hash_stable:", same_hash);
  console.log("status_unchanged:", status_ok);
  console.log("PASS:", same_hash && status_ok ? "YES" : "NO");

  process.exit(same_hash && status_ok ? 0 : 1);
} finally {
  await c.close().catch(() => {});
}
