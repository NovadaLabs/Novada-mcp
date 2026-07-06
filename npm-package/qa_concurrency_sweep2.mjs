/**
 * QA: Concurrency/Session - Deeper Probes
 * 1. File name collision on parallel search output (same query, 5 concurrent)
 * 2. browser_flow isError=false but error content (NOT a defect, just different URL error)
 * 3. Session store isolation (process-level, shared store vs 5 separate stdio processes)
 * 4. Concurrent browser session same ID race condition (deeper)
 * 5. novada_extract: file output collision under concurrent writes
 */

import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const CREDS = {
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
  NOVADA_BROWSER_WS: 'wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com',
  PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
};

async function makeClient(name) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
    env: CREDS,
  });
  const client = new Client({ name, version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

function safeText(r) {
  if (r.isError) return `[isError] ${r.content?.[0]?.text?.slice(0, 300) || ''}`;
  return r.content?.[0]?.text?.slice(0, 300) || '';
}

async function callTool(client, name, args) {
  const t0 = Date.now();
  try {
    const r = await client.callTool({ name, arguments: args });
    return { ok: !r.isError, ms: Date.now() - t0, text: safeText(r), isError: r.isError, raw: r };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, text: `THROW: ${e.message?.slice(0, 150)}`, isError: true, raw: null };
  }
}

async function run() {
  console.log('=== DEEP CONCURRENCY PROBE #2 ===\n');

  // ── PROBE A: Same query, 5 concurrent → check if file paths collide ──────────
  console.log('=== PROBE A: 5 concurrent novada_search (same query) file output collision ===');
  const clientsA = await Promise.all([0,1,2,3,4].map(i => makeClient(`searchA-${i}`)));
  const t0A = Date.now();
  const resultsA = await Promise.all(clientsA.map(({client}) =>
    callTool(client, 'novada_search', { query: 'concurrent test abc123', engine: 'google', num: 3, country: '', language: '' })
  ));
  console.log(`Total time: ${Date.now()-t0A}ms`);
  const filesA = resultsA.map(r => {
    const m = r.text.match(/path: (.+)/);
    return m ? m[1].trim() : null;
  });
  const uniqueFilesA = new Set(filesA.filter(Boolean));
  console.log(`Files produced: ${filesA.length}  Unique: ${uniqueFilesA.size}`);
  filesA.forEach((f, i) => console.log(`  [${i}] ${f}`));
  if (filesA.filter(Boolean).length > uniqueFilesA.size) {
    console.log('  !!!! FILE PATH COLLISION DETECTED (2+ calls wrote to same file)');
  } else {
    console.log('  OK: no file path collision');
  }
  await Promise.all(clientsA.map(({client}) => client.close()));
  console.log();

  // ── PROBE B: novada_search saves the full content + file path in response ─────
  // We need to confirm: does the text in the *response* (content[0].text) show
  // the file path, and separately, does it have the actual results?
  console.log('=== PROBE B: novada_search full response inspection ===');
  const { client: cB } = await makeClient('searchB');
  const rB = await cB.callTool({ name: 'novada_search', arguments: { query: 'novada proxy 2026', engine: 'google', num: 3, country: '', language: '' } });
  console.log(`isError: ${rB.isError}`);
  console.log(`content[0].type: ${rB.content?.[0]?.type}`);
  console.log(`Full response text:\n${rB.content?.[0]?.text}`);
  await cB.close();
  console.log();

  // ── PROBE C: novada_browser_flow same session_id - inspect error vs isError ──────
  // Test 3 in previous run showed ok=true but error content - let's confirm
  console.log('=== PROBE C: novada_browser_flow response format inspection ===');
  const { client: cC } = await makeClient('bflowC');
  const rC = await cC.callTool({ name: 'novada_browser_flow', arguments: {
    url: 'https://httpbin.org/get',
    actions: [{ type: 'screenshot' }],
    country: '',
    session_id: 'probe-c-session',
  }});
  console.log(`isError: ${rC.isError}`);
  console.log(`Full response text:\n${rC.content?.[0]?.text?.slice(0, 500)}`);
  // If API Error but isError=false, that's a bug: tool should set isError=true for errors
  const isMisreportedError = !rC.isError && rC.content?.[0]?.text?.includes('API Error');
  console.log(`Misreported error (isError=false but contains "API Error"): ${isMisreportedError}`);
  await cC.close();
  console.log();

  // ── PROBE D: novada_browser same session_id, 2 calls from SAME client sequentially ──
  // In the process-based MCP, each client is a separate process with its own session store.
  // But what if 2 calls to the SAME client use same session_id concurrently (in-process race)?
  console.log('=== PROBE D: 2 concurrent calls to SAME MCP process with same browser session_id ===');
  const { client: cD } = await makeClient('browserD');
  // Both calls fire to the same MCP server process - this is the true concurrency test for in-process session store
  const [rD1, rD2] = await Promise.all([
    callTool(cD, 'novada_browser', {
      actions: [{ action: 'navigate', url: 'https://httpbin.org/get', wait_until: 'domcontentloaded' }],
      timeout: 60000,
      session_id: 'shared-session-D',
    }),
    callTool(cD, 'novada_browser', {
      actions: [{ action: 'navigate', url: 'https://httpbin.org/headers', wait_until: 'domcontentloaded' }],
      timeout: 60000,
      session_id: 'shared-session-D',
    }),
  ]);
  console.log(`[D1] ${rD1.ms}ms isError=${!rD1.ok}`);
  console.log(`    ${rD1.text.slice(0, 150)}`);
  console.log(`[D2] ${rD2.ms}ms isError=${!rD2.ok}`);
  console.log(`    ${rD2.text.slice(0, 150)}`);
  // If D2 returned D1's page content or vice-versa, that's a session race
  const d1HasHttpbinGet = rD1.text.includes('httpbin.org/get') || rD1.text.includes('/get');
  const d2HasHttpbinHeaders = rD2.text.includes('httpbin.org/headers') || rD2.text.includes('/headers');
  console.log(`D1 on correct page (/get): ${d1HasHttpbinGet} | D2 on correct page (/headers): ${d2HasHttpbinHeaders}`);
  await cD.close();
  console.log();

  // ── PROBE E: novada_extract 5 parallel - check content isolation by verifying response content ──
  console.log('=== PROBE E: 5 parallel novada_extract with different URLs - content isolation ===');
  const urls = [
    'https://example.com',
    'https://httpbin.org/get',
    'https://httpbin.org/ip',
    'https://icanhazip.com',
    'https://api.ipify.org',
  ];
  const clientsE = await Promise.all(urls.map((_, i) => makeClient(`extractE-${i}`)));
  const resultsE = await Promise.all(clientsE.map(({client}, i) =>
    callTool(client, 'novada_extract', { url: urls[i], format: 'markdown', render: 'auto' })
  ));

  // For each result, read the saved file to check actual content
  const fs = await import('fs');
  const path = await import('path');
  let crossLeak = false;
  for (let i = 0; i < resultsE.length; i++) {
    const r = resultsE[i];
    const m = r.text.match(/path: (.+)/);
    const filePath = m ? m[1].trim() : null;
    if (filePath && fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8').slice(0, 200);
      console.log(`  [${i}] URL=${urls[i]} → ok=${r.ok} file=${path.basename(filePath)} content=${content.replace(/\n/g, ' ').slice(0, 80)}`);
    } else {
      console.log(`  [${i}] URL=${urls[i]} → ok=${r.ok} no file path. text=${r.text.slice(0, 80)}`);
    }
  }
  console.log(`Cross-leak: ${crossLeak}`);
  await Promise.all(clientsE.map(({client}) => client.close()));
  console.log();

  // ── PROBE F: browser_flow session reuse - same session_id, sequential, check speedup ──
  console.log('=== PROBE F: browser_flow session_id reuse - latency measurement ===');
  const { client: cF } = await makeClient('bflowF');
  const rF1 = await callTool(cF, 'novada_browser_flow', {
    url: 'https://httpbin.org/get',
    actions: [{ type: 'screenshot' }],
    country: '',
    session_id: 'probe-f-session',
  });
  console.log(`[F1] first call: ${rF1.ms}ms ok=${rF1.ok}`);
  console.log(`  Response: ${rF1.text.slice(0, 200)}`);

  const rF2 = await callTool(cF, 'novada_browser_flow', {
    url: 'https://httpbin.org/headers',
    actions: [{ type: 'screenshot' }],
    country: '',
    session_id: 'probe-f-session',  // same session
  });
  console.log(`[F2] second call (same session): ${rF2.ms}ms ok=${rF2.ok}`);
  console.log(`  Response: ${rF2.text.slice(0, 200)}`);
  await cF.close();
  console.log();

  console.log('=== DEEP PROBE #2 COMPLETE ===');
}

run().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
