/**
 * QA audit client for novada_research — availability perspective.
 * Tests: quick depth, deep depth, focus param, query alias, sub-queries/dedup,
 *        zero-key error path, and output structure quality.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = process.env.QA_KEY || "dummy";
const INDEX = "/Users/tongwu/Projects/novada-mcp/build/index.js";

function makeClient(key) {
  const t = new StdioClientTransport({
    command: "node",
    args: [INDEX],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: key }),
  });
  const c = new Client({ name: "qa-audit-research", version: "0" }, { capabilities: {} });
  return { t, c };
}

async function runTest(label, key, toolArgs, timeoutMs = 90000) {
  const { t, c } = makeClient(key);
  const start = Date.now();
  let result, error;
  try {
    await c.connect(t);
    const r = await Promise.race([
      c.callTool({ name: "novada_research", arguments: toolArgs }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs)),
    ]);
    result = r;
  } catch (e) {
    error = e;
  } finally {
    try { await c.close(); } catch {}
  }
  const elapsed = Date.now() - start;
  return { label, elapsed, result, error };
}

async function main() {
  const results = [];

  // SCENARIO 1: Quick depth — simple factual question
  console.log("[1/6] Quick depth: 'what is novada web scraping api'");
  const s1 = await runTest("quick-depth-simple", KEY, {
    question: "what is novada web scraping api",
    depth: "quick",
  });
  results.push(s1);
  console.log("  elapsed:", s1.elapsed + "ms");
  if (s1.error) {
    console.log("  ERROR:", s1.error.message);
  } else {
    const text = s1.result?.content?.[0]?.text ?? "";
    console.log("  isError:", s1.result?.isError);
    console.log("  length:", text.length);
    console.log("  has ## Research:", text.includes("## Research"));
    console.log("  has ## Summary:", text.includes("## Summary"));
    console.log("  has ## Sources:", text.includes("## Sources"));
    console.log("  has agent_instruction:", text.includes("agent_instruction:"));
    console.log("  queries line:", text.match(/\*\*queries\*\*:[^\n]*/)?.[0]);
    console.log("  depth line:", text.match(/\*\*depth\*\*:[^\n]*/)?.[0]);
    console.log("  first 300 chars:", text.slice(0, 300));
  }

  // SCENARIO 2: Deep depth — comparative question
  console.log("\n[2/6] Deep depth: 'firecrawl vs novada scraping api comparison'");
  const s2 = await runTest("deep-depth-compare", KEY, {
    question: "firecrawl vs novada scraping api comparison",
    depth: "deep",
  }, 120000);
  results.push(s2);
  console.log("  elapsed:", s2.elapsed + "ms");
  if (s2.error) {
    console.log("  ERROR:", s2.error.message);
  } else {
    const text = s2.result?.content?.[0]?.text ?? "";
    console.log("  isError:", s2.result?.isError);
    console.log("  length:", text.length);
    console.log("  has ## Research:", text.includes("## Research"));
    console.log("  has ## Summary:", text.includes("## Summary"));
    console.log("  has ## Key Findings:", text.includes("## Key Findings"));
    console.log("  queries line:", text.match(/\*\*queries\*\*:[^\n]*/)?.[0]);
    console.log("  generated_queries count:", (text.match(/generated_queries/)?.[0] ? text.match(/\n  \d+\./g)?.length : 0));
    console.log("  has sources table:", text.includes("| # | Title |"));
    console.log("  synthesis snippet:", text.slice(text.indexOf("## Summary"), text.indexOf("## Summary") + 400));
  }

  // SCENARIO 3: Focus param
  console.log("\n[3/6] Focus param: 'AI web scraping tools' with focus='pricing and cost comparison'");
  const s3 = await runTest("focus-param", KEY, {
    question: "AI web scraping tools",
    depth: "deep",
    focus: "pricing and cost comparison",
  }, 120000);
  results.push(s3);
  console.log("  elapsed:", s3.elapsed + "ms");
  if (s3.error) {
    console.log("  ERROR:", s3.error.message);
  } else {
    const text = s3.result?.content?.[0]?.text ?? "";
    console.log("  isError:", s3.result?.isError);
    console.log("  length:", text.length);
    // Focus param should cause generated queries to include focus terms
    const hasFocusTerms = text.toLowerCase().includes("pricing") || text.toLowerCase().includes("cost");
    console.log("  focus terms appear in output:", hasFocusTerms);
    console.log("  queries succeeded:", text.match(/\*\*queries\*\*:[^\n]*/)?.[0]);
  }

  // SCENARIO 4: query alias (not 'question')
  console.log("\n[4/6] 'query' alias param instead of 'question'");
  const s4 = await runTest("query-alias", KEY, {
    query: "MCP server web scraping tools 2025",
    depth: "quick",
  });
  results.push(s4);
  console.log("  elapsed:", s4.elapsed + "ms");
  if (s4.error) {
    console.log("  ERROR:", s4.error.message);
  } else {
    const text = s4.result?.content?.[0]?.text ?? "";
    console.log("  isError:", s4.result?.isError);
    console.log("  has ## Research:", text.includes("## Research"));
    console.log("  query appears in header:", text.includes("MCP server web scraping tools 2025"));
    console.log("  length:", text.length);
  }

  // SCENARIO 5: Missing both question and query — should be validation error
  console.log("\n[5/6] Missing question+query — expect validation error");
  const s5 = await runTest("missing-question", KEY, {
    depth: "quick",
  });
  results.push(s5);
  console.log("  elapsed:", s5.elapsed + "ms");
  if (s5.error) {
    console.log("  Got error (expected):", s5.error.message.slice(0, 200));
  } else {
    const text = s5.result?.content?.[0]?.text ?? "";
    console.log("  isError:", s5.result?.isError);
    console.log("  text:", text.slice(0, 300));
  }

  // SCENARIO 6: No API key — should get structured error not crash
  console.log("\n[6/6] No API key — expect structured error");
  const s6 = await runTest("no-api-key", "dummy", {
    question: "web scraping api tools",
    depth: "quick",
  }, 60000);
  results.push(s6);
  console.log("  elapsed:", s6.elapsed + "ms");
  if (s6.error) {
    console.log("  Transport error:", s6.error.message.slice(0, 200));
  } else {
    const text = s6.result?.content?.[0]?.text ?? "";
    console.log("  isError:", s6.result?.isError);
    console.log("  text (first 400):", text.slice(0, 400));
    // Check if error leaks stack traces or internal paths
    const leaksStack = text.includes("at Object.") || text.includes("/Users/") || text.includes("node_modules");
    console.log("  leaks stack/paths:", leaksStack);
  }

  // Output full text of scenario 1 for deep inspection
  if (!s1.error) {
    const text = s1.result?.content?.[0]?.text ?? "";
    console.log("\n\n=== FULL OUTPUT: Scenario 1 (quick depth) ===");
    console.log(text.slice(0, 3000));
    if (text.length > 3000) console.log("... [truncated at 3000 chars, total:", text.length + "]");
  }

  // Output dedup inspection for scenario 2
  if (!s2.error) {
    const text = s2.result?.content?.[0]?.text ?? "";
    console.log("\n=== PARTIAL OUTPUT: Scenario 2 (deep depth) — Sources section ===");
    const srcIdx = text.indexOf("## Sources");
    if (srcIdx >= 0) {
      console.log(text.slice(srcIdx, srcIdx + 800));
    }
    // Check for duplicate URLs in sources
    const urlMatches = text.match(/https?:\/\/[^\s|)]+/g) ?? [];
    const urlSet = new Set(urlMatches);
    console.log("  Total URL occurrences:", urlMatches.length, "Unique:", urlSet.size);
    if (urlMatches.length > urlSet.size) {
      const seen = new Set();
      const dupes = urlMatches.filter(u => seen.has(u) || (seen.add(u) && false));
      console.log("  Duplicate URLs found:", [...new Set(dupes)].slice(0, 5));
    }
  }

  return results;
}

main().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
