/**
 * Deep QA for novada_scrape — additional scenarios focused on:
 * 1. Operation alias pre/post preflight ordering
 * 2. 11006 error path and agent_instruction content
 * 3. toon format structure (HEADERS: line)
 * 4. json format structure (```json block)
 * 5. Limit clamping vs rejection
 * 6. Error message quality for 11006 fallback
 * 7. PLATFORM_OPERATIONS coverage vs description
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "fs";
import { writeFileSync } from "fs";

const BUILD = "/Users/tongwu/Projects/novada-mcp/build/index.js";
const DUMMY_KEY = "dummy";

const findings = [];
const scenarios = [];

function record(scenario) {
  scenarios.push(scenario);
}

async function makeClient(apiKey = DUMMY_KEY) {
  const t = new StdioClientTransport({
    command: "node",
    args: [BUILD],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: apiKey }),
  });
  const c = new Client({ name: "qa-scrape-deep", version: "0" }, { capabilities: {} });
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

// ── DEEP TEST 1: Alias is applied BEFORE preflight check ──────────────────
// The code at scrape.ts:481-483 applies alias lookup BEFORE calling preflightScrape.
// But preflightScrape is called with the RESOLVED operation AND resolved platform.
// Let's verify: if the alias resolves to a valid op for a known platform, the preflight
// should not reject it as "unknown operation".
async function testAliasOrderingVsPreflight() {
  const { client } = await makeClient(DUMMY_KEY);
  record("DA1: alias-before-preflight ordering");

  console.log("[DA1] Alias 'google_shopping' → 'google_shopping_keywords' before preflight...");
  const r = await call(client, "novada_scrape", {
    platform: "google.com",
    operation: "google_shopping",  // alias
    params: { keyword: "headphones" },
    format: "markdown",
  });
  if (r.ok) {
    const text = r.result?.content?.[0]?.text ?? "";
    const isErr = r.result?.isError;
    // Should NOT be a preflight error about "unknown operation"
    const isPreflight = text.includes("Unknown operation") && text.includes("google_shopping");
    console.log(`  [DA1] isError=${isErr}, isPreflight=${isPreflight}, text: ${text.slice(0, 150)}`);
    if (isErr && isPreflight) {
      findings.push({
        title: "Alias 'google_shopping' not resolved before preflightScrape — triggers 'Unknown operation' error",
        severity: "Medium",
        category: "functional",
        component: "novada_scrape / alias resolution order",
        environment: "local",
        repro_steps: "Call novada_scrape with platform='google.com', operation='google_shopping', params={keyword:'test'}",
        expected: "Alias resolved to 'google_shopping_keywords', preflight passes (error from backend auth, not preflight)",
        actual: text.slice(0, 400),
        root_cause: "In novadaScrape, alias is resolved at line 482 but may not be passed to preflightScrape correctly. Need to verify the `operation` variable used in preflightScrape call.",
        suggested_fix: "Verify preflightScrape is called with `operation` (post-alias) not `params.operation` (pre-alias)",
        code_location: "src/tools/scrape.ts:481-488",
        evidence: text.slice(0, 400),
        confidence: "high",
      });
    }
  }
  await client.close();
}

// ── DEEP TEST 2: 11006 error path content ────────────────────────────────
// PLATFORM_OPERATIONS has no reddit.com, so a call to reddit.com would fail with 11006
// from backend (after dummy key auth failure). With dummy key, actually gets ip-blocked first.
// We can't fully test 11006 path offline. But we can test the preflightScrape path for
// a known platform with an invalid operation to check the agent_instruction format.
async function test11006FallbackMessage() {
  const { client } = await makeClient(DUMMY_KEY);
  record("DA2: preflight error agent_instruction format check");

  console.log("[DA2] Check agent_instruction includes valid operation list...");
  const r = await call(client, "novada_scrape", {
    platform: "amazon.com",
    operation: "nonexistent_amazon_op",
    params: { keyword: "test" },
    format: "markdown",
  });
  if (r.ok) {
    const text = r.result?.content?.[0]?.text ?? "";
    const isErr = r.result?.isError;
    console.log(`  [DA2] isError=${isErr}, text: ${text.slice(0, 300)}`);
    // Check agent_instruction has valid ops
    const hasOpList = text.includes("amazon_product_asin") || text.includes("amazon_product_keywords");
    const hasRetryAdvice = text.includes("Do not retry") || text.includes("do not retry");
    if (isErr && !hasOpList) {
      findings.push({
        title: "Preflight error for unknown amazon op does not list valid operations in error text",
        severity: "Medium",
        category: "mcp-contract",
        component: "novada_scrape / preflightScrape",
        environment: "local",
        repro_steps: "Call novada_scrape with platform='amazon.com', operation='nonexistent_amazon_op'",
        expected: "Error text includes agent_instruction with list of valid amazon.com operations (e.g. 'amazon_product_asin, amazon_product_keywords')",
        actual: text.slice(0, 400),
        root_cause: "agent_instruction field may be constructed but not included in output text",
        suggested_fix: "Verify NovadaError agent_instruction is surfaced via classifyError/formatError in the output",
        code_location: "src/tools/scrape.ts:442-450",
        evidence: text.slice(0, 400),
        confidence: "medium",
      });
    }
    // The error text should NOT say "Do not retry with the same operation id" for preflight errors
    // (that message is for 11006 backend errors) — unless it's appropriate here too
    if (isErr && !hasRetryAdvice) {
      console.log(`  [DA2] Note: no retry-avoidance instruction found`);
    }
  }
  await client.close();
}

// ── DEEP TEST 3: PLATFORM_OPERATIONS covers only 13 — what about reddit.com? ──
// Tool description says "Amazon, Reddit, TikTok, LinkedIn" but reddit.com is NOT in
// PLATFORM_OPERATIONS. So calling with reddit.com would skip preflight (unknown platform)
// and go to backend. Let's verify that's true.
async function testRedditNotInPlatformMap() {
  const { client } = await makeClient(DUMMY_KEY);
  record("DA3: reddit.com not in PLATFORM_OPERATIONS — passes to backend");

  console.log("[DA3] reddit.com not in PLATFORM_OPERATIONS but mentioned in description...");
  const r = await call(client, "novada_scrape", {
    platform: "reddit.com",
    operation: "reddit_posts_url",
    params: { url: "https://www.reddit.com/r/programming/" },
    format: "markdown",
  });
  if (r.ok) {
    const text = r.result?.content?.[0]?.text ?? "";
    const isErr = r.result?.isError;
    console.log(`  [DA3] isError=${isErr}, text: ${text.slice(0, 200)}`);
    // This is fine — passes to backend. But note description says "Reddit" is supported
    // yet it's not in the PLATFORM_OPERATIONS preflight map (only 13 are)
    // This creates misleading preflight behavior: reddit.com gets no preflight validation
    // so a wrong operation would hang ~14s before getting rejected
    if (isErr) {
      const isPreflight = text.includes("preflight") || text.includes("Unknown operation");
      if (!isPreflight) {
        // Good — correctly passed to backend (not falsely rejected by preflight)
        console.log(`  [DA3] Correctly skipped preflight for reddit.com (falls to backend)`);
      }
    }
  }
  await client.close();
}

// ── DEEP TEST 4: Limit clamping behavior ─────────────────────────────────
// Schema has max(100), but novadaScrape also does Math.max(1, Math.min(params.limit ?? 20, 100))
// at line 477. So limit=200 should be clamped to 100 by schema validation before reaching runtime.
async function testLimitClampingBehavior() {
  const { client } = await makeClient(DUMMY_KEY);
  record("DA4: limit boundary behavior (clamp vs schema rejection)");

  // limit=200 — should be rejected by schema (max=100)
  console.log("[DA4a] limit=200 (schema max=100)...");
  const r200 = await call(client, "novada_scrape", {
    platform: "amazon.com",
    operation: "amazon_product_keywords",
    params: { keyword: "test" },
    format: "markdown",
    limit: 200,
  });
  if (r200.ok) {
    const text = r200.result?.content?.[0]?.text ?? "";
    const isErr = r200.result?.isError;
    console.log(`  [DA4a] limit=200, isError=${isErr}, text: ${text.slice(0, 100)}`);
    if (!isErr) {
      findings.push({
        title: "limit=200 not rejected by schema (max=100)",
        severity: "Low",
        category: "mcp-contract",
        component: "novada_scrape / ScrapeParamsSchema",
        environment: "local",
        repro_steps: "Call novada_scrape with limit=200",
        expected: "Zod validation error or clamped to 100 with schema error",
        actual: `isError:${isErr}, text: ${text.slice(0, 200)}`,
        root_cause: "Schema max(100) should reject, but runtime Math.min clamping may mask the rejection",
        suggested_fix: "Accept if result is clamped at 100 without error — check whether the 200 limit is clamped silently",
        code_location: "src/tools/scrape.ts:477",
        evidence: JSON.stringify(r200.result).slice(0, 300),
        confidence: "medium",
      });
    }
  }

  await client.close();
}

// ── DEEP TEST 5: params injection — null-byte in keyword ─────────────────
async function testParamsNullByte() {
  const { client } = await makeClient(DUMMY_KEY);
  record("DA5: null byte in params value");

  console.log("[DA5] Null byte in params.keyword...");
  const r = await call(client, "novada_scrape", {
    platform: "amazon.com",
    operation: "amazon_product_keywords",
    params: { keyword: "test\x00injection" },
    format: "markdown",
  });
  if (r.ok) {
    const text = r.result?.content?.[0]?.text ?? "";
    const isErr = r.result?.isError;
    console.log(`  [DA5] isError=${isErr}, text: ${text.slice(0, 120)}`);
    // Should either sanitize or pass through (the null byte is in the search keyword,
    // not a path parameter — lower risk but still worth noting if it crashes)
    // No crash expected but if the backend returns something weird, flag it
  }
  await client.close();
}

// ── DEEP TEST 6: Description inconsistency — 13 vs 129 in agent hints ────
// This is documented in main test. Let's verify the exact line in the agent hints
// that says 129.
async function verifyDescriptionVsAgentHints() {
  // Static source analysis
  record("DA6: description vs agent hints platform count");
  const srcPath = "/Users/tongwu/Projects/novada-mcp/src/tools/scrape.ts";
  const src = readFileSync(srcPath, "utf8");
  const line639Match = src.match(/Discover all (\d+) supported platforms/);
  const countInSrc = line639Match ? line639Match[1] : "NOT FOUND";
  console.log(`[DA6] scrape.ts agent hints says: "Discover all ${countInSrc} supported platforms"`);

  // Count actual platforms in PLATFORM_OPERATIONS
  const platformMatches = src.match(/"[a-z]+\.[a-z]+":\s*freezeOpMap\(/g) ?? [];
  console.log(`[DA6] Actual PLATFORM_OPERATIONS entries: ${platformMatches.length}`);
  console.log(`[DA6] Platforms: ${platformMatches.join(", ")}`);

  if (countInSrc !== "13" && platformMatches.length === 13) {
    findings.push({
      title: `Agent Hints says "${countInSrc} supported platforms" but PLATFORM_OPERATIONS has 13 active entries`,
      severity: "Low",
      category: "functional",
      component: "novada_scrape / Agent Hints output",
      environment: "local",
      repro_steps: "Static: read scrape.ts line containing 'Discover all N supported platforms'; count PLATFORM_OPERATIONS keys",
      expected: "Consistent platform count",
      actual: `Agent Hints: "Discover all ${countInSrc} supported platforms", PLATFORM_OPERATIONS: ${platformMatches.length} entries`,
      root_cause: "The '129 supported platforms' count in Agent Hints refers to the total Novada scraper platform catalog (including platforms without local preflight validation), while the tool description says '13 platforms' (those with pre-flight validation). Neither is wrong but they're confusingly inconsistent.",
      suggested_fix: "Either clarify that '13' are the platforms with preflight validation and '129' is the total backend catalog, or unify the messaging in both description and agent hints",
      code_location: "src/tools/scrape.ts:639 vs src/index.ts:280",
      evidence: `scrape.ts: "Discover all ${countInSrc} supported platforms" | PLATFORM_OPERATIONS: ${platformMatches.length} entries | description: '13 platforms (~78 operations)'`,
      confidence: "high",
    });
  }

  // Check if "Reddit" is in description but not in PLATFORM_OPERATIONS
  const indexSrc = readFileSync("/Users/tongwu/Projects/novada-mcp/src/index.ts", "utf8");
  const descMatch = indexSrc.match(/name: "novada_scrape"[\s\S]{0,500}description: `([\s\S]{0,600})`/);
  if (descMatch) {
    const desc = descMatch[1];
    const mentionsReddit = desc.includes("Reddit");
    const mentionsZillow = desc.includes("Zillow");
    const mentionsGlassdoor = desc.includes("Glassdoor");
    const mentionsAirbnb = desc.includes("Airbnb");
    console.log(`[DA6] Description mentions Reddit: ${mentionsReddit}, Zillow: ${mentionsZillow}, Glassdoor: ${mentionsGlassdoor}, Airbnb: ${mentionsAirbnb}`);

    const missingFromPlatformOps = [];
    if (mentionsReddit && !src.includes('"reddit.com"')) missingFromPlatformOps.push("reddit.com");
    if (mentionsZillow && !src.includes('"zillow.com"')) missingFromPlatformOps.push("zillow.com");
    if (mentionsGlassdoor && !src.includes('"glassdoor.com"')) missingFromPlatformOps.push("glassdoor.com");
    if (mentionsAirbnb && !src.includes('"airbnb.com"')) missingFromPlatformOps.push("airbnb.com");

    if (missingFromPlatformOps.length > 0) {
      findings.push({
        title: `Tool description mentions platforms not in PLATFORM_OPERATIONS: ${missingFromPlatformOps.join(", ")}`,
        severity: "Medium",
        category: "functional",
        component: "novada_scrape description vs PLATFORM_OPERATIONS",
        environment: "local",
        repro_steps: "Read novada_scrape description and compare mentioned platforms against PLATFORM_OPERATIONS map in scrape.ts",
        expected: "All platforms mentioned in description have preflight validation in PLATFORM_OPERATIONS",
        actual: `Missing from PLATFORM_OPERATIONS: ${missingFromPlatformOps.join(", ")}. These platforms skip preflight validation, so invalid operations hang ~14s before backend rejection.`,
        root_cause: "PLATFORM_OPERATIONS only covers 13 platforms for preflight validation, but description and agent hints imply broader coverage. Platforms not in the map pass through to backend without operation validation.",
        suggested_fix: "Either add reddit.com, zillow.com etc to PLATFORM_OPERATIONS (if supported), or update description to only mention the 13 validated platforms, or clarify that '13' have fast-fail preflight and others rely on backend validation",
        code_location: "src/tools/scrape.ts:299-403 (PLATFORM_OPERATIONS) vs src/index.ts:280 (description)",
        evidence: `Description: "Amazon, Reddit, TikTok, LinkedIn, Google Shopping, Glassdoor, GitHub, Zillow, Airbnb" | PLATFORM_OPERATIONS: ${platformMatches.map(m => m.match(/"([^"]+)"/)?.[1]).join(", ")}`,
        confidence: "high",
      });
    }
  }
}

// ── DEEP TEST 7: twitter.com → x.com alias resolves operation too ────────
// twitter.com is aliased to x.com. But the operation 'twitter_profile_username' is
// defined under x.com in PLATFORM_OPERATIONS. The preflightScrape is called with
// the RESOLVED platform (x.com) but with the ORIGINAL operation (twitter_profile_username).
// This should work because the operation is defined under x.com.
async function testTwitterAliasWithX() {
  const { client } = await makeClient(DUMMY_KEY);
  record("DA7: twitter.com alias + twitter_profile_username op");

  console.log("[DA7] twitter.com alias with twitter_profile_username op...");
  const r = await call(client, "novada_scrape", {
    platform: "twitter.com",
    operation: "twitter_profile_username",
    params: { username: "testuser" },
    format: "markdown",
  });
  if (r.ok) {
    const text = r.result?.content?.[0]?.text ?? "";
    const isErr = r.result?.isError;
    console.log(`  [DA7] isError=${isErr}, text: ${text.slice(0, 150)}`);
    // Should NOT be a preflight error about unknown operation
    if (isErr && text.includes("Unknown operation")) {
      findings.push({
        title: "twitter.com platform alias: operation 'twitter_profile_username' rejected by preflight despite being valid for x.com",
        severity: "Medium",
        category: "functional",
        component: "novada_scrape / platform alias + preflight",
        environment: "local",
        repro_steps: "Call novada_scrape with platform='twitter.com', operation='twitter_profile_username', params={username:'test'}",
        expected: "Platform resolved to 'x.com'; operation 'twitter_profile_username' validated against x.com ops; error from backend (auth failure)",
        actual: text.slice(0, 400),
        root_cause: "resolvePlatform called before preflightScrape (line 479), so platform='x.com' is passed to preflightScrape. If rejection occurs, the ops lookup under 'x.com' is failing.",
        suggested_fix: "Verify PLATFORM_OPERATIONS['x.com'] includes 'twitter_profile_username'",
        code_location: "src/tools/scrape.ts:347-351",
        evidence: text.slice(0, 400),
        confidence: "high",
      });
    }
  }
  await client.close();
}

// ── DEEP TEST 8: Verify index.ts error handler correctly sets isError ─────
// Make sure the catch path in index.ts correctly applies `isError: true`
async function testIndexErrorHandlerContract() {
  const { client } = await makeClient(DUMMY_KEY);
  record("DA8: index.ts error handler isError contract");

  // Test with multiple error types to confirm isError:true is consistent
  const testCases = [
    { scenario: "schema error (empty platform)", args: { platform: "", operation: "op", params: {} } },
    { scenario: "preflight error (unknown op)", args: { platform: "amazon.com", operation: "bad_op", params: { keyword: "test" } } },
    { scenario: "preflight missing param", args: { platform: "amazon.com", operation: "amazon_product_asin", params: {} } },
  ];

  for (const tc of testCases) {
    const r = await call(client, "novada_scrape", tc.args);
    if (r.ok) {
      const isErr = r.result?.isError;
      const text = r.result?.content?.[0]?.text ?? "";
      const contentType = r.result?.content?.[0]?.type;
      console.log(`  [DA8] ${tc.scenario}: isError=${isErr}, type=${contentType}, text[0..60]=${text.slice(0, 60)}`);
      if (!isErr) {
        findings.push({
          title: `Error case "${tc.scenario}" missing isError:true`,
          severity: "High",
          category: "mcp-contract",
          component: "src/index.ts error handler",
          environment: "local",
          repro_steps: `Call novada_scrape with args: ${JSON.stringify(tc.args)}`,
          expected: "Response with isError:true",
          actual: `isError:${isErr}`,
          root_cause: "Error not propagated through isError flag in MCP response",
          suggested_fix: "Check error handler in index.ts callTool path",
          code_location: "src/index.ts",
          evidence: JSON.stringify(r.result).slice(0, 300),
          confidence: "high",
        });
      }
      if (contentType !== "text") {
        findings.push({
          title: `Error response content[0].type is '${contentType}', expected 'text'`,
          severity: "Medium",
          category: "mcp-contract",
          component: "src/index.ts error handler",
          environment: "local",
          repro_steps: `Call novada_scrape with error-triggering args and check content[0].type`,
          expected: "content[0].type === 'text'",
          actual: `content[0].type: ${contentType}`,
          root_cause: "MCP error response may have wrong content type",
          suggested_fix: "Ensure error content is always {type:'text', text: '<message>'}",
          code_location: "src/index.ts error handler",
          evidence: JSON.stringify(r.result).slice(0, 300),
          confidence: "medium",
        });
      }
    }
  }
  await client.close();
}

// ── DEEP TEST 9: Concurrent / duplicate call stability ────────────────────
async function testConcurrentCalls() {
  const { client } = await makeClient(DUMMY_KEY);
  record("DA9: concurrent calls stability");

  console.log("[DA9] Firing 3 concurrent preflight-error calls...");
  const promises = [
    call(client, "novada_scrape", { platform: "amazon.com", operation: "bad_op_1", params: { keyword: "test" }, format: "markdown" }),
    call(client, "novada_scrape", { platform: "amazon.com", operation: "bad_op_2", params: { keyword: "test" }, format: "json" }),
    call(client, "novada_scrape", { platform: "amazon.com", operation: "bad_op_3", params: { keyword: "test" }, format: "toon" }),
  ];
  const results = await Promise.all(promises);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.ok) {
      const isErr = r.result?.isError;
      const text = r.result?.content?.[0]?.text ?? "";
      console.log(`  [DA9/${i}] isError=${isErr}, text: ${text.slice(0, 80)}`);
      if (!isErr) {
        findings.push({
          title: `Concurrent call ${i} (bad_op_${i+1}) did not return isError:true`,
          severity: "High",
          category: "concurrency-state",
          component: "novada_scrape",
          environment: "local",
          repro_steps: "Fire 3 concurrent novada_scrape calls with invalid operations",
          expected: "All 3 return isError:true",
          actual: `call ${i} returned isError:${isErr}`,
          root_cause: "Concurrency issue in error handler",
          suggested_fix: "Verify error state is not shared between concurrent calls",
          code_location: "src/tools/scrape.ts / src/index.ts",
          evidence: JSON.stringify(r.result).slice(0, 300),
          confidence: "medium",
        });
      }
    }
  }
  await client.close();
}

// ── MAIN ─────────────────────────────────────────────────────────────────
console.log("=== novada_scrape Deep QA ===\n");
await testAliasOrderingVsPreflight();
await test11006FallbackMessage();
await testRedditNotInPlatformMap();
await testLimitClampingBehavior();
await testParamsNullByte();
await verifyDescriptionVsAgentHints();
await testTwitterAliasWithX();
await testIndexErrorHandlerContract();
await testConcurrentCalls();

console.log("\n=== Deep QA Summary ===");
console.log(`Scenarios run: ${scenarios.length}`);
console.log(`Additional findings: ${findings.length}`);
for (const f of findings) {
  console.log(`  [${f.severity}] ${f.title}`);
}

// Merge with existing findings
let existing = { findings: [] };
try {
  existing = JSON.parse(readFileSync("/tmp/novada-qa-0.9.0/func-scrape.json", "utf8"));
} catch { /* first time */ }

const merged = {
  perspective: "Functional — scrape",
  summary: `Ran ${scenarios.length + (existing.scenarios_run ?? 0)} total scenarios across offline and deep tests. Found ${findings.length + existing.findings.length} total findings.`,
  scenarios_run: scenarios.length + (existing.scenarios_run ?? 0),
  findings: [...existing.findings, ...findings],
};
writeFileSync("/tmp/novada-qa-0.9.0/func-scrape.json", JSON.stringify(merged, null, 2));
console.log("Updated /tmp/novada-qa-0.9.0/func-scrape.json");
