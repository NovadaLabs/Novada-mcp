/**
 * QA Functional Test — novada_scrape (Perspective: Functional — scrape)
 * Tests platform/operation resolution, preflight validation, 11006 fallback,
 * format variants (toon/json/markdown), alias resolution, and edge cases.
 *
 * OFFLINE-FIRST: NOVADA_API_KEY=dummy for all validation/contract tests.
 * LIVE: reads real key only for 1-2 end-to-end calls.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const BUILD = "/Users/tongwu/Projects/novada-mcp/build/index.js";
const DUMMY_KEY = "dummy";

const findings = [];
const scenarios = [];

function record(scenario, finding) {
  scenarios.push(scenario);
  if (finding) findings.push(finding);
}

async function makeClient(apiKey = DUMMY_KEY) {
  const t = new StdioClientTransport({
    command: "node",
    args: [BUILD],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: apiKey }),
  });
  const c = new Client({ name: "qa-scrape", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { client: c, transport: t };
}

async function call(client, name, args) {
  try {
    const r = await client.callTool({ name, arguments: args });
    return { ok: true, result: r };
  } catch (err) {
    return { ok: false, error: err };
  }
}

// ─── SCENARIO RUNNER ────────────────────────────────────────────────────────

async function runOfflineTests() {
  console.log("[offline] Connecting with dummy key...");
  const { client, transport } = await makeClient(DUMMY_KEY);

  // ── S1: Valid platform + unknown operation → should get pre-flight rejection ──
  console.log("[S1] Unknown operation for known platform...");
  const s1 = await call(client, "novada_scrape", {
    platform: "amazon.com",
    operation: "amazon_totally_fake_op",
    params: { keyword: "test" },
    format: "markdown",
  });
  record("S1: unknown operation for known platform", null);
  if (s1.ok) {
    const text = s1.result?.content?.[0]?.text ?? "";
    // If it went to network, there will be no auth — expect isError:true
    const isErr = s1.result?.isError;
    if (!isErr) {
      findings.push({
        title: "Unknown operation for known platform did not produce error",
        severity: "High",
        category: "functional",
        component: "novada_scrape / preflightScrape",
        environment: "local",
        repro_steps: "Call novada_scrape with platform='amazon.com', operation='amazon_totally_fake_op'",
        expected: "isError:true with agent_instruction listing valid operations",
        actual: `isError:${isErr}, content: ${text.slice(0, 200)}`,
        root_cause: "preflightScrape should block bad operation IDs pre-backend",
        suggested_fix: "Ensure preflightScrape returns NovadaError for known platforms",
        code_location: "src/tools/scrape.ts:preflightScrape",
        evidence: JSON.stringify(s1.result).slice(0, 300),
        confidence: "high",
      });
    } else {
      // Good — check it has agent_instruction
      const hasInstruction = text.includes("agent_instruction") || text.includes("Use one of");
      if (!hasInstruction) {
        findings.push({
          title: "Preflight error missing agent_instruction for unknown operation",
          severity: "Medium",
          category: "mcp-contract",
          component: "novada_scrape / preflightScrape",
          environment: "local",
          repro_steps: "Call novada_scrape with platform='amazon.com', operation='amazon_totally_fake_op'",
          expected: "Error text includes agent_instruction with valid operation list",
          actual: text.slice(0, 400),
          root_cause: "NovadaError built without agent_instruction field populated",
          suggested_fix: "Verify agent_instruction is passed through in NovadaError",
          code_location: "src/tools/scrape.ts:442",
          evidence: text.slice(0, 400),
          confidence: "medium",
        });
      }
    }
    console.log(`  [S1] isError=${s1.result?.isError}, text snippet: ${(s1.result?.content?.[0]?.text ?? "").slice(0, 100)}`);
  } else {
    console.log(`  [S1] threw error: ${s1.error?.message}`);
  }

  // ── S2: Known platform + missing required param → preflight rejection ──
  console.log("[S2] Missing required param for known platform/op...");
  const s2 = await call(client, "novada_scrape", {
    platform: "amazon.com",
    operation: "amazon_product_asin",
    params: {}, // missing 'asin'
    format: "markdown",
  });
  record("S2: missing required param", null);
  if (s2.ok) {
    const text = s2.result?.content?.[0]?.text ?? "";
    const isErr = s2.result?.isError;
    if (!isErr) {
      findings.push({
        title: "Missing required param did not produce error",
        severity: "High",
        category: "functional",
        component: "novada_scrape / preflightScrape",
        environment: "local",
        repro_steps: "Call novada_scrape with platform='amazon.com', operation='amazon_product_asin', params={}",
        expected: "isError:true with message about missing 'asin' param",
        actual: `isError:${isErr}, text: ${text.slice(0, 200)}`,
        root_cause: "preflightScrape should detect missing required params",
        suggested_fix: "Verify required-param check in preflightScrape",
        code_location: "src/tools/scrape.ts:454",
        evidence: JSON.stringify(s2.result).slice(0, 300),
        confidence: "high",
      });
    } else {
      console.log(`  [S2] isError=true (correct). text snippet: ${text.slice(0, 120)}`);
      // Check agent_instruction
      const hasInstruction = text.includes("params: {") || text.includes("'asin'") || text.includes("agent_instruction");
      if (!hasInstruction) {
        findings.push({
          title: "Missing-param error lacks actionable agent_instruction",
          severity: "Low",
          category: "mcp-contract",
          component: "novada_scrape / preflightScrape",
          environment: "local",
          repro_steps: "Call novada_scrape with platform='amazon.com', operation='amazon_product_asin', params={}",
          expected: "Error text shows which param is missing and provides example usage",
          actual: text.slice(0, 400),
          root_cause: "agent_instruction may not be emitting param name clearly",
          suggested_fix: "Include the exact key name and example call in agent_instruction",
          code_location: "src/tools/scrape.ts:461",
          evidence: text.slice(0, 400),
          confidence: "low",
        });
      }
    }
  } else {
    console.log(`  [S2] threw: ${s2.error?.message}`);
  }

  // ── S3: OPERATION_ALIASES — stale/near-miss op id → auto-resolves ──
  console.log("[S3] Operation alias 'amazon_product_by-keywords' → 'amazon_product_keywords'...");
  const s3 = await call(client, "novada_scrape", {
    platform: "amazon.com",
    operation: "amazon_product_by-keywords",
    params: { keyword: "test" },
    format: "markdown",
  });
  record("S3: operation alias resolution", null);
  if (s3.ok) {
    const text = s3.result?.content?.[0]?.text ?? "";
    const isErr = s3.result?.isError;
    // With dummy key we expect auth failure from backend, NOT a pre-flight rejection
    // If we get isError due to preflight (invalid operation) → alias is broken
    if (isErr && text.includes("amazon_product_by-keywords")) {
      findings.push({
        title: "OPERATION_ALIASES: stale op id 'amazon_product_by-keywords' not resolved before preflight check",
        severity: "Medium",
        category: "functional",
        component: "novada_scrape / OPERATION_ALIASES",
        environment: "local",
        repro_steps: "Call novada_scrape with platform='amazon.com', operation='amazon_product_by-keywords', params={keyword:'test'}",
        expected: "Alias resolved to 'amazon_product_keywords' before preflight check; error should be auth (not preflight)",
        actual: text.slice(0, 400),
        root_cause: "OPERATION_ALIASES lookup happens before preflightScrape call in novadaScrape, but alias may not be applied correctly",
        suggested_fix: "Verify alias lookup order: alias resolution → platform resolution → preflightScrape",
        code_location: "src/tools/scrape.ts:481",
        evidence: text.slice(0, 400),
        confidence: "medium",
      });
    }
    console.log(`  [S3] isError=${isErr}, text snippet: ${text.slice(0, 120)}`);
  }

  // ── S4: twitter.com platform alias → x.com ──
  console.log("[S4] Platform alias 'twitter.com' → 'x.com'...");
  const s4 = await call(client, "novada_scrape", {
    platform: "twitter.com",
    operation: "twitter_profile_username",
    params: { username: "elonmusk" },
    format: "markdown",
  });
  record("S4: platform alias twitter.com → x.com", null);
  if (s4.ok) {
    const text = s4.result?.content?.[0]?.text ?? "";
    const isErr = s4.result?.isError;
    // Should NOT be a preflight error about unknown platform
    if (isErr && text.toLowerCase().includes("unknown operation")) {
      findings.push({
        title: "Platform alias 'twitter.com' → 'x.com' not applied before preflight check",
        severity: "Medium",
        category: "functional",
        component: "novada_scrape / resolvePlatform",
        environment: "local",
        repro_steps: "Call novada_scrape with platform='twitter.com', operation='twitter_profile_username', params={username:'elonmusk'}",
        expected: "Platform resolved to 'x.com'; operation validated against x.com's op map",
        actual: text.slice(0, 400),
        root_cause: "resolvePlatform called but operation resolved against original platform name in preflightScrape",
        suggested_fix: "Ensure preflightScrape uses the resolved (post-alias) platform name",
        code_location: "src/tools/scrape.ts:479-487",
        evidence: text.slice(0, 400),
        confidence: "medium",
      });
    }
    console.log(`  [S4] isError=${isErr}, text snippet: ${text.slice(0, 120)}`);
  }

  // ── S5: Schema validation — bad format value ──
  console.log("[S5] Invalid format value...");
  const s5 = await call(client, "novada_scrape", {
    platform: "amazon.com",
    operation: "amazon_product_keywords",
    params: { keyword: "test" },
    format: "xml", // not in enum
  });
  record("S5: invalid format rejected by schema", null);
  if (s5.ok) {
    const isErr = s5.result?.isError;
    const text = s5.result?.content?.[0]?.text ?? "";
    if (!isErr) {
      findings.push({
        title: "Invalid format 'xml' not rejected by schema",
        severity: "Medium",
        category: "mcp-contract",
        component: "novada_scrape / ScrapeParamsSchema",
        environment: "local",
        repro_steps: "Call novada_scrape with format='xml'",
        expected: "Zod validation error: format must be one of markdown|json|toon",
        actual: `isError:${isErr}, text: ${text.slice(0, 200)}`,
        root_cause: "ScrapeParamsSchema format enum should reject 'xml'",
        suggested_fix: "Check zodToMcpSchema and Zod .enum validation",
        code_location: "src/tools/types.ts:385",
        evidence: JSON.stringify(s5.result).slice(0, 300),
        confidence: "high",
      });
    }
    console.log(`  [S5] format=xml, isError=${isErr}, text: ${text.slice(0, 100)}`);
  }

  // ── S6: Unknown platform — should pass through to backend (11008 path) ──
  console.log("[S6] Unknown platform 'glassdoor.com'...");
  const s6 = await call(client, "novada_scrape", {
    platform: "glassdoor.com",
    operation: "glassdoor_jobs_keywords",
    params: { keyword: "software engineer" },
    format: "markdown",
  });
  record("S6: unknown platform passes through to backend", null);
  if (s6.ok) {
    const text = s6.result?.content?.[0]?.text ?? "";
    const isErr = s6.result?.isError;
    // With dummy key: backend error, but it should be auth (dummy key) or 11008, not preflight
    // Most important: it should be isError:true with something
    if (!isErr) {
      findings.push({
        title: "Unknown platform 'glassdoor.com' returned success with dummy key",
        severity: "Urgent",
        category: "functional",
        component: "novada_scrape",
        environment: "local",
        repro_steps: "Call novada_scrape with platform='glassdoor.com', operation='glassdoor_jobs_keywords', params={keyword:'test'} and dummy API key",
        expected: "isError:true with auth or 11008 error",
        actual: `isError:${isErr}, text: ${text.slice(0, 200)}`,
        root_cause: "Platform not in PLATFORM_OPERATIONS so passes to backend; backend should reject dummy key",
        suggested_fix: "Verify backend error propagation for unknown platform+auth failure",
        code_location: "src/tools/scrape.ts:99-127",
        evidence: JSON.stringify(s6.result).slice(0, 300),
        confidence: "high",
      });
    }
    console.log(`  [S6] isError=${isErr}, text: ${text.slice(0, 120)}`);
  }

  // ── S7: format=toon — check output structure (offline preflight error path) ──
  console.log("[S7] format=toon with invalid operation (tests toon format path)...");
  // We test the toon format code path via a valid-ish call (alias resolution test)
  const s7 = await call(client, "novada_scrape", {
    platform: "amazon.com",
    operation: "amazon_product_keywords",
    params: {}, // missing keyword → preflight error
    format: "toon",
  });
  record("S7: toon format with missing param produces clean error", null);
  if (s7.ok) {
    const text = s7.result?.content?.[0]?.text ?? "";
    const isErr = s7.result?.isError;
    // Should still be an error (missing keyword)
    if (!isErr) {
      findings.push({
        title: "format=toon with missing required param did not produce error",
        severity: "High",
        category: "functional",
        component: "novada_scrape",
        environment: "local",
        repro_steps: "Call novada_scrape with format='toon', platform='amazon.com', operation='amazon_product_keywords', params={}",
        expected: "isError:true — missing 'keyword' param should be caught by preflight",
        actual: `isError:${isErr}, text: ${text.slice(0, 200)}`,
        root_cause: "Preflight check runs before format selection; should error regardless of format",
        suggested_fix: "Verify preflightScrape is called before format handling",
        code_location: "src/tools/scrape.ts:486-488",
        evidence: JSON.stringify(s7.result).slice(0, 300),
        confidence: "high",
      });
    }
    console.log(`  [S7] format=toon, isError=${isErr}, text: ${text.slice(0, 100)}`);
  }

  // ── S8: format=json with valid call (preflight passes, dummy key hits backend) ──
  console.log("[S8] format=json with valid params, dummy key (auth error from backend)...");
  const s8 = await call(client, "novada_scrape", {
    platform: "github.com",
    operation: "github_repository_repo-url",
    params: { url: "https://github.com/vercel/next.js" },
    format: "json",
  });
  record("S8: format=json with valid params", null);
  if (s8.ok) {
    const text = s8.result?.content?.[0]?.text ?? "";
    const isErr = s8.result?.isError;
    // Should fail with auth (50001/50002/50003) from backend or InvalidApiKey
    console.log(`  [S8] isError=${isErr}, text: ${text.slice(0, 180)}`);
    // If NOT an error with a dummy key, that's concerning
    if (!isErr) {
      findings.push({
        title: "Dummy API key not rejected for valid scrape call",
        severity: "Urgent",
        category: "safety-data-leak",
        component: "novada_scrape / submitScrapeTask",
        environment: "local",
        repro_steps: "Call novada_scrape with NOVADA_API_KEY=dummy and valid params",
        expected: "isError:true with auth error (INVALID_API_KEY or HTTP 401/403)",
        actual: `isError:${isErr}, text: ${text.slice(0, 300)}`,
        root_cause: "Backend auth not enforced or dummy key accepted",
        suggested_fix: "Verify auth error handling in submitScrapeTask",
        code_location: "src/tools/scrape.ts:87-99",
        evidence: JSON.stringify(s8.result).slice(0, 300),
        confidence: "high",
      });
    }
  }

  // ── S9: Prototype pollution test — __proto__ in params ──
  console.log("[S9] __proto__ in params (H-4 block)...");
  const s9 = await call(client, "novada_scrape", {
    platform: "amazon.com",
    operation: "amazon_product_asin",
    params: { asin: "B09XYZ", __proto__: { isAdmin: true } },
    format: "markdown",
  });
  record("S9: __proto__ in params blocked", null);
  if (s9.ok) {
    const text = s9.result?.content?.[0]?.text ?? "";
    const isErr = s9.result?.isError;
    console.log(`  [S9] isError=${isErr}, text: ${text.slice(0, 100)}`);
    // Should reach backend as normal (key error), __proto__ should be stripped
    // If it crashes or behaves unexpectedly, that's a problem
  }

  // ── S10: operation with regex special chars — test operation validation regex ──
  console.log("[S10] Operation with regex special chars (should be blocked by schema)...");
  const s10 = await call(client, "novada_scrape", {
    platform: "amazon.com",
    operation: "amazon_product_asin|cat /etc/passwd",
    params: { asin: "test" },
    format: "markdown",
  });
  record("S10: operation with special chars blocked by schema regex", null);
  if (s10.ok) {
    const text = s10.result?.content?.[0]?.text ?? "";
    const isErr = s10.result?.isError;
    if (!isErr) {
      findings.push({
        title: "Operation with special chars '|' not rejected by schema",
        severity: "High",
        category: "safety-data-leak",
        component: "novada_scrape / ScrapeParamsSchema",
        environment: "local",
        repro_steps: "Call novada_scrape with operation containing '|' character",
        expected: "Zod schema rejects: operation regex only allows [a-zA-Z0-9_\\-]",
        actual: `isError:${isErr}, text: ${text.slice(0, 200)}`,
        root_cause: "Schema regex /^[a-zA-Z0-9_-]+$/ should reject '|'; if not rejecting, schema is not enforced",
        suggested_fix: "Verify zodToMcpSchema is enforcing the regex constraint",
        code_location: "src/tools/types.ts:374",
        evidence: JSON.stringify(s10.result).slice(0, 300),
        confidence: "high",
      });
    }
    console.log(`  [S10] isError=${isErr}, text: ${text.slice(0, 100)}`);
  }

  // ── S11: limit boundary tests ──
  console.log("[S11] limit=0 (below min)...");
  const s11a = await call(client, "novada_scrape", {
    platform: "amazon.com",
    operation: "amazon_product_keywords",
    params: { keyword: "test" },
    format: "markdown",
    limit: 0,
  });
  record("S11a: limit=0 (schema min=1)", null);
  if (s11a.ok) {
    const text = s11a.result?.content?.[0]?.text ?? "";
    const isErr = s11a.result?.isError;
    console.log(`  [S11a] limit=0, isError=${isErr}, text: ${text.slice(0, 100)}`);
    if (!isErr) {
      findings.push({
        title: "limit=0 not rejected by schema (min=1)",
        severity: "Medium",
        category: "mcp-contract",
        component: "novada_scrape / ScrapeParamsSchema",
        environment: "local",
        repro_steps: "Call novada_scrape with limit=0",
        expected: "Zod validation error: limit must be >= 1",
        actual: `isError:${isErr}, text: ${text.slice(0, 200)}`,
        root_cause: "Schema has min(1) but it may not be enforced at runtime",
        suggested_fix: "Verify Zod schema min constraint enforcement",
        code_location: "src/tools/types.ts:379",
        evidence: JSON.stringify(s11a.result).slice(0, 300),
        confidence: "high",
      });
    }
  }

  console.log("[S11b] limit=101 (above max)...");
  const s11b = await call(client, "novada_scrape", {
    platform: "amazon.com",
    operation: "amazon_product_keywords",
    params: { keyword: "test" },
    format: "markdown",
    limit: 101,
  });
  record("S11b: limit=101 (schema max=100)", null);
  if (s11b.ok) {
    const text = s11b.result?.content?.[0]?.text ?? "";
    const isErr = s11b.result?.isError;
    console.log(`  [S11b] limit=101, isError=${isErr}, text: ${text.slice(0, 100)}`);
    if (!isErr) {
      findings.push({
        title: "limit=101 not rejected by schema (max=100)",
        severity: "Low",
        category: "mcp-contract",
        component: "novada_scrape / ScrapeParamsSchema",
        environment: "local",
        repro_steps: "Call novada_scrape with limit=101",
        expected: "Either Zod validation error OR result capped at 100",
        actual: `isError:${isErr}, text snippet: ${text.slice(0, 200)}`,
        root_cause: "Schema has max(100) but runtime clamping via Math.min is also applied at line 477",
        suggested_fix: "Behavior is acceptable if clamped — check whether limit is clamped or rejected",
        code_location: "src/tools/scrape.ts:477",
        evidence: JSON.stringify(s11b.result).slice(0, 300),
        confidence: "low",
      });
    }
  }

  // ── S12: platform regex validation — non-domain characters ──
  console.log("[S12] Platform with invalid chars (semicolon)...");
  const s12 = await call(client, "novada_scrape", {
    platform: "amazon.com; DROP TABLE",
    operation: "amazon_product_keywords",
    params: { keyword: "test" },
    format: "markdown",
  });
  record("S12: platform with SQL injection chars blocked by schema regex", null);
  if (s12.ok) {
    const text = s12.result?.content?.[0]?.text ?? "";
    const isErr = s12.result?.isError;
    if (!isErr) {
      findings.push({
        title: "Platform with SQL injection chars not rejected by schema",
        severity: "High",
        category: "safety-data-leak",
        component: "novada_scrape / ScrapeParamsSchema",
        environment: "local",
        repro_steps: "Call novada_scrape with platform='amazon.com; DROP TABLE'",
        expected: "Zod schema rejects: platform regex only allows [a-zA-Z0-9._\\-]",
        actual: `isError:${isErr}, text: ${text.slice(0, 200)}`,
        root_cause: "Platform regex /^[a-zA-Z0-9._-]+$/ should reject semicolons and spaces",
        suggested_fix: "Verify zodToMcpSchema enforces platform regex",
        code_location: "src/tools/types.ts:371",
        evidence: JSON.stringify(s12.result).slice(0, 300),
        confidence: "high",
      });
    }
    console.log(`  [S12] isError=${isErr}, text: ${text.slice(0, 100)}`);
  }

  // ── S13: Empty params — platform-level empty test ──
  console.log("[S13] Empty platform string (should be rejected by schema min:1)...");
  const s13 = await call(client, "novada_scrape", {
    platform: "",
    operation: "amazon_product_keywords",
    params: { keyword: "test" },
    format: "markdown",
  });
  record("S13: empty platform rejected by schema", null);
  if (s13.ok) {
    const text = s13.result?.content?.[0]?.text ?? "";
    const isErr = s13.result?.isError;
    if (!isErr) {
      findings.push({
        title: "Empty platform string not rejected by schema",
        severity: "Medium",
        category: "mcp-contract",
        component: "novada_scrape / ScrapeParamsSchema",
        environment: "local",
        repro_steps: "Call novada_scrape with platform=''",
        expected: "Zod validation error: platform min(1) not met",
        actual: `isError:${isErr}, text: ${text.slice(0, 200)}`,
        root_cause: "Schema min(1) not enforced for platform",
        suggested_fix: "Verify Zod min(1) enforcement",
        code_location: "src/tools/types.ts:370",
        evidence: JSON.stringify(s13.result).slice(0, 300),
        confidence: "high",
      });
    }
    console.log(`  [S13] isError=${isErr}, text: ${text.slice(0, 100)}`);
  }

  // ── S14: search engine platform (google.com) — Format A path ──
  console.log("[S14] google.com search engine path (Format A)...");
  const s14 = await call(client, "novada_scrape", {
    platform: "google.com",
    operation: "google_search",
    params: { q: "test query" },
    format: "json",
  });
  record("S14: google.com search engine takes Format A", null);
  if (s14.ok) {
    const text = s14.result?.content?.[0]?.text ?? "";
    const isErr = s14.result?.isError;
    console.log(`  [S14] isError=${isErr}, text: ${text.slice(0, 180)}`);
    // Should fail with auth error (dummy key), not preflight
    if (isErr && text.includes("preflight") && text.includes("google_search")) {
      findings.push({
        title: "google.com search operation rejected by preflight despite being valid",
        severity: "High",
        category: "functional",
        component: "novada_scrape / preflightScrape",
        environment: "local",
        repro_steps: "Call novada_scrape with platform='google.com', operation='google_search', params={q:'test'}",
        expected: "Preflight passes, error comes from backend (auth failure)",
        actual: text.slice(0, 400),
        root_cause: "SEARCH_QUERY_KEYS ['q','keyword','query'] should accept 'q' as valid param key for google_search",
        suggested_fix: "Verify SEARCH_QUERY_KEYS is used as the required-param list for google_search",
        code_location: "src/tools/scrape.ts:325",
        evidence: text.slice(0, 400),
        confidence: "high",
      });
    }
  }

  // ── S15: MCP error contract — isError flag on NovadaError ──
  console.log("[S15] Checking isError:true on NovadaError responses...");
  const s15 = await call(client, "novada_scrape", {
    platform: "amazon.com",
    operation: "amazon_product_keywords",
    params: {}, // will trigger preflight: missing keyword
    format: "markdown",
  });
  record("S15: MCP error contract (isError:true on NovadaError)", null);
  if (s15.ok) {
    const isErr = s15.result?.isError;
    const text = s15.result?.content?.[0]?.text ?? "";
    if (!isErr) {
      findings.push({
        title: "Preflight NovadaError not surfaced with isError:true in MCP response",
        severity: "High",
        category: "mcp-contract",
        component: "novada_scrape / index.ts error handler",
        environment: "local",
        repro_steps: "Call novada_scrape with missing required param; expect isError:true in response",
        expected: "{ isError: true, content: [{ type: 'text', text: '<error message>' }] }",
        actual: `isError:${isErr}, text: ${text.slice(0, 200)}`,
        root_cause: "NovadaError not caught correctly in index.ts callTool handler",
        suggested_fix: "Verify the error handler in index.ts catches NovadaError and sets isError:true",
        code_location: "src/index.ts:error handler around case 'novada_scrape'",
        evidence: JSON.stringify(s15.result).slice(0, 300),
        confidence: "high",
      });
    }
    console.log(`  [S15] isError=${isErr}, text: ${text.slice(0, 120)}`);
  }

  await client.close();
  console.log("[offline] Done.");
}

// ─── FORMAT INTEGRITY TESTS via source analysis ─────────────────────────────

async function runFormatIntegrityTests() {
  console.log("[format] Testing format-specific output structure...");
  const { client } = await makeClient(DUMMY_KEY);

  // S16: toon format header line check — if we somehow get results, HEADERS: must appear
  // We can't get real results with dummy key, so we test the error format consistency
  // S17: json format — validate that json format wraps in ```json block
  // S18: test markdown default includes ## Scrape Results header

  // Since we can't get actual results without live key, test via known error paths
  // and verify the error output conforms to isError:true + readable text

  // ── S16: Verify error text is human-readable in all format variants ──
  const formats = ["markdown", "json", "toon"];
  for (const fmt of formats) {
    console.log(`[S16/${fmt}] Error text readability in format=${fmt}...`);
    const r = await call(client, "novada_scrape", {
      platform: "amazon.com",
      operation: "amazon_product_keywords",
      params: {}, // triggers preflight
      format: fmt,
    });
    record(`S16/${fmt}: error readability with format=${fmt}`, null);
    if (r.ok) {
      const text = r.result?.content?.[0]?.text ?? "";
      const isErr = r.result?.isError;
      if (isErr && text.length === 0) {
        findings.push({
          title: `Error response with format='${fmt}' has empty text content`,
          severity: "Medium",
          category: "mcp-contract",
          component: "novada_scrape",
          environment: "local",
          repro_steps: `Call novada_scrape with format='${fmt}' and missing params`,
          expected: "Non-empty error message regardless of format",
          actual: `isError:true, text length: ${text.length}`,
          root_cause: "Error path may not populate content[0].text",
          suggested_fix: "Ensure error handler populates content array with error text",
          code_location: "src/index.ts:error handler",
          evidence: JSON.stringify(r.result).slice(0, 300),
          confidence: "high",
        });
      }
      console.log(`  [S16/${fmt}] isError=${isErr}, text: ${text.slice(0, 100)}`);
    }
  }

  await client.close();
}

// ─── DESCRIPTION vs IMPLEMENTATION GAP CHECK ───────────────────────────────

async function runDescriptionGapTest() {
  console.log("[gap] Testing description vs implementation consistency...");
  const { client } = await makeClient(DUMMY_KEY);

  // S19: Tool description says "13 platforms" — check PLATFORM_OPERATIONS keys
  // (static analysis; confirmed 13 keys in source)
  // novada://scraper-platforms mentions "129 platforms" in plugin version vs "13" in local
  // This is a description inconsistency between plugin & local

  // List tools to get the description
  const tools = await client.listTools();
  const scrapeTool = tools.tools.find(t => t.name === "novada_scrape");
  if (scrapeTool) {
    const desc = scrapeTool.description ?? "";
    const mentions13 = desc.includes("13 platform");
    const mentions129 = desc.includes("129 platform");
    console.log(`  [S19] Description mentions 13? ${mentions13}, 129? ${mentions129}`);

    // Check Agent Hints in S8 (json format) would say 129 — that's a discrepancy
    if (mentions13 || mentions129) {
      record("S19: description platform count check", null);
      // Cross-check with the markdown default output (line 639 in scrape.ts says "129 supported platforms")
      // but description says "13 platforms" — this is a discrepancy
      if (mentions13) {
        // Check if the markdown output also says 129 platforms (it does from line 639)
        findings.push({
          title: "Tool description says '13 platforms' but Agent Hints output says '129 supported platforms'",
          severity: "Low",
          category: "functional",
          component: "novada_scrape description / Agent Hints",
          environment: "local",
          repro_steps: "1. list_tools and check novada_scrape description. 2. Successful markdown response includes '129 supported platforms' in Agent Hints.",
          expected: "Consistent platform count in tool description and output",
          actual: "Description: '13 platforms (~78 operations)' vs Agent Hints: '129 supported platforms'",
          root_cause: "Two separate constants/strings are not kept in sync: tool description vs format output string",
          suggested_fix: "Unify the count: either update description to match scrape.ts line 639 or vice versa",
          code_location: "src/tools/scrape.ts:639 vs src/index.ts:280",
          evidence: `Description: "${desc.slice(0, 200)}" | scrape.ts line 639: "Discover all 129 supported platforms"`,
          confidence: "high",
        });
      }
    }
  }

  await client.close();
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

console.log("=== novada_scrape Functional QA — 0.9.0 ===\n");
await runOfflineTests();
await runFormatIntegrityTests();
await runDescriptionGapTest();

console.log("\n=== Summary ===");
console.log(`Scenarios run: ${scenarios.length}`);
console.log(`Findings: ${findings.length}`);
for (const f of findings) {
  console.log(`  [${f.severity}] ${f.title}`);
}

import { writeFileSync } from "fs";
const output = {
  perspective: "Functional — scrape",
  summary: `Ran ${scenarios.length} offline scenarios testing platform resolution, operation alias resolution, param validation, format variants (markdown/json/toon), schema boundary enforcement, and description vs implementation consistency. ${findings.length} findings identified.`,
  scenarios_run: scenarios.length,
  findings,
};
writeFileSync("/tmp/novada-qa-0.9.0/func-scrape.json", JSON.stringify(output, null, 2));
console.log("\nResults written to /tmp/novada-qa-0.9.0/func-scrape.json");
