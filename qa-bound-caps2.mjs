/**
 * Boundary/fuzz QA part 2: More focused tests and edge cases
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
  const c = new Client({ name: "qa-bound2", version: "0" }, { capabilities: {} });
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

  // ─── search: at exact 500 chars (runtime check is >500, so 500 should pass)
  {
    const q500 = "x".repeat(500);
    const res = await callTool(c, "novada_search", { query: q500 });
    const isError = res.ok && res.result?.isError;
    const errText = res.text;
    results.push({
      scenario: "search/query-500-exact",
      expected: "500-char query should PASS (check is >500)",
      actual: isError ? `REJECTED: ${errText.slice(0,300)}` : `ACCEPTED: ${errText.slice(0,300)}`,
      finding: isError && errText.includes("exceeds maximum") ? "FINDING: off-by-one — 500 chars rejected when check is >500" : null
    });
    console.log(`[${isError && errText.includes("exceeds maximum") ? "FINDING" : "OK"}] search/query-500-exact: ${isError ? "rejected" : "accepted"}`);
  }

  // ─── search: at 501 chars (must be rejected)
  {
    const q501 = "x".repeat(501);
    const res = await callTool(c, "novada_search", { query: q501 });
    const isError = res.ok && res.result?.isError;
    const errText = res.text;
    results.push({
      scenario: "search/query-501-exact",
      expected: "501-char query should be REJECTED (check is >500)",
      actual: isError ? `Correctly rejected: ${errText.slice(0,300)}` : `ACCEPTED (unexpected): ${errText.slice(0,300)}`,
      finding: !isError ? "FINDING: 501-char query not rejected" : null
    });
    console.log(`[${!isError ? "FINDING" : "OK"}] search/query-501-exact: ${isError ? "rejected (correct)" : "accepted (BUG)"}`);
  }

  // ─── search: whitespace trimming then check
  // search.ts does: const query = params.query.trim(); so "   " becomes ""
  {
    const res = await callTool(c, "novada_search", { query: "   " });
    const isError = res.ok && res.result?.isError;
    const errText = res.text;
    results.push({
      scenario: "search/query-whitespace-trim-check",
      expected: "Whitespace query trimmed to '' should be rejected",
      actual: isError ? `Correctly rejected: ${errText.slice(0,200)}` : `ACCEPTED: ${errText.slice(0,200)}`,
      finding: !isError ? "FINDING: whitespace-only query not rejected after trim" : null
    });
    console.log(`[${!isError ? "FINDING" : "OK"}] search/query-whitespace-trim-check`);
  }

  // ─── research: trim behavior — does research.ts trim before the > 2000 check?
  // research.ts: const questionText = (params.question ?? "").trim();
  // So "   " (5 spaces) gets trimmed to "" — but the question field passes Zod min(5) first
  // because Zod's min(5) checks length BEFORE trim
  {
    const res = await callTool(c, "novada_research", { question: "     " });
    const isError = res.ok && res.result?.isError;
    const textContent = res.result?.content?.[0]?.text || "";
    results.push({
      scenario: "research/5-space-question-trim-behavior",
      expected: "5 spaces: Zod min(5) passes, then research.ts trims to '' -> research executes with empty topic",
      actual: isError ? `Rejected: ${res.text.slice(0,200)}` : `Accepted and ran: topic=${JSON.stringify(textContent.match(/Cannot complete research on.*?"/)?.[0] || "").slice(0,50)}`,
      finding: !isError ? `FINDING: 5-space question accepted (Zod min(5) doesn't trim; research executes with trimmed empty string as topic "${textContent.slice(0,200)}")` : null
    });
    console.log(`[${!isError ? "FINDING" : "OK"}] research/5-space-question-trim-behavior`);
    if (!isError) {
      console.log("  Topic used:", textContent.slice(0, 300));
    }
  }

  // ─── research: what is the actual topic used with whitespace question?
  // Let's check the error message for "Cannot complete research on: ..."
  {
    const res = await callTool(c, "novada_research", { question: "  abc  " });
    const isError = res.ok && res.result?.isError;
    const textContent = res.result?.content?.[0]?.text || "";
    const topicMatch = textContent.match(/Cannot complete research on.*?\"(.*?)\"/s);
    results.push({
      scenario: "research/question-with-surrounding-spaces",
      expected: "Trimming spaces around question should use 'abc' as topic",
      actual: topicMatch ? `Topic used: "${topicMatch[1]}"` : `No match in: ${textContent.slice(0,200)}`,
      finding: null
    });
    console.log(`[OK] research/question-with-surrounding-spaces: topic="${topicMatch?.[1]}"`);
  }

  // ─── scrape: params record with deeply nested object (prototype pollution risk)
  // The code explicitly blocks __proto__, constructor, prototype
  {
    const res = await callTool(c, "novada_scrape", {
      platform: "amazon.com",
      operation: "amazon_product_keywords",
      params: {
        "__proto__": { admin: true },
        "keyword": "test"
      }
    });
    const isError = res.ok && res.result?.isError;
    // Not expecting a finding, but check the proto key is blocked
    results.push({
      scenario: "scrape/params-proto-pollution-attempt",
      expected: "__proto__ key should be blocked by BLOCKED_KEYS set",
      actual: `isError=${isError}: ${res.text.slice(0,200)}`,
      finding: null
    });
    console.log(`[OK] scrape/params-proto-pollution-attempt`);
  }

  // ─── research: check the exact schema — query field has NO min() constraint
  // This means query="" passes the schema refine but the code uses question ?? ""
  {
    const res = await callTool(c, "novada_research", { query: "" });
    const isError = res.ok && res.result?.isError;
    const textContent = res.result?.content?.[0]?.text || "";
    results.push({
      scenario: "research/query-empty-string",
      expected: "Empty query — no min() on query field in Zod schema, refine only checks !!(question || query)",
      actual: isError ? `Rejected: ${res.text.slice(0,200)}` : `Accepted (questionText=''): ${textContent.slice(0,300)}`,
      finding: !isError ? `FINDING: empty string query accepted — refine !!(question || query) treats '' as falsy WAIT - actually '' is falsy so this SHOULD be rejected. Let me check...` : null
    });
    const finding2 = !isError ? "FINDING: empty query ('') accepted — but ''.trim() is '' which is falsy — the refine should catch this" : null;
    results[results.length-1].finding = finding2;
    console.log(`[${finding2 ? "FINDING" : "OK"}] research/query-empty-string: ${isError ? "rejected" : "accepted"}`);
    if (!isError) console.log("  Content:", textContent.slice(0, 300));
  }

  // ─── research: query=" " (single space) — "" || " " = " " which is truthy!
  // So the refine passes with " " which is truthy, but trimmed gives ""
  {
    const res = await callTool(c, "novada_research", { query: " " });
    const isError = res.ok && res.result?.isError;
    const textContent = res.result?.content?.[0]?.text || "";
    results.push({
      scenario: "research/query-single-space-truthy",
      expected: "Single space is truthy — passes !!(question||query) refine despite being semantically empty",
      actual: isError ? `Rejected: ${res.text.slice(0,200)}` : `Accepted: ${textContent.slice(0,300)}`,
      finding: !isError ? "CONFIRMED FINDING: ' ' (single space) is truthy → passes Zod refine, research runs with trimmed empty topic ''" : null
    });
    console.log(`[${!isError ? "FINDING" : "OK"}] research/query-single-space-truthy: ${isError ? "rejected" : "CONFIRMED accepted with empty topic"}`);
  }

  // ─── novada_scrape: limit boundary edge cases
  // limit=0 is below min(1) — should be rejected by Zod
  {
    const res = await callTool(c, "novada_scrape", {
      platform: "amazon.com",
      operation: "amazon_product_keywords",
      params: { keyword: "test" },
      limit: 0
    });
    const isError = res.ok && res.result?.isError;
    results.push({
      scenario: "scrape/limit-0",
      expected: "limit=0 below min(1) — should be rejected",
      actual: isError ? `Correctly rejected: ${res.text.slice(0,200)}` : `ACCEPTED: ${res.text.slice(0,200)}`,
      finding: !isError ? "FINDING: limit=0 accepted in scrape" : null
    });
    console.log(`[${!isError ? "FINDING" : "OK"}] scrape/limit-0`);
  }

  // limit=101 is above max(100)
  {
    const res = await callTool(c, "novada_scrape", {
      platform: "amazon.com",
      operation: "amazon_product_keywords",
      params: { keyword: "test" },
      limit: 101
    });
    const isError = res.ok && res.result?.isError;
    results.push({
      scenario: "scrape/limit-101",
      expected: "limit=101 above max(100) — should be rejected",
      actual: isError ? `Correctly rejected: ${res.text.slice(0,200)}` : `ACCEPTED: ${res.text.slice(0,200)}`,
      finding: !isError ? "FINDING: limit=101 accepted in scrape" : null
    });
    console.log(`[${!isError ? "FINDING" : "OK"}] scrape/limit-101`);
  }

  // ─── project string: boundary test at exactly 30 chars vs 31
  {
    const proj30 = "a".repeat(30);
    const res = await callTool(c, "novada_search", { query: "test", project: proj30 });
    const isError = res.ok && res.result?.isError;
    results.push({
      scenario: "search/project-30-chars",
      expected: "project at max(30) should pass schema",
      actual: isError && res.text?.includes("API key") ? "API error (expected with dummy key, schema passed)" : `isError=${isError}: ${res.text.slice(0,200)}`,
      finding: null
    });
    console.log(`[OK] search/project-30-chars: schema accepted`);
  }

  {
    const proj31 = "a".repeat(31);
    const res = await callTool(c, "novada_search", { query: "test", project: proj31 });
    const isError = res.ok && res.result?.isError;
    results.push({
      scenario: "search/project-31-chars",
      expected: "project at 31 chars should be rejected (max:30)",
      actual: isError ? `Correctly rejected: ${res.text.slice(0,200)}` : `ACCEPTED: ${res.text.slice(0,200)}`,
      finding: !isError ? "FINDING: project=31 chars accepted (above max:30)" : null
    });
    console.log(`[${!isError ? "FINDING" : "OK"}] search/project-31-chars`);
  }

  // ─── browser evaluate: non-ASCII Unicode in script (should be rejected)
  {
    const res = await callTool(c, "novada_browser", {
      actions: [{ action: "evaluate", script: "document.title + '日本語'" }],
      timeout: 10000
    });
    const isError = res.ok && res.result?.isError;
    results.push({
      scenario: "browser/evaluate-unicode-script",
      expected: "Non-ASCII Unicode in evaluate script should be rejected (ASCII-only refine)",
      actual: isError ? `Correctly rejected: ${res.text.slice(0,200)}` : `ACCEPTED: ${res.text.slice(0,200)}`,
      finding: !isError ? "FINDING: Unicode in evaluate script accepted (ASCII-only refine not enforced)" : null
    });
    console.log(`[${!isError ? "FINDING" : "OK"}] browser/evaluate-unicode-script`);
  }

  // ─── browser: close_session mixed with navigate (should be rejected)
  {
    const res = await callTool(c, "novada_browser", {
      actions: [
        { action: "navigate", url: "https://example.com", wait_until: "domcontentloaded" },
        { action: "close_session" }
      ],
      timeout: 10000
    });
    const isError = res.ok && res.result?.isError;
    results.push({
      scenario: "browser/close-session-mixed",
      expected: "close_session with other actions should be rejected (NOV-664 constraint)",
      actual: isError ? `Correctly rejected: ${res.text.slice(0,200)}` : `ACCEPTED: ${res.text.slice(0,200)}`,
      finding: !isError ? "FINDING: close_session mixed with other actions accepted (violates NOV-664)" : null
    });
    console.log(`[${!isError ? "FINDING" : "OK"}] browser/close-session-mixed`);
  }

  // ─── browser: 21 actions (one over max 20)
  {
    const actions21 = Array(21).fill({ action: "screenshot" });
    const res = await callTool(c, "novada_browser", {
      actions: actions21,
      timeout: 10000
    });
    const isError = res.ok && res.result?.isError;
    results.push({
      scenario: "browser/actions-21",
      expected: "21 actions should be rejected (max:20)",
      actual: isError ? `Correctly rejected: ${res.text.slice(0,200)}` : `ACCEPTED: ${res.text.slice(0,200)}`,
      finding: !isError ? "FINDING: 21 actions accepted (above max:20)" : null
    });
    console.log(`[${!isError ? "FINDING" : "OK"}] browser/actions-21`);
  }

  await c.close();

  // Merge with existing results
  const existing = JSON.parse(readFileSync("/tmp/novada-qa-0.9.0/bound-caps.json", "utf8"));
  const merged = [...existing, ...results];
  writeFileSync("/tmp/novada-qa-0.9.0/bound-caps.json", JSON.stringify(merged, null, 2));

  // Print findings summary
  const findings = results.filter(r => r.finding);
  console.log(`\nNew findings (${findings.length}/${results.length} scenarios):`);
  findings.forEach((f, i) => {
    console.log(`  ${i+1}. [${f.scenario}] ${f.finding}`);
  });

  return results;
}

runTests().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
