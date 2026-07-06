// boundary_test.mjs - QA boundary value sweep for novada-mcp 0.8.11
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

const client = new Client({ name: 'boundary-test', version: '1.0.0' });

const results = [];

async function callTool(name, args, label) {
  const start = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args });
    const elapsed = Date.now() - start;
    results.push({ label, name, args, status: 'ok', elapsed, result: JSON.stringify(result).slice(0, 500) });
    console.log(`[OK ${elapsed}ms] ${label}`);
    console.log('  result:', JSON.stringify(result).slice(0, 300));
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

  // List all tools first
  const toolsResponse = await client.listTools();
  const tools = toolsResponse.tools;
  console.log(`Tools available: ${tools.length}`);
  console.log('Tool names:', tools.map(t => t.name).join(', '));
  console.log();

  // === BOUNDARY VALUE TESTS ===

  // 1. novada_search - empty query string
  await callTool('novada_search', { query: '', engine: 'google', num: 5, country: '', language: '' }, 'novada_search empty query');

  // 2. novada_search - whitespace-only query
  await callTool('novada_search', { query: '   ', engine: 'google', num: 5, country: '', language: '' }, 'novada_search whitespace query');

  // 3. novada_search - num=0 (zero count)
  await callTool('novada_search', { query: 'test', engine: 'google', num: 0, country: '', language: '' }, 'novada_search num=0');

  // 4. novada_search - num=9999 (way above max)
  await callTool('novada_search', { query: 'test', engine: 'google', num: 9999, country: '', language: '' }, 'novada_search num=9999');

  // 5. novada_search - very long query (2000+ chars)
  const longQuery = 'a'.repeat(2000);
  await callTool('novada_search', { query: longQuery, engine: 'google', num: 5, country: '', language: '' }, 'novada_search query=2000 chars');

  // 6. novada_extract - empty url string
  await callTool('novada_extract', { url: '', format: 'markdown', render: 'auto' }, 'novada_extract empty url');

  // 7. novada_extract - whitespace url
  await callTool('novada_extract', { url: '   ', format: 'markdown', render: 'auto' }, 'novada_extract whitespace url');

  // 8. novada_crawl - max_pages=0
  await callTool('novada_crawl', { url: 'https://example.com', max_pages: 0, strategy: 'bfs', render: 'auto' }, 'novada_crawl max_pages=0');

  // 9. novada_crawl - max_pages=999 (way above stated max of 20)
  await callTool('novada_crawl', { url: 'https://example.com', max_pages: 999, strategy: 'bfs', render: 'auto' }, 'novada_crawl max_pages=999');

  // 10. novada_map - limit=0
  await callTool('novada_map', { url: 'https://example.com', limit: 0, include_subdomains: false, max_depth: 2 }, 'novada_map limit=0');

  // 11. novada_map - limit=99999 (way above max 100)
  await callTool('novada_map', { url: 'https://example.com', limit: 99999, include_subdomains: false, max_depth: 2 }, 'novada_map limit=99999');

  // 12. novada_map - max_depth=0
  await callTool('novada_map', { url: 'https://example.com', limit: 10, include_subdomains: false, max_depth: 0 }, 'novada_map max_depth=0');

  // 13. novada_map - negative max_depth
  await callTool('novada_map', { url: 'https://example.com', limit: 10, include_subdomains: false, max_depth: -5 }, 'novada_map max_depth=-5');

  // 14. novada_scrape - empty platform
  await callTool('novada_scrape', { platform: '', operation: 'amazon_product_keywords', params: { keyword: 'test' }, limit: 5, format: 'markdown' }, 'novada_scrape empty platform');

  // 15. novada_scrape - limit=0
  await callTool('novada_scrape', { platform: 'amazon.com', operation: 'amazon_product_keywords', params: { keyword: 'test' }, limit: 0, format: 'markdown' }, 'novada_scrape limit=0');

  // 16. novada_scrape - limit=99999 (above max 100)
  await callTool('novada_scrape', { platform: 'amazon.com', operation: 'amazon_product_keywords', params: { keyword: 'test' }, limit: 99999, format: 'markdown' }, 'novada_scrape limit=99999');

  // 17. novada_extract - max_chars=0
  await callTool('novada_extract', { url: 'https://example.com', format: 'markdown', render: 'auto', max_chars: 0 }, 'novada_extract max_chars=0');

  // 18. novada_extract - max_chars negative
  await callTool('novada_extract', { url: 'https://example.com', format: 'markdown', render: 'auto', max_chars: -100 }, 'novada_extract max_chars=-100');

  // 19. novada_search - negative num
  await callTool('novada_search', { query: 'test', engine: 'google', num: -5, country: '', language: '' }, 'novada_search num=-5');

  // 20. novada_research - empty question
  await callTool('novada_research', { depth: 'quick', question: '' }, 'novada_research empty question');

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`${r.status === 'error' ? 'ERR' : 'OK '} | ${r.label} | ${r.elapsed}ms`);
    if (r.status === 'error') {
      console.log(`  Error: ${r.error}`);
    }
  }

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
