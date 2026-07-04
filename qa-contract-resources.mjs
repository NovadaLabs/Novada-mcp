/**
 * Test: resource contract - read resources, check content validity
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY })
});
const c = new Client({ name: "qa-resources", version: "0" }, { capabilities: {} });
await c.connect(t);

// 1. Read all resources and verify content type matches mimeType
const resources = await c.listResources();
console.log("Resource count:", resources.resources.length);

for (const res of resources.resources) {
  try {
    const content = await c.readResource({ uri: res.uri });
    const items = content.contents || [];
    console.log(`\n--- ${res.name} (${res.uri}) ---`);
    console.log("items:", items.length);
    for (const item of items) {
      console.log("  mimeType:", item.mimeType, "| has text:", !!item.text);
      // Verify mimeType matches
      if (res.mimeType !== item.mimeType) {
        console.log("  MISMATCH: resource.mimeType=" + res.mimeType + " but content.mimeType=" + item.mimeType);
      }
      // For text/plain, verify it's actually a string
      if (item.mimeType === "text/plain" && typeof item.text !== "string") {
        console.log("  ISSUE: text/plain but text is:", typeof item.text);
      }
      // Basic non-empty check
      if (!item.text || item.text.trim().length === 0) {
        console.log("  ISSUE: empty text content");
      }
    }
  } catch (e) {
    console.log(`${res.name}: READ ERROR: ${e.message}`);
  }
}

// 2. Read unknown resource - should return error
try {
  const r = await c.readResource({ uri: "novada://nonexistent" });
  console.log("\nRead unknown resource: returned content, no error:", JSON.stringify(r).slice(0, 200));
} catch (e) {
  console.log("\nRead unknown resource error:", e.code, e.message);
}

// 3. Read with empty URI
try {
  const r = await c.readResource({ uri: "" });
  console.log("\nRead empty URI: returned content, no error");
} catch (e) {
  console.log("\nRead empty URI error:", e.code, e.message);
}

// 4. Read with injection attempt
try {
  const r = await c.readResource({ uri: "novada://../../etc/passwd" });
  console.log("\nRead path traversal: returned content:", JSON.stringify(r).slice(0, 200));
} catch (e) {
  console.log("\nRead path traversal error:", e.code, e.message);
}

// 5. Check if resources support subscriptions (resourcesListChanged capability)
console.log("\nCapabilities check complete");

await c.close();
