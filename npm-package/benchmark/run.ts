#!/usr/bin/env tsx
/**
 * Novada Competitive Benchmark Harness
 *
 * Usage:
 *   npx tsx benchmark/run.ts
 *   npx tsx benchmark/run.ts --provider novada --category static --limit 5
 *
 * Environment variables:
 *   NOVADA_API_KEY / NOVADA_SCRAPER_API_KEY — Novada API key (required for Novada)
 *   FIRECRAWL_API_KEY — Firecrawl API key (optional, skips if missing)
 *   TAVILY_API_KEY — Tavily API key (optional, skips if missing)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { NovadaProvider, FirecrawlProvider, TavilyProvider } from "./providers/index.js";
import type { BenchmarkProvider } from "./providers/index.js";
import { aggregateResults, summarizeProvider } from "./stats.js";
import { generateHtmlReport, generateCsv } from "./report.js";
import type {
  BenchmarkConfig,
  BenchmarkReport,
  ExtractionResult,
  ProviderName,
  CategoryName,
  UrlList,
} from "./types.js";
import { CATEGORY_LABELS } from "./types.js";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

if (hasFlag("--help") || hasFlag("-h")) {
  console.log(`
Novada Competitive Benchmark Harness

Usage:
  npx tsx benchmark/run.ts [options]

Options:
  --provider <name>    Run only one provider: novada, firecrawl, tavily
  --category <name>    Run only one category: static, js_heavy, anti_bot, structured
  --limit <n>          Max URLs per category (default: 50 = all)
  --timeout <ms>       Request timeout in ms (default: 30000)
  --help, -h           Show this help

Environment variables:
  NOVADA_API_KEY           Novada API key
  NOVADA_SCRAPER_API_KEY   Novada API key (alias)
  FIRECRAWL_API_KEY        Firecrawl API key (skip if not set)
  TAVILY_API_KEY           Tavily API key (skip if not set)
`);
  process.exit(0);
}

const ALL_PROVIDERS: ProviderName[] = ["novada", "firecrawl", "tavily"];
const ALL_CATEGORIES: CategoryName[] = ["static", "js_heavy", "anti_bot", "structured"];

const providerFilter = getArg("--provider") as ProviderName | undefined;
const categoryFilter = getArg("--category") as CategoryName | undefined;
const limit = parseInt(getArg("--limit") || "50", 10);
const timeout = parseInt(getArg("--timeout") || "30000", 10);

if (providerFilter && !ALL_PROVIDERS.includes(providerFilter)) {
  console.error(`Unknown provider: ${providerFilter}. Must be one of: ${ALL_PROVIDERS.join(", ")}`);
  process.exit(1);
}
if (categoryFilter && !ALL_CATEGORIES.includes(categoryFilter)) {
  console.error(`Unknown category: ${categoryFilter}. Must be one of: ${ALL_CATEGORIES.join(", ")}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");

const urlsPath = resolve(__dirname, "urls.json");
const urls: UrlList = JSON.parse(readFileSync(urlsPath, "utf-8"));

const resultsDir = resolve(__dirname, "results");
if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });

const dateStr = new Date().toISOString().slice(0, 10);

// Initialize providers
const providerInstances: BenchmarkProvider[] = [
  new NovadaProvider(),
  new FirecrawlProvider(),
  new TavilyProvider(),
];

const activeProviders = providerInstances.filter((p) => {
  if (providerFilter && p.name !== providerFilter) return false;
  if (!p.isAvailable()) {
    console.log(`  [skip] ${p.name} — no API key configured`);
    return false;
  }
  return true;
});

const activeCategories = categoryFilter ? [categoryFilter] : ALL_CATEGORIES;

if (activeProviders.length === 0) {
  console.error("\nNo providers available. Set at least one API key:");
  console.error("  NOVADA_API_KEY, FIRECRAWL_API_KEY, or TAVILY_API_KEY");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Progress display
// ---------------------------------------------------------------------------

let completed = 0;
let totalRequests = 0;

function updateProgress(provider: string, url: string, success: boolean): void {
  completed++;
  const pct = ((completed / totalRequests) * 100).toFixed(0);
  const icon = success ? "+" : "x";
  const shortUrl = url.length > 60 ? url.slice(0, 57) + "..." : url;
  process.stdout.write(
    `\r  [${completed}/${totalRequests}] ${pct}% | ${provider} | ${icon} ${shortUrl}                    `
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("\n=== Novada Competitive Benchmark ===\n");
  console.log(`Date:       ${dateStr}`);
  console.log(`Providers:  ${activeProviders.map((p) => p.name).join(", ")}`);
  console.log(`Categories: ${activeCategories.map((c) => CATEGORY_LABELS[c]).join(", ")}`);
  console.log(`Limit:      ${limit} URLs per category`);
  console.log(`Timeout:    ${timeout}ms per request`);
  console.log("");

  // Calculate total
  for (const cat of activeCategories) {
    const catUrls = urls[cat].slice(0, limit);
    totalRequests += catUrls.length * activeProviders.length;
  }

  console.log(`Total requests: ${totalRequests}\n`);

  const results: ExtractionResult[] = [];

  // Run sequentially to avoid rate limits
  for (const cat of activeCategories) {
    const catUrls = urls[cat].slice(0, limit);
    console.log(`\n--- ${CATEGORY_LABELS[cat]} (${catUrls.length} URLs) ---\n`);

    for (const url of catUrls) {
      for (const provider of activeProviders) {
        const result = await provider.extract(url, cat, timeout);
        results.push(result);
        updateProgress(provider.name, url, result.success);
      }
      // Small delay between URLs to be respectful
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log("\n\n=== Aggregating Results ===\n");

  // Aggregate
  const config: BenchmarkConfig = {
    providers: activeProviders.map((p) => p.name),
    categories: activeCategories,
    limit,
    timeout,
    outputDir: resultsDir,
  };

  const aggregated = activeProviders.flatMap((p) =>
    activeCategories.map((c) => aggregateResults(results, p.name, c))
  );

  const summary = activeProviders.map((p) => summarizeProvider(results, p.name));

  const report: BenchmarkReport = {
    runDate: dateStr,
    config,
    results,
    aggregated,
    summary,
  };

  // Write outputs
  const jsonPath = resolve(resultsDir, `${dateStr}-benchmark.json`);
  const htmlPath = resolve(resultsDir, `${dateStr}-benchmark.html`);
  const csvPath = resolve(resultsDir, `${dateStr}-benchmark.csv`);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`  JSON: ${jsonPath}`);

  writeFileSync(htmlPath, generateHtmlReport(report));
  console.log(`  HTML: ${htmlPath}`);

  writeFileSync(csvPath, generateCsv(report));
  console.log(`  CSV:  ${csvPath}`);

  // Print summary to stdout
  console.log("\n=== Summary ===\n");

  const colW = 14;
  const headerLine = [
    "Provider".padEnd(colW),
    "Success".padEnd(colW),
    "P50".padEnd(colW),
    "P95".padEnd(colW),
    "Quality".padEnd(colW),
    "Avg Chars".padEnd(colW),
    "$/1k".padEnd(colW),
  ].join("");
  console.log(headerLine);
  console.log("-".repeat(headerLine.length));

  for (const s of summary) {
    console.log(
      [
        s.provider.padEnd(colW),
        `${(s.overallSuccessRate * 100).toFixed(1)}%`.padEnd(colW),
        `${s.overallLatencyP50}ms`.padEnd(colW),
        `${s.overallLatencyP95}ms`.padEnd(colW),
        `${s.overallAvgQuality.toFixed(1)}/10`.padEnd(colW),
        `${s.overallAvgChars.toLocaleString()}`.padEnd(colW),
        `$${s.estimatedCostPer1k.toFixed(2)}`.padEnd(colW),
      ].join("")
    );
  }

  // Per-category breakdown
  console.log("\n=== Per-Category Breakdown ===\n");

  for (const cat of activeCategories) {
    console.log(`  ${CATEGORY_LABELS[cat]}:`);
    for (const p of activeProviders) {
      const stat = aggregated.find((s) => s.provider === p.name && s.category === cat);
      if (!stat) continue;
      console.log(
        `    ${p.name.padEnd(12)} ${(stat.successRate * 100).toFixed(0)}% success | P50: ${stat.latencyP50}ms | Quality: ${stat.avgQualityScore.toFixed(1)}/10 | ${stat.avgCharCount.toLocaleString()} chars`
      );
    }
    console.log("");
  }

  const failed = results.filter((r) => !r.success).length;
  const succeeded = results.filter((r) => r.success).length;
  console.log(`Done. ${succeeded} succeeded, ${failed} failed out of ${results.length} total requests.\n`);
}

main().catch((err) => {
  console.error("\nBenchmark failed:", err);
  process.exit(1);
});
