/**
 * QA client: novada_scrape availability audit
 * Tests: amazon keywords (markdown), google SERP (json), linkedin (toon), error paths
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = process.env.QA_KEY || "dummy";
const BUILD = "/Users/tongwu/Projects/novada-mcp/build/index.js";

async function makeClient() {
  const t = new StdioClientTransport({
    command: "node",
    args: [BUILD],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
  });
  const c = new Client({ name: "audit-scrape", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { client: c, transport: t };
}

async function callTool(client, name, args) {
  const start = Date.now();
  try {
    const r = await client.callTool({ name, arguments: args });
    const elapsed = Date.now() - start;
    return { ok: true, elapsed, result: r };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { ok: false, elapsed, error: err.message || String(err) };
  }
}

function inspect(r) {
  const text = r.result?.content?.[0]?.text ?? "";
  const isErr = r.result?.isError ?? false;
  return { text: text.slice(0, 2000), isErr };
}

const results = [];

async function run() {
  console.log("=== novada_scrape QA audit ===\n");

  // ── Test 1: Amazon keywords, markdown format ─────────────────────────────
  {
    console.log("TEST 1: amazon.com / amazon_product_keywords / keyword=wireless earbuds / format=markdown");
    const { client, transport } = await makeClient();
    const r = await callTool(client, "novada_scrape", {
      platform: "amazon.com",
      operation: "amazon_product_keywords",
      params: { keyword: "wireless earbuds", num: 3 },
      limit: 5,
      format: "markdown",
    });
    await client.close();

    const { text, isErr } = inspect(r);
    const hasRecords = text.includes("Scrape Results") && !text.includes("No records returned");
    const hasMarkdownTable = text.includes("|") || text.includes("##");
    console.log(`  elapsed: ${r.elapsed}ms | isError: ${isErr} | ok: ${r.ok}`);
    console.log(`  has_records: ${hasRecords} | has_markdown: ${hasMarkdownTable}`);
    console.log(`  preview: ${text.slice(0, 400)}\n`);

    results.push({
      test: "T1_amazon_keywords_markdown",
      ok: r.ok,
      isErr,
      elapsed: r.elapsed,
      has_records: hasRecords,
      has_markdown: hasMarkdownTable,
      preview: text.slice(0, 400),
    });
  }

  // ── Test 2: Google SERP, json format ─────────────────────────────────────
  {
    console.log("TEST 2: google.com / google_serp_web / q=novada web scraping / format=json");
    const { client } = await makeClient();
    const r = await callTool(client, "novada_scrape", {
      platform: "google.com",
      operation: "google_serp_web",
      params: { q: "novada web scraping api" },
      limit: 5,
      format: "json",
    });
    await client.close();

    const { text, isErr } = inspect(r);
    const hasJson = text.includes("```json") || text.includes('"title"') || text.includes('"url"');
    const hasRecords = text.includes("Scrape Results");
    console.log(`  elapsed: ${r.elapsed}ms | isError: ${isErr} | ok: ${r.ok}`);
    console.log(`  has_json: ${hasJson} | has_records: ${hasRecords}`);
    console.log(`  preview: ${text.slice(0, 500)}\n`);

    results.push({
      test: "T2_google_serp_json",
      ok: r.ok,
      isErr,
      elapsed: r.elapsed,
      has_json: hasJson,
      has_records: hasRecords,
      preview: text.slice(0, 400),
    });
  }

  // ── Test 3: LinkedIn company, toon format ────────────────────────────────
  {
    console.log("TEST 3: linkedin.com / linkedin_company_information_url / url=anthropic / format=toon");
    const { client } = await makeClient();
    const r = await callTool(client, "novada_scrape", {
      platform: "linkedin.com",
      operation: "linkedin_company_information_url",
      params: { url: "https://www.linkedin.com/company/anthropic/" },
      limit: 5,
      format: "toon",
    });
    await client.close();

    const { text, isErr } = inspect(r);
    const hasToon = text.includes("HEADERS:");
    const hasRecords = text.includes("Scrape Results");
    console.log(`  elapsed: ${r.elapsed}ms | isError: ${isErr} | ok: ${r.ok}`);
    console.log(`  has_toon_headers: ${hasToon} | has_records: ${hasRecords}`);
    console.log(`  preview: ${text.slice(0, 500)}\n`);

    results.push({
      test: "T3_linkedin_toon",
      ok: r.ok,
      isErr,
      elapsed: r.elapsed,
      has_toon_headers: hasToon,
      has_records: hasRecords,
      preview: text.slice(0, 400),
    });
  }

  // ── Test 4: Error path — invalid operation for known platform ────────────
  {
    console.log("TEST 4: [ERROR PATH] amazon.com / invalid_op_xyz / expect preflight error");
    const { client } = await makeClient();
    const r = await callTool(client, "novada_scrape", {
      platform: "amazon.com",
      operation: "invalid_op_xyz",
      params: { keyword: "test" },
      format: "markdown",
    });
    await client.close();

    const { text, isErr } = inspect(r);
    const hasAgentInstruction = text.includes("agent_instruction") || text.includes("Use one of the valid");
    const hasPreflight = text.includes("Unknown operation") || text.includes("preflight");
    console.log(`  elapsed: ${r.elapsed}ms | isError: ${isErr} | ok: ${r.ok}`);
    console.log(`  preflight_caught: ${hasPreflight} | has_agent_instruction: ${hasAgentInstruction}`);
    console.log(`  preview: ${text.slice(0, 400)}\n`);

    results.push({
      test: "T4_invalid_op_preflight",
      ok: r.ok,
      isErr,
      elapsed: r.elapsed,
      preflight_caught: hasPreflight,
      has_agent_instruction: hasAgentInstruction,
      preview: text.slice(0, 400),
    });
  }

  // ── Test 5: Error path — missing required param ──────────────────────────
  {
    console.log("TEST 5: [ERROR PATH] amazon.com / amazon_product_asin / no params — expect missing-param error");
    const { client } = await makeClient();
    const r = await callTool(client, "novada_scrape", {
      platform: "amazon.com",
      operation: "amazon_product_asin",
      params: {},
      format: "markdown",
    });
    await client.close();

    const { text, isErr } = inspect(r);
    const hasMissingParam = text.includes("requires") && (text.includes("'asin'") || text.includes("asin"));
    console.log(`  elapsed: ${r.elapsed}ms | isError: ${isErr} | ok: ${r.ok}`);
    console.log(`  missing_param_caught: ${hasMissingParam}`);
    console.log(`  preview: ${text.slice(0, 400)}\n`);

    results.push({
      test: "T5_missing_required_param",
      ok: r.ok,
      isErr,
      elapsed: r.elapsed,
      missing_param_caught: hasMissingParam,
      preview: text.slice(0, 400),
    });
  }

  // ── Test 6: Operation alias — amazon_product_by-keywords ─────────────────
  {
    console.log("TEST 6: [ALIAS] amazon.com / amazon_product_by-keywords (should alias to amazon_product_keywords)");
    const { client } = await makeClient();
    const r = await callTool(client, "novada_scrape", {
      platform: "amazon.com",
      operation: "amazon_product_by-keywords",
      params: { keyword: "laptop" },
      limit: 3,
      format: "markdown",
    });
    await client.close();

    const { text, isErr } = inspect(r);
    const hasRecords = text.includes("Scrape Results") && !text.includes("No records returned");
    console.log(`  elapsed: ${r.elapsed}ms | isError: ${isErr} | ok: ${r.ok}`);
    console.log(`  alias_resolved: ${!isErr && hasRecords}`);
    console.log(`  preview: ${text.slice(0, 400)}\n`);

    results.push({
      test: "T6_alias_resolution",
      ok: r.ok,
      isErr,
      elapsed: r.elapsed,
      alias_resolved: !isErr && hasRecords,
      preview: text.slice(0, 400),
    });
  }

  // ── Test 7: twitter.com alias → x.com ────────────────────────────────────
  {
    console.log("TEST 7: [PLATFORM ALIAS] twitter.com → should resolve to x.com");
    const { client } = await makeClient();
    const r = await callTool(client, "novada_scrape", {
      platform: "twitter.com",
      operation: "twitter_profile_username",
      params: { username: "anthropic" },
      limit: 3,
      format: "markdown",
    });
    await client.close();

    const { text, isErr } = inspect(r);
    // Should NOT get "Unknown platform" 11008 error; should get either results or a task issue
    const noUnknownPlatform = !text.includes("Unknown platform");
    console.log(`  elapsed: ${r.elapsed}ms | isError: ${isErr} | ok: ${r.ok}`);
    console.log(`  platform_alias_ok: ${noUnknownPlatform}`);
    console.log(`  preview: ${text.slice(0, 400)}\n`);

    results.push({
      test: "T7_twitter_platform_alias",
      ok: r.ok,
      isErr,
      elapsed: r.elapsed,
      no_unknown_platform: noUnknownPlatform,
      preview: text.slice(0, 400),
    });
  }

  // ── Test 8: limit enforcement ──────────────────────────────────────────
  {
    console.log("TEST 8: [LIMIT] google.com / google_serp_web / limit=3 — check records capped");
    const { client } = await makeClient();
    const r = await callTool(client, "novada_scrape", {
      platform: "google.com",
      operation: "google_serp_web",
      params: { q: "test" },
      limit: 3,
      format: "json",
    });
    await client.close();

    const { text, isErr } = inspect(r);
    // Count records in JSON output
    const recordsMatch = text.match(/"records":\s*(\d+)/);
    const recordCount = recordsMatch ? parseInt(recordsMatch[1]) : null;
    const limitOk = recordCount === null || recordCount <= 3;
    console.log(`  elapsed: ${r.elapsed}ms | isError: ${isErr} | records: ${recordCount}`);
    console.log(`  limit_ok: ${limitOk}`);
    console.log(`  preview: ${text.slice(0, 300)}\n`);

    results.push({
      test: "T8_limit_enforcement",
      ok: r.ok,
      isErr,
      elapsed: r.elapsed,
      record_count: recordCount,
      limit_ok: limitOk,
      preview: text.slice(0, 300),
    });
  }

  return results;
}

run().then((results) => {
  console.log("\n=== SUMMARY ===");
  for (const r of results) {
    const status = r.ok && !r.isErr ? "PASS" : (r.isErr ? "STRUCTURED_ERR" : "FAIL");
    console.log(`  ${r.test}: ${status} (${r.elapsed}ms)`);
  }
  // Write results to file
  const fs = (await import("fs")).default;
  fs.writeFileSync("/tmp/novada-audit-0.9.0/scrape-avail-raw.json", JSON.stringify(results, null, 2));
  console.log("\nRaw results written to /tmp/novada-audit-0.9.0/scrape-avail-raw.json");
}).catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
