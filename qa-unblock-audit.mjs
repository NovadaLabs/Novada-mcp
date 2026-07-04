/**
 * QA Audit: novada_unblock — AVAILABILITY perspective
 * Tests: render method, browser method, wait_for, timeout ceiling, country validation,
 *        max_chars truncation, camelCase alias (waitFor/maxChars), missing-param errors,
 *        and no-unblocker-key fallback detection.
 */
import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const REAL_KEY = process.env.QA_KEY || 'dummy';
const UNBLOCKER_KEY = process.env.QA_UNBLOCKER_KEY || '';
const BROWSER_WS = process.env.QA_BROWSER_WS || '';

const makeEnv = (withUnblocker = true, withBrowser = false) => ({
  ...process.env,
  NOVADA_API_KEY: REAL_KEY,
  ...(withUnblocker && UNBLOCKER_KEY ? { NOVADA_WEB_UNBLOCKER_KEY: UNBLOCKER_KEY } : {}),
  ...(withBrowser && BROWSER_WS ? { NOVADA_BROWSER_WS: BROWSER_WS } : {}),
});

const results = [];

async function runScenario(label, args, envOptions = {}, expectError = false) {
  const { withUnblocker = true, withBrowser = false } = envOptions;
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
    env: makeEnv(withUnblocker, withBrowser),
  });
  const client = new Client({ name: 'audit', version: '0' }, { capabilities: {} });
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
      textSnippet: text.slice(0, 800),
      expectedError: expectError,
      pass: expectError ? isError : !isError,
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    outcome = {
      label,
      ok: false,
      threw: true,
      elapsed,
      error: err.message?.slice(0, 400),
      code: err.code,
      expectedError: expectError,
      pass: expectError ? true : false,
    };
  } finally {
    await client.close().catch(() => {});
  }

  console.log(`[${outcome.pass ? 'PASS' : 'FAIL'}] ${label} (${outcome.elapsed}ms)`);
  if (!outcome.pass) {
    console.log('  UNEXPECTED:', JSON.stringify(outcome).slice(0, 400));
  } else if (outcome.textSnippet) {
    console.log('  snippet:', outcome.textSnippet.slice(0, 200).replace(/\n/g, ' '));
  }
  results.push(outcome);
  return outcome;
}

// ── S1: render method — basic JS page ──────────────────────────────────────
await runScenario('S1-render-httpbin', {
  url: 'https://httpbin.org/html',
  method: 'render',
  timeout: 30000,
});

// ── S2: render method — JSON response (tests normalizeToString) ───────────
await runScenario('S2-render-json', {
  url: 'https://httpbin.org/json',
  method: 'render',
  timeout: 30000,
});

// ── S3: browser method — uses Browser API CDP ─────────────────────────────
await runScenario('S3-browser-method', {
  url: 'https://httpbin.org/html',
  method: 'browser',
  timeout: 30000,
}, { withBrowser: true });

// ── S4: wait_for — CSS selector ───────────────────────────────────────────
await runScenario('S4-wait_for-selector', {
  url: 'https://httpbin.org/html',
  method: 'render',
  wait_for: 'h1',
  timeout: 30000,
});

// ── S5: camelCase alias waitFor → wait_for ────────────────────────────────
await runScenario('S5-camelCase-waitFor-alias', {
  url: 'https://httpbin.org/html',
  method: 'render',
  waitFor: 'h1',
  timeout: 30000,
});

// ── S6: max_chars truncation ──────────────────────────────────────────────
await runScenario('S6-max_chars-truncation', {
  url: 'https://httpbin.org/html',
  method: 'render',
  max_chars: 1000,
  timeout: 30000,
});

// ── S7: camelCase alias maxChars → max_chars ──────────────────────────────
await runScenario('S7-camelCase-maxChars-alias', {
  url: 'https://httpbin.org/html',
  method: 'render',
  maxChars: 1000,
  timeout: 30000,
});

// ── S8: country parameter passed ─────────────────────────────────────────
await runScenario('S8-country-us', {
  url: 'https://httpbin.org/get',
  method: 'render',
  country: 'us',
  timeout: 30000,
});

// ── S9: country invalid (non-alpha 2-char) — should schema-reject ─────────
await runScenario('S9-country-invalid-notalpha', {
  url: 'https://httpbin.org/get',
  method: 'render',
  country: '!!',
  timeout: 30000,
}, {}, false); // Note: schema only checks length=2, not alpha — so this may NOT fail

// ── S10: country 1-char — should fail schema (length=2) ──────────────────
await runScenario('S10-country-1char-schemaerr', {
  url: 'https://httpbin.org/get',
  method: 'render',
  country: 'u',
  timeout: 30000,
}, {}, true);

// ── S11: missing url — should fail ───────────────────────────────────────
await runScenario('S11-missing-url', {
  method: 'render',
  timeout: 30000,
}, {}, true);

// ── S12: timeout at ceiling (120000) — schema should accept ──────────────
await runScenario('S12-timeout-ceiling', {
  url: 'https://httpbin.org/html',
  method: 'render',
  timeout: 120000,
});

// ── S13: timeout below min (4999) — schema should reject ─────────────────
await runScenario('S13-timeout-below-min', {
  url: 'https://httpbin.org/html',
  method: 'render',
  timeout: 4999,
}, {}, true);

// ── S14: timeout above max (120001) — schema should reject ───────────────
await runScenario('S14-timeout-above-max', {
  url: 'https://httpbin.org/html',
  method: 'render',
  timeout: 120001,
}, {}, true);

// ── S15: render without NOVADA_WEB_UNBLOCKER_KEY (fallback to render-failed) ──
await runScenario('S15-render-no-unblocker-key', {
  url: 'https://httpbin.org/html',
  method: 'render',
  timeout: 30000,
}, { withUnblocker: false });

// ── S16: JS-heavy SPA page via render method ─────────────────────────────
await runScenario('S16-render-spa-cloudflare', {
  url: 'https://example.com',
  method: 'render',
  timeout: 30000,
});

// ── S17: max_chars=500000 (ceiling) ──────────────────────────────────────
await runScenario('S17-max_chars-at-ceiling', {
  url: 'https://httpbin.org/html',
  method: 'render',
  max_chars: 500000,
  timeout: 30000,
});

// ── S18: max_chars below min (999) — schema should reject ────────────────
await runScenario('S18-max_chars-below-min', {
  url: 'https://httpbin.org/html',
  method: 'render',
  max_chars: 999,
  timeout: 30000,
}, {}, true);

// ── S19: SSRF — internal IP (should reject) ──────────────────────────────
await runScenario('S19-ssrf-internal-ip', {
  url: 'http://127.0.0.1/secret',
  method: 'render',
  timeout: 30000,
}, {}, true);

// ── S20: invalid URL — schema should reject ───────────────────────────────
await runScenario('S20-invalid-url', {
  url: 'not-a-url',
  method: 'render',
  timeout: 30000,
}, {}, true);

// Summary
console.log('\n=== SUMMARY ===');
const pass = results.filter(r => r.pass).length;
const fail = results.filter(r => !r.pass).length;
console.log(`PASS: ${pass} / ${results.length}`);
console.log(`FAIL: ${fail}`);

const failures = results.filter(r => !r.pass);
if (failures.length) {
  console.log('\nFailed scenarios:');
  failures.forEach(f => console.log(' -', f.label, JSON.stringify(f).slice(0, 500)));
}

console.log('\n=== RAW RESULTS ===');
console.log(JSON.stringify(results, null, 2));
