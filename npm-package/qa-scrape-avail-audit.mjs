/**
 * QA Availability Audit — novada_scrape
 * Tests: amazon keyword (markdown), google SERP (json), github repo (toon),
 *        bad-platform (11008 error path), bad-operation preflight (client-side error),
 *        toon format structure.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = process.env.QA_KEY || "dummy";
const INDEX = "/Users/tongwu/Projects/novada-mcp/build/index.js";

function makeClient() {
  const t = new StdioClientTransport({
    command: "node",
    args: [INDEX],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
  });
  const c = new Client({ name: "avail-scrape-audit", version: "0" }, { capabilities: {} });
  return { t, c };
}

async function runTest(label, platform, operation, params, format = "markdown") {
  const { t, c } = makeClient();
  const result = { label, platform, operation, format, params };
  const start = Date.now();
  try {
    await c.connect(t);
    const r = await c.callTool({
      name: "novada_scrape",
      arguments: { platform, operation, params, format, limit: 5 },
    });
    const elapsed = Date.now() - start;
    const text = r?.content?.[0]?.text ?? "";
    result.isError = r?.isError ?? false;
    result.elapsed_ms = elapsed;
    result.responseLen = text.length;
    result.preview = text.slice(0, 600);
    result.hasRecords = text.includes("records:");
    result.pass = !result.isError && result.hasRecords && text.length > 100;
    result.status = result.pass ? "PASS" : (result.isError ? "ERROR" : "FAIL");
  } catch (err) {
    result.status = "EXCEPTION";
    result.error = String(err);
    result.pass = false;
  } finally {
    try { await c.close(); } catch {}
  }
  return result;
}

async function runErrorTest(label, platform, operation, params, expectedErrPattern) {
  const { t, c } = makeClient();
  const result = { label, platform, operation, params, expectedPattern: expectedErrPattern };
  const start = Date.now();
  try {
    await c.connect(t);
    const r = await c.callTool({
      name: "novada_scrape",
      arguments: { platform, operation, params, limit: 5 },
    });
    const elapsed = Date.now() - start;
    const text = r?.content?.[0]?.text ?? "";
    result.isError = r?.isError ?? false;
    result.elapsed_ms = elapsed;
    result.preview = text.slice(0, 500);
    // For error tests, pass = isError is true AND message matches expected pattern
    const matchesPattern = expectedErrPattern ? text.includes(expectedErrPattern) || text.toLowerCase().includes(expectedErrPattern.toLowerCase()) : true;
    result.pass = result.isError && matchesPattern;
    result.status = result.pass ? "PASS" : (result.isError ? "WRONG_ERROR_MSG" : "EXPECTED_ERROR_BUT_GOT_SUCCESS");
  } catch (err) {
    result.status = "EXCEPTION";
    result.error = String(err);
    result.pass = false;
  } finally {
    try { await c.close(); } catch {}
  }
  return result;
}

async function main() {
  console.log("=== novada_scrape availability audit ===\n");
  const results = [];

  // TEST 1: Amazon keyword — markdown format
  console.log("[1/6] Amazon product keywords (markdown)...");
  const r1 = await runTest(
    "amazon_keyword_markdown",
    "amazon.com",
    "amazon_product_keywords",
    { keyword: "wireless headphones" },
    "markdown"
  );
  results.push(r1);
  console.log(`  Status: ${r1.status} | elapsed: ${r1.elapsed_ms}ms | len: ${r1.responseLen}`);
  if (r1.preview) console.log(`  Preview: ${r1.preview.slice(0, 200)}\n`);

  // TEST 2: Google SERP — json format
  console.log("[2/6] Google SERP web search (json)...");
  const r2 = await runTest(
    "google_serp_json",
    "google.com",
    "google_serp_web",
    { q: "web scraping python" },
    "json"
  );
  results.push(r2);
  console.log(`  Status: ${r2.status} | elapsed: ${r2.elapsed_ms}ms | len: ${r2.responseLen}`);
  if (r2.preview) console.log(`  Preview: ${r2.preview.slice(0, 200)}\n`);

  // TEST 3: GitHub repo — toon format
  console.log("[3/6] GitHub repository (toon format)...");
  const r3 = await runTest(
    "github_repo_toon",
    "github.com",
    "github_repository_repo-url",
    { url: "https://github.com/microsoft/vscode" },
    "toon"
  );
  results.push(r3);
  console.log(`  Status: ${r3.status} | elapsed: ${r3.elapsed_ms}ms | len: ${r3.responseLen}`);
  if (r3.preview) console.log(`  Preview: ${r3.preview.slice(0, 200)}\n`);

  // TEST 4: TOON format structure check — verify "HEADERS:" marker
  if (r3.status !== "EXCEPTION") {
    const toonText = r3.preview ?? "";
    const hasHeaders = toonText.includes("HEADERS:");
    const toonCheck = {
      label: "toon_format_structure",
      pass: r3.pass && hasHeaders,
      status: (r3.pass && hasHeaders) ? "PASS" : "FAIL",
      note: hasHeaders ? "HEADERS: line present" : "HEADERS: line MISSING from toon output",
    };
    results.push(toonCheck);
    console.log(`[4/6] TOON format structure: ${toonCheck.status} — ${toonCheck.note}\n`);
  } else {
    results.push({ label: "toon_format_structure", status: "SKIPPED", pass: false });
    console.log("[4/6] TOON format structure: SKIPPED (prev test excepted)\n");
  }

  // TEST 5: Bad platform → expect 11008-style error
  console.log("[5/6] Bad platform error path (notaplatform.xyz)...");
  const r5 = await runErrorTest(
    "bad_platform_11008",
    "notaplatform.xyz",
    "some_operation",
    { keyword: "test" },
    "11008"
  );
  results.push(r5);
  console.log(`  Status: ${r5.status} | elapsed: ${r5.elapsed_ms}ms`);
  if (r5.preview) console.log(`  Preview: ${r5.preview.slice(0, 200)}\n`);

  // TEST 6: Bad operation on known platform → expect preflight error (client-side, fast)
  console.log("[6/6] Known platform + invalid operation (preflight)...");
  const r6 = await runErrorTest(
    "preflight_invalid_op",
    "amazon.com",
    "amazon_nonexistent_op",
    { keyword: "test" },
    "Unknown operation"
  );
  results.push(r6);
  console.log(`  Status: ${r6.status} | elapsed: ${r6.elapsed_ms}ms`);
  if (r6.preview) console.log(`  Preview: ${r6.preview.slice(0, 200)}\n`);

  // Summary
  console.log("\n=== SUMMARY ===");
  const pass = results.filter(r => r.pass).length;
  const total = results.length;
  results.forEach(r => console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.label}: ${r.status}`));
  console.log(`\nTotal: ${pass}/${total} passed\n`);

  // Write full results to JSON
  const outPath = "/tmp/novada-audit-0.9.0/qa-scrape-avail-raw.json";
  const fs = await import("fs");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`Results written to ${outPath}`);
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
