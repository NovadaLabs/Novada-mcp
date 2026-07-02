/**
 * novada-mcp v0.8.1 — Live Integration Test
 * Runs all 13 tests against real Novada API endpoints.
 *
 * Usage:
 *   NOVADA_API_KEY=<key> \
 *   NOVADA_PROXY_USER=<user> \
 *   NOVADA_PROXY_PASS=<pass> \
 *   NOVADA_PROXY_ENDPOINT=<host:port> \
 *   NOVADA_BROWSER_WS=<wss://...> \
 *   NOVADA_WEB_UNBLOCKER_KEY=<key> \
 *   node tests/live/integration.mjs
 *
 * All credentials are read from environment variables. The script exits with
 * a clear message naming any missing variables — no defaults are embedded.
 */

// ---- Credential validation — fast-fail before any imports ----

const REQUIRED_ENV_VARS = [
  'NOVADA_API_KEY',
  'NOVADA_PROXY_USER',
  'NOVADA_PROXY_PASS',
  'NOVADA_PROXY_ENDPOINT',
  'NOVADA_BROWSER_WS',
  'NOVADA_WEB_UNBLOCKER_KEY',
];

const missing = REQUIRED_ENV_VARS.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error('ERROR: Missing required environment variables:');
  for (const v of missing) {
    console.error(`  ${v}`);
  }
  console.error('\nSet them before running this script. Example:');
  console.error('  export NOVADA_API_KEY=<key>');
  console.error('  export NOVADA_PROXY_USER=<user>');
  console.error('  export NOVADA_PROXY_PASS=<pass>');
  console.error('  export NOVADA_PROXY_ENDPOINT=<host:port>');
  console.error('  export NOVADA_BROWSER_WS=<wss://...>');
  console.error('  export NOVADA_WEB_UNBLOCKER_KEY=<key>');
  process.exit(1);
}

import { novadaSearch } from '../../build/tools/search.js';
import { novadaExtract } from '../../build/tools/extract.js';
import { novadaCrawl } from '../../build/tools/crawl.js';
import { novadaMap } from '../../build/tools/map.js';
import { novadaProxy } from '../../build/tools/proxy.js';
import { novadaScrape } from '../../build/tools/scrape.js';
import { novadaVerify } from '../../build/tools/verify.js';
import { novadaUnblock } from '../../build/tools/unblock.js';
import { novadaBrowser } from '../../build/tools/browser.js';

const API_KEY = process.env.NOVADA_API_KEY;

// ---- helpers ----

function first200(text) {
  if (!text || typeof text !== 'string') return String(text).slice(0, 200);
  return text.slice(0, 200).replace(/\n/g, ' ');
}

function mask(str) {
  if (!str) return '(not set)';
  return str.slice(0, 4) + '****';
}

const results = [];

async function runTest(id, name, fn) {
  const start = Date.now();
  try {
    const output = await fn();
    const elapsed = Date.now() - start;
    results.push({ id, name, status: 'PASS', elapsed, output, error: null });
    console.log(`[${id.toString().padStart(2, '0')}] ✅ PASS  ${name}  (${elapsed}ms)`);
    console.log(`     Content: ${first200(output)}`);
    return { output, elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    results.push({ id, name, status: 'FAIL', elapsed, output: null, error: errMsg });
    console.log(`[${id.toString().padStart(2, '0')}] ❌ FAIL  ${name}  (${elapsed}ms)`);
    console.log(`     Error: ${errMsg.slice(0, 300)}`);
    return { output: null, elapsed, error: errMsg };
  }
}

// Some tools return "DEGRADED" results — detect common patterns
function assessStatus(output, testNum) {
  if (!output) return 'FAIL';
  const lower = output.toLowerCase();
  // Search unavailable is a known degraded state
  if (testNum === 1 && lower.includes('serp_unavailable') || lower.includes('search unavailable')) return 'DEGRADED';
  if (testNum === 10 && lower.includes('search unavailable')) return 'DEGRADED';
  // Bot challenge detection
  if (lower.includes('access denied') || lower.includes('captcha') || lower.includes('please verify') ||
      lower.includes('403 forbidden') || lower.includes('challenge') && lower.includes('cloudflare')) return 'DEGRADED';
  return 'PASS';
}

console.log('='.repeat(70));
console.log('novada-mcp v0.8.1 — Live Integration Test');
console.log(`API Key: ${mask(API_KEY)}`);
console.log(`Date: ${new Date().toISOString()}`);
console.log('='.repeat(70));
console.log('');

// ---- Test 1: novada_search ----
await runTest(1, 'novada_search (Google SERP)', async () => {
  return await novadaSearch(
    { query: 'Novada proxy API pricing 2024', engine: 'google', num: 5 },
    API_KEY
  );
});

// ---- Test 2: novada_extract static ----
await runTest(2, 'novada_extract example.com (static)', async () => {
  return await novadaExtract(
    { url: 'https://example.com', render: 'static' },
    API_KEY
  );
});

// ---- Test 3: novada_extract JS-heavy (auto) ----
await runTest(3, 'novada_extract Glassdoor (auto)', async () => {
  return await novadaExtract(
    { url: 'https://www.glassdoor.com/Job/jobs.htm', render: 'auto' },
    API_KEY
  );
});

// ---- Test 4: novada_extract Amazon (render) ----
await runTest(4, 'novada_extract Amazon product (render)', async () => {
  return await novadaExtract(
    { url: 'https://www.amazon.com/dp/B0CHX3QBCH', render: 'render' },
    API_KEY
  );
});

// ---- Test 5: novada_extract IP check (proxy) ----
await runTest(5, 'novada_extract IP check via proxy (static)', async () => {
  return await novadaExtract(
    { url: 'https://api.ipify.org?format=json', render: 'static' },
    API_KEY
  );
});

// ---- Test 6: novada_crawl ----
await runTest(6, 'novada_crawl Hacker News (3 pages)', async () => {
  return await novadaCrawl(
    { url: 'https://news.ycombinator.com', max_pages: 3, render: 'static' },
    API_KEY
  );
});

// ---- Test 7: novada_map ----
await runTest(7, 'novada_map example.com (limit 20)', async () => {
  return await novadaMap(
    { url: 'https://example.com', limit: 20 },
    API_KEY
  );
});

// ---- Test 8: novada_proxy ----
await runTest(8, 'novada_proxy (residential, US)', async () => {
  return await novadaProxy(
    { type: 'residential', country: 'us' }
  );
});

// ---- Test 9: novada_scrape Amazon ----
await runTest(9, 'novada_scrape Amazon keyword search', async () => {
  return await novadaScrape(
    {
      platform: 'amazon.com',
      operation: 'amazon_product_by-keywords',
      params: { keyword: 'iPhone 16 Pro' },
      format: 'json',
      limit: 3,
    },
    API_KEY
  );
});

// ---- Test 10: novada_verify ----
await runTest(10, 'novada_verify Eiffel Tower claim', async () => {
  return await novadaVerify(
    { claim: 'The Eiffel Tower is located in Paris, France' },
    API_KEY
  );
});

// ---- Test 11: novada_unblock Cloudflare ----
await runTest(11, 'novada_unblock cloudflare.com (render)', async () => {
  return await novadaUnblock(
    { url: 'https://www.cloudflare.com', render: true },
    API_KEY
  );
});

// ---- Test 12: novada_browser screenshot ----
await runTest(12, 'novada_browser screenshot example.com', async () => {
  return await novadaBrowser(
    { action: 'screenshot', url: 'https://example.com' }
  );
});

// ---- Test 13: novada_browser snapshot ----
await runTest(13, 'novada_browser snapshot example.com', async () => {
  return await novadaBrowser(
    { action: 'snapshot', url: 'https://example.com' }
  );
});

// ---- Final Report ----
console.log('');
console.log('='.repeat(70));
console.log('FINAL REPORT');
console.log('='.repeat(70));
console.log('');

// Re-assess statuses based on content
const finalResults = results.map(r => {
  if (r.status === 'FAIL') return r;
  const assessed = assessStatus(r.output, r.id);
  return { ...r, status: assessed };
});

// Print summary table
console.log('| # | Tool | Status | Time (ms) | Notes |');
console.log('|---|------|--------|-----------|-------|');

for (const r of finalResults) {
  const statusIcon = r.status === 'PASS' ? '✅ PASS' : r.status === 'DEGRADED' ? '⚠️ DEG' : '❌ FAIL';
  const note = r.error
    ? r.error.slice(0, 60)
    : (r.output ? first200(r.output).slice(0, 60) : '');
  console.log(`| ${r.id} | ${r.name} | ${statusIcon} | ${r.elapsed} | ${note} |`);
}

const passing = finalResults.filter(r => r.status === 'PASS').length;
const degraded = finalResults.filter(r => r.status === 'DEGRADED').length;
const failing = finalResults.filter(r => r.status === 'FAIL').length;

console.log('');
console.log(`Overall: ${passing} PASS | ${degraded} DEGRADED | ${failing} FAIL out of ${finalResults.length}`);
console.log('');

// Detailed output for analysis
console.log('='.repeat(70));
console.log('DETAILED OUTPUT (first 400 chars per test)');
console.log('='.repeat(70));
for (const r of finalResults) {
  console.log(`\n--- Test ${r.id}: ${r.name} [${r.status}] ${r.elapsed}ms ---`);
  if (r.error) {
    console.log('ERROR:', r.error.slice(0, 500));
  } else if (r.output) {
    console.log(r.output.slice(0, 400));
  }
}
