/**
 * QA LIVE: novada_unblock — AVAILABILITY perspective
 * Tests: render method, render-failed fallback, wait_for (render vs browser),
 *        timeout ceiling, max_chars truncation, camelCase aliases, SSRF guard,
 *        missing-url error, country param, large max_chars (500000 ceiling).
 */
import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const REAL_KEY = process.env.QA_KEY || 'dummy';
const UNBLOCKER_KEY = process.env.QA_UNBLOCKER_KEY || REAL_KEY; // same key falls back to NOVADA_API_KEY
const BROWSER_WS = process.env.QA_BROWSER_WS || '';

function makeEnv({ withUnblocker = true, withBrowser = false, noUnblockerKey = false } = {}) {
  const env = { ...process.env, NOVADA_API_KEY: REAL_KEY };
  if (withUnblocker && !noUnblockerKey) {
    env.NOVADA_WEB_UNBLOCKER_KEY = UNBLOCKER_KEY;
  }
  if (withBrowser && BROWSER_WS) {
    env.NOVADA_BROWSER_WS = BROWSER_WS;
  }
  if (noUnblockerKey) {
    delete env.NOVADA_WEB_UNBLOCKER_KEY;
  }
  return env;
}

const results = [];

async function run(label, args, envOpts = {}, expectError = false) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
    env: makeEnv(envOpts),
  });
  const client = new Client({ name: 'qa-unblock-audit', version: '0' }, { capabilities: {} });
  await client.connect(transport);

  const start = Date.now();
  let outcome;
  try {
    const r = await client.callTool({ name: 'novada_unblock', arguments: args });
    const elapsed = Date.now() - start;
    const text = r.content?.[0]?.text ?? '';
    const isError = !!r.isError;
    outcome = {
      label,
      ok: !isError,
      isError,
      elapsed,
      textLen: text.length,
      snippet: text.slice(0, 600),
      expectedError,
      pass: expectError ? isError : !isError,
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    outcome = {
      label,
      ok: false,
      threw: true,
      elapsed,
      error: err.message?.slice(0, 300),
      code: err.code,
      expectedError,
      pass: expectError ? true : false,
    };
  } finally {
    await client.close().catch(() => {});
  }

  const tag = outcome.pass ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${label} (${outcome.elapsed}ms)`);
  if (outcome.snippet) {
    console.log('  snippet:', outcome.snippet.replace(/\n/g, ' ').slice(0, 200));
  }
  if (!outcome.pass) {
    console.log('  UNEXPECTED:', JSON.stringify(outcome).slice(0, 400));
  }
  results.push(outcome);
  return outcome;
}

// ── S1: render method — basic HTML page, real unblocker key ───────────────
await run('S1-render-httpbin-html', {
  url: 'https://httpbin.org/html',
  method: 'render',
  timeout: 40000,
}, { withUnblocker: true });

// ── S2: render method — JSON endpoint (tests normalizeToString) ───────────
await run('S2-render-httpbin-json', {
  url: 'https://httpbin.org/json',
  method: 'render',
  timeout: 40000,
}, { withUnblocker: true });

// ── S3: render without unblocker key → should fallback gracefully ─────────
// The credential resolver falls back to NOVADA_API_KEY when NOVADA_WEB_UNBLOCKER_KEY is absent.
// NOVADA_API_KEY IS set; so this should still attempt render (not render-failed).
// We test explicitly with NO unblocker key env but API_KEY present to observe actual behavior.
await run('S3-render-no-unblocker-key-fallback', {
  url: 'https://httpbin.org/html',
  method: 'render',
  timeout: 30000,
}, { noUnblockerKey: true, withUnblocker: false });

// ── S4: max_chars truncation — default 100000, test with small value ──────
await run('S4-max-chars-small', {
  url: 'https://httpbin.org/html',
  method: 'render',
  timeout: 40000,
  max_chars: 500,
}, { withUnblocker: true });

// ── S5: max_chars at ceiling 500000 ───────────────────────────────────────
await run('S5-max-chars-ceiling', {
  url: 'https://httpbin.org/html',
  method: 'render',
  timeout: 40000,
  max_chars: 500000,
}, { withUnblocker: true });

// ── S6: camelCase alias waitFor ───────────────────────────────────────────
await run('S6-camelCase-waitFor-alias', {
  url: 'https://httpbin.org/html',
  method: 'render',
  timeout: 40000,
  waitFor: 'body',  // camelCase alias → wait_for
}, { withUnblocker: true });

// ── S7: camelCase alias maxChars ──────────────────────────────────────────
await run('S7-camelCase-maxChars-alias', {
  url: 'https://httpbin.org/html',
  method: 'render',
  timeout: 40000,
  maxChars: 1000,
}, { withUnblocker: true });

// ── S8: wait_for with render method (selector NOT sent to unblocker API) ──
// This test checks that wait_for with render method still returns content
// even though the CSS selector is silently dropped (not sent to unblocker API).
await run('S8-wait_for-render-selector-drop', {
  url: 'https://httpbin.org/html',
  method: 'render',
  timeout: 40000,
  wait_for: 'body',
}, { withUnblocker: true });

// ── S9: country param ─────────────────────────────────────────────────────
await run('S9-country-param', {
  url: 'https://httpbin.org/html',
  method: 'render',
  timeout: 40000,
  country: 'us',
}, { withUnblocker: true });

// ── S10: SSRF guard — localhost URL should return validation error ─────────
await run('S10-ssrf-localhost', {
  url: 'http://localhost:8080',
  method: 'render',
  timeout: 5000,
}, { withUnblocker: true }, true /* expectError */);

// ── S11: SSRF guard — private IP ─────────────────────────────────────────
await run('S11-ssrf-private-ip', {
  url: 'http://192.168.1.1',
  method: 'render',
  timeout: 5000,
}, { withUnblocker: true }, true /* expectError */);

// ── S12: missing url — should return validation error ─────────────────────
await run('S12-missing-url', {
  method: 'render',
  timeout: 5000,
}, { withUnblocker: true }, true /* expectError */);

// ── S13: timeout ceiling — pass 200000 (above 120000 ceiling) ────────────
// Should cap at 120000 and not error on the value itself (schema max is 120000)
await run('S13-timeout-above-schema-max', {
  url: 'https://httpbin.org/html',
  method: 'render',
  timeout: 200000,  // above schema max of 120000 — Zod should reject
}, { withUnblocker: true }, true /* expectError */);

// ── S14: timeout at schema minimum 5000 ──────────────────────────────────
await run('S14-timeout-minimum', {
  url: 'https://httpbin.org/html',
  method: 'render',
  timeout: 5000,
}, { withUnblocker: true });

// ── S15: Real JS-heavy page (example.com) ─────────────────────────────────
await run('S15-real-site-render', {
  url: 'https://example.com',
  method: 'render',
  timeout: 40000,
}, { withUnblocker: true });

console.log('\n=== SUMMARY ===');
const passed = results.filter(r => r.pass).length;
console.log(`${passed}/${results.length} scenarios passed`);
results.forEach(r => {
  console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] ${r.label}`);
});

// Write structured results
import { writeFileSync } from 'fs';
writeFileSync('/tmp/novada-audit-0.9.0/unblock-live-results.json', JSON.stringify(results, null, 2));
console.log('\nResults saved to /tmp/novada-audit-0.9.0/unblock-live-results.json');
