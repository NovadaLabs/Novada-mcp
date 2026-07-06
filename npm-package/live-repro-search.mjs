import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "child_process";
import * as path from "path";

const WORKTREE = "/Users/tongwu/Projects/novada-mcp/.worktrees/fix-search-cluster";
const BUILD = path.join(WORKTREE, "build/index.js");

const API_KEY = process.env.NOVADA_API_KEY;
if (!API_KEY) { console.error("NOVADA_API_KEY not set"); process.exit(1); }

function spawnMCP() {
  const proc = spawn("node", [BUILD], {
    env: { ...process.env, NOVADA_API_KEY: API_KEY },
    stdio: ["pipe", "pipe", "inherit"]
  });
  return new StdioClientTransport({ command: "node", args: [BUILD], env: { ...process.env, NOVADA_API_KEY: API_KEY } });
}

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  return result;
}

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [BUILD],
    env: { ...process.env, NOVADA_API_KEY: API_KEY }
  });

  const client = new Client({ name: "verifier", version: "1.0" }, { capabilities: {} });
  await client.connect(transport);
  
  console.log("=== LANE 1: F16 — format=json empty-result path (bing, likely 0 results) ===");
  const r1 = await callTool(client, "novada_search", {
    query: "weather today",
    engine: "bing",
    num: 5,
    format: "json"
  });
  const text1 = r1.content[0].text;
  try {
    const parsed = JSON.parse(text1);
    console.log("L1 JSON.parse: PASS — parsed cleanly");
    console.log("L1 result_count:", parsed.result_count ?? parsed.results?.length ?? "field absent");
    console.log("L1 status:", parsed.status);
  } catch(e) {
    console.log("L1 JSON.parse: FAIL — threw:", e.message.slice(0,80));
    console.log("L1 raw snippet:", text1.slice(0,120));
  }

  console.log("\n=== LANE 2: F15 — time_range annotation ===");
  const r2 = await callTool(client, "novada_search", {
    query: "AI agent news",
    engine: "google",
    num: 5,
    time_range: "week",
    format: "json"
  });
  const text2 = r2.content[0].text;
  try {
    const parsed2 = JSON.parse(text2);
    console.log("L2 JSON.parse: PASS");
    const results = parsed2.results || [];
    const hasAnnotation = results.some(r => "within_time_range" in r);
    const stale = results.filter(r => r.within_time_range === false);
    const warningPresent = !!parsed2.time_range_warning;
    console.log("L2 results count:", results.length);
    console.log("L2 has within_time_range annotation:", hasAnnotation);
    console.log("L2 stale results:", stale.length);
    console.log("L2 time_range_warning present:", warningPresent);
    if (stale.length > 0) {
      console.log("L2 stale items:", stale.map(r => `${r.published||r.date||'no-date'} → within_time_range:${r.within_time_range}`).join("; "));
    }
  } catch(e) {
    console.log("L2 JSON.parse: FAIL — threw:", e.message.slice(0,80));
    console.log("L2 raw snippet:", text2.slice(0,200));
  }

  console.log("\n=== LANE 3: F6 — extract_options nested object, sentinel detection ===");
  const r3 = await callTool(client, "novada_search", {
    query: "novada web scraping API",
    engine: "google",
    num: 5,
    format: "json",
    extract_options: { top_n: 2, format: "json" }
  });
  const text3 = r3.content[0].text;
  try {
    const parsed3 = JSON.parse(text3);
    console.log("L3 JSON.parse: PASS");
    console.log("L3 status:", parsed3.status);
    const results3 = parsed3.results || [];
    let enrichedCount = 0;
    let sentinelFound = false;
    let doubleEncoded = false;
    for (const r of results3) {
      if (r.extracted_content !== undefined) {
        enrichedCount++;
        if (typeof r.extracted_content === "string") {
          if (r.extracted_content.includes("## Extract Failed") || r.extracted_content.includes("Extract Failed")) {
            sentinelFound = true;
            console.log("L3 SENTINEL FOUND in extracted_content — FAIL");
          }
          // check if string looks like JSON-in-string (double encoded)
          if (r.extracted_content.trim().startsWith('{') || r.extracted_content.trim().startsWith('[')) {
            doubleEncoded = true;
            console.log("L3 double-encoded string detected — FAIL");
          }
        }
      }
      if (r.extract_error) {
        console.log("L3 extract_error present:", r.extract_error.slice?.(0,60) || r.extract_error);
      }
    }
    console.log("L3 enriched_count:", enrichedCount);
    console.log("L3 sentinel_in_content:", sentinelFound ? "FAIL" : "PASS");
    console.log("L3 double_encoded:", doubleEncoded ? "FAIL" : "PASS");
    if (parsed3.enrich_failed_count !== undefined) console.log("L3 enrich_failed_count:", parsed3.enrich_failed_count);
    // Check no credential-looking text
    const fullJson = JSON.stringify(parsed3);
    const credLike = /[A-Za-z0-9]{32,}/.test(fullJson);
    console.log("L3 long-token present in output:", credLike ? "WARNING (check manually)" : "clean");
  } catch(e) {
    console.log("L3 JSON.parse: FAIL — threw:", e.message.slice(0,80));
    console.log("L3 raw snippet:", text3.slice(0,200));
  }

  // ─── VETO REMEDIATION: F6a mixed-format (outer=markdown, inner=json) ───────
  console.log("\n=== VETO F6a: outer=markdown + extract_options.format=json — no [object Object] ===");
  const rV1 = await callTool(client, "novada_search", {
    query: "novada web scraping API",
    engine: "google",
    num: 5,
    format: "markdown",
    extract_options: { top_n: 2, format: "json" }
  });
  const textV1 = rV1.content[0].text;
  const hasObjectObject = textV1.includes("[object Object]");
  console.log("V1 [object Object] absent:", hasObjectObject ? "FAIL — found!" : "PASS");
  // Must be markdown (not parseable as JSON at top level)
  let v1IsMarkdown = false;
  try { JSON.parse(textV1); } catch { v1IsMarkdown = true; }
  console.log("V1 is markdown (not JSON):", v1IsMarkdown ? "PASS" : "FAIL");
  // Check extracted_content block if present
  const v1match = textV1.match(/extracted_content:\n([\s\S]*?)(\n##|\n---|\n$)/);
  if (v1match) {
    const contentBlock = v1match[1].trim();
    console.log("V1 extracted_content block found, preview:", contentBlock.slice(0, 80));
    try {
      JSON.parse(contentBlock);
      console.log("V1 extracted_content is re-parseable JSON string: PASS");
    } catch {
      console.log("V1 extracted_content is plain string (not re-parseable JSON): acceptable if not [object Object]");
    }
  } else {
    console.log("V1 no extracted_content block — extraction may have failed gracefully");
  }

  // ─── VETO REMEDIATION: F15 markdown path — time_range_warning ──────────────
  console.log("\n=== VETO F15: time_range=week + format=markdown — freshness in markdown ===");
  const rV2 = await callTool(client, "novada_search", {
    query: "AI agent news",
    engine: "google",
    num: 5,
    format: "markdown",
    time_range: "week"
  });
  const textV2 = rV2.content[0].text;
  let v2IsMarkdown = false;
  try { JSON.parse(textV2); } catch { v2IsMarkdown = true; }
  console.log("V2 is markdown (not JSON):", v2IsMarkdown ? "PASS" : "FAIL");
  const v2HasWithinTrue = textV2.includes("within_time_range: true");
  const v2HasWithinFalse = textV2.includes("within_time_range: false");
  const v2HasWarning = textV2.includes("time_range_warning:");
  const v2HasAnyFreshness = v2HasWithinTrue || v2HasWithinFalse || v2HasWarning;
  console.log("V2 within_time_range:true present:", v2HasWithinTrue);
  console.log("V2 within_time_range:false present:", v2HasWithinFalse);
  console.log("V2 time_range_warning present:", v2HasWarning);
  if (v2HasAnyFreshness) {
    console.log("V2 freshness signal in markdown: PASS");
    if (v2HasWithinFalse && !v2HasWarning) {
      console.log("V2 stale results present but time_range_warning absent: FAIL");
    } else {
      console.log("V2 stale results + top-level warning consistency: PASS");
    }
  } else {
    console.log("V2 no freshness signal yet — upstream returned undated results (annotation not triggered): acceptable");
  }

  await client.close();
  console.log("\n=== DONE ===");
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
