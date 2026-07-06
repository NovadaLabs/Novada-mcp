/**
 * QA: Deep performance / latency investigation
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
  const c = new Client({ name: "qa-perf-deep", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { c, t };
}

async function callTool(c, name, args, label) {
  const start = Date.now();
  try {
    const r = await c.callTool({ name, arguments: args });
    const elapsed = Date.now() - start;
    const content = r?.content?.[0]?.text ?? JSON.stringify(r);
    return { ok: true, elapsed, content, label };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { ok: false, elapsed, error: err.message, label };
  }
}

const results = [];

async function runTests() {
  const { c } = await makeClient();

  // =============================================
  // TEST: Batch uses 'urls' param but schema validation rejects it
  // The S9/S10 tests showed "url: Invalid input" - investigate
  // =============================================
  console.log("\n=== BATCH 'urls' param validation ===");
  {
    // Try 'urls' as the batch param
    const r = await callTool(c, "novada_extract", {
      urls: ["https://example.com", "https://example.org"],
      render: "static",
      format: "markdown",
    }, "BATCH-urls-param");
    results.push(r);
    console.log(`  elapsed:${r.elapsed}ms ok:${r.ok}`);
    console.log(`  snippet: ${r.content?.slice(0, 300)}`);
  }

  // =============================================
  // TEST: Check the exact schema for novada_extract
  // =============================================
  console.log("\n=== Schema check ===");
  {
    const tools = await c.listTools();
    const extractTool = tools.tools?.find(t => t.name === "novada_extract");
    if (extractTool) {
      const schema = extractTool.inputSchema;
      console.log("Input schema keys:", JSON.stringify(Object.keys(schema?.properties ?? {})));
      // Check if 'urls' is in schema
      const hasUrls = "urls" in (schema?.properties ?? {});
      const hasUrl = "url" in (schema?.properties ?? {});
      console.log(`  has 'url' param: ${hasUrl}, has 'urls' param: ${hasUrls}`);
      results.push({ label: "schema-check", ok: true, elapsed: 0, hasUrls, hasUrl, content: JSON.stringify(schema?.properties?.url ?? {}) });
    }
  }

  // =============================================
  // TEST: wait_ms > 0 is passed but NOT in browser mode — is it silently ignored?
  // Look for any warning/hint in the response
  // =============================================
  console.log("\n=== wait_ms ignored in static mode ===");
  {
    const r = await callTool(c, "novada_extract", {
      url: "https://example.com",
      render: "static",
      wait_ms: 5000,
      format: "json",
    }, "wait_ms-ignored");
    results.push(r);
    console.log(`  elapsed:${r.elapsed}ms`);
    // Parse JSON and check if any hint about wait_ms being ignored
    try {
      const parsed = JSON.parse(r.content);
      const hasWaitMsHint = JSON.stringify(parsed).includes("wait_ms") ||
                             JSON.stringify(parsed.hints ?? []).includes("wait");
      console.log(`  hints: ${JSON.stringify(parsed.hints ?? [])}`);
      console.log(`  has wait_ms hint: ${hasWaitMsHint}`);
      results.push({ label: "wait_ms-hint-check", ok: true, elapsed: 0, hasWaitMsHint, hints: parsed.hints });
    } catch(e) {
      console.log(`  parse error: ${e.message}`);
      console.log(`  raw: ${r.content?.slice(0, 300)}`);
    }
  }

  // =============================================
  // TEST: Auto-mode race condition — direct vs proxy both run
  // When proxy env vars are not set, what actually happens?
  // From code: Promise.any([directFetch, proxyFetch]) but proxyFetch falls back to direct
  // when no proxy creds → effectively two direct fetches racing!
  // =============================================
  console.log("\n=== Auto mode with no proxy creds ===");
  {
    const r = await callTool(c, "novada_extract", {
      url: "https://example.com",
      render: "auto",
      format: "json",
    }, "auto-no-proxy");
    results.push(r);
    console.log(`  elapsed:${r.elapsed}ms render=auto no proxy`);
    try {
      const parsed = JSON.parse(r.content);
      console.log(`  mode: ${parsed.mode}`);
    } catch {
      console.log(`  snippet: ${r.content?.slice(0, 200)}`);
    }
  }

  // =============================================
  // TEST: Probe the 3-second direct-fetch timeout race
  // In auto mode, extractSingleInner has:
  //   fetchWithRetry(..., {timeout: 3000}) racing against fetchViaProxy
  // After 3s, direct fetch times out and proxy wins. But proxy also has 3 retries!
  // Test: what is the actual ceiling behavior?
  // =============================================
  console.log("\n=== Check unblock timeout=0 behavior ===");
  {
    const r = await callTool(c, "novada_unblock", {
      url: "https://example.com",
      method: "render",
      timeout: 0,
    }, "unblock-timeout-0");
    results.push(r);
    console.log(`  elapsed:${r.elapsed}ms`);
    console.log(`  content: ${r.content?.slice(0, 400)}`);
  }

  // =============================================
  // TEST: Check the TOTAL_REQUEST_CEILING error message format
  // This should be 50s in 0.9.0 (capped for hosted)
  // =============================================
  console.log("\n=== ceiling_s value in error message ===");
  {
    // Can't easily trigger the ceiling without a real 50s+ fetch,
    // but we can test by checking the error message format
    // by forcing a fast failure instead
    const r = await callTool(c, "novada_extract", {
      url: "https://example.com",
      render: "static",
      format: "json",
    }, "ceiling-test-baseline");
    results.push(r);
    console.log(`  elapsed:${r.elapsed}ms`);
    try {
      const parsed = JSON.parse(r.content);
      console.log(`  mode: ${parsed.mode}, quality: ${parsed.quality?.score}`);
    } catch {
      console.log(`  raw: ${r.content?.slice(0, 300)}`);
    }
  }

  // =============================================
  // TEST: Wayback Machine fallback latency (auto-triggered when content < 100 chars)
  // For dummy key with no real fetch, what happens?
  // =============================================
  console.log("\n=== novada_extract format=html ===");
  {
    const r = await callTool(c, "novada_extract", {
      url: "https://example.com",
      render: "static",
      format: "html",
    }, "html-format");
    results.push(r);
    console.log(`  elapsed:${r.elapsed}ms`);
    // should return raw HTML truncated at 10000 chars
    console.log(`  starts with: ${r.content?.slice(0, 100)}`);
    console.log(`  length: ${r.content?.length}`);
  }

  // =============================================
  // TEST: Batch mode — does 'urls' array work in MCP schema?
  // =============================================
  console.log("\n=== Batch mode: url as array vs urls ===");
  {
    // Test url as array (the SDK accepts this but check schema validation)
    const r1 = await callTool(c, "novada_extract", {
      url: ["https://example.com", "https://example.org"],
      render: "static",
      format: "markdown",
    }, "batch-url-array");
    results.push(r1);
    console.log(`  [url-array] elapsed:${r1.elapsed}ms ok:${r1.ok}`);
    console.log(`  snippet: ${r1.content?.slice(0, 200)}`);
  }

  // =============================================
  // TEST: What is the actual schema for 'url' - does it allow arrays?
  // =============================================
  {
    const tools = await c.listTools();
    const extractTool = tools.tools?.find(t => t.name === "novada_extract");
    if (extractTool) {
      const urlProp = extractTool.inputSchema?.properties?.url;
      const urlsProp = extractTool.inputSchema?.properties?.urls;
      console.log(`\n  url schema: ${JSON.stringify(urlProp)}`);
      console.log(`  urls schema: ${JSON.stringify(urlsProp)}`);
    }
  }

  // =============================================
  // TEST: render=auto then checking response time (real network needed)
  // =============================================
  console.log("\n=== Auto mode race: static 3s timeout racing proxy ===");
  {
    // In auto mode: fetchWithRetry(url, {timeout: 3000}) races fetchViaProxy(url)
    // Without proxy creds, fetchViaProxy falls back to another fetchWithRetry call
    // This means TWO direct fetchWithRetry calls are racing (the 3s-timeout one and the proxy-fallback one)
    // The proxy-fallback one has STATIC_FETCH=15000 timeout, so it's slower
    // The result: the 3s direct one SHOULD win on fast sites
    // But the proxy-fallback one is still running in the background after the 3s one wins
    // This is a performance concern: orphaned background fetch consuming resources

    // We need to check: after Promise.any resolves, is the losing fetch cancelled?
    // In Node.js, Promise.any doesn't cancel the losing promise's underlying fetch
    // The abandoned axios request continues to run until it either resolves, rejects, or times out

    console.log("  Checking abandoned fetch behavior in auto mode...");
    // This is a code-level analysis rather than a runnable test with dummy key
    results.push({
      label: "orphaned-fetch-analysis",
      ok: true,
      elapsed: 0,
      finding: "In auto render mode: fetchWithRetry(3s) races fetchViaProxy which itself calls fetchWithRetry(15s). " +
               "When the 3s fetch wins Promise.any, the 15s fetch is NOT cancelled — it runs to completion " +
               "consuming a socket from the shared httpsAgent pool. With maxSockets=10, heavy batch traffic " +
               "could exhaust connections."
    });
    console.log("  ✓ Analysis complete (code-level finding)");
  }

  await c.close();
  return results;
}

runTests()
  .then(r => {
    console.log("\n=== DEEP TEST RESULTS ===");
    r.forEach(res => console.log(`${res.label}: ok=${res.ok} elapsed=${res.elapsed}ms`));
    process.exit(0);
  })
  .catch(err => {
    console.error("FATAL:", err);
    process.exit(1);
  });
