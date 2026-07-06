/**
 * QA harness: Functional — crawl + map
 * Tests: schema validation, glob path filtering, bfs/dfs, max_pages, max_depth,
 *        seed-always-crawled, SPA detection, MCP contract, error messages, etc.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy"; // offline checks
const RESULTS = [];

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY })
});
const c = new Client({ name: "qa-func-crawl-map", version: "0" }, { capabilities: {} });
await c.connect(t);

function record(scenario, toolName, args, result, notes) {
  RESULTS.push({ scenario, tool: toolName, args, result_isError: result?.isError ?? false, content_preview: JSON.stringify(result?.content ?? result).slice(0, 500), notes });
}

// ── Helper to call tool and return result ──────────────────────────────────────
async function call(toolName, args) {
  try {
    return await c.callTool({ name: toolName, arguments: args });
  } catch (e) {
    return { isError: true, error: String(e), content: [{ type: "text", text: String(e) }] };
  }
}

// ─── CRAWL SCHEMA TESTS ────────────────────────────────────────────────────────

// T1: missing required url
const t1 = await call("novada_crawl", {});
record("crawl-missing-url", "novada_crawl", {}, t1, "must reject missing url");

// T2: invalid url (non-http)
const t2 = await call("novada_crawl", { url: "ftp://example.com" });
record("crawl-invalid-url-ftp", "novada_crawl", { url: "ftp://example.com" }, t2, "must reject ftp://");

// T3: private/localhost URL (SSRF)
const t3 = await call("novada_crawl", { url: "http://127.0.0.1/secret" });
record("crawl-ssrf-localhost", "novada_crawl", { url: "http://127.0.0.1/secret" }, t3, "must block localhost SSRF");

// T4: max_pages out of range (>20)
const t4 = await call("novada_crawl", { url: "https://example.com", max_pages: 21 });
record("crawl-max_pages-overflow", "novada_crawl", { url: "https://example.com", max_pages: 21 }, t4, "max_pages > 20 should fail validation");

// T5: max_pages = 0 (below min)
const t5 = await call("novada_crawl", { url: "https://example.com", max_pages: 0 });
record("crawl-max_pages-zero", "novada_crawl", { url: "https://example.com", max_pages: 0 }, t5, "max_pages=0 should fail validation");

// T6: invalid strategy
const t6 = await call("novada_crawl", { url: "https://example.com", strategy: "random" });
record("crawl-bad-strategy", "novada_crawl", { url: "https://example.com", strategy: "random" }, t6, "invalid strategy should fail");

// T7: select_paths pattern too long (>200 chars per element)
const longPattern = "/docs/" + "a".repeat(200);
const t7 = await call("novada_crawl", { url: "https://example.com", select_paths: [longPattern] });
record("crawl-select_paths-pattern-too-long", "novada_crawl", { url: "https://example.com", select_paths: [longPattern] }, t7, "pattern >200 chars should fail Zod");

// T8: select_paths too many (>20 entries)
const tooManyPaths = Array.from({ length: 21 }, (_, i) => `/path${i}/**`);
const t8 = await call("novada_crawl", { url: "https://example.com", select_paths: tooManyPaths });
record("crawl-select_paths-too-many", "novada_crawl", { url: "https://example.com", select_paths: tooManyPaths }, t8, ">20 paths should fail Zod");

// T9: exclude_paths too many (>20)
const tooManyExclude = Array.from({ length: 21 }, (_, i) => `/path${i}/**`);
const t9 = await call("novada_crawl", { url: "https://example.com", exclude_paths: tooManyExclude });
record("crawl-exclude_paths-too-many", "novada_crawl", { url: "https://example.com", exclude_paths: tooManyExclude }, t9, ">20 exclude_paths should fail Zod");

// T10: invalid format
const t10 = await call("novada_crawl", { url: "https://example.com", format: "xml" });
record("crawl-invalid-format", "novada_crawl", { url: "https://example.com", format: "xml" }, t10, "unsupported format should fail");

// T11: invalid render mode
const t11 = await call("novada_crawl", { url: "https://example.com", render: "browser" });
record("crawl-invalid-render", "novada_crawl", { url: "https://example.com", render: "browser" }, t11, "'browser' not in crawl render enum");

// T12: camelCase alias maxPages (should still work)
const t12 = await call("novada_crawl", { url: "https://httpbin.org/get", maxPages: 2 });
record("crawl-camelCase-maxPages-alias", "novada_crawl", { url: "https://httpbin.org/get", maxPages: 2 }, t12, "camelCase alias maxPages should still work");

// T13: deprecated alias 'limit' (NOV-673 removed this alias — should NOT work as max_pages)
const t13 = await call("novada_crawl", { url: "https://httpbin.org/get", limit: 2 });
record("crawl-deprecated-limit-alias", "novada_crawl", { url: "https://httpbin.org/get", limit: 2 }, t13, "limit alias removed in NOV-673 — should use default of 5, NOT treat as max_pages");

// T14: deprecated alias 'mode' (NOV-673 removed)
const t14 = await call("novada_crawl", { url: "https://httpbin.org/get", mode: "dfs" });
record("crawl-deprecated-mode-alias", "novada_crawl", { url: "https://httpbin.org/get", mode: "dfs" }, t14, "mode alias removed in NOV-673 — should use default bfs");

// ─── MAP SCHEMA TESTS ──────────────────────────────────────────────────────────

// T15: missing required url
const t15 = await call("novada_map", {});
record("map-missing-url", "novada_map", {}, t15, "must reject missing url");

// T16: max_depth out of range (>5)
const t16 = await call("novada_map", { url: "https://example.com", max_depth: 6 });
record("map-max_depth-overflow", "novada_map", { url: "https://example.com", max_depth: 6 }, t16, "max_depth >5 should fail");

// T17: limit overflow (>100)
const t17 = await call("novada_map", { url: "https://example.com", limit: 101 });
record("map-limit-overflow", "novada_map", { url: "https://example.com", limit: 101 }, t17, "limit >100 should fail");

// T18: private IP SSRF in map
const t18 = await call("novada_map", { url: "http://192.168.1.1/" });
record("map-ssrf-private-ip", "novada_map", { url: "http://192.168.1.1/" }, t18, "must block private IP");

// T19: camelCase alias maxDepth
const t19 = await call("novada_map", { url: "https://example.com", maxDepth: 3 });
record("map-camelCase-maxDepth", "novada_map", { url: "https://example.com", maxDepth: 3 }, t19, "camelCase maxDepth alias should work");

// T20: binary file URL (PDF)
const t20 = await call("novada_map", { url: "https://example.com/document.pdf" });
record("map-binary-pdf-url", "novada_map", { url: "https://example.com/document.pdf" }, t20, "PDF URL should return friendly message not crash");

// T21: binary file URL (ZIP)
const t21 = await call("novada_map", { url: "https://example.com/archive.zip" });
record("map-binary-zip-url", "novada_map", { url: "https://example.com/archive.zip" }, t21, "ZIP URL should return friendly message");

// ─── PATH FILTER LOGIC TESTS (offline, using compilePatterns/shouldCrawlUrl behavior) ─

// T22: select_paths with only root-level pattern — verify seed bypass behavior
const t22 = await call("novada_crawl", {
  url: "https://httpbin.org/get",
  select_paths: ["/docs/**"],
  max_pages: 1
});
record("crawl-select_paths-seed-bypass", "novada_crawl", {
  url: "https://httpbin.org/get",
  select_paths: ["/docs/**"],
  max_pages: 1
}, t22, "seed URL doesn't match /docs/** but should NOT abort crawl (depth=0 exempt from path filter)");

// T23: Glob with globstar (**) should crawl paths with nested segments
const t23 = await call("novada_crawl", {
  url: "https://httpbin.org/get",
  select_paths: ["/**"],
  max_pages: 1
});
record("crawl-globstar-any-path", "novada_crawl", {
  url: "https://httpbin.org/get",
  select_paths: ["/**"],
  max_pages: 1
}, t23, "/** glob should match all paths");

// T24: exclude_paths with globstar — all paths excluded after root
const t24 = await call("novada_crawl", {
  url: "https://httpbin.org/get",
  exclude_paths: ["/**"],
  max_pages: 2
});
record("crawl-exclude_paths-all", "novada_crawl", {
  url: "https://httpbin.org/get",
  exclude_paths: ["/**"],
  max_pages: 2
}, t24, "exclude /** at depth>0 should still crawl root but no children");

// T25: select_paths with ?-wildcard (single non-slash char)
const t25 = await call("novada_crawl", {
  url: "https://httpbin.org/get",
  select_paths: ["/g?t"],
  max_pages: 1
});
record("crawl-select_paths-question-mark", "novada_crawl", {
  url: "https://httpbin.org/get",
  select_paths: ["/g?t"],
  max_pages: 1
}, t25, "? should match single char in path segment");

// T26: select_paths with * (single segment wildcard, not crossing /)
const t26 = await call("novada_crawl", {
  url: "https://httpbin.org/get",
  select_paths: ["/get*"],
  max_pages: 1
});
record("crawl-select_paths-star", "novada_crawl", {
  url: "https://httpbin.org/get",
  select_paths: ["/get*"],
  max_pages: 1
}, t26, "* should match within single path segment");

// T27: URL with newline injection attempt
const t27 = await call("novada_crawl", { url: "https://example.com/path\nGET / HTTP/1.1" });
record("crawl-url-newline-inject", "novada_crawl", { url: "https://example.com/path\nGET / HTTP/1.1" }, t27, "newline in URL must be rejected");

// T28: map with search param containing special chars
const t28 = await call("novada_map", {
  url: "https://example.com",
  search: "user-guide setup"
});
record("map-search-hyphen-space", "novada_map", {
  url: "https://example.com",
  search: "user-guide setup"
}, t28, "search with hyphen/space should tokenize correctly");

// T29: map with max_depth=1 (minimum allowed)
const t29 = await call("novada_map", {
  url: "https://example.com",
  max_depth: 1
});
record("map-max_depth-min", "novada_map", {
  url: "https://example.com",
  max_depth: 1
}, t29, "max_depth=1 should be accepted");

// T30: map with max_depth=0 (below minimum=1)
const t30 = await call("novada_map", {
  url: "https://example.com",
  max_depth: 0
});
record("map-max_depth-zero", "novada_map", {
  url: "https://example.com",
  max_depth: 0
}, t30, "max_depth=0 should fail (min is 1)");

// T31: crawl with empty select_paths array (should be treated as no filter)
const t31 = await call("novada_crawl", {
  url: "https://httpbin.org/get",
  select_paths: [],
  max_pages: 1
});
record("crawl-select_paths-empty-array", "novada_crawl", {
  url: "https://httpbin.org/get",
  select_paths: [],
  max_pages: 1
}, t31, "empty select_paths[] should be treated as no filter — crawl should proceed");

// T32: crawl with exclude_paths empty array
const t32 = await call("novada_crawl", {
  url: "https://httpbin.org/get",
  exclude_paths: [],
  max_pages: 1
});
record("crawl-exclude_paths-empty-array", "novada_crawl", {
  url: "https://httpbin.org/get",
  exclude_paths: [],
  max_pages: 1
}, t32, "empty exclude_paths[] should be treated as no filter");

// T33: crawl bfs vs dfs explicit — schema acceptance test
const t33 = await call("novada_crawl", {
  url: "https://httpbin.org/get",
  strategy: "dfs",
  max_pages: 1
});
record("crawl-strategy-dfs-accepted", "novada_crawl", {
  url: "https://httpbin.org/get",
  strategy: "dfs",
  max_pages: 1
}, t33, "dfs strategy should be accepted");

// T34: crawl strategy bfs explicit
const t34 = await call("novada_crawl", {
  url: "https://httpbin.org/get",
  strategy: "bfs",
  max_pages: 1
});
record("crawl-strategy-bfs-accepted", "novada_crawl", {
  url: "https://httpbin.org/get",
  strategy: "bfs",
  max_pages: 1
}, t34, "bfs strategy should be accepted");

// T35: crawl json format — verify output is valid JSON
const t35 = await call("novada_crawl", {
  url: "https://httpbin.org/get",
  format: "json",
  max_pages: 1
});
record("crawl-format-json", "novada_crawl", {
  url: "https://httpbin.org/get",
  format: "json",
  max_pages: 1
}, t35, "json format should return parseable JSON output");

// T36: map with include_subdomains=false (default)
const t36 = await call("novada_map", {
  url: "https://example.com",
  include_subdomains: false
});
record("map-include_subdomains-false", "novada_map", {
  url: "https://example.com",
  include_subdomains: false
}, t36, "include_subdomains=false is default and should be accepted");

// T37: crawl render=static explicit
const t37 = await call("novada_crawl", {
  url: "https://httpbin.org/get",
  render: "static",
  max_pages: 1
});
record("crawl-render-static", "novada_crawl", {
  url: "https://httpbin.org/get",
  render: "static",
  max_pages: 1
}, t37, "render=static should be accepted");

// T38: crawl with instructions parameter (optional)
const t38 = await call("novada_crawl", {
  url: "https://httpbin.org/get",
  instructions: "only API reference pages",
  max_pages: 1
});
record("crawl-instructions-param", "novada_crawl", {
  url: "https://httpbin.org/get",
  instructions: "only API reference pages",
  max_pages: 1
}, t38, "instructions param should be accepted and reflected in output");

// T39: map binary SVG extension
const t39 = await call("novada_map", { url: "https://example.com/logo.svg" });
record("map-binary-svg-url", "novada_map", { url: "https://example.com/logo.svg" }, t39, "SVG URL should return binary content message");

// T40: crawl with ReDoS-attempt pattern (many wildcards)
const redosPattern = "/a**b**c**d**e**f";
const t40 = await call("novada_crawl", {
  url: "https://httpbin.org/get",
  select_paths: [redosPattern],
  max_pages: 1
});
record("crawl-redos-pattern", "novada_crawl", {
  url: "https://httpbin.org/get",
  select_paths: [redosPattern],
  max_pages: 1
}, t40, "ReDoS-like pattern should not hang or error");

// Measure timing of ReDoS test
const redosStart = Date.now();
const t40b = await call("novada_crawl", {
  url: "https://httpbin.org/get",
  select_paths: ["/" + "a*".repeat(50) + "b"],
  max_pages: 1
});
const redosEnd = Date.now();
record("crawl-redos-timing", "novada_crawl", {
  url: "https://httpbin.org/get",
  select_paths: ["/" + "a*".repeat(50) + "b"],
  max_pages: 1
}, { ...t40b, timing_ms: redosEnd - redosStart }, `ReDoS timing: ${redosEnd - redosStart}ms (>5000ms would indicate hanging)`);

// T41: map with empty search string (should not crash)
const t41 = await call("novada_map", {
  url: "https://example.com",
  search: ""
});
record("map-empty-search", "novada_map", {
  url: "https://example.com",
  search: ""
}, t41, "empty search string — unclear if this is valid");

// T42: map limit=1 (minimum)
const t42 = await call("novada_map", {
  url: "https://example.com",
  limit: 1
});
record("map-limit-one", "novada_map", {
  url: "https://example.com",
  limit: 1
}, t42, "limit=1 should be accepted");

// T43: crawl URL with query string — should normalize URLs
const t43 = await call("novada_crawl", {
  url: "https://httpbin.org/get?foo=bar",
  max_pages: 1
});
record("crawl-url-with-query", "novada_crawl", {
  url: "https://httpbin.org/get?foo=bar",
  max_pages: 1
}, t43, "URL with query string should be valid");

// T44: crawl select_paths with exact path match (no wildcard)
const t44 = await call("novada_crawl", {
  url: "https://httpbin.org/get",
  select_paths: ["/get"],
  max_pages: 1
});
record("crawl-select_paths-exact-match", "novada_crawl", {
  url: "https://httpbin.org/get",
  select_paths: ["/get"],
  max_pages: 1
}, t44, "select_paths with exact /get path should work");

// T45: map SPA-like URL that returns no additional links
// (This goes live — checking if isError=false but returns "Only the root URL found" message)
const t45 = await call("novada_map", {
  url: "https://example.com",
  max_depth: 1,
  limit: 5
});
record("map-spa-detection", "novada_map", {
  url: "https://example.com",
  max_depth: 1,
  limit: 5
}, t45, "SPA detection should return friendly message not isError=true");

await c.close();

// Output all results
console.log(JSON.stringify(RESULTS, null, 2));
