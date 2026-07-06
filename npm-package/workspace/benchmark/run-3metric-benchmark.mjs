#!/usr/bin/env node
/**
 * 3-Metric Benchmark: LATENCY, CHARACTERS, STRUCTURED DATA
 * Run: node run-3metric-benchmark.mjs
 */

import { novadaExtract } from '../../build/tools/extract.js';
import { novadaScrape } from '../../build/tools/scrape.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const API_KEY = '1f35b477c9e1802778ec64aee2a6adfa';
const OUT_DIR = '/Users/tongwu/Projects/novada-mcp/workspace/benchmark';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---- URL definitions ----
const LATENCY_URLS = [
  'https://example.com',
  'https://httpbin.org/get',
  'https://docs.python.org/3/tutorial/introduction.html',
  'https://nodejs.org/en/docs',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
  'https://www.paulgraham.com/todo.html',
  'https://quotes.toscrape.com/',
  'https://books.toscrape.com/',
  'https://jsonplaceholder.typicode.com/',
  'https://github.com/trending',
];

const CONTENT_URLS = [
  'https://en.wikipedia.org/wiki/Web_scraping',
  'https://news.ycombinator.com/',
  'https://www.bbc.com/news',
  'https://techcrunch.com/',
  'https://medium.com/',
  'https://stackoverflow.com/questions/tagged/python',
  'https://css-tricks.com/',
  'https://www.smashingmagazine.com/',
];

// For structured: also specify expected fields
const STRUCTURED_TASKS = [
  { url: 'https://quotes.toscrape.com/', fields: ['title', 'text', 'author'], label: 'quotes-page' },
  { url: 'https://books.toscrape.com/', fields: ['title', 'price', 'rating'], label: 'books-page' },
  { url: 'https://jsonplaceholder.typicode.com/posts', fields: ['userId', 'id', 'title', 'body'], label: 'json-api' },
  { url: 'https://httpbin.org/json', fields: ['slideshow', 'title', 'date'], label: 'httpbin-json' },
  { url: 'https://www.goodreads.com/', fields: ['title', 'author', 'rating'], label: 'goodreads' },
  { url: 'https://news.ycombinator.com/', fields: ['title', 'score', 'comments'], label: 'hn-structured' },
  { url: 'https://quotes.toscrape.com/page/2/', fields: ['text', 'author', 'tags'], label: 'quotes-page2' },
];

// Also try Amazon scraper (as scrape tool)
const AMAZON_TASK = {
  asin: 'B07XKX5RM8',
  label: 'amazon-product',
};

function scoreContent(text) {
  if (typeof text !== 'string') return 0;
  const hasCode = text.includes('```') || text.includes('    ') || text.includes('\t');
  const hasHeadings = /^#{1,3} /m.test(text) || text.includes('## ');
  const hasLinks = text.includes('[') && text.includes('](');
  const noNavPollution = !text.toLowerCase().includes('cookie consent') &&
    !text.toLowerCase().includes('accept all cookies') &&
    !text.toLowerCase().includes('we use cookies');
  const hasMeaningfulContent = text.length > 500;
  const score = [hasCode, hasHeadings, hasLinks, noNavPollution, hasMeaningfulContent].filter(Boolean).length;
  return score;
}

function hasStructuredFields(text, fields) {
  if (typeof text !== 'string') return { found: 0, total: fields.length, ratio: 0, detail: [] };
  const detail = fields.map(f => {
    // Check if the field appears meaningfully in the output
    const patterns = [
      new RegExp(f, 'i'),
      new RegExp(f.replace(/_/g, ' '), 'i'),
    ];
    const found = patterns.some(p => p.test(text));
    return { field: f, found };
  });
  const found = detail.filter(d => d.found).length;
  return { found, total: fields.length, ratio: found / fields.length, detail };
}

async function runExtract(url, extraParams = {}) {
  const start = Date.now();
  let result = null;
  let error = null;
  try {
    result = await novadaExtract(
      { url, format: 'markdown', render: 'auto', max_chars: 50000, ...extraParams },
      API_KEY
    );
  } catch (e) {
    error = e.message || String(e);
  }
  const latencyMs = Date.now() - start;
  const text = typeof result === 'string' ? result : '';
  const chars = text.length;
  const qualityScore = scoreContent(text);
  const success = chars > 300 && !text.startsWith('## Extract Failed') && !error;
  return { url, latencyMs, chars, qualityScore, success, error: error || null };
}

async function runExtractWithFields(url, fields, label) {
  const start = Date.now();
  let result = null;
  let error = null;
  try {
    result = await novadaExtract(
      { url, format: 'markdown', render: 'auto', fields, max_chars: 50000 },
      API_KEY
    );
  } catch (e) {
    error = e.message || String(e);
  }
  const latencyMs = Date.now() - start;
  const text = typeof result === 'string' ? result : '';
  const chars = text.length;
  const fieldResult = hasStructuredFields(text, fields);
  const success = chars > 200 && !text.startsWith('## Extract Failed') && !error && fieldResult.ratio >= 0.5;
  return {
    url, label, latencyMs, chars, fields,
    fieldsFound: fieldResult.found,
    fieldsTotal: fieldResult.total,
    fieldsRatio: fieldResult.ratio,
    fieldDetail: fieldResult.detail,
    qualityScore: scoreContent(text),
    success,
    error: error || null,
  };
}

async function runAmazonScrape(asin) {
  const start = Date.now();
  let result = null;
  let error = null;
  try {
    result = await novadaScrape(
      {
        platform: 'amazon.com',
        operation: 'amazon_product_asin',
        params: { asin },
        limit: 1,
        format: 'markdown',
      },
      API_KEY
    );
  } catch (e) {
    error = e.message || String(e);
  }
  const latencyMs = Date.now() - start;
  const text = typeof result === 'string' ? result : '';
  const fields = ['title', 'price', 'rating', 'description'];
  const fieldResult = hasStructuredFields(text, fields);
  const success = text.length > 100 && !error && fieldResult.ratio >= 0.5;
  return {
    url: `amazon.com/dp/${asin}`,
    label: 'amazon-product',
    latencyMs,
    chars: text.length,
    fields,
    fieldsFound: fieldResult.found,
    fieldsTotal: fieldResult.total,
    fieldsRatio: fieldResult.ratio,
    fieldDetail: fieldResult.detail,
    qualityScore: scoreContent(text),
    success,
    error: error || null,
    tool: 'novada_scrape',
  };
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(Math.floor(sorted.length * p / 100), sorted.length - 1);
  return sorted[idx];
}

function avg(arr) {
  if (!arr.length) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

// ---- Main run ----
async function main() {
  const allResults = [];
  const latencyResults = [];
  const contentResults = [];
  const structuredResults = [];

  console.log('=== 3-Metric Benchmark starting ===');
  console.log(`Total URLs: ${LATENCY_URLS.length + CONTENT_URLS.length + STRUCTURED_TASKS.length + 1}`);
  console.log('');

  // Category 1: LATENCY (10 URLs)
  console.log('--- Category 1: LATENCY ---');
  for (const url of LATENCY_URLS) {
    console.log(`  Testing: ${url}`);
    const r = await runExtract(url);
    r.category = 'latency';
    latencyResults.push(r);
    allResults.push(r);
    console.log(`    latency=${r.latencyMs}ms chars=${r.chars} quality=${r.qualityScore} success=${r.success}`);
    await sleep(1000);
  }

  // Category 2: CONTENT QUALITY (8 URLs)
  console.log('\n--- Category 2: CONTENT QUALITY ---');
  for (const url of CONTENT_URLS) {
    console.log(`  Testing: ${url}`);
    const r = await runExtract(url);
    r.category = 'content';
    contentResults.push(r);
    allResults.push(r);
    console.log(`    latency=${r.latencyMs}ms chars=${r.chars} quality=${r.qualityScore} success=${r.success}`);
    await sleep(1000);
  }

  // Category 3: STRUCTURED DATA (7 tasks + Amazon)
  console.log('\n--- Category 3: STRUCTURED DATA ---');
  for (const task of STRUCTURED_TASKS) {
    console.log(`  Testing: ${task.url} fields=${task.fields.join(',')}`);
    const r = await runExtractWithFields(task.url, task.fields, task.label);
    r.category = 'structured';
    structuredResults.push(r);
    allResults.push(r);
    console.log(`    latency=${r.latencyMs}ms chars=${r.chars} fields=${r.fieldsFound}/${r.fieldsTotal} success=${r.success}`);
    await sleep(1000);
  }
  // Amazon scrape
  console.log(`  Testing: Amazon ASIN B07XKX5RM8 (novada_scrape)`);
  const amazonR = await runAmazonScrape('B07XKX5RM8');
  amazonR.category = 'structured';
  structuredResults.push(amazonR);
  allResults.push(amazonR);
  console.log(`    latency=${amazonR.latencyMs}ms chars=${amazonR.chars} fields=${amazonR.fieldsFound}/${amazonR.fieldsTotal} success=${amazonR.success}`);

  // ---- Compute stats ----
  const allLatencies = allResults.map(r => r.latencyMs);
  const successLatencies = allResults.filter(r => r.success).map(r => r.latencyMs);
  const allChars = allResults.filter(r => r.success).map(r => r.chars);
  const highQualityChars = allResults.filter(r => r.success && r.qualityScore >= 3).map(r => r.chars);

  // Latency category stats
  const latSucc = latencyResults.filter(r => r.success).map(r => r.latencyMs);
  const contentSucc = contentResults.filter(r => r.success).map(r => r.latencyMs);
  const structSucc = structuredResults.filter(r => r.success).map(r => r.latencyMs);

  // Structured data success rate
  const structSuccessRate = structuredResults.filter(r => r.success).length / structuredResults.length;

  const stats = {
    overall: {
      total: allResults.length,
      successful: allResults.filter(r => r.success).length,
      successRate: allResults.filter(r => r.success).length / allResults.length,
      p50LatencyMs: percentile(allLatencies, 50),
      p95LatencyMs: percentile(allLatencies, 95),
      p50SuccessLatencyMs: percentile(successLatencies, 50),
      p95SuccessLatencyMs: percentile(successLatencies, 95),
      avgChars: avg(allChars),
      medianChars: percentile(allChars, 50),
      avgQualityScore: allResults.filter(r => r.success).reduce((s, r) => s + r.qualityScore, 0) / allResults.filter(r => r.success).length,
      usefulCharsRatio: highQualityChars.length / allChars.length,
    },
    latencyCategory: {
      total: latencyResults.length,
      successful: latencyResults.filter(r => r.success).length,
      successRate: latencyResults.filter(r => r.success).length / latencyResults.length,
      p50Ms: percentile(latSucc, 50),
      p95Ms: percentile(latSucc, 95),
      avgChars: avg(latencyResults.filter(r => r.success).map(r => r.chars)),
    },
    contentCategory: {
      total: contentResults.length,
      successful: contentResults.filter(r => r.success).length,
      successRate: contentResults.filter(r => r.success).length / contentResults.length,
      p50Ms: percentile(contentSucc, 50),
      p95Ms: percentile(contentSucc, 95),
      avgChars: avg(contentResults.filter(r => r.success).map(r => r.chars)),
    },
    structuredCategory: {
      total: structuredResults.length,
      successful: structuredResults.filter(r => r.success).length,
      successRate: structSuccessRate,
      p50Ms: percentile(structSucc, 50),
      p95Ms: percentile(structSucc, 95),
      avgFieldsRatio: structuredResults.reduce((s, r) => s + (r.fieldsRatio || 0), 0) / structuredResults.length,
    },
  };

  const output = {
    runDate: new Date().toISOString(),
    results: allResults,
    stats,
    baselines: {
      firecrawl: { p50LatencyMs: 508, p95LatencyMs: 844, avgChars: 15460, medianChars: 15599, structuredSuccessRate: 0.75, overallSuccessRate: 0.925 },
      tavily: { p50LatencyMs: 119, p95LatencyMs: 185, avgChars: 11417, medianChars: 8855, structuredSuccessRate: 0.75, overallSuccessRate: 0.863 },
      novadaPrevious: { p50LatencyMs: 577, p95LatencyMs: 2589, avgChars: 10558, medianChars: 6125, structuredSuccessRate: 0.90, overallSuccessRate: 0.913 },
    },
  };

  writeFileSync(join(OUT_DIR, 'raw-3metric-results.json'), JSON.stringify(output, null, 2));
  console.log('\n=== Raw results saved ===');
  console.log(JSON.stringify(stats, null, 2));

  return output;
}

main().catch(e => { console.error(e); process.exit(1); });
