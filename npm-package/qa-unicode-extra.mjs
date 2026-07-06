import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";
const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY })
});
const c = new Client({ name: "qa-unicode", version: "0" }, { capabilities: {} });
await c.connect(t);

async function call(name, args) {
  try {
    const r = await c.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text ?? "";
    return { ok: !r.isError, isError: r.isError ?? false, text };
  } catch(e) {
    return { ok: false, isError: true, text: String(e), threw: true };
  }
}

const results = [];

// Test U+2028 LINE SEPARATOR in query middle
const lsQuery = "test result"; // LINE SEPARATOR in middle
const r1 = await call("novada_search", { query: lsQuery, engine: "google", num: 3 });
results.push({ test: "U2028_line_sep", len: lsQuery.length, trimEmpty: lsQuery.trim() === "", isError: r1.isError, isBlockedOrEmpty: r1.text.includes("required and must be a non-empty"), isIpBlocked: r1.text.includes("ip blocked"), preview: r1.text.slice(0, 200) });

// Test only zero-width chars 
const onlyZW = "​‌‍"; // ZWSP, ZWNJ, ZWJ
const r2 = await call("novada_search", { query: onlyZW, engine: "google", num: 3 });
results.push({ test: "only_zero_width", len: onlyZW.length, trimEmpty: onlyZW.trim() === "", isError: r2.isError, isEmptyError: r2.text.includes("required and must be a non-empty"), isIpBlocked: r2.text.includes("ip blocked"), preview: r2.text.slice(0, 200) });

// Test full-width country code with proxy_residential  
const fullWidthUS = "ＵＳ"; // ＵＳ full-width  
const r3 = await call("novada_proxy_residential", { format: "url", country: fullWidthUS });
results.push({ test: "fullwidth_country_residential", country: fullWidthUS, jsLen: fullWidthUS.length, isError: r3.isError, preview: r3.text.slice(0, 300) });

// Test full-width country with novada_proxy
const r4 = await call("novada_proxy", { type: "residential", format: "url", country: fullWidthUS });
results.push({ test: "fullwidth_country_proxy", country: fullWidthUS, jsLen: fullWidthUS.length, isError: r4.isError, preview: r4.text.slice(0, 300) });

// Test Korean/CJK only in query - confirm they pass through
const cjk = "인공지능"; // 인공지능
const r5 = await call("novada_search", { query: cjk, engine: "google", num: 3 });
results.push({ test: "korean_query", query: cjk, len: cjk.length, isError: r5.isError, isIpBlocked: r5.text.includes("ip blocked"), preview: r5.text.slice(0, 200) });

// Test query with U+FEFF BOM only
const bomOnly = "﻿";
const r6 = await call("novada_search", { query: bomOnly, engine: "google", num: 3 });
results.push({ test: "bom_only", len: bomOnly.length, trimEmpty: bomOnly.trim() === "", isError: r6.isError, preview: r6.text.slice(0, 200) });

// Test the unblock country field (same z.string().length(2) schema)
const r7 = await call("novada_unblock", { url: "https://example.com", method: "render", timeout: 5000, country: "ＵＳ" });
results.push({ test: "unblock_fullwidth_country", isError: r7.isError, preview: r7.text.slice(0, 300) });

// Test novada_browser country field
const r8 = await call("novada_browser", { actions: [{ action: "screenshot" }], timeout: 30000, country: "ＵＳ" });
results.push({ test: "browser_fullwidth_country", isError: r8.isError, preview: r8.text.slice(0, 300) });

console.log(JSON.stringify(results, null, 2));
await c.close();
