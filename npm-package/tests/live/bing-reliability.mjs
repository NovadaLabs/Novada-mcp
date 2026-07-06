/**
 * Bing reliability stress test — 10 calls, expect ≥9 pass.
 *
 * Catches backend reliability regression:
 *   POST scraper.novada.com/request with a_auto_push=false
 *   should return {html, task_id} every time.
 *   Currently returns data.data.data=null ~20% of calls (backend race condition).
 *   Our MCP-side retry loop (3 attempts) should absorb this, keeping pass rate ≥90%.
 *
 * Bug report for fudong:
 *   POST scraper.novada.com/request with a_auto_push=false returns data.data.data=null ~20% of calls.
 *   Expected: always returns {html, task_id}. Suspected: backend race condition or cache miss.
 *
 * Usage:
 *   NOVADA_API_KEY=<key> node tests/live/bing-reliability.mjs
 *   Or: npm run test:bing-live
 */

const API_KEY = process.env.NOVADA_API_KEY || '1f35b477c9e1802778ec64aee2a6adfa';

if (!API_KEY) {
  console.error('NOVADA_API_KEY not set');
  process.exit(1);
}

// Set env before importing build — config.js reads these at module load
process.env.NOVADA_API_KEY = API_KEY;

const { novadaSearch } = await import('../../build/tools/search.js');

const RUNS = 10;
const MIN_PASS = 9;
const QUERY = 'apple';

console.log(`Bing reliability test: ${RUNS} runs, threshold ≥${MIN_PASS} pass\n`);

let passes = 0;
let nullReturns = 0;
let errors = 0;

for (let i = 1; i <= RUNS; i++) {
  const start = Date.now();
  try {
    const result = await novadaSearch({ query: QUERY, engine: 'bing', num: 3, country: 'us', language: 'en' }, API_KEY);
    const elapsed = Date.now() - start;

    const hasResults = result.includes('results:') && !result.includes('results:0');
    const isNoResults = result === 'No results found for this query.';

    if (isNoResults) {
      nullReturns++;
      console.log(`  run ${i}: FAIL (no results after 3 retries) [${elapsed}ms]`);
    } else if (hasResults) {
      passes++;
      // Count how many results came back
      const match = result.match(/results:(\d+)/);
      console.log(`  run ${i}: PASS (${match?.[1] ?? '?'} results) [${elapsed}ms]`);
    } else {
      // Has output but no results: field? Check for error markers
      const isError = result.includes('Search Unavailable') || result.includes('Error');
      if (isError) {
        errors++;
        console.log(`  run ${i}: FAIL (error response) [${elapsed}ms]`);
        console.log(`    → ${result.slice(0, 120)}`);
      } else {
        passes++;
        console.log(`  run ${i}: PASS (result present) [${elapsed}ms]`);
      }
    }
  } catch (err) {
    errors++;
    console.log(`  run ${i}: FAIL (exception: ${err.message}) [${Date.now() - start}ms]`);
  }
}

console.log(`\n─────────────────────────────────────────`);
console.log(`Results: ${passes}/${RUNS} passed | null=${nullReturns} | errors=${errors}`);

if (passes >= MIN_PASS) {
  console.log(`✓ PASS — Bing reliability ≥${MIN_PASS}/10 (got ${passes}/10)`);
  process.exit(0);
} else {
  console.log(`✗ FAIL — Bing reliability too low: ${passes}/${RUNS} (threshold: ${MIN_PASS})`);
  if (nullReturns > 1) {
    console.log(`  Backend may be returning data.data.data=null more than expected.`);
    console.log(`  Report to fudong: POST scraper.novada.com/request a_auto_push=false → data.data.data=null rate = ${Math.round(nullReturns/RUNS*100)}%`);
  }
  process.exit(1);
}
