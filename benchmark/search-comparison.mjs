#!/usr/bin/env node
/**
 * Keyword Search Quality Benchmark
 * Compares Novada, Firecrawl, and Tavily on search quality
 * Uses only broad, open-topic keywords — no restricted content
 */

const NOVADA_API_KEY = process.env.NOVADA_API_KEY || process.env.NOVADA_SCRAPER_API_KEY;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

const KEYWORDS = [
  // Technical / developer
  "TypeScript generics best practices",
  "Rust async await tutorial",
  "Python dataclass vs pydantic",
  "Docker multi-stage build optimization",
  "Kubernetes horizontal pod autoscaling",
  "PostgreSQL query optimization indexes",
  "Redis caching strategies patterns",
  "GraphQL vs REST API comparison",
  // Science / open knowledge
  "quantum computing explained simply",
  "CRISPR gene editing applications",
  "climate change tipping points 2024",
  "large language model architecture transformer",
  "reinforcement learning from human feedback",
  "diffusion model image generation",
  // Business / product
  "product market fit indicators startup",
  "MRR ARR saas metrics calculation",
  "API monetization strategies",
  "developer tools go to market",
  // Random / varied
  "best open source alternatives to notion",
  "SQLite vs PostgreSQL when to choose",
  "WebAssembly use cases 2025",
  "edge computing vs cloud computing difference",
  "observability monitoring telemetry difference",
  "chaos engineering principles netflix",
];

const TIMEOUT = 30000;

async function searchNovada(query) {
  const start = Date.now();
  try {
    const res = await fetch(`https://scraper-api.novada.ai/v1/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": NOVADA_API_KEY },
      body: JSON.stringify({ query, num: 5, engine: "google" }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = await res.json();
    const results = data?.results || data?.data?.results || [];
    return {
      provider: "novada",
      query,
      success: res.ok && results.length > 0,
      resultCount: results.length,
      latencyMs: Date.now() - start,
      topTitle: results[0]?.title || "",
      topUrl: results[0]?.url || "",
      hasSnippets: results.filter(r => r.snippet || r.description).length,
    };
  } catch (e) {
    return { provider: "novada", query, success: false, latencyMs: Date.now() - start, error: e.message, resultCount: 0 };
  }
}

async function searchFirecrawl(query) {
  const start = Date.now();
  try {
    const res = await fetch(`https://api.firecrawl.dev/v1/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${FIRECRAWL_API_KEY}` },
      body: JSON.stringify({ query, limit: 5 }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = await res.json();
    const results = data?.data || [];
    return {
      provider: "firecrawl",
      query,
      success: res.ok && results.length > 0,
      resultCount: results.length,
      latencyMs: Date.now() - start,
      topTitle: results[0]?.metadata?.title || results[0]?.title || "",
      topUrl: results[0]?.url || "",
      hasSnippets: results.filter(r => r.markdown || r.content).length,
    };
  } catch (e) {
    return { provider: "firecrawl", query, success: false, latencyMs: Date.now() - start, error: e.message, resultCount: 0 };
  }
}

async function searchTavily(query) {
  const start = Date.now();
  try {
    const res = await fetch(`https://api.tavily.com/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query, max_results: 5, search_depth: "basic" }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = await res.json();
    const results = data?.results || [];
    return {
      provider: "tavily",
      query,
      success: res.ok && results.length > 0,
      resultCount: results.length,
      latencyMs: Date.now() - start,
      topTitle: results[0]?.title || "",
      topUrl: results[0]?.url || "",
      hasSnippets: results.filter(r => r.content).length,
    };
  } catch (e) {
    return { provider: "tavily", query, success: false, latencyMs: Date.now() - start, error: e.message, resultCount: 0 };
  }
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

async function main() {
  const providers = [];
  if (NOVADA_API_KEY) providers.push({ name: "novada", fn: searchNovada });
  if (FIRECRAWL_API_KEY) providers.push({ name: "firecrawl", fn: searchFirecrawl });
  if (TAVILY_API_KEY) providers.push({ name: "tavily", fn: searchTavily });

  if (!providers.length) { console.error("No API keys set"); process.exit(1); }

  console.log(`\n=== Keyword Search Benchmark ===`);
  console.log(`Providers: ${providers.map(p => p.name).join(", ")}`);
  console.log(`Keywords: ${KEYWORDS.length}`);
  console.log(`Total requests: ${KEYWORDS.length * providers.length}\n`);

  const allResults = [];
  let done = 0;
  const total = KEYWORDS.length * providers.length;

  for (const kw of KEYWORDS) {
    const results = await Promise.all(providers.map(p => p.fn(kw)));
    allResults.push(...results);
    done += providers.length;
    const pct = ((done / total) * 100).toFixed(0);
    const line = results.map(r => `${r.provider}:${r.success ? `✓(${r.resultCount}/${r.latencyMs}ms)` : `✗`}`).join(" | ");
    process.stdout.write(`\r[${done}/${total}] ${pct}% | ${kw.slice(0, 40).padEnd(40)} | ${line}    `);
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n\n=== Results Summary ===\n`);

  for (const p of providers) {
    const pr = allResults.filter(r => r.provider === p.name);
    const succ = pr.filter(r => r.success);
    const latencies = succ.map(r => r.latencyMs);
    const avgResults = succ.length ? (succ.reduce((a, r) => a + r.resultCount, 0) / succ.length).toFixed(1) : 0;
    const avgSnippets = succ.length ? (succ.reduce((a, r) => a + r.hasSnippets, 0) / succ.length).toFixed(1) : 0;
    console.log(`${p.name.padEnd(12)} ${(succ.length/pr.length*100).toFixed(1)}% success | P50: ${median(latencies).toFixed(0)}ms | Avg results: ${avgResults} | Avg w/snippets: ${avgSnippets}`);
  }

  // Category breakdown
  const categories = [
    { label: "Technical/Dev", keywords: KEYWORDS.slice(0, 8) },
    { label: "Science/AI", keywords: KEYWORDS.slice(8, 16) },
    { label: "Business", keywords: KEYWORDS.slice(16, 20) },
    { label: "Random/Varied", keywords: KEYWORDS.slice(20) },
  ];

  console.log(`\n=== By Category ===\n`);
  for (const cat of categories) {
    console.log(`  ${cat.label}:`);
    for (const p of providers) {
      const pr = allResults.filter(r => r.provider === p.name && cat.keywords.includes(r.query));
      const succ = pr.filter(r => r.success);
      console.log(`    ${p.name.padEnd(12)} ${(succ.length/pr.length*100).toFixed(0)}% | P50: ${median(succ.map(r=>r.latencyMs)).toFixed(0)}ms`);
    }
    console.log();
  }

  // Save JSON
  const dateStr = new Date().toISOString().slice(0, 10);
  const { writeFileSync } = await import("node:fs");
  const outPath = `benchmark/results/${dateStr}-search-comparison.json`;
  writeFileSync(outPath, JSON.stringify({ date: dateStr, results: allResults }, null, 2));
  console.log(`Saved: ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
