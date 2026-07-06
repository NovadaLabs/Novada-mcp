/**
 * QA Test Client for novada_extract — Functional perspective
 * Tests: formats, render modes, fields, batch, clean, max_chars, edge cases
 * Offline-first: all schema/validation tests use dummy API key
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";

async function makeClient() {
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
  });
  const c = new Client({ name: "qa-extract", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { c, t };
}

async function callTool(c, name, args) {
  try {
    const r = await c.callTool({ name, arguments: args });
    return { ok: true, result: r };
  } catch (err) {
    return { ok: false, error: err.message, raw: err };
  }
}

function inspect(label, result, expectIsError = false) {
  const content = result.result?.content?.[0]?.text || result.error || "";
  const isError = result.result?.isError || !result.ok;
  const pass = expectIsError ? isError : !isError;
  console.log(`[${pass ? "PASS" : "FAIL"}] ${label}`);
  if (!pass || process.env.VERBOSE) {
    console.log("  isError:", isError);
    console.log("  content:", content.slice(0, 300));
  }
  return { label, pass, isError, content, args: null };
}

const findings = [];
const results = [];

async function main() {
  console.log("=== QA: novada_extract functional tests (offline) ===\n");
  const { c } = await makeClient();

  // --- 1. List tools, confirm novada_extract is registered ---
  const tools = await c.listTools();
  const extractTool = tools.tools.find(t => t.name === "novada_extract");
  if (!extractTool) {
    console.log("[FAIL] novada_extract not found in tool list!");
    process.exit(1);
  }
  console.log("[PASS] novada_extract registered. Schema:");
  // Check required params
  const schema = extractTool.inputSchema;
  const props = schema.properties || {};
  console.log("  required:", schema.required);
  console.log("  properties keys:", Object.keys(props));

  // --- 2. format=html truncation boundary ---
  // HTML format truncates at 10000 chars (hardcoded). Test schema accepts "html" value.
  const fmtHtmlResult = await callTool(c, "novada_extract", {
    url: "https://example.com",
    format: "html",
    render: "static",
  });
  results.push(inspect("format=html accepted by schema", fmtHtmlResult, false));

  // --- 3. format=text ---
  const fmtTextResult = await callTool(c, "novada_extract", {
    url: "https://example.com",
    format: "text",
    render: "static",
  });
  results.push(inspect("format=text accepted by schema", fmtTextResult, false));

  // --- 4. format=json ---
  const fmtJsonResult = await callTool(c, "novada_extract", {
    url: "https://example.com",
    format: "json",
    render: "static",
  });
  results.push(inspect("format=json accepted by schema", fmtJsonResult, false));

  // --- 5. render=js alias (documented, should be internally normalized to "render") ---
  const renderJsResult = await callTool(c, "novada_extract", {
    url: "https://example.com",
    render: "js",
  });
  results.push(inspect("render=js alias accepted", renderJsResult, false));

  // --- 6. render=browser (requires NOVADA_BROWSER_WS - should fail gracefully) ---
  const renderBrowserResult = await callTool(c, "novada_extract", {
    url: "https://example.com",
    render: "browser",
  });
  results.push(inspect("render=browser without NOVADA_BROWSER_WS handles gracefully", renderBrowserResult, false));
  const browserContent = renderBrowserResult.result?.content?.[0]?.text || "";
  const hasBrowserMsg = browserContent.includes("BROWSER") || browserContent.includes("browser") ||
                         browserContent.includes("NOVADA_BROWSER_WS") || browserContent.includes("Error");
  console.log("  render=browser error msg present:", hasBrowserMsg);

  // --- 7. max_chars boundary: min=1000, max=100000 ---
  const maxCharsMin = await callTool(c, "novada_extract", {
    url: "https://example.com",
    max_chars: 999, // below min
  });
  results.push(inspect("max_chars=999 (below min 1000) should fail validation", maxCharsMin, true));

  const maxCharsMax = await callTool(c, "novada_extract", {
    url: "https://example.com",
    max_chars: 100001, // above max
  });
  results.push(inspect("max_chars=100001 (above max 100000) should fail validation", maxCharsMax, true));

  const maxCharsValid = await callTool(c, "novada_extract", {
    url: "https://example.com",
    max_chars: 1000,
    render: "static",
  });
  results.push(inspect("max_chars=1000 (at min boundary) accepted", maxCharsValid, false));

  // --- 8. fields[] parameter ---
  const fieldsResult = await callTool(c, "novada_extract", {
    url: "https://example.com",
    fields: ["title", "price", "description"],
    render: "static",
  });
  results.push(inspect("fields[] parameter accepted", fieldsResult, false));

  // --- 9. fields[] max 20 limit ---
  const fieldsOver = await callTool(c, "novada_extract", {
    url: "https://example.com",
    fields: Array(21).fill("field"), // 21 fields
  });
  results.push(inspect("fields[] with 21 items (over max 20) should fail", fieldsOver, true));

  // --- 10. fields[] empty string item ---
  const fieldsEmpty = await callTool(c, "novada_extract", {
    url: "https://example.com",
    fields: ["title", ""], // empty string field
  });
  results.push(inspect("fields[] with empty string should fail validation", fieldsEmpty, true));

  // --- 11. Batch URL: urls[] param ---
  const batchResult = await callTool(c, "novada_extract", {
    urls: ["https://example.com", "https://example.org"],
    render: "static",
  });
  results.push(inspect("urls[] batch mode accepted", batchResult, false));

  // --- 12. Batch URL: url as array ---
  const batchArrayResult = await callTool(c, "novada_extract", {
    url: ["https://example.com", "https://example.org"],
    render: "static",
  });
  results.push(inspect("url as array batch mode accepted", batchArrayResult, false));

  // --- 13. Batch URL: 11 URLs (over limit) ---
  const batchOver = await callTool(c, "novada_extract", {
    urls: Array(11).fill("https://example.com"),
  });
  results.push(inspect("urls[] with 11 items (over max 10) should fail", batchOver, true));

  // --- 14. SSRF: localhost URL ---
  const ssrfLocal = await callTool(c, "novada_extract", {
    url: "http://localhost:8080/admin",
  });
  results.push(inspect("SSRF: localhost URL should be blocked", ssrfLocal, true));
  const ssrfContent = ssrfLocal.result?.content?.[0]?.text || ssrfLocal.error || "";
  console.log("  SSRF response:", ssrfContent.slice(0, 200));

  // --- 15. SSRF: 127.0.0.1 ---
  const ssrf127 = await callTool(c, "novada_extract", {
    url: "http://127.0.0.1/",
  });
  results.push(inspect("SSRF: 127.0.0.1 URL should be blocked", ssrf127, true));

  // --- 16. SSRF: private range 192.168.x.x ---
  const ssrfPrivate = await callTool(c, "novada_extract", {
    url: "http://192.168.1.1/",
  });
  results.push(inspect("SSRF: 192.168.1.1 URL should be blocked", ssrfPrivate, true));

  // --- 17. SSRF: 10.x.x.x ---
  const ssrf10 = await callTool(c, "novada_extract", {
    url: "http://10.0.0.1/",
  });
  results.push(inspect("SSRF: 10.0.0.1 URL should be blocked", ssrf10, true));

  // --- 18. URL with newlines (injection test) ---
  const urlNewline = await callTool(c, "novada_extract", {
    url: "https://example.com\ninjected-header: evil",
  });
  results.push(inspect("URL with newlines should be rejected", urlNewline, true));

  // --- 19. Non-HTTP URL (file://) ---
  const fileUrl = await callTool(c, "novada_extract", {
    url: "file:///etc/passwd",
  });
  results.push(inspect("file:// URL should be rejected", fileUrl, true));

  // --- 20. Missing required url param ---
  const missingUrl = await callTool(c, "novada_extract", {
    format: "markdown",
  });
  results.push(inspect("Missing url param should fail", missingUrl, true));

  // --- 21. clean=true parameter ---
  const cleanResult = await callTool(c, "novada_extract", {
    url: "https://example.com",
    clean: true,
    render: "static",
  });
  results.push(inspect("clean=true accepted", cleanResult, false));

  // --- 22. wait_ms parameter ---
  const waitMsResult = await callTool(c, "novada_extract", {
    url: "https://example.com",
    wait_ms: 1000,
    render: "browser", // wait_ms only works with browser
  });
  results.push(inspect("wait_ms accepted", waitMsResult, false));

  // --- 23. wait_ms over max 30000 ---
  const waitMsOver = await callTool(c, "novada_extract", {
    url: "https://example.com",
    wait_ms: 30001, // over max
  });
  results.push(inspect("wait_ms=30001 (over max) should fail", waitMsOver, true));

  // --- 24. wait_for CSS selector ---
  const waitForResult = await callTool(c, "novada_extract", {
    url: "https://example.com",
    wait_for: ".content",
    render: "browser",
  });
  results.push(inspect("wait_for CSS selector accepted", waitForResult, false));

  // --- 25. Invalid render enum value ---
  const renderInvalid = await callTool(c, "novada_extract", {
    url: "https://example.com",
    render: "invalid-mode",
  });
  results.push(inspect("Invalid render value should fail", renderInvalid, true));

  // --- 26. Invalid format enum ---
  const formatInvalid = await callTool(c, "novada_extract", {
    url: "https://example.com",
    format: "xml",
  });
  results.push(inspect("Invalid format value should fail", formatInvalid, true));

  // --- 27. camelCase alias: maxChars ---
  const camelCaseAlias = await callTool(c, "novada_extract", {
    url: "https://example.com",
    maxChars: 5000, // camelCase alias for max_chars
    render: "static",
  });
  results.push(inspect("camelCase alias maxChars works", camelCaseAlias, false));
  const camelContent = camelCaseAlias.result?.content?.[0]?.text || "";
  console.log("  Response snippet:", camelContent.slice(0, 150));

  // --- 28. project parameter max length ---
  const projectTooLong = await callTool(c, "novada_extract", {
    url: "https://example.com",
    project: "x".repeat(31), // over max 30
  });
  results.push(inspect("project name >30 chars should fail", projectTooLong, true));

  // --- 29. Check that url + urls together is handled ---
  const urlAndUrls = await callTool(c, "novada_extract", {
    url: "https://example.com",
    urls: ["https://example.org"],
    render: "static",
  });
  // This is ambiguous - check what actually happens
  results.push(inspect("url + urls together - ambiguous case handled", urlAndUrls, false));
  const bothContent = urlAndUrls.result?.content?.[0]?.text || "";
  console.log("  url+urls behavior:", bothContent.slice(0, 200));

  // --- 30. Check JSON output has required fields when format=json ---
  const jsonFull = await callTool(c, "novada_extract", {
    url: "https://example.com",
    format: "json",
    render: "static",
  });
  results.push(inspect("format=json produces parseable JSON", jsonFull, false));
  try {
    const jsonContent = jsonFull.result?.content?.[0]?.text || "";
    const parsed = JSON.parse(jsonContent);
    const requiredFields = ["url", "title", "content", "quality", "mode", "links"];
    const missing = requiredFields.filter(f => !(f in parsed));
    if (missing.length > 0) {
      console.log(`[WARN] format=json missing required fields: ${missing.join(", ")}`);
      findings.push({
        title: "format=json missing required fields in output",
        severity: "High",
        category: "mcp-contract",
        component: "novada_extract / extract.ts",
        environment: "local",
        repro_steps: "Call novada_extract with format=json, check output for required fields",
        expected: "All standard fields (url, title, content, quality, mode, links) present",
        actual: `Missing: ${missing.join(", ")}`,
        root_cause: "formatJsonExtract or extractSingleInner missing fields in JSON output",
        suggested_fix: "Ensure all required JSON fields are always emitted",
        code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts line 937+",
        evidence: JSON.stringify(parsed, null, 2).slice(0, 500),
        confidence: "high",
      });
    } else {
      console.log("  JSON has all required fields:", requiredFields);
    }
  } catch (e) {
    console.log("  [WARN] JSON parse failed:", e.message);
    findings.push({
      title: "format=json does not return parseable JSON",
      severity: "High",
      category: "functional",
      component: "novada_extract / extract.ts",
      environment: "local",
      repro_steps: "Call novada_extract with format=json, parse the output",
      expected: "Valid JSON output",
      actual: `Parse error: ${e.message}`,
      root_cause: "JSON format path may prefix output with non-JSON content (path:, or markdown)",
      suggested_fix: "Ensure format=json returns pure JSON, not prefixed markdown",
      code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts line 937+",
      evidence: jsonFull.result?.content?.[0]?.text?.slice(0, 500) || "no content",
      confidence: "high",
    });
  }

  // --- 31. Analyze format=json "path:" prefix issue ---
  const jsonPathPrefixContent = jsonFull.result?.content?.[0]?.text || "";
  if (jsonPathPrefixContent.startsWith("path:")) {
    console.log("[FINDING] format=json output has path: prefix — breaks JSON parsing");
    findings.push({
      title: "format=json output is prefixed with 'path: <filepath>' breaking JSON parsing",
      severity: "High",
      category: "functional",
      component: "novada_extract / extract.ts",
      environment: "local",
      repro_steps: "Call novada_extract with format=json on any URL, observe the raw MCP tool output",
      expected: "Output starts with '{' — a valid JSON object",
      actual: "Output starts with 'path: ~/Downloads/...' prefix before the JSON object",
      root_cause: "saveOutput() prepends 'path: <filePath>\\n\\n' before the JSON string (line ~1028-1034). This breaks JSON.parse() on the raw output.",
      suggested_fix: "For format=json, include the save path inside the JSON object (as 'output_saved' field, which is already done) and do NOT prepend the path: prefix to the raw output",
      code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts line 1018-1034",
      evidence: jsonPathPrefixContent.slice(0, 400),
      confidence: "high",
    });
  } else if (jsonPathPrefixContent.startsWith("{")) {
    console.log("  format=json starts with '{' (correct)");
  } else {
    console.log("  format=json first chars:", jsonPathPrefixContent.slice(0, 50));
  }

  // --- 32. Check format=json returned_chars vs content.length alignment ---
  try {
    const jsonStr = jsonPathPrefixContent.startsWith("path:")
      ? jsonPathPrefixContent.slice(jsonPathPrefixContent.indexOf("{"))
      : jsonPathPrefixContent;
    const parsed = JSON.parse(jsonStr);
    if (parsed.returned_chars !== undefined && parsed.content !== undefined) {
      const actualLen = (parsed.content || "").length;
      const reportedLen = parsed.returned_chars;
      if (Math.abs(actualLen - reportedLen) > 0) {
        console.log(`[FINDING] returned_chars=${reportedLen} != content.length=${actualLen} (diff=${actualLen-reportedLen})`);
        findings.push({
          title: "format=json returned_chars does not match content.length",
          severity: "Medium",
          category: "functional",
          component: "novada_extract / extract.ts",
          environment: "local",
          repro_steps: "Call novada_extract with format=json, compare returned_chars field vs content string length",
          expected: "returned_chars === content.length",
          actual: `returned_chars=${reportedLen}, actual content.length=${actualLen}, diff=${actualLen-reportedLen}`,
          root_cause: "returned_chars is set to displayContent.length before truncation message is appended, but the final content includes the truncation message",
          suggested_fix: "Set returned_chars after the full content string is finalized, not before truncation message append",
          code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts line 955",
          evidence: `returned_chars: ${reportedLen}, content.length: ${actualLen}`,
          confidence: "medium",
        });
      }
    }
  } catch(e) {}

  // --- 33. Verify html format is always <=10000 chars (hardcoded limit) ---
  const htmlContent = fmtHtmlResult.result?.content?.[0]?.text || "";
  if (htmlContent.length > 12000) {
    console.log("[FINDING] format=html returned more than expected truncated size:", htmlContent.length);
    findings.push({
      title: "format=html does not consistently truncate at 10,000 chars",
      severity: "Medium",
      category: "functional",
      component: "novada_extract / extract.ts",
      environment: "local",
      repro_steps: "Call novada_extract with format=html and a large page, check content length",
      expected: "HTML content <= ~10,000 chars inline (remainder on disk)",
      actual: `HTML content was ${htmlContent.length} chars inline`,
      root_cause: "format=html truncation at line 665 in extract.ts applies a 10000 char limit to inline content but comments/path prefix may exceed this",
      suggested_fix: "Verify truncation applies to total inline return, not just the html content portion",
      code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts line 663-687",
      evidence: `HTML inline content length: ${htmlContent.length}`,
      confidence: "low",
    });
  } else {
    console.log(`  format=html inline content length: ${htmlContent.length} (within expected limit)`);
  }

  // --- 34. Test batch mode response format ---
  const batchContent = batchResult.result?.content?.[0]?.text || "";
  const hasBatchHeader = batchContent.includes("## Batch Extract Results");
  console.log(`[${hasBatchHeader ? "PASS" : "FAIL"}] Batch mode has '## Batch Extract Results' header`);
  if (!hasBatchHeader) {
    findings.push({
      title: "Batch mode missing '## Batch Extract Results' header",
      severity: "Medium",
      category: "mcp-contract",
      component: "novada_extract / extract.ts",
      environment: "local",
      repro_steps: "Call novada_extract with urls=['url1','url2'], check for batch header in response",
      expected: "Response includes '## Batch Extract Results' header",
      actual: batchContent.slice(0, 300),
      root_cause: "Batch output formatting is not emitting the expected header",
      suggested_fix: "Ensure batch mode always emits '## Batch Extract Results' in output",
      code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts line 132",
      evidence: batchContent.slice(0, 300),
      confidence: "high",
    });
  }

  // --- 35. Verify url+urls behavior: should urls win or should we get error? ---
  const urlAndUrlsContent = urlAndUrls.result?.content?.[0]?.text || "";
  const isBatchBehavior = urlAndUrlsContent.includes("## Batch Extract Results");
  const isSingleBehavior = urlAndUrlsContent.includes("## Extracted Content");
  console.log(`  url+urls: isBatch=${isBatchBehavior}, isSingle=${isSingleBehavior}`);
  if (isBatchBehavior) {
    console.log("  [NOTE] When both url and urls are provided, urls takes precedence (batch mode)");
  } else if (isSingleBehavior) {
    console.log("  [NOTE] When both url and urls are provided, url takes precedence (single mode)");
  } else {
    console.log("  [NOTE] url+urls returned unexpected format:", urlAndUrlsContent.slice(0, 200));
  }

  // --- 36. SSRF through unicode/encoded IPs ---
  const ssrfUnicode = await callTool(c, "novada_extract", {
    url: "http://①②⑦.0.0.1/admin", // Unicode encoded IP
  });
  results.push(inspect("SSRF unicode encoded IP should be rejected", ssrfUnicode, true));

  // --- 37. Check agent_instruction presence in markdown output ---
  const mdContent = fmtHtmlResult.result?.content?.[0]?.text ||
                    fmtTextResult.result?.content?.[0]?.text || "";

  // Check agent_instruction in markdown format
  const mdResult2 = await callTool(c, "novada_extract", {
    url: "https://example.com",
    format: "markdown",
    render: "static",
  });
  const mdContent2 = mdResult2.result?.content?.[0]?.text || "";
  const hasAgentInstruction = mdContent2.includes("agent_instruction:");
  console.log(`[${hasAgentInstruction ? "PASS" : "FAIL"}] Markdown output has agent_instruction`);
  if (!hasAgentInstruction) {
    findings.push({
      title: "Markdown output missing agent_instruction field",
      severity: "Medium",
      category: "mcp-contract",
      component: "novada_extract / extract.ts",
      environment: "local",
      repro_steps: "Call novada_extract with format=markdown, check for agent_instruction in output",
      expected: "Output includes 'agent_instruction:' line in ## Agent Action section",
      actual: "agent_instruction not found in markdown output",
      root_cause: "buildContextualAgentInstruction may not be called or output dropped",
      suggested_fix: "Ensure agent_instruction is always emitted in markdown format",
      code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts line 1218-1232",
      evidence: mdContent2.slice(-500),
      confidence: "high",
    });
  }

  // --- 38. format=text should NOT have markdown headers ---
  const textContent = fmtTextResult.result?.content?.[0]?.text || "";
  const hasMarkdownInText = /^#{1,6}\s+/m.test(textContent);
  if (hasMarkdownInText) {
    console.log("[FINDING] format=text contains markdown headers");
    findings.push({
      title: "format=text output contains markdown headers (## prefix)",
      severity: "Low",
      category: "functional",
      component: "novada_extract / extract.ts",
      environment: "local",
      repro_steps: "Call novada_extract with format=text, check for '## ' header patterns in output",
      expected: "Plain text output with no markdown headers",
      actual: "Output contains '## ' markdown headers",
      root_cause: "format=text strips '#' from mainContent but the header block lines (## Extracted Content, ## Agent Hints, etc.) are still rendered with markdown syntax",
      suggested_fix: "Ensure the metadata header block is also plain text for format=text, not markdown",
      code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts line 714-730",
      evidence: textContent.slice(0, 400),
      confidence: "medium",
    });
  } else {
    console.log("[PASS] format=text has no markdown headers in main content");
  }

  // --- 39. Check format=text vs format=markdown output structure ---
  console.log("\n-- format=text output snippet --");
  console.log(textContent.slice(0, 400));
  console.log("\n-- format=markdown output snippet --");
  console.log(mdContent2.slice(0, 400));

  // --- 40. Test max_chars actual truncation in text mode ---
  const textTruncated = await callTool(c, "novada_extract", {
    url: "https://example.com",
    format: "text",
    max_chars: 1000,
    render: "static",
  });
  const truncatedContent = textTruncated.result?.content?.[0]?.text || "";
  const hasTruncationMarker = truncatedContent.includes("[Content may be truncated") ||
                               truncatedContent.includes("first 1000 of");
  console.log(`[${hasTruncationMarker ? "PASS" : "INFO"}] format=text max_chars=1000 truncation marker present: ${hasTruncationMarker}`);

  // --- 41. Test that SSRF guard applies runtime too (not just schema) ---
  // The SSRF guard is also in extractSingle() at line 1268
  // Test with 0.0.0.0 which may bypass regex but should be caught by isBlockedHost
  const ssrf0000 = await callTool(c, "novada_extract", {
    url: "http://0.0.0.0/admin",
  });
  results.push(inspect("SSRF: 0.0.0.0 should be blocked", ssrf0000, true));
  const ssrf0Content = ssrf0000.result?.content?.[0]?.text || ssrf0000.error || "";
  console.log("  0.0.0.0 response:", ssrf0Content.slice(0, 200));

  // --- 42. Query param does not affect schema validation ---
  const queryResult = await callTool(c, "novada_extract", {
    url: "https://example.com",
    query: "what is the price",
    render: "static",
  });
  results.push(inspect("query parameter accepted", queryResult, false));
  const queryContent = queryResult.result?.content?.[0]?.text || "";
  const hasQueryHint = queryContent.includes("Query context:");
  console.log(`  query hint in output: ${hasQueryHint}`);

  // --- 43. Verify wait_for only works with browser mode ---
  // wait_for should be accepted but may be a no-op for non-browser modes
  const waitForNonBrowser = await callTool(c, "novada_extract", {
    url: "https://example.com",
    wait_for: ".content",
    render: "static",  // non-browser mode
  });
  results.push(inspect("wait_for with render=static accepted (no-op expected)", waitForNonBrowser, false));

  // --- 44. Dual submit: url array + urls array — should one win? ---
  // This is not a Zod error, the code resolves it at runtime (urls wins per code line 86-90)

  // --- 45. Verify empty fields array is treated differently from missing fields ---
  const fieldsEmptyArr = await callTool(c, "novada_extract", {
    url: "https://example.com",
    fields: [], // empty array
    render: "static",
  });
  results.push(inspect("fields=[] empty array accepted", fieldsEmptyArr, false));
  const fieldsEmptyContent = fieldsEmptyArr.result?.content?.[0]?.text || "";
  const hasFieldsBlock = fieldsEmptyContent.includes("## Requested Fields");
  console.log(`  fields=[] triggers Requested Fields block: ${hasFieldsBlock}`);
  if (hasFieldsBlock) {
    console.log("[FINDING] fields=[] (empty array) incorrectly triggers Requested Fields block");
    findings.push({
      title: "fields=[] (empty array) may incorrectly trigger Requested Fields block",
      severity: "Low",
      category: "functional",
      component: "novada_extract / extract.ts",
      environment: "local",
      repro_steps: "Call novada_extract with fields=[] (empty array), check output for Requested Fields section",
      expected: "No '## Requested Fields' section when no fields are requested",
      actual: "Requested Fields section present even with empty fields array",
      root_cause: "Code checks `params.fields && params.fields.length > 0` but may display block if fieldResults has entries",
      suggested_fix: "Guard field display block with fieldResults !== null && fieldResults.length > 0",
      code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts line 1059",
      evidence: fieldsEmptyContent.slice(0, 500),
      confidence: "low",
    });
  }

  // -- Print summary ---
  console.log("\n=== Summary ===");
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`Tests: ${results.length} | PASS: ${passed} | FAIL: ${failed}`);
  console.log(`Findings: ${findings.length}`);

  // Close client
  await c.close();
  return findings;
}

main().then(findings => {
  console.log("\n=== FINDINGS ===");
  console.log(JSON.stringify(findings, null, 2));
}).catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
