/**
 * QA client for novada_research functional testing
 * Tests: depth modes, dedup, citations, focus param, question length cap, edge cases
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";

async function makeClient() {
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
  });
  const c = new Client({ name: "qa-research", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { client: c, transport: t };
}

async function callResearch(client, args) {
  const start = Date.now();
  try {
    const r = await client.callTool({ name: "novada_research", arguments: args });
    return { result: r, elapsed: Date.now() - start };
  } catch (e) {
    return { error: e, elapsed: Date.now() - start };
  }
}

// ─── SCENARIO DEFINITIONS ──────────────────────────────────────────────────

const scenarios = [
  // SC-01: Basic question/query alias
  {
    id: "SC-01",
    desc: "query alias accepted (instead of question)",
    args: { query: "What is TypeScript?" },
  },
  // SC-02: question param directly
  {
    id: "SC-02",
    desc: "question param directly",
    args: { question: "What is TypeScript?" },
  },
  // SC-03: Neither question nor query — should fail with error
  {
    id: "SC-03",
    desc: "neither question nor query — expects validation error",
    args: { depth: "quick" },
  },
  // SC-04: depth=quick
  {
    id: "SC-04",
    desc: "depth=quick explicit",
    args: { question: "TypeScript generics tutorial", depth: "quick" },
  },
  // SC-05: depth=deep
  {
    id: "SC-05",
    desc: "depth=deep explicit",
    args: { question: "React vs Vue comparison", depth: "deep" },
  },
  // SC-06: depth=comprehensive
  {
    id: "SC-06",
    desc: "depth=comprehensive explicit",
    args: { question: "database indexing strategies", depth: "comprehensive" },
  },
  // SC-07: depth=auto with short question (should resolve to quick)
  {
    id: "SC-07",
    desc: "depth=auto + short simple question → should resolve to quick",
    args: { question: "Python basics", depth: "auto" },
  },
  // SC-08: depth=auto with complex question (should resolve to deep)
  {
    id: "SC-08",
    desc: "depth=auto + complex comparison question → should resolve to deep",
    args: { question: "Compare PostgreSQL versus MySQL for high-write workloads with pros and cons", depth: "auto" },
  },
  // SC-09: focus param provided
  {
    id: "SC-09",
    desc: "focus param guides sub-queries",
    args: { question: "machine learning optimization", focus: "production deployment" },
  },
  // SC-10: question length exactly at 2000 chars (boundary — should pass)
  {
    id: "SC-10",
    desc: "question = 2000 chars exactly (boundary — should pass)",
    args: { question: "x".repeat(1995) + " help?", depth: "quick" },
  },
  // SC-11: question length 2001 chars (one over limit — should fail)
  {
    id: "SC-11",
    desc: "question = 2001 chars (over limit — should fail with INVALID_PARAMS)",
    args: { question: "x".repeat(1996) + " help?", depth: "quick" },
  },
  // SC-12: question length 5000 chars (well over limit — should fail fast)
  {
    id: "SC-12",
    desc: "question = 5000 chars (DoS protection — should fail fast)",
    args: { question: "a".repeat(5000) },
  },
  // SC-13: question exactly 4 chars (below min 5 — should fail)
  {
    id: "SC-13",
    desc: "question = 4 chars (below min 5 — expects validation error)",
    args: { question: "test" },
  },
  // SC-14: question exactly 5 chars (boundary — should pass)
  {
    id: "SC-14",
    desc: "question = 5 chars (min boundary — should pass)",
    args: { question: "hello" },
  },
  // SC-15: invalid depth value
  {
    id: "SC-15",
    desc: "invalid depth value (not in enum) — expects validation error",
    args: { question: "TypeScript tutorial", depth: "ultrafast" },
  },
  // SC-16: project param
  {
    id: "SC-16",
    desc: "project param provided (for output grouping)",
    args: { question: "TypeScript generics", project: "test-project" },
  },
  // SC-17: focus param with empty string
  {
    id: "SC-17",
    desc: "focus param = empty string",
    args: { question: "Python web frameworks", focus: "" },
  },
  // SC-18: both question and query provided (question should win)
  {
    id: "SC-18",
    desc: "both question and query provided (question takes precedence)",
    args: { question: "React hooks", query: "Vue.js hooks" },
  },
  // SC-19: question with leading/trailing whitespace (should be trimmed)
  {
    id: "SC-19",
    desc: "question with leading/trailing whitespace — trimming behavior",
    args: { question: "   TypeScript types   ", depth: "quick" },
  },
  // SC-20: question with only whitespace (should fail after trim)
  {
    id: "SC-20",
    desc: "question with only whitespace chars — should fail after trim",
    args: { question: "     " },
  },
  // SC-21: project name too long (>30 chars)
  {
    id: "SC-21",
    desc: "project name >30 chars — should fail validation",
    args: { question: "TypeScript tutorial", project: "a".repeat(31) },
  },
  // SC-22: question with special chars (injection attempt)
  {
    id: "SC-22",
    desc: "question with injection-like chars (quotes, angle brackets)",
    args: { question: "how to use <script>alert('xss')</script> safely", depth: "quick" },
  },
  // SC-23: question with unicode chars
  {
    id: "SC-23",
    desc: "unicode question (Chinese)",
    args: { question: "TypeScript泛型使用方法", depth: "quick" },
  },
  // SC-24: focus param longer than question
  {
    id: "SC-24",
    desc: "focus param longer than question (no explicit length limit on focus in schema)",
    args: { question: "AI tools", focus: "comparative analysis of enterprise adoption trends with ROI metrics and case studies from Fortune 500 companies in 2024-2025" },
  },
  // SC-25: null values for optional fields
  {
    id: "SC-25",
    desc: "null for optional fields (focus=null, project=null) — should be treated as absent",
    args: { question: "TypeScript tutorial", focus: null, project: null },
  },
];

// Run all scenarios
async function runAll() {
  const { client } = await makeClient();
  const results = [];

  for (const scenario of scenarios) {
    console.log(`\n--- ${scenario.id}: ${scenario.desc} ---`);
    const { result, error, elapsed } = await callResearch(client, scenario.args);

    let content = null;
    let isError = false;
    let errorCode = null;
    let errorMsg = null;

    if (error) {
      isError = true;
      errorMsg = error.message;
      console.log(`ERROR: ${error.message.slice(0, 200)}`);
    } else if (result) {
      isError = result.isError === true;
      if (result.content && result.content[0]) {
        content = result.content[0].text || "";
        console.log(`Content (first 300 chars): ${content.slice(0, 300)}`);
      }
    }

    results.push({
      id: scenario.id,
      desc: scenario.desc,
      args: scenario.args,
      isError,
      errorMsg,
      content: content ? content.slice(0, 2000) : null,
      elapsed,
    });
  }

  await client.close();
  return results;
}

runAll().then(results => {
  console.log("\n\n=== ALL RESULTS ===");
  console.log(JSON.stringify(results, null, 2));
}).catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
