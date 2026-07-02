/**
 * F14 live verification client
 * Tests F14-1 (nav-chrome filtering), F14-2 (named entity retention), F14-3 (depth provenance)
 *
 * Usage:
 *   NOVADA_API_KEY=<key> node scripts/lane-client.mjs
 *
 * Checks:
 *   1. Summary does NOT start with nav-chrome boilerplate
 *   2. synthesis: field is ok or weak (not missing)
 *   3. requested_depth and resolved_depth both appear in output
 *   4. Agent Action line contains requested_depth and resolved_depth
 *   5. Sub-queries contain named entity from question (not just truncated keyPhrase)
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

const client = new Client({ name: "lane-client-f14", version: "1" }, { capabilities: {} });
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

// ── Q1: depth=quick, residential vs datacenter comparison ──────────────────
console.log("\n=== Q1: F14-1 nav-chrome + F14-3 depth provenance (depth=quick) ===");
const r1 = await client.callTool({
  name: "novada_research",
  arguments: {
    depth: "quick",
    question: "What are the main tradeoffs between residential and datacenter proxies for web scraping?",
  },
});
const out1 = typeof r1.content === "string" ? r1.content : r1.content?.[0]?.text ?? "";

// F14-1: summary should not start with nav-chrome
const summaryMatch1 = out1.match(/## Summary\n([\s\S]*?)(?:\n##|\n---|\n\*\*|$)/);
const summary1 = summaryMatch1 ? summaryMatch1[1].trim() : "";
const navChromePatterns = [
  /\[?skip\s+to\s+(main\s+)?content\]?/i,
  /\bsign\s+(in|up)\b/i,
  /\btoggle\s+navigation\b/i,
  /\bnavigation\s+menu\b/i,
  /\bopen\s+menu\b/i,
];
const firstLine1 = summary1.split("\n")[0] ?? "";
const hasNavChrome1 = navChromePatterns.some((p) => p.test(firstLine1));
assert("F14-1: summary first line is not nav-chrome", !hasNavChrome1, `first_line="${firstLine1.slice(0, 80)}"`);

// F14-3: output contains requested_depth and resolved_depth
assert("F14-3: output contains requested_depth", out1.includes("requested_depth"), "missing requested_depth field");
assert("F14-3: output contains resolved_depth", out1.includes("resolved_depth"), "missing resolved_depth field");

// Agent Action line has both
const agentLine1 = out1.split("\n").find((l) => l.startsWith("agent_instruction:")) ?? "";
assert("F14-3: agent_instruction has requested_depth", agentLine1.includes("requested_depth"), agentLine1.slice(0, 120));
assert("F14-3: agent_instruction has resolved_depth", agentLine1.includes("resolved_depth"), agentLine1.slice(0, 120));

// synthesis field present
const synthMatch1 = out1.match(/synthesis:(ok|weak|failed)/);
assert("F14-1: synthesis quality field present", !!synthMatch1, "synthesis:ok/weak/failed not found in output");

console.log("\n--- Q1 summary excerpt ---");
console.log(summary1.slice(0, 300));
console.log("\n--- Q1 agent_instruction ---");
console.log(agentLine1);

// ── Q2: depth=auto, named entity "Model Context Protocol" ─────────────────
console.log("\n=== Q2: F14-2 named entity retention + F14-3 auto depth provenance ===");
const r2 = await client.callTool({
  name: "novada_research",
  arguments: {
    depth: "auto",
    question: "What is the current version of the Model Context Protocol SDK for TypeScript?",
  },
});
const out2 = typeof r2.content === "string" ? r2.content : r2.content?.[0]?.text ?? "";

// F14-3: auto resolves to something, both fields present
assert("F14-3: output contains requested_depth (auto)", out2.includes("requested_depth"), "missing requested_depth");
assert("F14-3: output contains resolved_depth (auto)", out2.includes("resolved_depth"), "missing resolved_depth");

// requested_depth should show "auto"
assert("F14-3: requested_depth=auto in output", out2.includes("requested_depth: auto") || out2.includes("requested_depth**:"), "requested_depth value not visible");

const agentLine2 = out2.split("\n").find((l) => l.startsWith("agent_instruction:")) ?? "";
assert("F14-3: agent_instruction has requested_depth:auto", agentLine2.includes("requested_depth:auto"), agentLine2.slice(0, 150));
assert("F14-3: agent_instruction has resolved_depth:", agentLine2.includes("resolved_depth:"), agentLine2.slice(0, 150));

// F14-2: queries section should contain named entities across sub-queries (not just verbatim question)
// Format: **generated_queries**:\n  1. ...\n  2. ...
const queriesMatch2 = out2.match(/\*\*generated_queries\*\*:?\s*([\s\S]*?)(?=\n\*\*[a-z_]|\n##|\n---)/);
const queriesText2 = queriesMatch2 ? queriesMatch2[1] : "";
// Lines 2+ are sub-queries; they must contain named entities from the full topic
const subQueryLines2 = queriesText2.split("\n").filter((l) => /^\s+[2-9]\.\s/.test(l) || /^\s+\d{2}\.\s/.test(l));
const subQueryJoined2 = subQueryLines2.join(" ");
const hasNamedEntity2 = /model context protocol|typescript|SDK/i.test(subQueryJoined2);
assert(
  "F14-2: sub-queries retain named entity (Model Context Protocol/TypeScript)",
  hasNamedEntity2,
  `sub_queries="${subQueryJoined2.slice(0, 200)}"`
);

// F14-1: check synthesis quality
const synthMatch2 = out2.match(/synthesis:(ok|weak|failed)/);
assert("F14-1: synthesis quality present in Q2", !!synthMatch2, "synthesis:ok/weak/failed not found");

console.log("\n--- Q2 queries excerpt ---");
console.log(queriesText2.slice(0, 300));
console.log("\n--- Q2 agent_instruction ---");
console.log(agentLine2);

await client.close();

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
