/**
 * novada_extract availability audit for 0.9.0
 * Tests: markdown, text, html, json formats; render modes; fields[]; batch urls[]; clean=true; PDF
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = process.env.QA_KEY || "dummy";
const INDEX_JS = "/Users/tongwu/Projects/novada-mcp/build/index.js";

async function makeClient() {
  const t = new StdioClientTransport({
    command: "node",
    args: [INDEX_JS],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
  });
  const c = new Client({ name: "audit-extract", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { c, t };
}

async function call(c, args, label) {
  const start = Date.now();
  try {
    const r = await c.callTool({ name: "novada_extract", arguments: args });
    const elapsed = Date.now() - start;
    const text = r.content?.[0]?.text ?? JSON.stringify(r);
    return { label, ok: true, elapsed, text, len: text.length, isError: r.isError ?? false };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { label, ok: false, elapsed, text: String(err), len: 0, isError: true };
  }
}

function snip(s, n = 600) {
  if (s.length <= n) return s;
  return s.slice(0, n) + `\n...[truncated, total ${s.length}]`;
}

async function run() {
  const { c } = await makeClient();
  const results = [];

  console.log("=== novada_extract availability audit ===\n");

  // TEST 1: markdown format, auto render (baseline)
  {
    const r = await call(c, { url: "https://example.com", format: "markdown" }, "T1: markdown/auto");
    results.push(r);
    console.log(`[${r.label}] ok=${r.ok} isError=${r.isError} len=${r.len} elapsed=${r.elapsed}ms`);
    if (r.len < 200 || r.isError) console.log("  WARN: suspiciously short or errored");
    // Check for required fields
    const hasMode = r.text.includes("mode:");
    const hasTitle = r.text.includes("title:");
    const hasContent = r.text.length > 200;
    console.log(`  has mode:${hasMode} title:${hasTitle} content:${hasContent}`);
    console.log(snip(r.text));
    console.log();
  }

  // TEST 2: text format
  {
    const r = await call(c, { url: "https://example.com", format: "text" }, "T2: text format");
    results.push(r);
    console.log(`[${r.label}] ok=${r.ok} isError=${r.isError} len=${r.len} elapsed=${r.elapsed}ms`);
    // text format should not have markdown headers
    const noMarkdownHeaders = !r.text.includes("## Extracted Content");
    console.log(`  noMarkdownHeaders:${noMarkdownHeaders}`);
    console.log(snip(r.text, 400));
    console.log();
  }

  // TEST 3: html format
  {
    const r = await call(c, { url: "https://example.com", format: "html" }, "T3: html format");
    results.push(r);
    console.log(`[${r.label}] ok=${r.ok} isError=${r.isError} len=${r.len} elapsed=${r.elapsed}ms`);
    const hasHtmlTags = /<html|<body|<head/i.test(r.text);
    console.log(`  hasHtmlTags:${hasHtmlTags}`);
    console.log(snip(r.text, 400));
    console.log();
  }

  // TEST 4: json format
  {
    const r = await call(c, { url: "https://example.com", format: "json" }, "T4: json format");
    results.push(r);
    console.log(`[${r.label}] ok=${r.ok} isError=${r.isError} len=${r.len} elapsed=${r.elapsed}ms`);
    let parsed = null;
    try {
      // JSON may be prefixed with path: line
      const jsonStart = r.text.indexOf("{");
      if (jsonStart >= 0) parsed = JSON.parse(r.text.slice(jsonStart));
    } catch(e) { console.log("  WARN: JSON parse failed:", e.message); }
    const hasUrl = parsed?.url !== undefined;
    const hasContent = parsed?.content !== undefined;
    const hasQuality = parsed?.quality !== undefined;
    console.log(`  parsed:${!!parsed} hasUrl:${hasUrl} hasContent:${hasContent} hasQuality:${hasQuality}`);
    console.log(snip(r.text, 500));
    console.log();
  }

  // TEST 5: render=static
  {
    const r = await call(c, { url: "https://example.com", format: "markdown", render: "static" }, "T5: render=static");
    results.push(r);
    console.log(`[${r.label}] ok=${r.ok} isError=${r.isError} len=${r.len} elapsed=${r.elapsed}ms`);
    const hasStaticMode = r.text.includes("mode: static");
    console.log(`  hasStaticMode:${hasStaticMode}`);
    console.log();
  }

  // TEST 6: render=render (Web Unblocker)
  {
    const r = await call(c, { url: "https://example.com", format: "markdown", render: "render" }, "T6: render=render");
    results.push(r);
    console.log(`[${r.label}] ok=${r.ok} isError=${r.isError} len=${r.len} elapsed=${r.elapsed}ms`);
    console.log(snip(r.text, 300));
    console.log();
  }

  // TEST 7: fields[] - request specific fields on a product-like page
  {
    const r = await call(c, {
      url: "https://en.wikipedia.org/wiki/Python_(programming_language)",
      format: "markdown",
      fields: ["designed_by", "first_appeared", "typing_discipline"],
      render: "static"
    }, "T7: fields[] extraction");
    results.push(r);
    console.log(`[${r.label}] ok=${r.ok} isError=${r.isError} len=${r.len} elapsed=${r.elapsed}ms`);
    const hasFieldsBlock = r.text.includes("## Requested Fields");
    console.log(`  hasFieldsBlock:${hasFieldsBlock}`);
    console.log(snip(r.text, 600));
    console.log();
  }

  // TEST 8: batch urls[] - two URLs
  {
    const r = await call(c, {
      urls: ["https://example.com", "https://httpbin.org/get"],
      format: "markdown"
    }, "T8: batch urls[]");
    results.push(r);
    console.log(`[${r.label}] ok=${r.ok} isError=${r.isError} len=${r.len} elapsed=${r.elapsed}ms`);
    const hasBatchHeader = r.text.includes("## Batch Extract Results");
    const hasItem1 = r.text.includes("[1/2]");
    const hasItem2 = r.text.includes("[2/2]");
    console.log(`  hasBatchHeader:${hasBatchHeader} item1:${hasItem1} item2:${hasItem2}`);
    console.log(snip(r.text, 600));
    console.log();
  }

  // TEST 9: clean=true
  {
    const r = await call(c, {
      url: "https://en.wikipedia.org/wiki/Python_(programming_language)",
      format: "markdown",
      clean: true,
      render: "static"
    }, "T9: clean=true");
    results.push(r);
    console.log(`[${r.label}] ok=${r.ok} isError=${r.isError} len=${r.len} elapsed=${r.elapsed}ms`);
    // clean=true should return shorter content than clean=false
    console.log(snip(r.text, 300));
    console.log();
  }

  // TEST 10: max_chars truncation
  {
    const r = await call(c, {
      url: "https://en.wikipedia.org/wiki/Python_(programming_language)",
      format: "markdown",
      max_chars: 2000,
      render: "static"
    }, "T10: max_chars=2000 truncation");
    results.push(r);
    console.log(`[${r.label}] ok=${r.ok} isError=${r.isError} len=${r.len} elapsed=${r.elapsed}ms`);
    const hasTruncated = r.text.includes("content_truncated:true") || r.text.includes("Content may be truncated");
    console.log(`  hasTruncated:${hasTruncated}`);
    console.log(snip(r.text, 400));
    console.log();
  }

  // TEST 11: json format with fields[]
  {
    const r = await call(c, {
      url: "https://en.wikipedia.org/wiki/Python_(programming_language)",
      format: "json",
      fields: ["designed_by", "first_appeared"],
      render: "static"
    }, "T11: json + fields[]");
    results.push(r);
    console.log(`[${r.label}] ok=${r.ok} isError=${r.isError} len=${r.len} elapsed=${r.elapsed}ms`);
    let parsed = null;
    try {
      const jsonStart = r.text.indexOf("{");
      if (jsonStart >= 0) parsed = JSON.parse(r.text.slice(jsonStart));
    } catch(e) { console.log("  WARN: JSON parse failed:", e.message); }
    const hasFields = parsed?.fields !== undefined;
    const fieldsKeys = parsed?.fields ? Object.keys(parsed.fields) : [];
    console.log(`  hasFields:${hasFields} fieldsKeys:${JSON.stringify(fieldsKeys)}`);
    console.log(snip(r.text, 400));
    console.log();
  }

  // TEST 12: batch url[] (array form of url param, not urls param)
  {
    const r = await call(c, {
      url: ["https://example.com", "https://example.org"],
      format: "markdown"
    }, "T12: batch via url[] array");
    results.push(r);
    console.log(`[${r.label}] ok=${r.ok} isError=${r.isError} len=${r.len} elapsed=${r.elapsed}ms`);
    const hasBatchHeader = r.text.includes("## Batch Extract Results");
    console.log(`  hasBatchHeader:${hasBatchHeader}`);
    console.log(snip(r.text, 300));
    console.log();
  }

  // TEST 13: PDF extraction (direct PDF URL)
  {
    const r = await call(c, {
      url: "https://www.w3.org/WAI/WCAG21/wcag21.pdf",
      format: "markdown"
    }, "T13: PDF extraction");
    results.push(r);
    console.log(`[${r.label}] ok=${r.ok} isError=${r.isError} len=${r.len} elapsed=${r.elapsed}ms`);
    const hasPdf = r.text.includes("pdf:true") || r.text.includes("pdf_pages") || r.text.includes("pages:");
    console.log(`  hasPdfIndicator:${hasPdf}`);
    console.log(snip(r.text, 400));
    console.log();
  }

  // TEST 14: invalid URL / SSRF guard
  {
    const r = await call(c, { url: "https://localhost/admin" }, "T14: SSRF guard localhost");
    results.push(r);
    console.log(`[${r.label}] ok=${r.ok} isError=${r.isError} len=${r.len} elapsed=${r.elapsed}ms`);
    const blocked = r.text.includes("Blocked") || r.text.includes("private") || r.isError;
    console.log(`  blocked:${blocked}`);
    console.log(snip(r.text, 200));
    console.log();
  }

  // TEST 15: render=auto on a real content-heavy site (news article)
  {
    const r = await call(c, {
      url: "https://www.bbc.com/news",
      format: "markdown",
      render: "auto",
      clean: true
    }, "T15: bbc news auto+clean");
    results.push(r);
    console.log(`[${r.label}] ok=${r.ok} isError=${r.isError} len=${r.len} elapsed=${r.elapsed}ms`);
    const hasContent = r.len > 500;
    console.log(`  hasContent:${hasContent}`);
    console.log(snip(r.text, 400));
    console.log();
  }

  await c.close();

  // Summary
  console.log("\n=== SUMMARY ===");
  const total = results.length;
  const passed = results.filter(r => r.ok && !r.isError && r.len > 100).length;
  console.log(`Tests: ${total} | Passed (ok+non-empty): ${passed} | Failed: ${total - passed}`);
  for (const r of results) {
    const status = (r.ok && !r.isError && r.len > 100) ? "PASS" : "FAIL";
    console.log(`  [${status}] ${r.label} len=${r.len} elapsed=${r.elapsed}ms isError=${r.isError}`);
  }

  return results;
}

run().catch(e => { console.error("Fatal:", e); process.exit(1); });
