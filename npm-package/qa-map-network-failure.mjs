/**
 * Test: novada_map network failure vs SPA detection
 * When host is unreachable, map returns SPA message instead of error
 * This is the core finding: network failure masked as SPA detection
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";
const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY })
});
const c = new Client({ name: "qa", version: "0" }, { capabilities: {} });
await c.connect(t);

async function call(name, args) {
  try {
    return await c.callTool({ name, arguments: args });
  } catch (e) {
    return { _thrown: true, error: String(e) };
  }
}

// Test with an invalid/unreachable hostname
const result1 = await call("novada_map", {
  url: "https://this-domain-does-not-exist-qa-test-xyz.invalid",
  max_depth: 2,
  limit: 10
});

console.log("=== Network failure test ===");
console.log("URL: https://this-domain-does-not-exist-qa-test-xyz.invalid");
console.log("isError:", result1.isError);
console.log("Full response:");
console.log(result1.content?.[0]?.text ?? JSON.stringify(result1));
console.log("");

// Compare with a real SPA (example.com — no links)
const result2 = await call("novada_map", {
  url: "https://example.com",
  max_depth: 2,
  limit: 10
});

console.log("=== Legitimate SPA test (example.com) ===");
console.log("isError:", result2.isError);
console.log("Response preview:");
console.log((result2.content?.[0]?.text ?? "").slice(0, 300));
console.log("");

// The question: are network failure and SPA indistinguishable from agent perspective?
console.log("=== KEY FINDING ===");
console.log("Both unreachable host AND true SPA return identical message structure:");
console.log("  - isError: undefined (no error signal)");
console.log("  - '⚠ Only the root URL found' message");
console.log("  - Agent cannot distinguish network failure from legitimate SPA");
console.log("");
console.log("Root cause: parallelBfsCrawl() pre-adds seed to discovered set (line 276),");
console.log("swallows all network errors silently (Promise.allSettled + if !== fulfilled continue),");
console.log("then isSpaLikely check sees discovered.length=1 and throws SPA_NO_URLS_FOUND.");
console.log("SPA_NO_URLS_FOUND is caught in novadaMap() and converted to friendly string (not error).");
console.log("");
console.log("Impact: agents retrying a misspelled domain will get 'try novada_extract' guidance");
console.log("instead of 'the host doesn't exist'. Loop risk: agent keeps trying different tools on an invalid URL.");

await c.close();
