#!/usr/bin/env node
/**
 * Search Quality Benchmark v2 — uses actual SDKs for all 3 providers
 */
import { novadaSearch } from "../build/tools/search.js";

const NOVADA_API_KEY = process.env.NOVADA_API_KEY || "";
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "";
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

const KEYWORDS = [
  "TypeScript generics best practices",
  "Rust async await tutorial 2024",
  "Python dataclass vs pydantic comparison",
  "Docker multi-stage build optimization",
  "PostgreSQL query optimization indexes",
  "Redis caching strategies patterns",
  "GraphQL vs REST API when to use",
  "quantum computing explained",
  "climate change renewable energy solutions",
  "large language model transformer architecture",
  "reinforcement learning from human feedback RLHF",
  "diffusion model image generation stable diffusion",
  "product market fit startup metrics",
  "open source alternatives to Notion",
  "SQLite vs PostgreSQL when to choose",
  "WebAssembly WASM use cases 2025",
  "Kubernetes vs Docker Swarm comparison",
  "machine learning model deployment best practices",
  "API rate limiting strategies backend",
  "serverless vs containers architecture",
  "observability monitoring tracing OpenTelemetry",
  "React Server Components vs Client Components",
  "database indexing strategies B-tree hash",
  "microservices communication patterns gRPC",
];

const TIMEOUT_MS = 30000;

async function searchNovada(query) {
  const start = Date.now();
  try {
    const result = await novadaSearch(
      { query, engine: "google", num: 5, country: "", language: "" },
      NOVADA_API_KEY
    );
    const success = typeof result === "string" && result.length > 100 && !result.includes("error");
    // Count results by counting "##" headings or URL patterns
    const urlMatches = (result.match(/https?:\/\//g) || []).length;
    return { provider: "novada", query, success, latencyMs: Date.now() - start, resultCount: Math.min(urlMatches, 5), contentLen: result.length };
  } catch (e) {
    return { provider: "novada", query, success: false, latencyMs: Date.now() - start, error: e.message, resultCount: 0, contentLen: 0 };
  }
}

async function searchFirecrawl(query) {
  const start = Date.now();
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${FIRECRAWL_API_KEY}` },
      body: JSON.stringify({ query, limit: 5 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json();
    const results = data?.data || [];
    return { provider: "firecrawl", query, success: res.ok && results.length > 0, latencyMs: Date.now() - start, resultCount: results.length, contentLen: results.reduce((a, r) => a + (r.markdown?.length || 0), 0) };
  } catch (e) {
    return { provider: "firecrawl", query, success: false, latencyMs: Date.now() - start, error: e.message, resultCount: 0, contentLen: 0 };
  }
}

async function searchTavily(query) {
  const start = Date.now();
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query, max_results: 5, search_depth: "basic" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json();
    const results = data?.results || [];
    return { provider: "tavily", query, success: res.ok && results.length > 0, latencyMs: Date.now() - start, resultCount: results.length, contentLen: results.reduce((a, r) => a + (r.content?.length || 0), 0) };
  } catch (e) {
    return { provider: "tavily", query, success: false, latencyMs: Date.now() - start, error: e.message, resultCount: 0, contentLen: 0 };
  }
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s.length % 2 ? s[Math.floor(s.length/2)] : (s[s.length/2-1]+s[s.length/2])/2;
}

async function main() {
  const providers = [
    ...(NOVADA_API_KEY ? [{ name: "novada", fn: searchNovada }] : []),
    ...(FIRECRAWL_API_KEY ? [{ name: "firecrawl", fn: searchFirecrawl }] : []),
    ...(TAVILY_API_KEY ? [{ name: "tavily", fn: searchTavily }] : []),
  ];

  console.log(`\n=== Search Quality Benchmark v2 ===`);
  console.log(`Providers: ${providers.map(p=>p.name).join(", ")} | Keywords: ${KEYWORDS.length} | Total: ${KEYWORDS.length*providers.length}\n`);

  const all = [];
  let done = 0;
  for (const kw of KEYWORDS) {
    const results = await Promise.all(providers.map(p => p.fn(kw)));
    all.push(...results);
    done += providers.length;
    const pct = ((done/(KEYWORDS.length*providers.length))*100).toFixed(0);
    const line = results.map(r => `${r.provider[0].toUpperCase()}:${r.success?`✓${r.latencyMs}ms`:"✗"}`).join(" ");
    process.stdout.write(`\r[${done}/${KEYWORDS.length*providers.length}] ${pct}% | "${kw.slice(0,38)}" | ${line}    `);
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n\n${"=".repeat(80)}`);
  console.log(`SUMMARY`);
  console.log(`${"=".repeat(80)}\n`);
  console.log(`${"Provider".padEnd(14)} ${"Success".padEnd(10)} ${"P50 ms".padEnd(10)} ${"Avg Results".padEnd(13)} ${"Avg Content".padEnd(14)}`);
  console.log("-".repeat(65));
  for (const p of providers) {
    const pr = all.filter(r => r.provider === p.name);
    const s = pr.filter(r => r.success);
    const lats = s.map(r => r.latencyMs);
    const avgR = s.length ? (s.reduce((a,r)=>a+r.resultCount,0)/s.length).toFixed(1) : "—";
    const avgC = s.length ? `${(s.reduce((a,r)=>a+r.contentLen,0)/s.length/1000).toFixed(1)}K` : "—";
    console.log(`${p.name.padEnd(14)} ${(s.length/pr.length*100).toFixed(1).padEnd(10)}% ${median(lats).toFixed(0).padEnd(10)} ${avgR.padEnd(13)} ${avgC.padEnd(14)}`);
  }

  // Failed keywords per provider
  console.log(`\nFailed keywords:`);
  for (const p of providers) {
    const failed = all.filter(r => r.provider === p.name && !r.success);
    if (failed.length) console.log(`  ${p.name}: ${failed.map(r=>`"${r.query.slice(0,30)}"`).join(", ")}`);
    else console.log(`  ${p.name}: none`);
  }

  const dateStr = new Date().toISOString().slice(0,10);
  const { writeFileSync } = await import("node:fs");
  const out = `benchmark/results/${dateStr}-search-v2.json`;
  writeFileSync(out, JSON.stringify({ date: dateStr, results: all }, null, 2));
  console.log(`\nSaved: ${out}`);
}

main().catch(e => { console.error(e); process.exit(1); });
