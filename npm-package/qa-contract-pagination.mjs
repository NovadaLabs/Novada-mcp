/**
 * Test: pagination, resource stale counts, extract url vs urls
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY })
});
const c = new Client({ name: "qa-paginate", version: "0" }, { capabilities: {} });
await c.connect(t);

// 1. Pagination: listTools with invalid cursor should return error per MCP spec
// MCP spec: if cursor is unrecognized, SHOULD return error code -32602
try {
  const r = await c.listTools({ cursor: "UNKNOWN_CURSOR_THAT_DOES_NOT_EXIST" });
  console.log("pagination_bad_cursor: returned tools, no error. count=", r.tools?.length, "nextCursor=", r.nextCursor);
} catch (e) {
  console.log("pagination_bad_cursor error:", e.code, e.message);
}

// 2. Pagination: listTools with empty string cursor
try {
  const r = await c.listTools({ cursor: "" });
  console.log("pagination_empty_cursor: count=", r.tools?.length, "nextCursor=", r.nextCursor);
} catch (e) {
  console.log("pagination_empty_cursor error:", e.code, e.message);
}

// 3. Resources: read the guide resource and check if it still says 23 tools
try {
  const r = await c.readResource({ uri: "novada://guide" });
  const text = r.contents?.[0]?.text ?? "";
  const has23 = text.includes("23 novada") || text.includes("23 tools");
  const has38 = text.includes("38 tools") || text.includes("38 novada");
  console.log("guide mentions 23:", has23);
  console.log("guide mentions 38:", has38);
} catch (e) {
  console.log("read guide error:", e.message);
}

// 4. Resources: read llms-txt resource and check tool count
try {
  const r = await c.readResource({ uri: "novada://llms-txt" });
  const text = r.contents?.[0]?.text ?? "";
  const has23 = text.includes("23 novada") || text.includes("23 tools");
  const has38 = text.includes("38 tools");
  console.log("llms-txt mentions 23:", has23);
  console.log("llms-txt mentions 38:", has38);
  // Count tool entries
  const toolMatches = text.match(/^## novada_/gm);
  console.log("llms-txt tool sections found:", toolMatches?.length);
} catch (e) {
  console.log("read llms-txt error:", e.message);
}

// 5. novada_extract with both url and urls (conflict)
try {
  const r = await c.callTool({ name: "novada_extract", arguments: {
    url: "https://example.com",
    urls: ["https://example.org"],
    format: "markdown",
    render: "auto"
  }});
  console.log("extract_both_url_and_urls:", JSON.stringify(r).slice(0, 300));
} catch (e) {
  console.log("extract_both_url_and_urls threw:", e.message);
}

// 6. Check the resource descriptions' tool counts
try {
  const r = await c.listResources();
  for (const res of r.resources) {
    console.log("resource:", res.name, "| description:", res.description.slice(0, 100));
  }
} catch (e) {
  console.log("listResources error:", e.message);
}

// 7. Verify "novada://guide" table counts
try {
  const r = await c.readResource({ uri: "novada://guide" });
  const text = r.contents?.[0]?.text ?? "";
  // Count tool rows in the comparison table
  const tableRows = text.match(/^\| novada_\w+/gm);
  console.log("guide table tool entries:", tableRows?.length);
  console.log("guide table tools:", tableRows?.map(r => r.split("|")[1]?.trim()));
} catch (e) {
  console.log("read guide error:", e.message);
}

await c.close();
