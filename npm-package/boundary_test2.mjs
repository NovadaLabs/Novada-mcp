// boundary_test2.mjs - deeper probes on identified issues + additional edge cases
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const env = {
  ...process.env,
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
  NOVADA_BROWSER_WS: 'wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com',
  NOVADA_WEB_UNBLOCKER_KEY: 'b27ad6e6834dd36407b00f4e502e055e',
};

const transport = new StdioClientTransport({
  command: 'node',
  args: [join(__dirname, 'build/index.js')],
  env,
});

const client = new Client({ name: 'boundary-test-2', version: '1.0.0' });

const results = [];

async function callTool(name, args, label) {
  const start = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args });
    const elapsed = Date.now() - start;
    const raw = JSON.stringify(result);
    results.push({ label, name, args, status: 'ok', elapsed, raw });
    console.log(`[OK ${elapsed}ms] ${label}`);
    console.log('  result:', raw.slice(0, 500));
    return { ok: true, result, elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    results.push({ label, name, args, status: 'error', elapsed, error: err.message });
    console.log(`[ERR ${elapsed}ms] ${label}: ${err.message}`);
    return { ok: false, error: err, elapsed };
  }
}

async function main() {
  console.log('Connecting to novada-mcp...');
  await client.connect(transport);
  console.log('Connected.\n');

  // --- Probe 1: whitespace-only query - confirm it's a different error path than empty string ---
  console.log('=== PROBE: whitespace query error path ===');
  await callTool('novada_search', { query: ' ', engine: 'google', num: 5, country: '', language: '' }, 'search query=single-space');
  await callTool('novada_search', { query: '\t\n', engine: 'google', num: 5, country: '', language: '' }, 'search query=tab+newline');

  // --- Probe 2: novada_research whitespace question ---
  await callTool('novada_research', { depth: 'quick', question: '     ' }, 'research question=spaces only');

  // --- Probe 3: novada_crawl empty url ---
  await callTool('novada_crawl', { url: '', max_pages: 5, strategy: 'bfs', render: 'auto' }, 'crawl empty url');

  // --- Probe 4: novada_crawl max_pages=1 (boundary minimum) -> should work ---
  await callTool('novada_crawl', { url: 'https://example.com', max_pages: 1, strategy: 'bfs', render: 'auto' }, 'crawl max_pages=1 (boundary min)');

  // --- Probe 5: novada_map empty url ---
  await callTool('novada_map', { url: '', limit: 10, include_subdomains: false, max_depth: 2 }, 'map empty url');

  // --- Probe 6: novada_scrape - empty operation string ---
  await callTool('novada_scrape', { platform: 'amazon.com', operation: '', params: {}, limit: 5, format: 'markdown' }, 'scrape empty operation');

  // --- Probe 7: novada_scraper_submit - empty platform ---
  await callTool('novada_scraper_submit', { platform: '', operation: 'test', params: {} }, 'scraper_submit empty platform');

  // --- Probe 8: novada_scraper_status - empty task_id ---
  await callTool('novada_scraper_status', { task_id: '' }, 'scraper_status empty task_id');

  // --- Probe 9: novada_scraper_result - empty task_id ---
  await callTool('novada_scraper_result', { task_id: '', format: 'markdown' }, 'scraper_result empty task_id');

  // --- Probe 10: novada_unblock - empty url ---
  await callTool('novada_unblock', { url: '', method: 'render', timeout: 30000 }, 'unblock empty url');

  // --- Probe 11: novada_unblock - timeout=0 ---
  await callTool('novada_unblock', { url: 'https://example.com', method: 'render', timeout: 0 }, 'unblock timeout=0');

  // --- Probe 12: novada_unblock - timeout negative ---
  await callTool('novada_unblock', { url: 'https://example.com', method: 'render', timeout: -1000 }, 'unblock timeout=-1000');

  // --- Probe 13: novada_monitor - empty url ---
  await callTool('novada_monitor', { url: '', format: 'markdown' }, 'monitor empty url');

  // --- Probe 14: novada_verify - empty claim (below minLength 10) ---
  await callTool('novada_verify', { claim: '' }, 'verify empty claim');

  // --- Probe 15: novada_verify - claim exactly 9 chars (boundary below min) ---
  await callTool('novada_verify', { claim: 'abcdefghi' }, 'verify claim=9chars (below min 10)');

  // --- Probe 16: novada_verify - whitespace claim ---
  await callTool('novada_verify', { claim: '          ' }, 'verify claim=10 spaces');

  // --- Probe 17: novada_extract - very large max_chars above maximum (100001) ---
  await callTool('novada_extract', { url: 'https://example.com', format: 'markdown', render: 'auto', max_chars: 100001 }, 'extract max_chars=100001 (1 above max)');

  // --- Probe 18: novada_extract - max_chars at boundary max (100000) -> should work ---
  await callTool('novada_extract', { url: 'https://example.com', format: 'markdown', render: 'auto', max_chars: 100000 }, 'extract max_chars=100000 (at max boundary)');

  // --- Probe 19: novada_search - num at exact max boundary (20) -> should work ---
  await callTool('novada_search', { query: 'test', engine: 'google', num: 20, country: '', language: '' }, 'search num=20 (boundary max)');

  // --- Probe 20: novada_search - num at exact min boundary (1) -> should work ---
  await callTool('novada_search', { query: 'test', engine: 'google', num: 1, country: '', language: '' }, 'search num=1 (boundary min)');

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    const isErr = r.raw?.includes('"isError":true') || r.status === 'error';
    console.log(`${r.status === 'error' ? 'THROW' : isErr ? 'TOOL_ERR' : 'OK   '} | ${r.label} | ${r.elapsed}ms`);
    if (r.raw?.includes('"isError":true')) {
      const match = r.raw.match(/"text":"([^"]+)"/);
      if (match) console.log(`  msg: ${match[1].slice(0, 150)}`);
    }
  }

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
