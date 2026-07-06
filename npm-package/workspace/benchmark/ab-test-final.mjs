/**
 * A/B Test: improve/final vs v0.7.8 baseline
 *
 * Round 1: Research reliability (5 questions × 3 depths)
 * Round 2: Extract success on hard targets (10 sites)
 * Round 3: Monitor tool validation (3 URLs)
 *
 * Compares against summary-078.json baseline data.
 * Output: ab-test-results.json + console summary
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD = resolve(__dirname, "../../build");
const API_KEY = "1f35b477c9e1802778ec64aee2a6adfa";

// Import from current build (improve/final)
const { novadaResearch } = await import(`${BUILD}/tools/research.js`);
const { novadaExtract } = await import(`${BUILD}/tools/extract.js`);
const { novadaMonitor } = await import(`${BUILD}/tools/monitor.js`);
// clearCache not exported — cache is session-scoped, each test gets unique URLs anyway

// Load baseline data
const baseline = JSON.parse(readFileSync(resolve(__dirname, "summary-078.json"), "utf-8"));

const now = () => Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = { round1: [], round2: [], round3: [], meta: { branch: "improve/final", timestamp: new Date().toISOString(), baseline: "v0.7.8 (summary-078.json)" } };

// ═══ ROUND 1: Research Reliability ═══
console.log("\n═══ ROUND 1: Research Reliability ═══\n");

const researchTests = [
  { q: "What is an API gateway and when do you need one", depth: "quick", label: "R1-quick" },
  { q: "Kong vs Traefik vs Apache APISIX comparison 2026", depth: "deep", label: "R2-deep" },
  { q: "best web scraping tools for AI agents RAG pipelines", depth: "deep", label: "R3-deep" },
  { q: "how to build API gateway from scratch in Go", depth: "quick", label: "R4-quick" },
  { q: "e-commerce price monitoring tools comparison BrightData Oxylabs", depth: "comprehensive", label: "R5-comp" },
];

for (const test of researchTests) {
  console.log(`  ${test.label}: "${test.q}" (${test.depth})...`);
  const t0 = now();
  try {
    const result = await novadaResearch({ question: test.q, depth: test.depth }, API_KEY);
    const elapsed = now() - t0;

    // Parse result metrics
    const queriesMatch = result.match(/queries:\s*(\d+)\/(\d+)/);
    const sourcesMatch = result.match(/sources_extracted:\s*(\d+)/);
    const hasSummary = result.includes("## Summary") && !result.includes("Synthesis unavailable");
    const hasFindings = result.includes("## Key Findings");
    const searchStrategy = result.includes("concurrent") ? "racing" : result.includes("engine") ? "fallback" : "unknown";

    const entry = {
      label: test.label,
      depth: test.depth,
      success: true,
      latency_ms: elapsed,
      queries_succeeded: queriesMatch ? parseInt(queriesMatch[1]) : 0,
      queries_total: queriesMatch ? parseInt(queriesMatch[2]) : 0,
      query_success_rate: queriesMatch ? (parseInt(queriesMatch[1]) / parseInt(queriesMatch[2]) * 100).toFixed(0) + "%" : "N/A",
      sources_extracted: sourcesMatch ? parseInt(sourcesMatch[1]) : 0,
      has_summary: hasSummary,
      has_findings: hasFindings,
      content_length: result.length,
      search_strategy: searchStrategy,
    };
    results.round1.push(entry);
    console.log(`    ✅ ${elapsed}ms | queries: ${entry.queries_succeeded}/${entry.queries_total} | sources: ${entry.sources_extracted} | summary: ${hasSummary ? "yes" : "no"}`);
  } catch (err) {
    results.round1.push({ label: test.label, depth: test.depth, success: false, error: err.message, latency_ms: now() - t0 });
    console.log(`    ❌ FAILED: ${err.message}`);
  }
  await sleep(1000); // Rate limit between research calls
}

// ═══ ROUND 2: Extract Hard Targets ═══
console.log("\n═══ ROUND 2: Extract Hard Targets (10 sites) ═══\n");

const hardTargets = [
  { url: "https://www.amazon.com/dp/B0FTC2PRVZ", label: "Amazon (DataDome)", expected_provider: "datadome" },
  { url: "https://www.zillow.com/homedetails/123-Main-St/12345_zpid/", label: "Zillow (Cloudflare)", expected_provider: "cloudflare" },
  { url: "https://www.indeed.com/jobs?q=software+engineer", label: "Indeed (Cloudflare)", expected_provider: "cloudflare" },
  { url: "https://www.glassdoor.com/Reviews/Google-Reviews-E9079.htm", label: "Glassdoor (Cloudflare)", expected_provider: "cloudflare" },
  { url: "https://www.linkedin.com/company/anthropic", label: "LinkedIn (LinkedIn)", expected_provider: "linkedin" },
  { url: "https://news.ycombinator.com", label: "HN (None)", expected_provider: null },
  { url: "https://techcrunch.com", label: "TechCrunch (None)", expected_provider: null },
  { url: "https://www.g2.com/products/slack/reviews", label: "G2 (Kasada)", expected_provider: "kasada" },
  { url: "https://www.walmart.com/ip/12345", label: "Walmart (PerimeterX)", expected_provider: "perimeterx" },
  { url: "https://example.com", label: "Example (None)", expected_provider: null },
];

for (const target of hardTargets) {
  console.log(`  ${target.label}...`);
  const t0 = now();
  try {
    const result = await novadaExtract({ url: target.url, format: "markdown", render: "auto" }, API_KEY);
    const elapsed = now() - t0;

    // Parse metrics from output
    const qualityMatch = result.match(/quality:(\d+)\/100/);
    const modeMatch = result.match(/mode: (\w+)/);
    const antiBotMatch = result.match(/anti_bot:\s*(\w+)/);
    const contentOk = result.includes("content_ok:true");
    const isExtractFailed = result.includes("## Extract Failed");
    const charMatch = result.match(/chars:(\d+)/);
    const agentAction = result.includes("## Agent Action");

    const entry = {
      label: target.label,
      url: target.url,
      success: !isExtractFailed,
      latency_ms: elapsed,
      quality: qualityMatch ? parseInt(qualityMatch[1]) : 0,
      mode: modeMatch ? modeMatch[1] : "unknown",
      content_ok: contentOk,
      anti_bot_detected: antiBotMatch ? antiBotMatch[1] : null,
      expected_provider: target.expected_provider,
      provider_match: antiBotMatch ? antiBotMatch[1] === target.expected_provider : target.expected_provider === null,
      content_length: charMatch ? parseInt(charMatch[1]) : 0,
      has_agent_action: agentAction,
    };
    results.round2.push(entry);

    const status = entry.success ? "✅" : "❌";
    const abInfo = entry.anti_bot_detected ? ` | anti_bot:${entry.anti_bot_detected}` : "";
    console.log(`    ${status} ${elapsed}ms | quality:${entry.quality}/100 | mode:${entry.mode} | ok:${entry.content_ok}${abInfo} | agent_action:${entry.has_agent_action}`);
  } catch (err) {
    results.round2.push({ label: target.label, url: target.url, success: false, error: err.message, latency_ms: now() - t0 });
    console.log(`    ❌ FAILED: ${err.message}`);
  }
  await sleep(500);
}

// ═══ ROUND 3: Monitor Tool ═══
console.log("\n═══ ROUND 3: Monitor Tool ═══\n");

const monitorTests = [
  { url: "https://news.ycombinator.com", fields: undefined, label: "M1-baseline-nofields" },
  { url: "https://news.ycombinator.com", fields: undefined, label: "M2-unchanged-nofields" },
  { url: "https://example.com", fields: ["title"], label: "M3-baseline-withfields" },
];

for (const test of monitorTests) {
  console.log(`  ${test.label}: ${test.url}...`);
  const t0 = now();
  try {
    const result = await novadaMonitor({ url: test.url, fields: test.fields }, API_KEY);
    const elapsed = now() - t0;

    const isBaseline = /first.check|baseline/i.test(result);
    const isUnchanged = /no.change|unchanged/i.test(result);
    const isChanged = /change.*detected|changed/i.test(result) && !isUnchanged;
    const hasAgentInstruction = /agent_instruction/i.test(result);

    let expectedState;
    if (test.label.includes("baseline")) expectedState = "baseline";
    else if (test.label.includes("unchanged")) expectedState = "unchanged";
    else expectedState = "any";

    let actualState = isBaseline ? "baseline" : isUnchanged ? "unchanged" : isChanged ? "changed" : "unknown";
    const stateCorrect = expectedState === "any" || actualState === expectedState;

    const entry = {
      label: test.label,
      url: test.url,
      success: true,
      latency_ms: elapsed,
      state: actualState,
      expected_state: expectedState,
      state_correct: stateCorrect,
      has_agent_instruction: hasAgentInstruction,
      content_length: result.length,
    };
    results.round3.push(entry);
    console.log(`    ${stateCorrect ? "✅" : "⚠️"} ${elapsed}ms | state:${actualState} (expected:${expectedState}) | agent_instruction:${hasAgentInstruction}`);
  } catch (err) {
    results.round3.push({ label: test.label, url: test.url, success: false, error: err.message, latency_ms: now() - t0 });
    console.log(`    ❌ FAILED: ${err.message}`);
  }
  await sleep(500);
}

// ═══ COMPARISON vs BASELINE ═══
console.log("\n═══ COMPARISON: improve/final vs v0.7.8 baseline ═══\n");

// Baseline metrics from summary-078.json
const baselineNovada = baseline.novada;
const baselineT1 = baselineNovada.T1; // HN static
const baselineT7 = baselineNovada.T7; // TechCrunch static

// Find matching results
const hnResult = results.round2.find(r => r.url.includes("ycombinator"));
const tcResult = results.round2.find(r => r.url.includes("techcrunch"));

const comparison = {
  research: {
    total_tests: results.round1.length,
    successes: results.round1.filter(r => r.success).length,
    avg_query_success: results.round1.filter(r => r.success).reduce((sum, r) => sum + (r.queries_succeeded / r.queries_total), 0) / Math.max(results.round1.filter(r => r.success).length, 1) * 100,
    avg_latency_ms: Math.round(results.round1.filter(r => r.success).reduce((sum, r) => sum + r.latency_ms, 0) / Math.max(results.round1.filter(r => r.success).length, 1)),
    avg_sources: (results.round1.filter(r => r.success).reduce((sum, r) => sum + r.sources_extracted, 0) / Math.max(results.round1.filter(r => r.success).length, 1)).toFixed(1),
    note: "v0.7.8 had no research benchmark (new improvement area)",
  },
  extract_hn: {
    baseline_latency: baselineT1?.latency_median_ms ?? "N/A",
    current_latency: hnResult?.latency_ms ?? "N/A",
    baseline_quality: baselineT1?.quality_median ?? "N/A",
    current_quality: hnResult?.quality ?? "N/A",
    baseline_af: baselineT1?.af_score ?? "N/A",
    current_has_agent_action: hnResult?.has_agent_action ?? false,
  },
  extract_hard_targets: {
    total: results.round2.length,
    successes: results.round2.filter(r => r.success).length,
    success_rate: (results.round2.filter(r => r.success).length / results.round2.length * 100).toFixed(0) + "%",
    anti_bot_detected: results.round2.filter(r => r.anti_bot_detected).length,
    provider_match_rate: (results.round2.filter(r => r.provider_match).length / results.round2.length * 100).toFixed(0) + "%",
    has_agent_action: results.round2.filter(r => r.has_agent_action).length,
    note: "v0.7.8 had no hard target benchmark (new improvement area)",
  },
  monitor: {
    total: results.round3.length,
    successes: results.round3.filter(r => r.success).length,
    state_correct: results.round3.filter(r => r.state_correct).length,
    note: "New tool — no baseline exists",
  },
};

results.comparison = comparison;

console.log("Research:");
console.log(`  Tests: ${comparison.research.successes}/${comparison.research.total_tests} passed`);
console.log(`  Avg query success: ${comparison.research.avg_query_success.toFixed(0)}%`);
console.log(`  Avg sources extracted: ${comparison.research.avg_sources}`);
console.log(`  Avg latency: ${comparison.research.avg_latency_ms}ms`);

console.log("\nExtract (HN comparison):");
console.log(`  Baseline: ${comparison.extract_hn.baseline_latency}ms, quality:${comparison.extract_hn.baseline_quality}`);
console.log(`  Current:  ${comparison.extract_hn.current_latency}ms, quality:${comparison.extract_hn.current_quality}`);
console.log(`  Agent Action: ${comparison.extract_hn.current_has_agent_action ? "YES (new)" : "no"}`);

console.log("\nExtract (hard targets):");
console.log(`  Success: ${comparison.extract_hard_targets.success_rate} (${comparison.extract_hard_targets.successes}/${comparison.extract_hard_targets.total})`);
console.log(`  Anti-bot detected: ${comparison.extract_hard_targets.anti_bot_detected}/${comparison.extract_hard_targets.total}`);
console.log(`  Provider match: ${comparison.extract_hard_targets.provider_match_rate}`);
console.log(`  Agent Action present: ${comparison.extract_hard_targets.has_agent_action}/${comparison.extract_hard_targets.total}`);

console.log("\nMonitor:");
console.log(`  Tests: ${comparison.monitor.successes}/${comparison.monitor.total} passed`);
console.log(`  State detection: ${comparison.monitor.state_correct}/${comparison.monitor.total} correct`);

// Save results
const outPath = resolve(__dirname, "ab-test-results.json");
writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\n✅ Results saved to ${outPath}`);
