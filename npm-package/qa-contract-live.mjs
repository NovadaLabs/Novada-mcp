import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: "dummy" })
});
const c = new Client({ name: "qa-contract-live", version: "0" }, { capabilities: {} });
await c.connect(t);

async function call(name, args) {
  try {
    const r = await c.callTool({ name, arguments: args });
    return { 
      isError: r.isError ?? false, 
      text: (r.content?.[0]?.text ?? JSON.stringify(r)).slice(0, 600)
    };
  } catch(e) {
    return { isError: true, threw: true, text: String(e).slice(0, 300) };
  }
}

const results = {};

// ===== TEST 1: novada_research with zero args =====
// Schema has required=[], so this is schema-valid
// What does the server return?
results.T1_research_zero_args = await call("novada_research", {});
console.log("T1 research zero args:", JSON.stringify(results.T1_research_zero_args));

// ===== TEST 2: novada_research with only depth (no question/query) =====
results.T2_research_depth_only = await call("novada_research", { depth: "quick" });
console.log("T2 research depth only:", JSON.stringify(results.T2_research_depth_only));

// ===== TEST 3: novada_browser scroll WITHOUT direction (required but has default) =====
// scroll action lists direction in required[], but it has default="down"
// Per MCP, if agent omits direction, schema validation should fail
// But if the server doesn't enforce required at action level, it passes
results.T3_browser_scroll_no_direction = await call("novada_browser", {
  actions: [{ action: "scroll" }],  // no direction
  timeout: 60000
});
console.log("T3 browser scroll no direction:", JSON.stringify(results.T3_browser_scroll_no_direction));

// ===== TEST 4: novada_browser wait with no ms/timeout/selector =====
// All three are optional, but wait with nothing to wait on is ambiguous
results.T4_browser_wait_empty = await call("novada_browser", {
  actions: [{ action: "wait" }],  // no ms, no selector
  timeout: 60000
});
console.log("T4 browser wait empty:", JSON.stringify(results.T4_browser_wait_empty));

// ===== TEST 5: novada_proxy_account_create with confirm:false (const:true violation) =====
// Schema says confirm.const=true, so confirm:false should fail schema validation
// But if the server doesn't validate, it might accept it
results.T5_confirm_false = await call("novada_proxy_account_create", {
  product: "1",
  account: "testaccount",
  password: "testpass123",
  confirm: false  // explicitly false — should fail due to const:true
});
console.log("T5 confirm false:", JSON.stringify(results.T5_confirm_false));

// ===== TEST 6: novada_ip_whitelist with confirm:false (const:true violation) =====
results.T6_ip_whitelist_confirm_false = await call("novada_ip_whitelist", {
  action: "add",
  product: "1",
  ip: "1.2.3.4",
  confirm: false  // explicitly false — should fail due to const:true
});
console.log("T6 ip_whitelist confirm false:", JSON.stringify(results.T6_ip_whitelist_confirm_false));

// ===== TEST 7: novada_extract with BOTH url AND urls (no exclusion constraint) =====
results.T7_extract_both_url_and_urls = await call("novada_extract", {
  url: "https://example.com",
  urls: ["https://example.org", "https://example.net"],
  format: "markdown",
  render: "auto"
});
console.log("T7 extract url AND urls:", JSON.stringify(results.T7_extract_both_url_and_urls));

// ===== TEST 8: Additional properties test - unknown key passed =====
// With no additionalProperties:false, extra keys are silently accepted
results.T8_extra_key_search = await call("novada_search", {
  query: "test",
  qeury: "typo of query",  // typo - should be ignored or rejected
  extra_field: "value"
});
console.log("T8 extra key search:", JSON.stringify(results.T8_extra_key_search));

// ===== TEST 9: novada_search with source_type (undocumented in schema check) =====
results.T9_search_source_type = await call("novada_search", {
  query: "test",
  source_type: "invalid_type"  // not in enum
});
console.log("T9 search source_type invalid:", JSON.stringify(results.T9_search_source_type));

// ===== TEST 10: novada_proxy_account_create without confirm (dry-run) =====
results.T10_create_no_confirm_dryrun = await call("novada_proxy_account_create", {
  product: "1",
  account: "testaccount",
  password: "testpass123"
  // no confirm — should return dry-run preview not execute
});
console.log("T10 create no confirm (dry-run):", JSON.stringify(results.T10_create_no_confirm_dryrun));

// ===== TEST 11: novada_ip_whitelist action=list (readonly) with confirm:true =====
// If action=list, confirm shouldn't be needed, but schema doesn't prevent passing it
results.T11_list_action_with_confirm = await call("novada_ip_whitelist", {
  action: "list",
  product: "1",
  confirm: true  // passing confirm for a read action - server should handle
});
console.log("T11 list action with confirm:", JSON.stringify(results.T11_list_action_with_confirm));

// ===== TEST 12: novada_browser_flow with country="" (empty string, schema allows via pattern) =====
results.T12_browser_flow_empty_country = await call("novada_browser_flow", {
  url: "https://example.com",
  actions: [{ type: "screenshot" }],
  country: ""  // empty string matches pattern ^[a-zA-Z]{0,2}$ 
});
console.log("T12 browser_flow country=empty:", JSON.stringify(results.T12_browser_flow_empty_country));

// ===== TEST 13: novada_browser country="usa" (3 chars - violates pattern maxLength:2) =====
// novada_browser.country doesn't have the same pattern as browser_flow
// Check schema
results.T13_browser_country_3chars = await call("novada_browser", {
  actions: [{ action: "screenshot" }],
  country: "usa",  // 3 chars
  timeout: 60000
});
console.log("T13 browser country 3chars:", JSON.stringify(results.T13_browser_country_3chars));

// ===== TEST 14: novada_research with query="" (empty string, no minLength) =====
// 'query' alias has no minLength constraint (unlike 'question' which has minLength:5)
results.T14_research_empty_query = await call("novada_research", { query: "" });
console.log("T14 research empty query:", JSON.stringify(results.T14_research_empty_query));

// ===== TEST 15: novada_research with query="hi" (2 chars, no minLength on query) =====
results.T15_research_short_query = await call("novada_research", { query: "hi", depth: "quick" });
console.log("T15 research short query:", JSON.stringify(results.T15_research_short_query));

await c.close();
console.log("\n=== ALL RESULTS ===");
console.log(JSON.stringify(results, null, 2));
