/**
 * Boundary/fuzz QA part 3: Confirm 500-char exact boundary for search
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
  const c = new Client({ name: "qa-bound3", version: "0" }, { capabilities: {} });
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

  // Detailed 500 boundary tests for search
  for (const len of [498, 499, 500, 501, 502]) {
    const q = "x".repeat(len);
    const res = await callTool(c, "novada_search", { query: q });
    const isError = res.ok && res.result?.isError;
    const errText = res.text;
    const hasLengthError = errText.includes("exceeds maximum length");
    console.log(`search/query-${len}-chars: isError=${isError} hasLengthError=${hasLengthError}`);
    if (hasLengthError) {
      console.log(`  -> ${errText.slice(0, 200)}`);
    }
    results.push({
      scenario: `search/query-${len}-chars-confirm`,
      expected: len <= 500 ? "Should pass (check is >500)" : "Should fail (>500)",
      actual: isError ? (hasLengthError ? `REJECTED-LENGTH: ${errText.slice(0,200)}` : `REJECTED-OTHER: ${errText.slice(0,200)}`) : "ACCEPTED",
      finding: (len <= 500 && isError && hasLengthError)
        ? `CONFIRMED FINDING: search query of ${len} chars is REJECTED — check is ">500" but ${len} <= 500 still fails. OFF-BY-ONE ERROR in docs or code.`
        : null
    });
  }

  // Specifically check around 500 — the code checks: if (query.length > QUERY_MAX_LENGTH)
  // where QUERY_MAX_LENGTH = 500, so 500 should NOT trigger (500 > 500 = false)
  // But something triggered a rejection at 500 in our previous test... Let me verify
  console.log("\n--- Testing exact 500 character query ---");
  const q500 = "x".repeat(500);
  console.log("Length:", q500.length);
  const res500 = await callTool(c, "novada_search", { query: q500 });
  const isError500 = res500.ok && res500.result?.isError;
  const errText500 = res500.text;
  console.log("isError:", isError500);
  console.log("Response:", errText500.slice(0, 500));
  results.push({
    scenario: "search/query-500-exact-confirm",
    expected: "500 chars: check is >500, so 500 should PASS",
    actual: isError500 ? `REJECTED (unexpected if length error): ${errText500.slice(0,300)}` : "ACCEPTED",
    finding: isError500 && errText500.includes("exceeds maximum length")
      ? "CONFIRMED BUG: query.length=500 triggers >500 check — this is impossible. Something else is happening (maybe Zod trims or post-process adds chars?)"
      : (isError500 ? `Rejected but NOT for length: ${errText500.slice(0,200)}` : null)
  });

  // Check if 500-char query is being rejected for API-key reasons (not length)
  // The error in previous run said "rejected" but we need to see the actual error text
  console.log("\n--- Checking what rejection was for 500 chars ---");
  if (isError500) {
    const fullText = JSON.stringify(res500.result);
    console.log("Full rejection text:", fullText.slice(0, 800));
  }

  // Test 499 to confirm it passes schema vs is rejected for other reasons
  const q499 = "x".repeat(499);
  const res499 = await callTool(c, "novada_search", { query: q499 });
  const isError499 = res499.ok && res499.result?.isError;
  console.log("\n499-char query isError:", isError499);
  console.log("499-char text:", res499.text.slice(0, 300));
  results.push({
    scenario: "search/query-499-full-response",
    expected: "499 chars should pass, any error is API-key related not length",
    actual: `isError=${isError499}: ${res499.text.slice(0,300)}`,
    finding: null
  });

  await c.close();

  // Append to existing results
  const existing = JSON.parse(readFileSync("/tmp/novada-qa-0.9.0/bound-caps.json", "utf8"));
  const merged = [...existing, ...results];
  writeFileSync("/tmp/novada-qa-0.9.0/bound-caps.json", JSON.stringify(merged, null, 2));

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
