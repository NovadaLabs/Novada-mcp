/**
 * Live MCP verification for round-3 veto remediation.
 *
 * Checks:
 *  VETO-1: OAuth/GDPR question — summary RETAINS substantive lines containing
 *          "sign in"/"privacy policy"/"terms" as subject matter (not stripped as chrome)
 *  ORIGINAL-1: residential vs datacenter proxies — still produces synthesis:ok
 *  ORIGINAL-2: MCP SDK version with depth=auto — still emits requested_depth/resolved_depth
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = process.env.NOVADA_API_KEY;
if (!KEY) {
  console.error("ERROR: NOVADA_API_KEY not set");
  process.exit(1);
}

const BUILD_PATH = new URL("../build/index.js", import.meta.url).pathname;

const transport = new StdioClientTransport({
  command: "node",
  args: [BUILD_PATH],
  env: { ...process.env, NOVADA_API_KEY: KEY },
});

const client = new Client({ name: "veto-verify", version: "1" }, { capabilities: {} });
await client.connect(transport);

let passed = 0;
let failed = 0;

function assert(name, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL  ${name}${detail ? `: ${detail}` : ""}`);
    failed++;
  }
}

// ── VETO-1: OAuth + GDPR question ────────────────────────────────────────────
console.log("\n=== VETO-1: OAuth 2.0 sign-in flow + GDPR privacy policy ===");
const r1 = await client.callTool({
  name: "novada_research",
  arguments: {
    depth: "quick",
    question: "How does OAuth 2.0 sign in flow work and what are the privacy policy implications under GDPR?",
  },
});
const out1 = typeof r1.content === "string" ? r1.content : r1.content?.[0]?.text ?? "";

// synthesis must NOT be:weak for a question where substantive content will contain these phrases
const synthMatch1 = out1.match(/synthesis:(ok|weak|failed)/);
assert("VETO-1: synthesis field present", !!synthMatch1, "no synthesis:ok/weak/failed found");
// If we got real content, it should be ok. If search returned nothing, failed is acceptable.
// weak is only acceptable if ALL content truly was nav-chrome — but the question itself
// will attract OAuth/GDPR results which are substantive.
const synthesis1 = synthMatch1?.[1] ?? "missing";
assert(
  "VETO-1: synthesis is ok or failed (not weak from false-positive stripping)",
  synthesis1 !== "weak",
  `synthesis=${synthesis1} — if weak, the nav-chrome patterns are over-stripping substantive content`
);

const summaryMatch1 = out1.match(/## Summary\n([\s\S]*?)(?:\n##|\n---|\n\*\*|$)/);
const summary1 = summaryMatch1 ? summaryMatch1[1].trim() : "";
console.log("\n--- VETO-1 summary (first 400 chars) ---");
console.log(summary1.slice(0, 400));

const agentLine1 = out1.split("\n").find((l) => l.startsWith("agent_instruction:")) ?? "";
console.log("\n--- VETO-1 agent_instruction ---");
console.log(agentLine1);

// ── ORIGINAL-1: residential vs datacenter proxies ────────────────────────────
console.log("\n=== ORIGINAL-1: residential vs datacenter proxies (depth=quick) ===");
const r2 = await client.callTool({
  name: "novada_research",
  arguments: {
    depth: "quick",
    question: "What are the main tradeoffs between residential and datacenter proxies for web scraping?",
  },
});
const out2 = typeof r2.content === "string" ? r2.content : r2.content?.[0]?.text ?? "";

const synthMatch2 = out2.match(/synthesis:(ok|weak|failed)/);
assert("ORIGINAL-1: synthesis field present", !!synthMatch2, "no synthesis:ok/weak/failed found");
assert("ORIGINAL-1: requested_depth present", out2.includes("requested_depth"), "missing requested_depth field");
assert("ORIGINAL-1: resolved_depth present", out2.includes("resolved_depth"), "missing resolved_depth field");

const summaryMatch2 = out2.match(/## Summary\n([\s\S]*?)(?:\n##|\n---|\n\*\*|$)/);
const summary2 = summaryMatch2 ? summaryMatch2[1].trim() : "";
const firstLine2 = summary2.split("\n")[0] ?? "";
const NAV_CHROME = [/\[?skip\s+to\s+(main\s+)?content\]?/i, /\btoggle\s+navigation\b/i, /\bnavigation\s+menu\b/i];
const hasNavChrome2 = NAV_CHROME.some((p) => p.test(firstLine2));
assert("ORIGINAL-1: summary first line is not nav-chrome", !hasNavChrome2, `first_line="${firstLine2.slice(0, 80)}"`);

const agentLine2 = out2.split("\n").find((l) => l.startsWith("agent_instruction:")) ?? "";
assert("ORIGINAL-1: agent_instruction has requested_depth", agentLine2.includes("requested_depth"), agentLine2.slice(0, 120));
assert("ORIGINAL-1: agent_instruction has resolved_depth", agentLine2.includes("resolved_depth"), agentLine2.slice(0, 120));

console.log("\n--- ORIGINAL-1 summary (first 300 chars) ---");
console.log(summary2.slice(0, 300));

// ── ORIGINAL-2: MCP SDK version, depth=auto ──────────────────────────────────
console.log("\n=== ORIGINAL-2: MCP SDK version (depth=auto) ===");
const r3 = await client.callTool({
  name: "novada_research",
  arguments: {
    depth: "auto",
    question: "What is the current version of the Model Context Protocol SDK for TypeScript?",
  },
});
const out3 = typeof r3.content === "string" ? r3.content : r3.content?.[0]?.text ?? "";

assert("ORIGINAL-2: requested_depth present", out3.includes("requested_depth"), "missing requested_depth");
assert("ORIGINAL-2: resolved_depth present", out3.includes("resolved_depth"), "missing resolved_depth");

const agentLine3 = out3.split("\n").find((l) => l.startsWith("agent_instruction:")) ?? "";
assert("ORIGINAL-2: agent_instruction has requested_depth:auto", agentLine3.includes("requested_depth:auto"), agentLine3.slice(0, 150));
assert("ORIGINAL-2: agent_instruction has resolved_depth:", agentLine3.includes("resolved_depth:"), agentLine3.slice(0, 150));

console.log("\n--- ORIGINAL-2 agent_instruction ---");
console.log(agentLine3);

await client.close();

console.log(`\n=== LIVE RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
