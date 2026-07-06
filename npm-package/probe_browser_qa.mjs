#!/usr/bin/env node
// QA Red-team probe for novada_browser tool

import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const CREDS = {
  NOVADA_API_KEY: 'process.env.NOVADA_API_KEY',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
  NOVADA_BROWSER_WS: 'wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com',
};

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
    env: { ...process.env, ...CREDS },
  });

  const client = new Client({ name: 'qa-probe', version: '1.0.0' });
  await client.connect(transport);

  // Step 1: List tools and grab novada_browser schema
  console.log('=== STEP 1: listTools ===');
  const toolsResult = await client.listTools();
  const browserTool = toolsResult.tools.find(t => t.name === 'novada_browser');
  if (!browserTool) {
    console.error('novada_browser NOT FOUND in tool list');
    process.exit(1);
  }
  console.log('Found tool:', browserTool.name);
  console.log('Schema:', JSON.stringify(browserTool.inputSchema, null, 2));

  async function call(label, args) {
    console.log(`\n=== ${label} ===`);
    console.log('Args:', JSON.stringify(args, null, 2));
    try {
      const result = await client.callTool({ name: 'novada_browser', arguments: args });
      console.log('isError:', result.isError);
      console.log('content:', JSON.stringify(result.content, null, 2));
      return result;
    } catch (err) {
      console.log('THREW:', err.code, err.message);
      return { threw: true, code: err.code, message: err.message };
    }
  }

  // --- HAPPY PATH ---
  await call('HAPPY-PATH: navigate + screenshot', {
    actions: [
      { action: 'navigate', url: 'https://example.com', wait_until: 'domcontentloaded' },
      { action: 'screenshot' },
    ],
    timeout: 30000,
  });

  // --- HAPPY PATH 2: aria_snapshot ---
  await call('HAPPY-PATH: navigate + aria_snapshot', {
    actions: [
      { action: 'navigate', url: 'https://example.com', wait_until: 'domcontentloaded' },
      { action: 'aria_snapshot' },
    ],
    timeout: 30000,
  });

  // --- MISSING REQUIRED: no actions ---
  await call('MISSING-REQUIRED: actions omitted', {
    timeout: 10000,
  });

  // --- WRONG TYPE: actions is a string ---
  await call('WRONG-TYPE: actions as string', {
    actions: 'navigate https://example.com',
    timeout: 10000,
  });

  // --- WRONG TYPE: timeout as string ---
  await call('WRONG-TYPE: timeout as string', {
    actions: [{ action: 'navigate', url: 'https://example.com', wait_until: 'domcontentloaded' }],
    timeout: '10000',
  });

  // --- EMPTY ACTIONS ARRAY ---
  await call('BOUNDARY: empty actions array', {
    actions: [],
    timeout: 10000,
  });

  // --- TOO MANY ACTIONS (>20) ---
  const manyActions = Array.from({ length: 25 }, (_, i) => ({
    action: 'wait',
    ms: 100,
  }));
  await call('BOUNDARY: 25 actions (>20 max)', {
    actions: manyActions,
    timeout: 30000,
  });

  // --- UNKNOWN EXTRA PARAM ---
  await call('EXTRA-PARAM: unknown field injected', {
    actions: [{ action: 'navigate', url: 'https://example.com', wait_until: 'domcontentloaded' }],
    timeout: 10000,
    EVIL_EXTRA: 'should_be_ignored_or_rejected',
  });

  // --- INVALID ACTION TYPE ---
  await call('INVALID-ACTION: unknown action type', {
    actions: [{ action: 'INVALID_ACTION_XYZ', url: 'https://example.com' }],
    timeout: 10000,
  });

  // --- MISSING REQUIRED ACTION FIELD ---
  await call('MISSING-ACTION-FIELD: navigate without url', {
    actions: [{ action: 'navigate', wait_until: 'domcontentloaded' }],
    timeout: 10000,
  });

  // --- HUGE UNICODE/INJECTION in url ---
  await call('INJECTION: JS in url', {
    actions: [{ action: 'navigate', url: 'javascript:alert(1)', wait_until: 'domcontentloaded' }],
    timeout: 10000,
  });

  // --- INJECTION in session_id ---
  await call('INJECTION: path traversal in session_id', {
    actions: [{ action: 'navigate', url: 'https://example.com', wait_until: 'domcontentloaded' }],
    session_id: '../../../etc/passwd',
    timeout: 10000,
  });

  // --- BOUNDARY: timeout at minimum ---
  await call('BOUNDARY: timeout=5000 (min)', {
    actions: [{ action: 'navigate', url: 'https://example.com', wait_until: 'domcontentloaded' }],
    timeout: 5000,
  });

  // --- BOUNDARY: timeout at maximum ---
  await call('BOUNDARY: timeout=120000 (max)', {
    actions: [{ action: 'navigate', url: 'https://example.com', wait_until: 'domcontentloaded' }],
    timeout: 120000,
  });

  // --- BOUNDARY: timeout beyond max ---
  await call('BOUNDARY: timeout=999999 (over max)', {
    actions: [{ action: 'navigate', url: 'https://example.com', wait_until: 'domcontentloaded' }],
    timeout: 999999,
  });

  // --- EVALUATE action ---
  await call('EVAL: evaluate script action', {
    actions: [
      { action: 'navigate', url: 'https://example.com', wait_until: 'domcontentloaded' },
      { action: 'evaluate', script: 'document.title' },
    ],
    timeout: 30000,
  });

  // --- COUNTRY param ---
  await call('HAPPY-PATH: with country=us', {
    actions: [
      { action: 'navigate', url: 'https://example.com', wait_until: 'domcontentloaded' },
      { action: 'screenshot' },
    ],
    timeout: 30000,
    country: 'us',
  });

  // --- INVALID COUNTRY ---
  await call('INVALID: country=INVALIDXYZ', {
    actions: [{ action: 'navigate', url: 'https://example.com', wait_until: 'domcontentloaded' }],
    timeout: 10000,
    country: 'INVALIDXYZ',
  });

  // --- NULL session_id ---
  await call('NULL session_id', {
    actions: [{ action: 'navigate', url: 'https://example.com', wait_until: 'domcontentloaded' }],
    session_id: null,
    timeout: 10000,
  });

  await client.close();
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
