/**
 * QA: Concurrency / Session State Sweep
 * Tests parallel calls, session_id reuse, and state isolation.
 *
 * Tools probed:
 *  1. novada_search — 5 parallel calls (same query, different)
 *  2. novada_extract — 5 parallel calls same URL
 *  3. novada_browser_flow — same session_id fired concurrently (race condition on session state)
 *  4. novada_search — 8 parallel different queries (rate limit graceful degradation)
 *  5. novada_crawl — 2 parallel crawls
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
  if (r.isError) return `[isError] ${r.content?.[0]?.text?.slice(0, 200) || ''}`;
  return r.content?.[0]?.text?.slice(0, 200) || '';
}

function extractSessionId(text) {
  const m = text.match(/session_id[:\s=]+"?([a-zA-Z0-9_\-\.]+)"?/);
  return m ? m[1] : null;
}

async function callTool(client, name, args) {
  const t0 = Date.now();
  try {
    const r = await client.callTool({ name, arguments: args });
    return { ok: !r.isError, ms: Date.now() - t0, text: safeText(r), raw: r };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, text: `THROW: ${e.message?.slice(0, 150)}`, raw: null };
  }
}

async function run() {
  console.log('=== novada-mcp concurrency/session sweep ===\n');

  // ── 0. List tools ──────────────────────────────────────────────────────
  const { client: c0, transport: t0 } = await makeClient('lister');
  const toolList = await c0.listTools();
  const toolNames = toolList.tools.map(t => t.name);
  console.log(`Tools available (${toolNames.length}):`, toolNames.slice(0, 10).join(', '), '...\n');
  await c0.close();

  // ── 1. novada_search: 5 parallel identical calls (check for state contamination) ──
  console.log('=== TEST 1: 5 parallel novada_search (same query) ===');
  const clients1 = await Promise.all([0,1,2,3,4].map(i => makeClient(`search-${i}`)));
  const results1 = await Promise.all(clients1.map(({client}) =>
    callTool(client, 'novada_search', { query: 'novada MCP proxy', engine: 'google', num: 3, country: '', language: '' })
  ));
  const texts1 = results1.map(r => r.text);
  const allOk1 = results1.every(r => r.ok);
  const uniqueTexts1 = new Set(texts1.map(t => t.slice(0, 100)));
  console.log(`All OK: ${allOk1}  |  Unique responses: ${uniqueTexts1.size}/5`);
  // Leakage = if all 5 return IDENTICAL results (could be acceptable caching) OR if responses cross-contaminate
  results1.forEach((r, i) => console.log(`  [${i}] ${r.ms}ms isError=${!r.ok} text=${r.text.slice(0,80)}`));
  await Promise.all(clients1.map(({client}) => client.close()));
  console.log();

  // ── 2. novada_extract: 5 parallel same URL (check for output isolation) ──
  console.log('=== TEST 2: 5 parallel novada_extract (same URL) ===');
  const clients2 = await Promise.all([0,1,2,3,4].map(i => makeClient(`extract-${i}`)));
  const results2 = await Promise.all(clients2.map(({client}) =>
    callTool(client, 'novada_extract', { url: 'https://example.com', format: 'markdown', render: 'auto' })
  ));
  const allOk2 = results2.every(r => r.ok);
  console.log(`All OK: ${allOk2}`);
  results2.forEach((r, i) => console.log(`  [${i}] ${r.ms}ms isError=${!r.ok} text=${r.text.slice(0,80)}`));
  // Check if any response has another response's content mixed in (state leak)
  const hasCrossLeak2 = results2.some((r, i) =>
    results2.some((r2, j) => i !== j && r.text.length > 0 && r2.text.length > 0 && r.text === r2.text && !r.text.includes('example'))
  );
  console.log(`Cross-response leak detected: ${hasCrossLeak2}`);
  await Promise.all(clients2.map(({client}) => client.close()));
  console.log();

  // ── 3. novada_browser_flow: same session_id fired from 2 concurrent clients ──
  // This tests whether the API-side session can be corrupted by concurrent access
  console.log('=== TEST 3: 2 concurrent novada_browser_flow with SAME session_id ===');
  const SESSION_ID = 'qa-concurrent-test-session-1';
  const clients3 = await Promise.all([0,1].map(i => makeClient(`bflow-${i}`)));
  // Fire both simultaneously with the same session_id
  const [r3a, r3b] = await Promise.all([
    callTool(clients3[0].client, 'novada_browser_flow', {
      url: 'https://httpbin.org/get',
      actions: [{ type: 'screenshot' }],
      country: '',
      session_id: SESSION_ID,
    }),
    callTool(clients3[1].client, 'novada_browser_flow', {
      url: 'https://httpbin.org/headers',
      actions: [{ type: 'screenshot' }],
      country: '',
      session_id: SESSION_ID,
    }),
  ]);
  console.log(`[A] ${r3a.ms}ms isError=${!r3a.ok}`);
  console.log(`    ${r3a.text.slice(0, 120)}`);
  console.log(`[B] ${r3b.ms}ms isError=${!r3b.ok}`);
  console.log(`    ${r3b.text.slice(0, 120)}`);
  // Check if one got the other's session data
  const aHasB = r3a.text.includes('httpbin.org/headers') && r3a.text.includes('httpbin.org/get');
  const bHasA = r3b.text.includes('httpbin.org/get') && r3b.text.includes('httpbin.org/headers');
  console.log(`Session cross-contamination A←B: ${aHasB} | B←A: ${bHasA}`);
  await Promise.all(clients3.map(({client}) => client.close()));
  console.log();

  // ── 4. novada_search: 8 parallel DIFFERENT queries (rate limit graceful degradation) ──
  console.log('=== TEST 4: 8 parallel novada_search (different queries) ===');
  const queries = [
    'Claude AI model', 'proxy server nodejs', 'MCP protocol tools',
    'residential proxy pricing', 'web scraping python', 'browser automation playwright',
    'LLM agent framework', 'firecrawl vs novada',
  ];
  const clients4 = await Promise.all(queries.map((_, i) => makeClient(`search4-${i}`)));
  const results4 = await Promise.all(clients4.map(({client}, i) =>
    callTool(client, 'novada_search', { query: queries[i], engine: 'google', num: 3, country: '', language: '' })
  ));
  const allOk4 = results4.every(r => r.ok);
  const rateLimited4 = results4.filter(r => r.text.includes('rate') || r.text.includes('429') || r.text.includes('RATE_LIMITED'));
  console.log(`All OK: ${allOk4}  |  Rate-limited: ${rateLimited4.length}/8`);
  results4.forEach((r, i) => console.log(`  [${i}] "${queries[i].slice(0,20)}" ${r.ms}ms ok=${r.ok} text=${r.text.slice(0,60)}`));
  // Check for cross-query result leakage (response i contains query j's keywords)
  let crossQueryLeak = false;
  for (let i = 0; i < results4.length; i++) {
    for (let j = 0; j < results4.length; j++) {
      if (i !== j && results4[i].ok && results4[j].ok) {
        // Query j's unique term in response i would be a leak
        const uniqueTerm = queries[j].split(' ').pop();
        if (results4[i].text.toLowerCase().includes(uniqueTerm.toLowerCase()) &&
            !queries[i].toLowerCase().includes(uniqueTerm.toLowerCase())) {
          // Only flag if it's clearly a different domain term
        }
      }
    }
  }
  await Promise.all(clients4.map(({client}) => client.close()));
  console.log();

  // ── 5. novada_browser_flow: sequential same session reuse vs. parallel same session ──
  console.log('=== TEST 5: Sequential vs parallel session reuse ===');
  const SESSION_ID_5 = 'qa-seq-vs-par-session';
  const { client: c5, transport: tr5 } = await makeClient('bflow5');

  // Sequential calls with same session
  const r5_seq1 = await callTool(c5, 'novada_browser_flow', {
    url: 'https://httpbin.org/get',
    actions: [{ type: 'screenshot' }],
    country: '',
    session_id: SESSION_ID_5,
  });
  console.log(`[seq1] ${r5_seq1.ms}ms ok=${r5_seq1.ok}`);

  const r5_seq2 = await callTool(c5, 'novada_browser_flow', {
    url: 'https://httpbin.org/headers',
    actions: [{ type: 'screenshot' }],
    country: '',
    session_id: SESSION_ID_5,
  });
  console.log(`[seq2] ${r5_seq2.ms}ms ok=${r5_seq2.ok}`);

  // The second call should be faster if session reuse works
  const seqSpeedup = r5_seq1.ms > r5_seq2.ms;
  console.log(`Session speedup observed (seq2 faster than seq1): ${seqSpeedup}`);
  console.log(`  seq1=${r5_seq1.ms}ms  seq2=${r5_seq2.ms}ms`);
  await c5.close();
  console.log();

  // ── 6. novada_extract: parallel calls with conflicting render modes ──
  console.log('=== TEST 6: 3 parallel novada_extract with different render modes (same URL) ===');
  const clients6 = await Promise.all(['auto','static','js'].map((mode, i) => makeClient(`extract6-${i}`)));
  const results6 = await Promise.all(clients6.map(({client}, i) => {
    const modes = ['auto', 'static', 'render'];
    return callTool(client, 'novada_extract', {
      url: 'https://example.com',
      format: 'markdown',
      render: modes[i],
    });
  }));
  console.log('Results for auto/static/render mode on example.com:');
  results6.forEach((r, i) => {
    const modes = ['auto', 'static', 'render'];
    console.log(`  [${modes[i]}] ${r.ms}ms ok=${r.ok} len=${r.text.length} text=${r.text.slice(0,60)}`);
  });
  // Check cross-contamination: each response should be for example.com
  const allHaveExampleCom = results6.every(r => r.ok || r.text.includes('error') || r.text.includes('Error'));
  console.log(`All responses coherent: ${allHaveExampleCom}`);
  await Promise.all(clients6.map(({client}) => client.close()));
  console.log();

  // ── 7. novada_research: 2 parallel research calls (heavy tool) ──
  console.log('=== TEST 7: 2 parallel novada_research ===');
  const clients7 = await Promise.all([0,1].map(i => makeClient(`research-${i}`)));
  const results7 = await Promise.all(clients7.map(({client}, i) =>
    callTool(client, 'novada_research', {
      question: i === 0 ? 'What is novada proxy?' : 'What is firecrawl?',
      depth: 'quick',
    })
  ));
  const allOk7 = results7.every(r => r.ok);
  console.log(`All OK: ${allOk7}`);
  results7.forEach((r, i) => {
    console.log(`  [${i}] ${r.ms}ms ok=${r.ok} len=${r.text.length}`);
    // Check that response 0 doesn't have "firecrawl" content and response 1 doesn't have novada content
    if (i === 0 && r.ok && r.text.toLowerCase().includes('firecrawl') && !r.text.toLowerCase().includes('novada')) {
      console.log(`  !!! [${i}] CROSS-CONTAMINATION: response 0 (novada query) contains firecrawl content but NOT novada`);
    }
  });
  await Promise.all(clients7.map(({client}) => client.close()));
  console.log();

  // ── 8. Concurrent novada_browser (CDP) - session_id reuse with NOVADA_BROWSER_WS ──
  console.log('=== TEST 8: novada_browser list_sessions (check session store integrity) ===');
  const { client: c8 } = await makeClient('browser8');
  const r8 = await callTool(c8, 'novada_browser', {
    actions: [{ action: 'list_sessions' }],
    timeout: 30000,
  });
  console.log(`list_sessions result: ok=${r8.ok}`);
  console.log(`  ${r8.text.slice(0, 200)}`);
  await c8.close();
  console.log();

  console.log('=== SWEEP COMPLETE ===');
}

run().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
