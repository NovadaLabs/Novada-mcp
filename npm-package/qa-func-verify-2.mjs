/**
 * QA functional test suite for novada_verify - Round 2
 * Focused on edge cases found in analysis:
 * 1. 10-space claim (passes Zod min(10) but should be caught by runtime trim check)
 * 2. Claim with js embedded NOT at start (sanitized but key term lost)
 * 3. Long context passing through
 * 4. Error format consistency check
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const BUILD = "/Users/tongwu/Projects/novada-mcp/build/index.js";
const DUMMY_KEY = "dummy";

async function makeClient(key = DUMMY_KEY) {
  const t = new StdioClientTransport({
    command: "node",
    args: [BUILD],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: key }),
  });
  const c = new Client({ name: "qa-verify2", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { client: c, transport: t };
}

function extract(result) {
  if (!result || !result.content) return null;
  const textContent = result.content.find(c => c.type === "text");
  return textContent ? textContent.text : JSON.stringify(result);
}

async function callVerify(client, args) {
  try {
    const r = await client.callTool({ name: "novada_verify", arguments: args });
    return { ok: true, text: extract(r), isError: r.isError };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const findings = [];

async function runAll() {
  const { client, transport } = await makeClient();

  // ─── Test A: 10 spaces (Zod passes min(10), runtime should catch empty trim) ─
  console.log("Test A: 10 spaces - passes Zod min(10) but should be caught");
  const a = await callVerify(client, { claim: "          " }); // 10 spaces
  console.log("  isError:", a.isError, "text:", (a.text || a.error || "").slice(0, 300));
  // Expected: isError=true (runtime trim check)
  // Actual: if isError=false → BUG (whitespace-only claim accepted)
  findings.push({ test: "A-10-spaces", isError: a.isError, text: (a.text || a.error || "").slice(0, 300) });

  // ─── Test B: 9 spaces + 1 char (exactly 10 chars, 9 spaces + 'a') ─────────
  console.log("Test B: 9 spaces + 'a' = 10 chars claim");
  const b = await callVerify(client, { claim: "         a" }); // 9 spaces + 1 char
  console.log("  isError:", b.isError, "text:", (b.text || b.error || "").slice(0, 300));
  findings.push({ test: "B-9spaces-1char", isError: b.isError, text: (b.text || b.error || "").slice(0, 300) });

  // ─── Test C: Whitespace claim of 15 chars ────────────────────────────────
  console.log("Test C: 15 spaces");
  const c_ = await callVerify(client, { claim: "               " }); // 15 spaces
  console.log("  isError:", c_.isError, "text:", (c_.text || c_.error || "").slice(0, 300));
  findings.push({ test: "C-15-spaces", isError: c_.isError, text: (c_.text || c_.error || "").slice(0, 300) });

  // ─── Test D: Script tag content - does alert(1) become a key term ────────
  console.log("Test D: HTML script tag - does alert() get into queries");
  const d = await callVerify(client, { claim: "<script>alert(1)</script> Earth is flat conspiracy theory" });
  console.log("  isError:", d.isError, "text:", (d.text || d.error || "").slice(0, 400));
  // This should work but with sanitized claim - the script content becomes part of key terms
  findings.push({ test: "D-script-tag", isError: d.isError, text: (d.text || d.error || "").slice(0, 400) });

  // ─── Test E: javascript: embedded in middle of claim ────────────────────
  console.log("Test E: javascript: embedded in middle");
  const e = await callVerify(client, { claim: "They use javascript: as a URL scheme for XSS attacks in old browsers" });
  console.log("  isError:", e.isError, "text:", (e.text || e.error || "").slice(0, 400));
  // The word 'javascript:' is sanitized out, which removes it from key terms
  // 'javascript' won't be a key term. The claim is modified semantically.
  findings.push({ test: "E-embedded-javascript", isError: e.isError, text: (e.text || e.error || "").slice(0, 400) });

  // ─── Test F: Claim with only year numbers (keyTerms = [year]) ────────────
  console.log("Test F: claim with only 4-digit year as meaningful term");
  const f = await callVerify(client, { claim: "The event occurred in 1969 and changed everything for all of humanity" });
  console.log("  isError:", f.isError, "text:", (f.text || f.error || "").slice(0, 400));
  findings.push({ test: "F-year-only-claim", isError: f.isError, text: (f.text || f.error || "").slice(0, 400) });

  // ─── Test G: Error format consistency ────────────────────────────────────
  // Check that Zod errors vs runtime INVALID_PARAMS errors have consistent format
  console.log("Test G: Compare error formats - Zod vs runtime");
  const zodErr = await callVerify(client, { claim: "short" }); // < 10 chars → Zod error
  const runtimeErr = await callVerify(client, { claim: "a".repeat(1001) }); // > 1000 → runtime error
  console.log("  Zod error format:");
  console.log("   ", zodErr.text.slice(0, 250));
  console.log("  Runtime error format:");
  console.log("   ", runtimeErr.text.slice(0, 250));
  findings.push({ test: "G-error-format-comparison", zodErr: zodErr.text.slice(0, 300), runtimeErr: runtimeErr.text.slice(0, 300) });

  // ─── Test H: Verify output structure when search returns empty ───────────
  // Check all fields of the 'Verify Unavailable' response
  console.log("Test H: Verify Unavailable response structure");
  const h = await callVerify(client, { claim: "NASA landed humans on the Moon in 1969 Apollo mission" });
  const hText = h.text || "";
  const checks = {
    hasVerifyUnavailableHeader: hText.includes("## Verify Unavailable"),
    hasFixLink: hText.includes("https://dashboard.novada.com/overview/scraper/"),
    hasAgentInstruction: hText.includes("agent_status: search_unavailable"),
    hasDoNotInterpret: hText.includes("do_not_interpret_as: genuine_insufficient_data"),
    doesNotShowVerdict: !hText.includes("verdict:"),
    doesNotShowConfidence: !hText.includes("confidence:"),
    doesNotShowSupportingEvidence: !hText.includes("## Supporting Evidence"),
  };
  console.log("  Checks:", JSON.stringify(checks, null, 2));
  findings.push({ test: "H-unavailable-structure", checks });

  // ─── Test I: Schema validation - extra fields are stripped ───────────────
  console.log("Test I: Extra unknown fields in args (Zod strips)");
  const i = await callVerify(client, {
    claim: "Earth is approximately 4.5 billion years old",
    context: "scientific consensus",
    unknownField: "injected",
    anotherField: 12345
  });
  console.log("  isError:", i.isError, "text:", (i.text || i.error || "").slice(0, 200));
  findings.push({ test: "I-extra-fields", isError: i.isError, text: (i.text || i.error || "").slice(0, 200) });

  // ─── Test J: Claim with quote chars (embedded in query string) ───────────
  // The query template: `"${claim}" evidence...`
  // If claim contains a quote char ", it could close/reopen the quoted query
  console.log("Test J: claim with double-quotes");
  const j = await callVerify(client, { claim: 'They said "the Earth is flat" in some research published here' });
  console.log("  isError:", j.isError, "text:", (j.text || j.error || "").slice(0, 300));
  findings.push({ test: "J-double-quotes", isError: j.isError, text: (j.text || j.error || "").slice(0, 300) });

  // ─── Test K: Claim with single-line newline-like unicode ─────────────────
  // Line separator U+2028 and paragraph separator U+2029 are NOT in /[\0\r\n]/ check
  // but they might cause issues in query strings
  console.log("Test K: claim with Unicode line separator (U+2028)");
  const k = await callVerify(client, { claim: "The Earth  is round and orbits  the Sun in our solar system" });
  console.log("  isError:", k.isError, "text:", (k.text || k.error || "").slice(0, 300));
  findings.push({ test: "K-unicode-line-sep", isError: k.isError, text: (k.text || k.error || "").slice(0, 300) });

  // ─── Test L: Verdict confidence calculation ──────────────────────────────
  // With dummy key, we can't test real verdict logic.
  // But we CAN inspect the code path for when queries all fail vs only 1 fails.
  // The 'dataIncomplete' flag: supportingResult.failed || skepticalResult.failed
  // This means if ONLY the neutral query fails, dataIncomplete is false
  // And if all 3 fail, we get 'Verify Unavailable'
  console.log("Test L: Verify unavailable message");
  const l = await callVerify(client, { claim: "Einstein invented the theory of general relativity in physics" });
  const lText = l.text || "";
  // Check that it's properly using search_unavailable not genuine_insufficient_data
  const proper = lText.includes("do_not_interpret_as: genuine_insufficient_data");
  console.log("  Properly differentiates unavailable from insufficient_data:", proper);
  findings.push({ test: "L-unavailable-differentiated", result: proper, text: lText.slice(0, 300) });

  // ─── Test M: isError flag on invalid_params ──────────────────────────────
  // MCP contract: isError=true when tool call fails
  console.log("Test M: isError flag on Zod validation failure");
  const m = await callVerify(client, { claim: "x" });
  console.log("  isError:", m.isError, "(should be true)");
  findings.push({ test: "M-iserror-flag-zod", isError: m.isError });

  // Test N: isError=undefined vs isError=false semantics
  // When search unavailable, result is NOT an error — it's a success response with no results
  console.log("Test N: isError on search unavailable (should NOT be error)");
  const n = await callVerify(client, { claim: "Water is made of hydrogen and oxygen molecules everywhere" });
  console.log("  isError:", n.isError, "(should be undefined/false - search unavailable is not an error)");
  findings.push({ test: "N-iserror-unavailable", isError: n.isError });

  await client.close();
  return findings;
}

runAll().then(findings => {
  console.log("\n=== ROUND 2 FULL RESULTS ===");
  console.log(JSON.stringify(findings, null, 2));
  import("fs").then(fs => {
    fs.writeFileSync("/tmp/novada-qa-0.9.0/raw-results-2.json", JSON.stringify(findings, null, 2));
    console.log("Results written to /tmp/novada-qa-0.9.0/raw-results-2.json");
  });
}).catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
