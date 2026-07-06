/**
 * QA E2E Site Audit Test - Novada MCP 0.9.0
 * Tests: map -> crawl -> extract/summarize real site; discover -> health flow
 * Perspective: Real-world e2e site audit
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const REAL_KEY = "1f35b477c9e1802778ec64aee2a6adfa";
const DUMMY_KEY = "dummy";

const findings = [];
const scenarios = [];

async function makeClient(apiKey = DUMMY_KEY) {
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: apiKey }),
  });
  const c = new Client({ name: "qa-e2e-site-audit", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return c;
}

function recordFinding(f) {
  findings.push(f);
  console.error(`[FINDING] ${f.severity} | ${f.title}`);
}

function recordScenario(name) {
  scenarios.push(name);
  console.error(`[SCENARIO] ${name}`);
}

// ============================================================
// OFFLINE TESTS (schema, validation, error path)
// ============================================================

async function testMapSchemaValidation(c) {
  recordScenario("map: missing required url");

  // Test 1: map with no url (should error with INVALID_PARAMS)
  try {
    const r = await c.callTool({ name: "novada_map", arguments: {} });
    const content = r.content?.[0]?.text || "";
    if (!content.includes("INVALID_PARAMS") && !content.includes("required") && !content.includes("invalid")) {
      recordFinding({
        title: "novada_map: missing url arg does not produce clear INVALID_PARAMS error",
        severity: "High",
        category: "mcp-contract",
        component: "novada_map / MapParamsSchema",
        environment: "local",
        repro_steps: "callTool('novada_map', {}) — omit required url",
        expected: "Error [INVALID_PARAMS] with agent_instruction",
        actual: content.slice(0, 300),
        root_cause: "Schema validation may not be surfacing error in agent-readable form",
        suggested_fix: "Ensure Zod parse errors are caught and re-thrown as NovadaError(INVALID_PARAMS)",
        code_location: "src/tools/types.ts: validateMapParams",
        evidence: content.slice(0, 300),
        confidence: "high",
      });
    } else {
      console.error("[OK] map missing url -> error returned:", content.slice(0, 100));
    }
  } catch (e) {
    console.error("[THROWN] map missing url threw:", e.message);
  }
}

async function testMapInvalidUrl(c) {
  recordScenario("map: invalid url formats");

  // Test: javascript: URL injection
  const jsUrl = "javascript:alert(1)";
  try {
    const r = await c.callTool({ name: "novada_map", arguments: { url: jsUrl } });
    const content = r.content?.[0]?.text || "";
    if (!content.includes("INVALID_PARAMS") && !content.includes("invalid") && !content.includes("Error")) {
      recordFinding({
        title: "novada_map: javascript: URL not rejected by schema",
        severity: "Urgent",
        category: "safety-data-leak",
        component: "novada_map / safeUrl validator",
        environment: "local",
        repro_steps: `callTool('novada_map', { url: 'javascript:alert(1)' })`,
        expected: "Immediate INVALID_PARAMS rejection before any network call",
        actual: content.slice(0, 300),
        root_cause: "safeUrl validator may not block non-http/https schemes",
        suggested_fix: "Enforce protocol whitelist (http/https only) in safeUrl",
        code_location: "src/tools/types.ts: safeUrl",
        evidence: content.slice(0, 300),
        confidence: "high",
      });
    } else {
      console.error("[OK] map javascript: url -> rejected:", content.slice(0, 120));
    }
  } catch (e) {
    console.error("[OK] map javascript: url threw:", e.message);
  }

  // Test: file:// URL
  try {
    const r = await c.callTool({ name: "novada_map", arguments: { url: "file:///etc/passwd" } });
    const content = r.content?.[0]?.text || "";
    if (!content.includes("INVALID_PARAMS") && !content.includes("invalid") && !content.includes("Error")) {
      recordFinding({
        title: "novada_map: file:// URL not rejected by schema (SSRF risk)",
        severity: "Urgent",
        category: "safety-data-leak",
        component: "novada_map / safeUrl validator",
        environment: "local",
        repro_steps: `callTool('novada_map', { url: 'file:///etc/passwd' })`,
        expected: "Immediate INVALID_PARAMS rejection before any network call",
        actual: content.slice(0, 300),
        root_cause: "safeUrl validator may not block file:// scheme",
        suggested_fix: "Enforce protocol whitelist (http/https only) in safeUrl",
        code_location: "src/tools/types.ts: safeUrl",
        evidence: content.slice(0, 300),
        confidence: "high",
      });
    } else {
      console.error("[OK] map file:// url -> rejected:", content.slice(0, 120));
    }
  } catch (e) {
    console.error("[OK] map file:// url threw:", e.message);
  }
}

async function testMapBoundaryParams(c) {
  recordScenario("map: boundary parameter values");

  // Test limit=0 (below min 1)
  try {
    const r = await c.callTool({ name: "novada_map", arguments: { url: "https://example.com", limit: 0 } });
    const content = r.content?.[0]?.text || "";
    if (!content.includes("INVALID_PARAMS") && !content.includes("invalid") && !content.includes("Error")) {
      recordFinding({
        title: "novada_map: limit=0 (below schema min:1) not rejected",
        severity: "Medium",
        category: "mcp-contract",
        component: "novada_map / MapParamsSchema",
        environment: "local",
        repro_steps: `callTool('novada_map', { url: 'https://example.com', limit: 0 })`,
        expected: "INVALID_PARAMS rejection (schema min: 1)",
        actual: content.slice(0, 200),
        root_cause: "Zod min check may not be enforced",
        suggested_fix: "Verify MapParamsSchema limit z.number().int().min(1)",
        code_location: "src/tools/types.ts: MapParamsSchema",
        evidence: content.slice(0, 200),
        confidence: "medium",
      });
    } else {
      console.error("[OK] map limit=0 -> rejected:", content.slice(0, 100));
    }
  } catch (e) {
    console.error("[OK] map limit=0 threw:", e.message);
  }

  // Test limit=101 (above max 100)
  try {
    const r = await c.callTool({ name: "novada_map", arguments: { url: "https://example.com", limit: 101 } });
    const content = r.content?.[0]?.text || "";
    if (!content.includes("INVALID_PARAMS") && !content.includes("invalid") && !content.includes("Error")) {
      recordFinding({
        title: "novada_map: limit=101 (above schema max:100) silently clamped vs rejected",
        severity: "Low",
        category: "mcp-contract",
        component: "novada_map / MapParamsSchema",
        environment: "local",
        repro_steps: `callTool('novada_map', { url: 'https://example.com', limit: 101 })`,
        expected: "Either INVALID_PARAMS rejection or documented clamping behavior",
        actual: content.slice(0, 200),
        root_cause: "Schema says max 100; code does Math.min(params.limit || 50, 100) internally — unclear contract",
        suggested_fix: "Schema should reject > 100 or document clamping in tool description",
        code_location: "src/tools/map.ts: const maxUrls = Math.min(params.limit || 50, 100)",
        evidence: content.slice(0, 200),
        confidence: "medium",
      });
    } else {
      console.error("[OK] map limit=101 -> rejected:", content.slice(0, 100));
    }
  } catch (e) {
    console.error("[OK] map limit=101 threw:", e.message);
  }
}

async function testCrawlSchemaValidation(c) {
  recordScenario("crawl: invalid parameters");

  // Test max_pages > 20 (above schema max)
  try {
    const r = await c.callTool({ name: "novada_crawl", arguments: { url: "https://example.com", max_pages: 25, strategy: "bfs", render: "auto" } });
    const content = r.content?.[0]?.text || "";
    if (!content.includes("INVALID_PARAMS") && !content.includes("invalid") && !content.includes("Error")) {
      recordFinding({
        title: "novada_crawl: max_pages=25 (above schema max:20) not rejected",
        severity: "Medium",
        category: "mcp-contract",
        component: "novada_crawl / CrawlParamsSchema",
        environment: "local",
        repro_steps: `callTool('novada_crawl', { url: 'https://example.com', max_pages: 25, strategy: 'bfs', render: 'auto' })`,
        expected: "INVALID_PARAMS rejection (schema max: 20)",
        actual: content.slice(0, 200),
        root_cause: "Zod max check not enforced",
        suggested_fix: "Verify CrawlParamsSchema max_pages max enforcement",
        code_location: "src/tools/types.ts: CrawlParamsSchema",
        evidence: content.slice(0, 200),
        confidence: "medium",
      });
    } else {
      console.error("[OK] crawl max_pages=25 -> rejected:", content.slice(0, 100));
    }
  } catch (e) {
    console.error("[OK] crawl max_pages=25 threw:", e.message);
  }

  // Test invalid strategy enum
  try {
    const r = await c.callTool({ name: "novada_crawl", arguments: { url: "https://example.com", max_pages: 5, strategy: "random", render: "auto" } });
    const content = r.content?.[0]?.text || "";
    if (!content.includes("INVALID_PARAMS") && !content.includes("invalid") && !content.includes("Error")) {
      recordFinding({
        title: "novada_crawl: invalid strategy='random' not rejected by schema",
        severity: "Medium",
        category: "mcp-contract",
        component: "novada_crawl / CrawlParamsSchema",
        environment: "local",
        repro_steps: `callTool('novada_crawl', { url: 'https://example.com', strategy: 'random' })`,
        expected: "INVALID_PARAMS rejection (strategy must be 'bfs' or 'dfs')",
        actual: content.slice(0, 200),
        root_cause: "Zod enum not enforced on strategy field",
        suggested_fix: "Verify CrawlParamsSchema strategy enum enforcement",
        code_location: "src/tools/types.ts: CrawlParamsSchema",
        evidence: content.slice(0, 200),
        confidence: "medium",
      });
    } else {
      console.error("[OK] crawl strategy=random -> rejected:", content.slice(0, 100));
    }
  } catch (e) {
    console.error("[OK] crawl strategy=random threw:", e.message);
  }
}

async function testCrawlSelectPathsGlob(c) {
  recordScenario("crawl: select_paths glob edge cases");

  // Test: very long select_paths pattern - should be clamped/rejected, not crash
  const longPattern = "/docs/" + "a".repeat(300);
  try {
    const r = await c.callTool({ name: "novada_crawl", arguments: {
      url: "https://example.com",
      max_pages: 1,
      strategy: "bfs",
      render: "static",
      select_paths: [longPattern],
    }});
    const content = r.content?.[0]?.text || "";
    if (content.includes("Error") && !content.includes("INVALID_PARAMS")) {
      // Got an error but not the expected one
      console.error("[INFO] crawl long select_path: got generic error:", content.slice(0, 200));
    } else {
      console.error("[OK] crawl long select_path handled:", content.slice(0, 100));
    }
  } catch (e) {
    console.error("[INFO] crawl long select_path threw:", e.message);
  }

  // Test: select_paths with ReDoS-like pattern
  const redosPattern = "/*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*";
  try {
    const r = await c.callTool({ name: "novada_crawl", arguments: {
      url: "https://example.com",
      max_pages: 1,
      strategy: "bfs",
      render: "static",
      select_paths: [redosPattern],
    }});
    console.error("[OK] crawl ReDoS pattern handled:", JSON.stringify(r).slice(0, 200));
  } catch (e) {
    recordFinding({
      title: "novada_crawl: ReDoS-like glob pattern in select_paths causes exception",
      severity: "High",
      category: "functional",
      component: "novada_crawl / compilePatterns",
      environment: "local",
      repro_steps: `callTool('novada_crawl', { url: 'https://example.com', select_paths: ['/*a*a*a*a*a*a*a*a*a*a*'] })`,
      expected: "Pattern handled gracefully (DP-based glob matcher should not ReDoS)",
      actual: e.message,
      root_cause: "globToMatcher DP implementation should prevent ReDoS but exception occurred",
      suggested_fix: "Catch errors in compilePatterns and return empty matcher for bad patterns",
      code_location: "src/tools/crawl.ts: compilePatterns",
      evidence: e.message,
      confidence: "high",
    });
  }
}

async function testExtractSchemaValidation(c) {
  recordScenario("extract: invalid url and boundary params");

  // Test: no url at all
  try {
    const r = await c.callTool({ name: "novada_extract", arguments: { format: "markdown", render: "auto" } });
    const content = r.content?.[0]?.text || "";
    if (!content.includes("INVALID_PARAMS") && !content.includes("required") && !content.includes("Error")) {
      recordFinding({
        title: "novada_extract: missing url does not return INVALID_PARAMS",
        severity: "High",
        category: "mcp-contract",
        component: "novada_extract / ExtractParamsSchema",
        environment: "local",
        repro_steps: `callTool('novada_extract', { format: 'markdown', render: 'auto' }) -- omit url`,
        expected: "INVALID_PARAMS error with agent_instruction",
        actual: content.slice(0, 300),
        root_cause: "Schema validation may not reject missing url",
        suggested_fix: "Verify url is required in ExtractParamsSchema",
        code_location: "src/tools/types.ts: ExtractParamsSchema",
        evidence: content.slice(0, 300),
        confidence: "high",
      });
    } else {
      console.error("[OK] extract no url -> error:", content.slice(0, 100));
    }
  } catch (e) {
    console.error("[OK] extract no url threw:", e.message);
  }

  // Test: max_chars below min (999)
  try {
    const r = await c.callTool({ name: "novada_extract", arguments: { url: "https://example.com", format: "markdown", render: "auto", max_chars: 999 } });
    const content = r.content?.[0]?.text || "";
    if (!content.includes("INVALID_PARAMS") && !content.includes("invalid") && !content.includes("Error")) {
      recordFinding({
        title: "novada_extract: max_chars=999 (below schema min:1000) not rejected",
        severity: "Low",
        category: "mcp-contract",
        component: "novada_extract / ExtractParamsSchema",
        environment: "local",
        repro_steps: `callTool('novada_extract', { url: 'https://example.com', max_chars: 999 })`,
        expected: "INVALID_PARAMS rejection (schema min: 1000)",
        actual: content.slice(0, 200),
        root_cause: "Zod min check not enforced for max_chars",
        suggested_fix: "Enforce min:1000 on max_chars",
        code_location: "src/tools/types.ts: ExtractParamsSchema max_chars",
        evidence: content.slice(0, 200),
        confidence: "medium",
      });
    } else {
      console.error("[OK] extract max_chars=999 -> rejected:", content.slice(0, 100));
    }
  } catch (e) {
    console.error("[OK] extract max_chars=999 threw:", e.message);
  }

  // Test: max_chars above max (100001)
  try {
    const r = await c.callTool({ name: "novada_extract", arguments: { url: "https://example.com", format: "markdown", render: "auto", max_chars: 100001 } });
    const content = r.content?.[0]?.text || "";
    if (!content.includes("INVALID_PARAMS") && !content.includes("invalid") && !content.includes("Error")) {
      recordFinding({
        title: "novada_extract: max_chars=100001 (above schema max:100000) not rejected",
        severity: "Low",
        category: "mcp-contract",
        component: "novada_extract / ExtractParamsSchema",
        environment: "local",
        repro_steps: `callTool('novada_extract', { url: 'https://example.com', max_chars: 100001 })`,
        expected: "INVALID_PARAMS rejection (schema max: 100000)",
        actual: content.slice(0, 200),
        root_cause: "Zod max check not enforced for max_chars",
        suggested_fix: "Enforce max:100000 on max_chars",
        code_location: "src/tools/types.ts: ExtractParamsSchema max_chars",
        evidence: content.slice(0, 200),
        confidence: "medium",
      });
    } else {
      console.error("[OK] extract max_chars=100001 -> rejected:", content.slice(0, 100));
    }
  } catch (e) {
    console.error("[OK] extract max_chars=100001 threw:", e.message);
  }
}

async function testExtractBatchMode(c) {
  recordScenario("extract: batch mode validation");

  // Test: url array with 11 items (above max:10)
  const urls = Array.from({ length: 11 }, (_, i) => `https://example.com/page${i + 1}`);
  try {
    const r = await c.callTool({ name: "novada_extract", arguments: { url: urls, format: "markdown", render: "auto" } });
    const content = r.content?.[0]?.text || "";
    if (!content.includes("INVALID_PARAMS") && !content.includes("10 URL") && !content.includes("Error")) {
      recordFinding({
        title: "novada_extract: batch url array with 11 items (above max:10) not rejected",
        severity: "Medium",
        category: "mcp-contract",
        component: "novada_extract / ExtractParamsSchema",
        environment: "local",
        repro_steps: `callTool('novada_extract', { url: [11 urls], format: 'markdown', render: 'auto' })`,
        expected: "INVALID_PARAMS rejection (max 10 URLs per call)",
        actual: content.slice(0, 300),
        root_cause: "Array length validation may not fire",
        suggested_fix: "Verify z.array(safeUrl).max(10) enforcement in ExtractParamsSchema",
        code_location: "src/tools/types.ts: ExtractParamsSchema url array",
        evidence: content.slice(0, 300),
        confidence: "high",
      });
    } else {
      console.error("[OK] extract 11-url batch -> rejected:", content.slice(0, 150));
    }
  } catch (e) {
    console.error("[OK] extract 11-url batch threw:", e.message);
  }
}

async function testHealthOffline(c) {
  recordScenario("health: offline validation (dummy key)");

  // Test novada_health with dummy key - should still produce a structured response
  try {
    const r = await c.callTool({ name: "novada_health", arguments: {} });
    const content = r.content?.[0]?.text || "";
    if (!content.includes("Health Check") && !content.includes("api_key")) {
      recordFinding({
        title: "novada_health: response missing expected structure (Health Check / api_key header)",
        severity: "Medium",
        category: "mcp-contract",
        component: "novada_health",
        environment: "local",
        repro_steps: `callTool('novada_health', {}) with dummy key`,
        expected: "Markdown table with '## Novada API — Health Check', api_key masked, product rows",
        actual: content.slice(0, 300),
        root_cause: "Health function may not return structured response",
        suggested_fix: "Ensure health always returns structured markdown table",
        code_location: "src/tools/health.ts",
        evidence: content.slice(0, 300),
        confidence: "medium",
      });
    } else {
      console.error("[OK] health offline response:", content.slice(0, 300));
    }

    // Check that api key is masked in response
    if (content.includes("dummy")) {
      recordFinding({
        title: "novada_health: API key value 'dummy' appears unmasked in response",
        severity: "High",
        category: "safety-data-leak",
        component: "novada_health",
        environment: "local",
        repro_steps: `callTool('novada_health', {}) with NOVADA_API_KEY='dummy'`,
        expected: "API key masked: ****mmy or similar",
        actual: content.slice(0, 300),
        root_cause: "maskedKey computation may expose short keys",
        suggested_fix: "Mask fully if key length < 4",
        code_location: "src/tools/health.ts: const maskedKey",
        evidence: content.slice(0, 300),
        confidence: "high",
      });
    } else {
      console.error("[OK] health key properly masked in response");
    }
  } catch (e) {
    recordFinding({
      title: "novada_health: throws exception with dummy key",
      severity: "High",
      category: "functional",
      component: "novada_health",
      environment: "local",
      repro_steps: `callTool('novada_health', {}) with dummy key`,
      expected: "Returns structured health report even with invalid key",
      actual: e.message,
      root_cause: "Exception not caught in health handler",
      suggested_fix: "Wrap health probes in try/catch and always return partial results",
      code_location: "src/tools/health.ts",
      evidence: e.message,
      confidence: "high",
    });
  }
}

async function testMapWithDummyKey(c) {
  recordScenario("map: with dummy key - error should be agent-readable");

  // Map with a real URL but dummy key - offline proxy check, should fail with auth or network error
  try {
    const r = await c.callTool({ name: "novada_map", arguments: { url: "https://example.com", limit: 5, include_subdomains: false, max_depth: 1 } });
    const content = r.content?.[0]?.text || "";
    console.error("[INFO] map with dummy key response:", content.slice(0, 400));

    // Check if response contains an agent-readable error structure
    if (content.includes("Error [") || content.includes("INVALID_API_KEY") || content.includes("## Site Map")) {
      console.error("[OK] map with dummy key returns structured response");
    } else {
      // May work without API key if using static fetch
      console.error("[INFO] map may work without auth for simple HTML pages");
    }

    // If error, check agent_instruction is present
    if (content.includes("Error [") && !content.includes("agent_instruction")) {
      recordFinding({
        title: "novada_map: error response missing agent_instruction field",
        severity: "High",
        category: "mcp-contract",
        component: "novada_map",
        environment: "local",
        repro_steps: `callTool('novada_map', { url: 'https://example.com', ... }) with invalid API key`,
        expected: "Error response includes agent_instruction field",
        actual: content.slice(0, 400),
        root_cause: "Error not formatted as NovadaError with agent_instruction",
        suggested_fix: "Ensure all map errors use makeNovadaError and toAgentString()",
        code_location: "src/tools/map.ts",
        evidence: content.slice(0, 400),
        confidence: "medium",
      });
    }
  } catch (e) {
    console.error("[INFO] map with dummy key threw:", e.message);
  }
}

async function testCrawlWithDummyKey(c) {
  recordScenario("crawl: with dummy key - error format");

  try {
    const r = await c.callTool({ name: "novada_crawl", arguments: {
      url: "https://httpbin.org/html",
      max_pages: 2,
      strategy: "bfs",
      render: "static",
    }});
    const content = r.content?.[0]?.text || "";
    console.error("[INFO] crawl with dummy key response:", content.slice(0, 400));
  } catch (e) {
    console.error("[INFO] crawl with dummy key threw:", e.message);
  }
}

async function testExtractWithDummyKey(c) {
  recordScenario("extract: with dummy key against simple static page");

  // Test extract against a simple static page - may work without API key
  try {
    const r = await c.callTool({ name: "novada_extract", arguments: {
      url: "https://httpbin.org/html",
      format: "markdown",
      render: "static",
    }});
    const content = r.content?.[0]?.text || "";
    console.error("[INFO] extract static page with dummy key:", content.slice(0, 400));

    // Check output quality markers for a successful response
    if (!content.includes("Error [")) {
      // Should have title/content
      if (!content.includes("title:") && !content.includes("# ")) {
        recordFinding({
          title: "novada_extract: successful response missing title field",
          severity: "Medium",
          category: "mcp-contract",
          component: "novada_extract",
          environment: "local",
          repro_steps: `callTool('novada_extract', { url: 'https://httpbin.org/html', format: 'markdown', render: 'static' })`,
          expected: "Response includes 'title:' field in metadata",
          actual: content.slice(0, 400),
          root_cause: "extractSingle may not always emit title",
          suggested_fix: "Always emit title: in metadata block even if empty",
          code_location: "src/tools/extract.ts: extractSingle",
          evidence: content.slice(0, 400),
          confidence: "medium",
        });
      }
    }
  } catch (e) {
    console.error("[INFO] extract static page threw:", e.message);
  }
}

async function testDiscoverTool(c) {
  recordScenario("discover: tool listing and validation");

  try {
    const r = await c.callTool({ name: "novada_discover", arguments: {} });
    const content = r.content?.[0]?.text || "";
    console.error("[INFO] discover response:", content.slice(0, 500));

    // Check discover returns a table with required columns
    if (!content.includes("novada_map") || !content.includes("novada_crawl") || !content.includes("novada_extract")) {
      recordFinding({
        title: "novada_discover: response missing expected tool names (map/crawl/extract)",
        severity: "Medium",
        category: "mcp-contract",
        component: "novada_discover",
        environment: "local",
        repro_steps: `callTool('novada_discover', {})`,
        expected: "Table includes novada_map, novada_crawl, novada_extract entries",
        actual: content.slice(0, 500),
        root_cause: "discover tool may not list all registered tools",
        suggested_fix: "Ensure all tools are included in discover output",
        code_location: "src/tools/discover.ts",
        evidence: content.slice(0, 500),
        confidence: "medium",
      });
    } else {
      console.error("[OK] discover lists map/crawl/extract tools");
    }
  } catch (e) {
    recordFinding({
      title: "novada_discover: throws exception on empty arguments",
      severity: "High",
      category: "functional",
      component: "novada_discover",
      environment: "local",
      repro_steps: `callTool('novada_discover', {})`,
      expected: "Returns tool listing table",
      actual: e.message,
      root_cause: "Exception not handled in discover tool",
      suggested_fix: "Add error handling wrapper in discover tool",
      code_location: "src/tools/discover.ts",
      evidence: e.message,
      confidence: "high",
    });
  }
}

// ============================================================
// LIVE TESTS (1-2 calls max with real key)
// ============================================================

async function testLiveMapAndExtract() {
  recordScenario("LIVE: map -> extract workflow on example.com");

  const liveClient = await makeClient(REAL_KEY);
  try {
    // Step 1: Map a simple site
    console.error("[LIVE] Calling novada_map on example.com...");
    const mapResult = await liveClient.callTool({ name: "novada_map", arguments: {
      url: "https://example.com",
      limit: 10,
      include_subdomains: false,
      max_depth: 1,
    }});
    const mapContent = mapResult.content?.[0]?.text || "";
    console.error("[LIVE] Map result:", mapContent.slice(0, 600));

    // Verify map output structure
    if (!mapContent.includes("Site Map") && !mapContent.includes("urls:") && !mapContent.includes("example.com")) {
      recordFinding({
        title: "novada_map LIVE: response missing expected structure (Site Map header / urls count)",
        severity: "High",
        category: "functional",
        component: "novada_map",
        environment: "local",
        repro_steps: `LIVE callTool('novada_map', { url: 'https://example.com', limit: 10 })`,
        expected: "## Site Map header with url count and discovered URLs",
        actual: mapContent.slice(0, 500),
        root_cause: "Map output format may be broken for simple sites",
        suggested_fix: "Ensure map always returns ## Site Map header",
        code_location: "src/tools/map.ts",
        evidence: mapContent.slice(0, 500),
        confidence: "high",
      });
    }

    // Step 2: Extract with the found URL - verify e2e pipeline
    console.error("[LIVE] Calling novada_extract on example.com...");
    const extractResult = await liveClient.callTool({ name: "novada_extract", arguments: {
      url: "https://example.com",
      format: "markdown",
      render: "auto",
      clean: true,
    }});
    const extractContent = extractResult.content?.[0]?.text || "";
    console.error("[LIVE] Extract result:", extractContent.slice(0, 600));

    // Verify extract contains meaningful content
    if (extractContent.includes("Error [")) {
      recordFinding({
        title: "novada_extract LIVE: extract of example.com returns error",
        severity: "High",
        category: "functional",
        component: "novada_extract",
        environment: "local",
        repro_steps: `LIVE callTool('novada_extract', { url: 'https://example.com', format: 'markdown', render: 'auto' })`,
        expected: "Extracted content from example.com",
        actual: extractContent.slice(0, 400),
        root_cause: "Static page extraction failed for simple domain",
        suggested_fix: "Investigate extract failure for simple static pages",
        code_location: "src/tools/extract.ts",
        evidence: extractContent.slice(0, 400),
        confidence: "high",
      });
    }

    // Check for quality meta
    if (!extractContent.includes("quality:") && !extractContent.includes("title:") && !extractContent.includes("Error [")) {
      recordFinding({
        title: "novada_extract LIVE: response missing quality/title metadata",
        severity: "Medium",
        category: "mcp-contract",
        component: "novada_extract",
        environment: "local",
        repro_steps: `LIVE callTool('novada_extract', { url: 'https://example.com', format: 'markdown' })`,
        expected: "Metadata block with quality: and title: fields",
        actual: extractContent.slice(0, 500),
        root_cause: "extractSingle metadata emission may be incomplete",
        suggested_fix: "Always include quality and title in extraction metadata",
        code_location: "src/tools/extract.ts",
        evidence: extractContent.slice(0, 500),
        confidence: "medium",
      });
    }

  } finally {
    await liveClient.close();
  }
}

async function testLiveHealthCheck() {
  recordScenario("LIVE: health check with real API key");

  const liveClient = await makeClient(REAL_KEY);
  try {
    console.error("[LIVE] Calling novada_health...");
    const r = await liveClient.callTool({ name: "novada_health", arguments: {} });
    const content = r.content?.[0]?.text || "";
    console.error("[LIVE] Health result:", content.slice(0, 800));

    // Check key is masked
    if (content.includes("1f35b477c9e1802778ec64aee2a6adfa")) {
      recordFinding({
        title: "novada_health LIVE: real API key exposed in health output",
        severity: "Urgent",
        category: "safety-data-leak",
        component: "novada_health",
        environment: "local",
        repro_steps: `LIVE callTool('novada_health', {}) with real API key`,
        expected: "API key masked: ****adfa",
        actual: content.slice(0, 500),
        root_cause: "API key masking not applied to full key",
        suggested_fix: "Use ****{last4} masking for API key in health output",
        code_location: "src/tools/health.ts: maskedKey",
        evidence: content.slice(0, 500),
        confidence: "high",
      });
    } else {
      console.error("[OK] API key properly masked in health output");
    }

    // Verify structured response
    if (!content.includes("## Novada API — Health Check") || !content.includes("| Product |")) {
      recordFinding({
        title: "novada_health LIVE: response missing required markdown table structure",
        severity: "Medium",
        category: "mcp-contract",
        component: "novada_health",
        environment: "local",
        repro_steps: `LIVE callTool('novada_health', {})`,
        expected: "## Novada API — Health Check header and | Product | table",
        actual: content.slice(0, 500),
        root_cause: "Health response format changed",
        suggested_fix: "Ensure health output always includes header and product table",
        code_location: "src/tools/health.ts",
        evidence: content.slice(0, 500),
        confidence: "high",
      });
    }

  } finally {
    await liveClient.close();
  }
}

// ============================================================
// ADDITIONAL EDGE CASE TESTS
// ============================================================

async function testMapSearchParam(c) {
  recordScenario("map: search parameter filtering");

  // Test search with empty string - should return all urls or error
  try {
    const r = await c.callTool({ name: "novada_map", arguments: {
      url: "https://example.com",
      search: "",
      limit: 5,
    }});
    const content = r.content?.[0]?.text || "";
    console.error("[INFO] map with empty search:", content.slice(0, 200));
    // Empty search is valid - should return all urls
    console.error("[OK] map with empty search handled");
  } catch (e) {
    console.error("[INFO] map empty search threw:", e.message);
  }

  // Test search with very long query
  const longSearch = "a".repeat(1000);
  try {
    const r = await c.callTool({ name: "novada_map", arguments: {
      url: "https://example.com",
      search: longSearch,
      limit: 5,
    }});
    const content = r.content?.[0]?.text || "";
    console.error("[INFO] map with very long search query:", content.slice(0, 200));
  } catch (e) {
    console.error("[INFO] map long search threw:", e.message);
  }
}

async function testCrawlExcludeSelectInteraction(c) {
  recordScenario("crawl: conflicting select_paths and exclude_paths");

  // Pathological: select /docs/** but exclude /docs/**  - net zero pages
  try {
    const r = await c.callTool({ name: "novada_crawl", arguments: {
      url: "https://httpbin.org",
      max_pages: 2,
      strategy: "bfs",
      render: "static",
      select_paths: ["/docs/**"],
      exclude_paths: ["/docs/**"],
    }});
    const content = r.content?.[0]?.text || "";
    console.error("[INFO] crawl conflicting paths:", content.slice(0, 300));
    // Should succeed but return 0 pages or the root
  } catch (e) {
    console.error("[INFO] crawl conflicting paths threw:", e.message);
  }
}

async function testExtractInvalidRenderMode(c) {
  recordScenario("extract: invalid render enum");

  try {
    const r = await c.callTool({ name: "novada_extract", arguments: {
      url: "https://example.com",
      format: "markdown",
      render: "playwright",  // invalid enum value
    }});
    const content = r.content?.[0]?.text || "";
    if (!content.includes("INVALID_PARAMS") && !content.includes("invalid") && !content.includes("Error")) {
      recordFinding({
        title: "novada_extract: invalid render='playwright' (not in enum) not rejected",
        severity: "Medium",
        category: "mcp-contract",
        component: "novada_extract / ExtractParamsSchema",
        environment: "local",
        repro_steps: `callTool('novada_extract', { url: 'https://example.com', render: 'playwright' })`,
        expected: "INVALID_PARAMS rejection (render must be one of: auto/static/render/js/browser)",
        actual: content.slice(0, 300),
        root_cause: "Zod enum not enforced on render field",
        suggested_fix: "Verify render enum in ExtractParamsSchema",
        code_location: "src/tools/types.ts: ExtractParamsSchema render enum",
        evidence: content.slice(0, 300),
        confidence: "medium",
      });
    } else {
      console.error("[OK] extract invalid render='playwright' -> rejected:", content.slice(0, 100));
    }
  } catch (e) {
    console.error("[OK] extract invalid render threw:", e.message);
  }
}

async function testExtractPrivateIpSSRF(c) {
  recordScenario("extract: SSRF via private/localhost IP");

  // Test extraction of localhost - should be blocked
  const internalUrls = [
    "http://localhost:8080/admin",
    "http://127.0.0.1:22",
    "http://0.0.0.0:3000",
    "http://169.254.169.254/latest/meta-data/",  // AWS metadata
  ];

  for (const url of internalUrls) {
    try {
      const r = await c.callTool({ name: "novada_extract", arguments: {
        url,
        format: "markdown",
        render: "static",
      }});
      const content = r.content?.[0]?.text || "";
      if (!content.includes("INVALID_PARAMS") && !content.includes("Error") && !content.includes("invalid")) {
        recordFinding({
          title: `novada_extract: private/localhost URL not blocked (SSRF risk): ${url}`,
          severity: "Urgent",
          category: "safety-data-leak",
          component: "novada_extract / safeUrl validator",
          environment: "local",
          repro_steps: `callTool('novada_extract', { url: '${url}', format: 'markdown', render: 'static' })`,
          expected: "INVALID_PARAMS rejection — private IP/localhost URLs should be blocked",
          actual: content.slice(0, 400),
          root_cause: "safeUrl validator does not block private IP ranges or localhost",
          suggested_fix: "Add private IP range and localhost blocking to safeUrl validator",
          code_location: "src/tools/types.ts: safeUrl",
          evidence: content.slice(0, 400),
          confidence: "high",
        });
      } else {
        console.error(`[OK] extract blocked private url ${url}:`, content.slice(0, 100));
      }
    } catch (e) {
      console.error(`[OK] extract private url ${url} threw:`, e.message);
    }
  }
}

async function testMapPrivateIpSSRF(c) {
  recordScenario("map: SSRF via private IP range");

  const privateUrls = [
    "http://192.168.1.1/",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://localhost/",
  ];

  for (const url of privateUrls) {
    try {
      const r = await c.callTool({ name: "novada_map", arguments: { url, limit: 1 } });
      const content = r.content?.[0]?.text || "";
      if (!content.includes("INVALID_PARAMS") && !content.includes("Error") && !content.includes("invalid")) {
        recordFinding({
          title: `novada_map: private IP URL not blocked (SSRF risk): ${url}`,
          severity: "Urgent",
          category: "safety-data-leak",
          component: "novada_map / safeUrl validator",
          environment: "local",
          repro_steps: `callTool('novada_map', { url: '${url}', limit: 1 })`,
          expected: "INVALID_PARAMS rejection — private IP/localhost URLs should be blocked",
          actual: content.slice(0, 400),
          root_cause: "safeUrl validator does not block private IP ranges",
          suggested_fix: "Block private IP ranges and localhost in safeUrl validator",
          code_location: "src/tools/types.ts: safeUrl",
          evidence: content.slice(0, 400),
          confidence: "high",
        });
      } else {
        console.error(`[OK] map blocked private url ${url}:`, content.slice(0, 80));
      }
    } catch (e) {
      console.error(`[OK] map private url ${url} threw:`, e.message);
    }
  }
}

async function testMapOutputStructure(c) {
  recordScenario("map: output structure verification with dummy key");

  // Use a public URL to test output structure in network-accessible environment
  // With dummy key, we expect either auth error (INVALID_API_KEY) or a cached/successful response
  try {
    const r = await c.callTool({ name: "novada_map", arguments: {
      url: "https://example.com",
      limit: 3,
      include_subdomains: false,
      max_depth: 1,
    }});
    const content = r.content?.[0]?.text || "";
    console.error("[INFO] map output structure test:", content.slice(0, 500));

    // If successful, check structure
    if (!content.includes("Error [")) {
      // Check for expected format: ## Site Map, root:, urls: count
      const hasHeader = content.includes("## Site Map") || content.includes("Site Map");
      const hasRoot = content.includes("root:");
      const hasCount = content.includes("urls:");

      if (!hasHeader || !hasRoot || !hasCount) {
        recordFinding({
          title: "novada_map: output structure missing required fields (Site Map/root/urls count)",
          severity: "Medium",
          category: "mcp-contract",
          component: "novada_map",
          environment: "local",
          repro_steps: `callTool('novada_map', { url: 'https://example.com', limit: 3 }) - successful response`,
          expected: "## Site Map header, root: <url>, urls:<count> fields",
          actual: content.slice(0, 500),
          root_cause: "Map output format may not emit all required metadata fields",
          suggested_fix: "Always emit root: and urls: fields in map output",
          code_location: "src/tools/map.ts",
          evidence: content.slice(0, 500),
          confidence: "medium",
        });
      }
    }
  } catch (e) {
    console.error("[INFO] map output structure test threw:", e.message);
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.error("=== Novada MCP 0.9.0 QA E2E Site Audit ===");
  console.error(`Started: ${new Date().toISOString()}`);

  // OFFLINE tests with dummy key
  const offlineClient = await makeClient(DUMMY_KEY);
  try {
    await testMapSchemaValidation(offlineClient);
    await testMapInvalidUrl(offlineClient);
    await testMapBoundaryParams(offlineClient);
    await testCrawlSchemaValidation(offlineClient);
    await testCrawlSelectPathsGlob(offlineClient);
    await testExtractSchemaValidation(offlineClient);
    await testExtractBatchMode(offlineClient);
    await testHealthOffline(offlineClient);
    await testMapWithDummyKey(offlineClient);
    await testCrawlWithDummyKey(offlineClient);
    await testExtractWithDummyKey(offlineClient);
    await testDiscoverTool(offlineClient);
    await testMapSearchParam(offlineClient);
    await testCrawlExcludeSelectInteraction(offlineClient);
    await testExtractInvalidRenderMode(offlineClient);
    await testExtractPrivateIpSSRF(offlineClient);
    await testMapPrivateIpSSRF(offlineClient);
    await testMapOutputStructure(offlineClient);
  } finally {
    await offlineClient.close();
  }

  // LIVE tests (limited calls)
  await testLiveMapAndExtract();
  await testLiveHealthCheck();

  // Output summary
  const output = {
    perspective: "Real-world e2e — site audit",
    summary: `Ran ${scenarios.length} scenarios. Found ${findings.length} issues.`,
    scenarios_run: scenarios.length,
    findings,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
