/**
 * novada_extract audit follow-up:
 * 1. PDF with real accessible URL
 * 2. urls[] batch without url param (confirms NOV-677 or new bug)
 * 3. max_chars cache bypass bug
 * 4. clean=true vs clean=false length comparison
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
  const c = new Client({ name: "audit-extract2", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { c };
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
  return s.length <= n ? s : s.slice(0, n) + `\n...[total ${s.length}]`;
}

async function run() {
  const { c } = await makeClient();

  console.log("=== Follow-up Tests ===\n");

  // TEST A: PDF with real URL
  console.log("=== TEST A: PDF (IRS f1040) ===");
  const ta = await call(c, { url: "https://www.irs.gov/pub/irs-pdf/f1040.pdf", format: "markdown" }, "PDF-irs");
  console.log(`ok=${ta.ok} isError=${ta.isError} len=${ta.len} elapsed=${ta.elapsed}ms`);
  const hasPdf = ta.text.includes("pdf:true") || ta.text.includes("pdf_pages") || ta.text.includes("pages:");
  console.log(`hasPdfIndicator:${hasPdf}`);
  console.log(snip(ta.text, 500));
  console.log();

  // TEST B: urls[] without url - this is the core bug
  console.log("=== TEST B: urls[] without url param ===");
  const tb = await call(c, { urls: ["https://example.com", "https://example.org"], format: "markdown" }, "urls-no-url");
  console.log(`ok=${tb.ok} isError=${tb.isError} len=${tb.len} elapsed=${tb.elapsed}ms`);
  console.log("Result:", snip(tb.text, 400));
  console.log();

  // TEST C: max_chars ignored from cache
  // Step 1: prime cache with large result
  console.log("=== TEST C: max_chars ignored by cache ===");
  const tc1 = await call(c, {
    url: "https://en.wikipedia.org/wiki/TypeScript",
    format: "markdown",
    render: "static"
  }, "prime-cache-large");
  const src1 = tc1.text.match(/source: (\w+)/)?.[1];
  console.log(`step1 (no max_chars): src=${src1} len=${tc1.len}`);

  // Step 2: request same URL with small max_chars - should honor max_chars or return from cache
  const tc2 = await call(c, {
    url: "https://en.wikipedia.org/wiki/TypeScript",
    format: "markdown",
    render: "static",
    max_chars: 1000
  }, "small-max_chars-cached");
  const src2 = tc2.text.match(/source: (\w+)/)?.[1];
  const hasTrunc = tc2.text.includes("content_truncated:true") || tc2.text.includes("Content may be truncated");
  console.log(`step2 (max_chars=1000): src=${src2} len=${tc2.len} hasTrunc=${hasTrunc}`);
  if (src2 === "cache" && !hasTrunc && tc2.len > 10000) {
    console.log("BUG CONFIRMED: cache served full content ignoring max_chars=1000");
  } else if (src2 === "cache" && hasTrunc) {
    console.log("OK: cache served result but with truncation applied");
  } else {
    console.log("INFO:", src2, "len:", tc2.len);
  }
  console.log(snip(tc2.text, 400));
  console.log();

  // TEST D: clean=true vs clean=false (verify they produce different content)
  console.log("=== TEST D: clean=true vs clean=false length difference ===");
  const td1 = await call(c, {
    url: "https://www.bbc.com/news",
    format: "markdown",
    clean: false,
    render: "static"
  }, "bbc-clean-false");
  const td2 = await call(c, {
    url: "https://www.bbc.com/news",
    format: "markdown",
    clean: true,
    render: "static"
  }, "bbc-clean-true");
  console.log(`clean=false len=${td1.len} | clean=true len=${td2.len}`);
  if (td1.len > td2.len) {
    console.log("PASS: clean=true produces shorter output as expected");
  } else if (td1.len === td2.len) {
    console.log("WARN: clean=true and clean=false produced same length output (cache hit?)");
  } else {
    console.log("UNEXPECTED: clean=true produced longer output than clean=false");
  }
  console.log();

  // TEST E: json format fields[] null case - agent_instruction check
  console.log("=== TEST E: json format fields with unresolved case ===");
  const te = await call(c, {
    url: "https://example.com",
    format: "json",
    fields: ["price", "author", "rating"],
    render: "static"
  }, "json-fields-unresolved");
  let parsed = null;
  try {
    const jsonStart = te.text.indexOf("{");
    if (jsonStart >= 0) parsed = JSON.parse(te.text.slice(jsonStart));
  } catch(e) { console.log("JSON parse error:", e.message); }
  console.log(`ok=${te.ok} isError=${te.isError} len=${te.len}`);
  if (parsed?.fields) {
    const fields = parsed.fields;
    console.log("fields resolved:", JSON.stringify(fields, null, 2).slice(0, 500));
    // Check that unresolved fields have agent_instruction
    for (const [k, v] of Object.entries(fields)) {
      if (v && typeof v === 'object' && v.source === "unresolved") {
        console.log(`  field ${k}: unresolved, has agent_instruction: ${!!v.agent_instruction}`);
      }
    }
  }
  console.log();

  await c.close();
  console.log("=== Done ===");
}

run().catch(e => { console.error("Fatal:", e); process.exit(1); });
