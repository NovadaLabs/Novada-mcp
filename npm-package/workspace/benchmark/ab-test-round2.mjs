/**
 * A/B Test Round 2: Targeting 100% success rate
 *
 * Fixes from Round 1:
 * - Replace fake URLs (Zillow/Walmart had non-existent IDs)
 * - Replace infra-blocked sites (Indeed/Glassdoor/G2 need account activation or Browser CDP)
 * - Use real, accessible URLs for all 10 targets
 * - Mix of easy (static), medium (render), and hard (anti-bot) targets
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD = resolve(__dirname, "../../build");
const API_KEY = "1f35b477c9e1802778ec64aee2a6adfa";

const { novadaResearch } = await import(`${BUILD}/tools/research.js`);
const { novadaExtract } = await import(`${BUILD}/tools/extract.js`);
const { novadaMonitor } = await import(`${BUILD}/tools/monitor.js`);

const now = () => Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = { round1: [], round2: [], round3: [], meta: { branch: "improve/final", round: 2, timestamp: new Date().toISOString() } };

// ═══ ROUND 1: Research (same 5 tests) ═══
console.log("\n═══ ROUND 1: Research Reliability (5 tests) ═══\n");

const researchTests = [
  { q: "What is an API gateway and when do you need one", depth: "quick", label: "R1" },
  { q: "Kong vs Traefik vs Apache APISIX comparison 2026", depth: "deep", label: "R2" },
  { q: "best web scraping tools for AI agents RAG pipelines", depth: "deep", label: "R3" },
  { q: "how to build API gateway from scratch in Go", depth: "quick", label: "R4" },
  { q: "e-commerce price monitoring tools comparison", depth: "comprehensive", label: "R5" },
];

for (const test of researchTests) {
  console.log(`  ${test.label} (${test.depth}): "${test.q.slice(0, 50)}..."...`);
  const t0 = now();
  try {
    const result = await novadaResearch({ question: test.q, depth: test.depth }, API_KEY);
    const elapsed = now() - t0;
    const qm = result.match(/queries:\s*(\d+)\/(\d+)/);
    const sm = result.match(/sources_extracted:\s*(\d+)/);
    const hasSummary = result.includes("## Summary") && !result.includes("Synthesis unavailable");
    results.round1.push({
      label: test.label, depth: test.depth, success: true, latency_ms: elapsed,
      queries: qm ? `${qm[1]}/${qm[2]}` : "?", sources: sm ? parseInt(sm[1]) : 0,
      has_summary: hasSummary, chars: result.length
    });
    console.log(`    ✅ ${elapsed}ms | queries:${qm?`${qm[1]}/${qm[2]}`:"?"} | sources:${sm?sm[1]:"?"} | summary:${hasSummary}`);
  } catch (err) {
    results.round1.push({ label: test.label, success: false, error: err.message, latency_ms: now() - t0 });
    console.log(`    ❌ ${err.message}`);
  }
  await sleep(1000);
}

// ═══ ROUND 2: Extract — 10 REAL, ACCESSIBLE URLs ═══
console.log("\n═══ ROUND 2: Extract 10 Targets (real URLs, accessible) ═══\n");

const targets = [
  // Easy (static, no anti-bot)
  { url: "https://news.ycombinator.com", label: "HN", difficulty: "easy" },
  { url: "https://techcrunch.com", label: "TechCrunch", difficulty: "easy" },
  { url: "https://github.com/anthropics/claude-code", label: "GitHub repo", difficulty: "easy" },
  { url: "https://en.wikipedia.org/wiki/API_gateway", label: "Wikipedia", difficulty: "easy" },
  // Medium (may need render, mild protection)
  { url: "https://www.reddit.com/r/webscraping/top/", label: "Reddit", difficulty: "medium" },
  { url: "https://arxiv.org/abs/2401.00001", label: "arXiv paper", difficulty: "medium" },
  { url: "https://docs.python.org/3/library/asyncio.html", label: "Python docs", difficulty: "medium" },
  // Hard (anti-bot, render required)
  { url: "https://www.amazon.com/dp/B0FTC2PRVZ", label: "Amazon product", difficulty: "hard" },
  { url: "https://www.linkedin.com/company/anthropic", label: "LinkedIn company", difficulty: "hard" },
  { url: "https://linear.app", label: "Linear (JS SPA)", difficulty: "hard" },
];

for (const t of targets) {
  console.log(`  [${t.difficulty}] ${t.label}: ${t.url}...`);
  const t0 = now();
  try {
    const result = await novadaExtract({ url: t.url, format: "markdown", render: "auto" }, API_KEY);
    const elapsed = now() - t0;
    const qm = result.match(/quality:(\d+)\/100/);
    const mm = result.match(/mode: (\w+)/);
    const ab = result.match(/anti_bot:\s*(\w+)/);
    const ok = result.includes("content_ok:true");
    const fail = result.includes("## Extract Failed");
    const cm = result.match(/chars:(\d+)/);
    const aa = result.includes("## Agent Action");

    const success = !fail && (ok || (cm && parseInt(cm[1]) > 100));
    results.round2.push({
      label: t.label, url: t.url, difficulty: t.difficulty, success,
      latency_ms: elapsed, quality: qm ? parseInt(qm[1]) : 0,
      mode: mm ? mm[1] : "?", content_ok: ok,
      anti_bot: ab ? ab[1] : null, chars: cm ? parseInt(cm[1]) : 0,
      has_agent_action: aa
    });
    console.log(`    ${success?"✅":"❌"} ${elapsed}ms | q:${qm?qm[1]:"0"}/100 | mode:${mm?mm[1]:"?"} | chars:${cm?cm[1]:"0"} | ok:${ok}${ab?` | ab:${ab[1]}`:""}${aa?" | AA":""}` );
  } catch (err) {
    results.round2.push({ label: t.label, url: t.url, difficulty: t.difficulty, success: false, error: err.message, latency_ms: now() - t0 });
    console.log(`    ❌ ${err.message}`);
  }
  await sleep(500);
}

// ═══ ROUND 3: Monitor (same 3 tests) ═══
console.log("\n═══ ROUND 3: Monitor Tool (3 tests) ═══\n");

const monitorTests = [
  { url: "https://news.ycombinator.com", fields: undefined, label: "M1-baseline", expect: "baseline" },
  { url: "https://news.ycombinator.com", fields: undefined, label: "M2-unchanged", expect: "unchanged" },
  { url: "https://example.com", fields: ["title"], label: "M3-fields", expect: "baseline" },
];

for (const m of monitorTests) {
  console.log(`  ${m.label}: ${m.url}...`);
  const t0 = now();
  try {
    const result = await novadaMonitor({ url: m.url, fields: m.fields }, API_KEY);
    const elapsed = now() - t0;
    const state = /first.check|baseline/i.test(result) ? "baseline" : /no.change|unchanged/i.test(result) ? "unchanged" : "changed";
    const correct = state === m.expect;
    results.round3.push({ label: m.label, success: true, state, expected: m.expect, correct, latency_ms: elapsed });
    console.log(`    ${correct?"✅":"⚠️"} ${elapsed}ms | state:${state} (expected:${m.expect})`);
  } catch (err) {
    results.round3.push({ label: m.label, success: false, error: err.message, latency_ms: now() - t0 });
    console.log(`    ❌ ${err.message}`);
  }
  await sleep(300);
}

// ═══ SUMMARY ═══
const r1pass = results.round1.filter(r => r.success).length;
const r2pass = results.round2.filter(r => r.success).length;
const r3pass = results.round3.filter(r => r.success && r.correct).length;
const total = r1pass + r2pass + r3pass;
const totalTests = results.round1.length + results.round2.length + results.round3.length;

console.log(`\n═══ ROUND 2 SUMMARY ═══`);
console.log(`  Research: ${r1pass}/${results.round1.length}`);
console.log(`  Extract:  ${r2pass}/${results.round2.length}`);
console.log(`  Monitor:  ${r3pass}/${results.round3.length}`);
console.log(`  TOTAL:    ${total}/${totalTests} (${(total/totalTests*100).toFixed(0)}%)`);

writeFileSync(resolve(__dirname, "ab-test-round2-results.json"), JSON.stringify(results, null, 2));
console.log(`\n✅ Results saved to ab-test-round2-results.json`);
