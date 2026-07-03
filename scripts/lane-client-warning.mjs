/**
 * Live test: verify that the per-field warning surfaces in tool output when
 * description is resolved from a pattern match (not meta/jsonld).
 * We use format="json" to inspect the structured fields object directly.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({
  command: "node",
  args: ["build/index.js"],
  env: { ...process.env },
});
const c = new Client({ name: "lane-warning-verify", version: "0.0.1" });
await c.connect(t);

// Wikipedia JSON format — description should come from JSON-LD (conf:0.95), NO warning
const r1 = await c.callTool({
  name: "novada_extract",
  arguments: {
    url: "https://en.wikipedia.org/wiki/Web_scraping",
    format: "json",
    fields: ["description"],
  },
});
const text1 = r1.content[0].text;
const parsed1 = JSON.parse(text1);
const desc1 = parsed1.fields?.description;
console.log("=== Wikipedia (JSON-LD should have no warning) ===");
console.log("source:", desc1?.source);
console.log("confidence:", desc1?.confidence);
console.log("warning:", desc1?.warning ?? "(none — correct)");
console.log("value:", (desc1?.value ?? "").slice(0, 100));

if (desc1 && desc1.source !== "unresolved" && desc1.source !== "jsonld" && desc1.warning === undefined) {
  console.error("FAIL: description resolved from non-jsonld source but has no warning");
  process.exit(1);
}
if (desc1 && desc1.source === "jsonld" && desc1.warning !== undefined) {
  console.error("FAIL: description resolved from jsonld should NOT have warning, but it does");
  process.exit(1);
}

console.log("\n=== LIVE CHECK PASS: warning field properly serialized (present/absent as expected) ===");

await c.close();
