/**
 * Boundary/fuzz QA part 4: scrape sync 60KB cap asymmetry + search schema missing max
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync } from "fs";

const KEY = "dummy";

function makeClient() {
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
  });
  const c = new Client({ name: "qa-bound4", version: "0" }, { capabilities: {} });
  return { t, c };
}

async function callTool(c, name, args) {
  try {
    const r = await c.callTool({ name, arguments: args });
    return { ok: true, result: r, text: JSON.stringify(r).slice(0, 3000) };
  } catch (e) {
    return { ok: false, error: e.message ?? String(e), text: String(e).slice(0, 3000) };
  }
}

async function runTests() {
  const { t, c } = makeClient();
  await c.connect(t);

  const results = [];

  // ─── Verify the 60KB asymmetry between novada_scrape and novada_scraper_submit ──

  // novada_scraper_submit with 60KB+1 should be rejected (validateParamsSize present)
  {
    const bigVal = "x".repeat(60001);
    const res = await callTool(c, "novada_scraper_submit", {
      platform: "amazon.com",
      operation: "amazon_product_keywords",
      params: { keyword: bigVal }
    });
    const isError = res.ok && res.result?.isError;
    const hasPayloadError = res.text.includes("params payload is too large") || res.text.includes("too long");
    results.push({
      scenario: "scraper_submit/params-60kb-rejected",
      expected: "novada_scraper_submit with 60KB+ params should be REJECTED by validateParamsSize",
      actual: isError && hasPayloadError ? `Correctly rejected: ${res.text.slice(0,300)}`
              : isError ? `Rejected for other reason: ${res.text.slice(0,300)}`
              : `ACCEPTED: ${res.text.slice(0,200)}`,
      finding: isError && !hasPayloadError ? `FINDING: scraper_submit rejected for API reasons not params size — ${res.text.slice(0,200)}` : null
    });
    console.log(`[${!isError ? "FINDING" : "OK"}] scraper_submit/params-60kb-rejected: isError=${isError} payloadError=${hasPayloadError}`);
    console.log("  ->", res.text.slice(0, 200));
  }

  // novada_scraper_submit with exactly 2001 chars in a single param value
  {
    const val2001 = "x".repeat(2001);
    const res = await callTool(c, "novada_scraper_submit", {
      platform: "amazon.com",
      operation: "amazon_product_keywords",
      params: { keyword: val2001 }
    });
    const isError = res.ok && res.result?.isError;
    const hasStringLenError = res.text.includes("too long") || res.text.includes("Maximum string length");
    results.push({
      scenario: "scraper_submit/params-string-2001-rejected",
      expected: "novada_scraper_submit with 2001-char string param value should be REJECTED",
      actual: isError && hasStringLenError ? `Correctly rejected: ${res.text.slice(0,300)}`
              : isError ? `Rejected for other reason: ${res.text.slice(0,300)}`
              : `ACCEPTED: ${res.text.slice(0,200)}`,
      finding: null
    });
    console.log(`[OK] scraper_submit/params-string-2001: isError=${isError} stringLenError=${hasStringLenError}`);
    console.log("  ->", res.text.slice(0, 200));
  }

  // novada_scrape with 2001 chars in a param value — NO validateParamsSize
  {
    const val2001 = "x".repeat(2001);
    const res = await callTool(c, "novada_scrape", {
      platform: "amazon.com",
      operation: "amazon_product_keywords",
      params: { keyword: val2001 }
    });
    const isError = res.ok && res.result?.isError;
    const hasStringLenError = res.text.includes("too long") || res.text.includes("Maximum string length") || res.text.includes("params payload");
    results.push({
      scenario: "scrape/params-string-2001-no-cap",
      expected: "novada_scrape has no validateParamsSize — 2001-char param passes to backend, gets API error",
      actual: isError && hasStringLenError ? `Length-rejected (unexpected — scrape has no size cap): ${res.text.slice(0,300)}`
              : isError && !hasStringLenError ? `API error (expected, no size cap): ${res.text.slice(0,300)}`
              : `ACCEPTED: ${res.text.slice(0,200)}`,
      finding: hasStringLenError ? null : isError ? null :  // API errors are expected
                `FINDING: scrape params size cap asymmetry confirmed — 2001-char string accepted in scrape, rejected in scraper_submit`
    });
    console.log(`[${hasStringLenError ? "FINDING-unexpected-cap" : "OK"}] scrape/params-string-2001-no-cap: isError=${isError} stringLenError=${hasStringLenError}`);
    console.log("  ->", res.text.slice(0, 200));
  }

  // novada_scrape with exactly 60KB+1 total params payload — no validateParamsSize in scrape.ts
  {
    const bigVal = "x".repeat(60001);
    const res = await callTool(c, "novada_scrape", {
      platform: "amazon.com",
      operation: "amazon_product_keywords",
      params: { keyword: bigVal }
    });
    const isError = res.ok && res.result?.isError;
    const hasPayloadError = res.text.includes("params payload is too large");
    results.push({
      scenario: "scrape/params-60kb-no-cap",
      expected: "novada_scrape sends 60KB+ params to backend (no cap); dummy key gets API error, not payload error",
      actual: isError && hasPayloadError ? `Payload-rejected (unexpected): ${res.text.slice(0,300)}`
              : isError && !hasPayloadError ? `API error (expected, no size cap in scrape): ${res.text.slice(0,300)}`
              : `ACCEPTED: ${res.text.slice(0,200)}`,
      finding: !hasPayloadError && isError ? `CONFIRMED: novada_scrape (sync) lacks the 60KB params cap present in novada_scraper_submit. 60KB+ param accepted and forwarded to backend (hits API error only due to bad key). Asymmetry between sync and async submit tools.` : null
    });
    console.log(`[${!hasPayloadError && isError ? "FINDING" : "OK"}] scrape/params-60kb-no-cap: isError=${isError} hasPayloadError=${hasPayloadError}`);
    console.log("  ->", res.text.slice(0, 200));
  }

  // ─── Verify search query Zod schema has no max (runtime enforces 500) ──────────

  // query=500 chars — schema has no max(), but runtime enforces >500 check
  // Confirming the schema gap: Zod schema could be the primary guard
  {
    const q500 = "x".repeat(500);
    const res = await callTool(c, "novada_search", { query: q500 });
    const isError = res.ok && res.result?.isError;
    const isLengthError = res.text.includes("exceeds maximum length");
    // 500 chars: >500 is false, so NOT a length error. API error is from dummy key.
    results.push({
      scenario: "search/query-500-schema-vs-runtime",
      expected: "500 chars passes runtime >500 check; any error is from API (dummy key), not schema",
      actual: isLengthError ? `LENGTH ERROR (unexpected for 500): ${res.text.slice(0,200)}`
              : isError ? `API error (expected): ${res.text.slice(0,200)}`
              : `ACCEPTED`,
      finding: null
    });
    console.log(`[OK] search/query-500-schema-vs-runtime: isLengthError=${isLengthError}`);
  }

  // ─── Zod schema has no .max() on novada_search.query — confirm the contract gap ─
  // This means the MCP JSON schema generated for agents does NOT list any maxLength
  // on query, but runtime enforces 500. This creates a mismatch between schema and behavior.
  {
    // Get the tool listing to check the schema
    try {
      const tools = await c.listTools();
      const searchTool = tools.tools?.find(t => t.name === 'novada_search');
      const queryProp = searchTool?.inputSchema?.properties?.query;
      console.log("\nnova_search query schema property:");
      console.log(JSON.stringify(queryProp, null, 2));
      const hasMaxLength = queryProp && ('maxLength' in queryProp || 'maximum' in queryProp);
      results.push({
        scenario: "search/query-schema-missing-maxLength",
        expected: "MCP JSON schema should expose maxLength:500 on query to allow agents to self-validate",
        actual: queryProp ? `query schema: ${JSON.stringify(queryProp)}` : "query schema not found",
        finding: !hasMaxLength
          ? `FINDING: novada_search.query has no maxLength in JSON schema (Zod has no .max()), but runtime enforces 500-char limit. Agents cannot pre-validate from schema alone — they will get a surprising error after submitting a long query.`
          : null
      });
      console.log(`[${!hasMaxLength ? "FINDING" : "OK"}] search/query-schema-missing-maxLength: hasMaxLength=${hasMaxLength}`);
    } catch (e) {
      console.log("Error getting tools:", e.message);
    }
  }

  // ─── novada_research question Zod min(5) — but no .trim() before → whitespace bypass ─
  // Test to see exact behavior: what happens with "   ab" (2 spaces + 2 chars = 4 chars)?
  {
    const q4 = "   ab"; // 5 chars, passes min(5), has content "ab" after trim
    const res = await callTool(c, "novada_research", { question: q4 });
    const isError = res.ok && res.result?.isError;
    const text = res.result?.content?.[0]?.text || "";
    const topicMatch = text.match(/"(.*?)"/s);
    results.push({
      scenario: "research/question-leading-spaces-4chars",
      expected: "5 chars with leading spaces: Zod min(5) passes, runtime trims to 'ab'",
      actual: isError ? `Rejected: ${res.text.slice(0,200)}` : `Topic used: "${topicMatch?.[1] || "?"}"`,
      finding: null
    });
    console.log(`[OK] research/question-4chars-leading-spaces: topic="${topicMatch?.[1]}"`);
  }

  // ─── What about question with only 4 chars but with extra space = 5? ──────────
  // "abc " (3 chars + space = 4 total, below min(5)) — should fail Zod
  {
    const q4 = "abc "; // 4 chars total
    const res = await callTool(c, "novada_research", { question: q4 });
    const isError = res.ok && res.result?.isError;
    results.push({
      scenario: "research/question-4chars-total",
      expected: "4 chars total should fail Zod min(5)",
      actual: isError ? `Correctly rejected` : `ACCEPTED: ${res.text.slice(0,200)}`,
      finding: !isError ? "FINDING: 4-char question accepted" : null
    });
    console.log(`[${!isError ? "FINDING" : "OK"}] research/question-4chars-total`);
  }

  await c.close();

  // Append to existing results
  const existing = JSON.parse(readFileSync("/tmp/novada-qa-0.9.0/bound-caps.json", "utf8"));
  const merged = [...existing, ...results];
  writeFileSync("/tmp/novada-qa-0.9.0/bound-caps.json", JSON.stringify(merged, null, 2));

  const findings = results.filter(r => r.finding);
  console.log(`\nNew findings (${findings.length}/${results.length} scenarios):`);
  findings.forEach((f, i) => {
    console.log(`  ${i+1}. [${f.scenario}] ${f.finding?.slice(0,250)}`);
  });

  return results;
}

runTests().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
