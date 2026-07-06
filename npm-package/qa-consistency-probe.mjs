import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, 'build/index.js');

const env = {
  ...process.env,
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
  NOVADA_PROXY_HOST: '1b9b0a2b9011e022.vtv.na.novada.pro',
  NOVADA_PROXY_PORT: '7777',
  NOVADA_PROXY_ENDPOINT: 'http://1b9b0a2b9011e022.vtv.na.novada.pro:7777',
  NOVADA_BROWSER_WS: 'wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com',
  NOVADA_WEB_UNBLOCKER_KEY: 'b27ad6e6834dd36407b00f4e502e055e',
};

const transport = new StdioClientTransport({
  command: 'node',
  args: [serverPath],
  env,
});

const client = new Client({ name: 'qa-probe', version: '1.0.0' });

async function callTool(name, args) {
  try {
    const result = await client.callTool({ name, arguments: args });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message, code: err.code };
  }
}

async function main() {
  await client.connect(transport);
  console.log('Connected to MCP server');

  // Step 1: List all tools to see real schemas
  const { tools } = await client.listTools();
  console.log(`\nTotal tools: ${tools.length}`);

  // Print tool names and their relevant param schemas
  const toolMap = {};
  for (const t of tools) {
    toolMap[t.name] = t;
  }

  // Print format/render param schemas from a sample of tools
  const formatTools = ['novada_extract', 'novada_search', 'novada_scrape', 'novada_crawl', 'novada_monitor', 'novada_research'];
  console.log('\n=== Format/Render Schema Survey ===');
  for (const name of formatTools) {
    const t = toolMap[name];
    if (!t) { console.log(`  ${name}: NOT FOUND`); continue; }
    const props = t.inputSchema?.properties || {};
    const formatProp = props.format;
    const renderProp = props.render;
    console.log(`\n${name}:`);
    if (formatProp) console.log('  format:', JSON.stringify(formatProp));
    if (renderProp) console.log('  render:', JSON.stringify(renderProp));
  }

  // Step 2: Test snake_case vs camelCase param acceptance
  // novada_extract: try both url/url (these are standard), try format values
  console.log('\n\n=== CALL 1: novada_extract with format=markdown (snake_case) ===');
  const r1 = await callTool('novada_extract', {
    url: 'https://example.com',
    format: 'markdown',
    render: 'auto',
  });
  console.log('Result:', JSON.stringify(r1.ok ? { ok: true, snippet: String(r1.result?.content?.[0]?.text || '').slice(0, 200) } : r1, null, 2));

  console.log('\n=== CALL 2: novada_extract with format=json (should work) ===');
  const r2 = await callTool('novada_extract', {
    url: 'https://example.com',
    format: 'json',
    render: 'auto',
  });
  console.log('Result:', JSON.stringify(r2.ok ? { ok: true, snippet: String(r2.result?.content?.[0]?.text || '').slice(0, 200) } : r2, null, 2));

  console.log('\n=== CALL 3: novada_extract with format=text (snake_case valid enum) ===');
  const r3 = await callTool('novada_extract', {
    url: 'https://example.com',
    format: 'text',
    render: 'auto',
  });
  console.log('Result:', JSON.stringify(r3.ok ? { ok: true, snippet: String(r3.result?.content?.[0]?.text || '').slice(0, 200) } : r3, null, 2));

  // Test camelCase param names vs snake_case
  console.log('\n=== CALL 4: novada_extract with maxChars (camelCase) ===');
  const r4 = await callTool('novada_extract', {
    url: 'https://example.com',
    format: 'markdown',
    render: 'auto',
    maxChars: 500,
  });
  console.log('Result:', JSON.stringify(r4.ok ? { ok: true, snippet: String(r4.result?.content?.[0]?.text || '').slice(0, 200) } : r4, null, 2));

  console.log('\n=== CALL 5: novada_extract with max_chars (snake_case) ===');
  const r5 = await callTool('novada_extract', {
    url: 'https://example.com',
    format: 'markdown',
    render: 'auto',
    max_chars: 500,
  });
  console.log('Result:', JSON.stringify(r5.ok ? { ok: true, snippet: String(r5.result?.content?.[0]?.text || '').slice(0, 200) } : r5, null, 2));

  // Test novada_search format param
  console.log('\n=== CALL 6: novada_search with format=markdown ===');
  const r6 = await callTool('novada_search', {
    query: 'test query',
    engine: 'google',
    num: 3,
    country: 'us',
    language: 'en',
    format: 'markdown',
  });
  console.log('Result:', JSON.stringify(r6.ok ? { ok: true, snippet: String(r6.result?.content?.[0]?.text || '').slice(0, 300) } : r6, null, 2));

  console.log('\n=== CALL 7: novada_search with format=json ===');
  const r7 = await callTool('novada_search', {
    query: 'test query',
    engine: 'google',
    num: 3,
    country: 'us',
    language: 'en',
    format: 'json',
  });
  console.log('Result:', JSON.stringify(r7.ok ? { ok: true, snippet: String(r7.result?.content?.[0]?.text || '').slice(0, 300) } : r7, null, 2));

  // Test novada_proxy_residential - check param names
  console.log('\n=== CALL 8: novada_proxy_residential with session_id (snake_case) ===');
  const r8 = await callTool('novada_proxy_residential', {
    format: 'url',
    session_id: 'test-session-123',
    country: 'us',
  });
  console.log('Result:', JSON.stringify(r8.ok ? { ok: true, result: String(r8.result?.content?.[0]?.text || '').slice(0, 300) } : r8, null, 2));

  console.log('\n=== CALL 9: novada_proxy_residential with sessionId (camelCase) ===');
  const r9 = await callTool('novada_proxy_residential', {
    format: 'url',
    sessionId: 'test-session-456',
    country: 'us',
  });
  console.log('Result:', JSON.stringify(r9.ok ? { ok: true, result: String(r9.result?.content?.[0]?.text || '').slice(0, 300) } : r9, null, 2));

  // Test novada_scrape - check format enum (has 'toon' extra value)
  console.log('\n=== CALL 10: novada_scrape format=toon ===');
  const r10 = await callTool('novada_scrape', {
    platform: 'amazon.com',
    operation: 'amazon_product_keywords',
    params: { keyword: 'laptop' },
    limit: 3,
    format: 'toon',
  });
  console.log('Result:', JSON.stringify(r10.ok ? { ok: true, snippet: String(r10.result?.content?.[0]?.text || '').slice(0, 300) } : r10, null, 2));

  // Test novada_crawl format param (does it have 'format'?)
  const crawlTool = toolMap['novada_crawl'];
  if (crawlTool) {
    console.log('\n=== novada_crawl schema props ===');
    const props = crawlTool.inputSchema?.properties || {};
    const reqd = crawlTool.inputSchema?.required || [];
    console.log('required:', reqd);
    console.log('props keys:', Object.keys(props));
    if (props.format) console.log('format:', JSON.stringify(props.format));
    if (props.render) console.log('render:', JSON.stringify(props.render));
    if (props.strategy) console.log('strategy:', JSON.stringify(props.strategy));
  }

  // Test novada_monitor format enum
  console.log('\n=== CALL 11: novada_monitor format=json ===');
  const r11 = await callTool('novada_monitor', {
    url: 'https://example.com',
    format: 'json',
  });
  console.log('Result:', JSON.stringify(r11.ok ? { ok: true, snippet: String(r11.result?.content?.[0]?.text || '').slice(0, 300) } : r11, null, 2));

  // Probe novada_unblock method param (camelCase? snake_case?)
  const unblockTool = toolMap['novada_unblock'];
  if (unblockTool) {
    console.log('\n=== novada_unblock schema ===');
    const props = unblockTool.inputSchema?.properties || {};
    console.log('props:', JSON.stringify(Object.keys(props)));
    if (props.method) console.log('method:', JSON.stringify(props.method));
    if (props.wait_for) console.log('wait_for:', JSON.stringify(props.wait_for));
    if (props.waitFor) console.log('waitFor:', JSON.stringify(props.waitFor));
    if (props.max_chars) console.log('max_chars:', JSON.stringify(props.max_chars));
    if (props.maxChars) console.log('maxChars:', JSON.stringify(props.maxChars));
  }

  // novada_extract: check waitFor vs wait_for schema
  const extractTool = toolMap['novada_extract'];
  if (extractTool) {
    console.log('\n=== novada_extract schema: wait params ===');
    const props = extractTool.inputSchema?.properties || {};
    if (props.wait_for) console.log('wait_for:', JSON.stringify(props.wait_for));
    if (props.waitFor) console.log('waitFor:', JSON.stringify(props.waitFor));
    if (props.wait_ms) console.log('wait_ms:', JSON.stringify(props.wait_ms));
    if (props.waitMs) console.log('waitMs:', JSON.stringify(props.waitMs));
    if (props.max_chars) console.log('max_chars:', JSON.stringify(props.max_chars));
    if (props.maxChars) console.log('maxChars:', JSON.stringify(props.maxChars));
    if (props.only_main_content) console.log('only_main_content:', JSON.stringify(props.only_main_content));
    if (props.onlyMainContent) console.log('onlyMainContent:', JSON.stringify(props.onlyMainContent));
  }

  // novada_search: enrich_top vs enrichTop
  const searchTool = toolMap['novada_search'];
  if (searchTool) {
    console.log('\n=== novada_search schema: enrich param ===');
    const props = searchTool.inputSchema?.properties || {};
    if (props.enrich_top) console.log('enrich_top:', JSON.stringify(props.enrich_top));
    if (props.enrichTop) console.log('enrichTop:', JSON.stringify(props.enrichTop));
    if (props.include_domains) console.log('include_domains:', JSON.stringify(props.include_domains));
    if (props.includeDomains) console.log('includeDomains:', JSON.stringify(props.includeDomains));
    if (props.exclude_domains) console.log('exclude_domains:', JSON.stringify(props.exclude_domains));
    if (props.excludeDomains) console.log('excludeDomains:', JSON.stringify(props.excludeDomains));
    if (props.time_range) console.log('time_range:', JSON.stringify(props.time_range));
    if (props.timeRange) console.log('timeRange:', JSON.stringify(props.timeRange));
    if (props.start_date) console.log('start_date:', JSON.stringify(props.start_date));
    if (props.startDate) console.log('startDate:', JSON.stringify(props.startDate));
    if (props.end_date) console.log('end_date:', JSON.stringify(props.end_date));
    if (props.endDate) console.log('endDate:', JSON.stringify(props.endDate));
    if (props.extract_options) console.log('extract_options:', JSON.stringify(props.extract_options));
    if (props.extractOptions) console.log('extractOptions:', JSON.stringify(props.extractOptions));
  }

  // novada_scrape: check include_domains param (firecrawl-style vs novada-style)
  const scrapeTool = toolMap['novada_scrape'];
  if (scrapeTool) {
    console.log('\n=== novada_scrape schema params ===');
    const props = scrapeTool.inputSchema?.properties || {};
    console.log('all props:', Object.keys(props).join(', '));
  }

  // novada_proxy_* check session_id param naming consistency
  console.log('\n=== Proxy tool session param naming survey ===');
  for (const tname of ['novada_proxy_residential', 'novada_proxy_isp', 'novada_proxy_datacenter', 'novada_proxy_mobile', 'novada_proxy_static', 'novada_proxy_dedicated']) {
    const t = toolMap[tname];
    if (!t) { console.log(`  ${tname}: NOT FOUND`); continue; }
    const props = t.inputSchema?.properties || {};
    const sessionKey = props.session_id ? 'session_id' : props.sessionId ? 'sessionId' : 'NONE';
    const countryKey = props.country ? 'country' : 'NONE';
    console.log(`  ${tname}: session=${sessionKey}, country=${countryKey}`);
  }

  // Test: send camelCase 'sessionId' to novada_proxy_residential (should fail or silently ignore?)
  console.log('\n=== CALL 12: novada_proxy_isp with session_id ===');
  const r12 = await callTool('novada_proxy_isp', {
    format: 'url',
    session_id: 'test-abc',
    country: 'us',
  });
  console.log('Result:', JSON.stringify(r12.ok ? { ok: true, result: String(r12.result?.content?.[0]?.text || '').slice(0, 300) } : r12, null, 2));

  // Check novada_crawl: 'strategy' vs 'mode' (tool has both?)
  console.log('\n=== CALL 13: novada_crawl with strategy param ===');
  // Minimal crawl to test param acceptance
  const r13 = await callTool('novada_crawl', {
    url: 'https://example.com',
    max_pages: 1,
    strategy: 'bfs',
    render: 'static',
    format: 'markdown',
  });
  console.log('Result:', JSON.stringify(r13.ok ? { ok: true, snippet: String(r13.result?.content?.[0]?.text || '').slice(0, 200) } : r13, null, 2));

  // Check novada_extract with onlyMainContent (camelCase) vs only_main_content (snake_case)
  console.log('\n=== CALL 14: novada_extract with onlyMainContent=true (camelCase) ===');
  const r14 = await callTool('novada_extract', {
    url: 'https://example.com',
    format: 'markdown',
    render: 'auto',
    onlyMainContent: true,
  });
  console.log('Result:', JSON.stringify(r14.ok ? { ok: true, snippet: String(r14.result?.content?.[0]?.text || '').slice(0, 200) } : r14, null, 2));

  // novada_extract with only_main_content (snake_case)
  console.log('\n=== CALL 15: novada_extract with only_main_content=true (snake_case) ===');
  const r15 = await callTool('novada_extract', {
    url: 'https://example.com',
    format: 'markdown',
    render: 'auto',
    only_main_content: true,
  });
  console.log('Result:', JSON.stringify(r15.ok ? { ok: true, snippet: String(r15.result?.content?.[0]?.text || '').slice(0, 200) } : r15, null, 2));

  // novada_research format check
  const researchTool = toolMap['novada_research'];
  if (researchTool) {
    console.log('\n=== novada_research schema ===');
    const props = researchTool.inputSchema?.properties || {};
    console.log('props:', Object.keys(props).join(', '));
    if (props.format) console.log('format:', JSON.stringify(props.format));
    if (props.depth) console.log('depth:', JSON.stringify(props.depth));
  }

  // Test novada_search with enrich_top vs enrichTop
  console.log('\n=== CALL 16: novada_search with enrich_top=true (snake_case) ===');
  const r16 = await callTool('novada_search', {
    query: 'site:example.com test',
    engine: 'google',
    num: 2,
    country: 'us',
    language: 'en',
    enrich_top: true,
  });
  console.log('Result:', JSON.stringify(r16.ok ? { ok: true, snippet: String(r16.result?.content?.[0]?.text || '').slice(0, 300) } : r16, null, 2));

  // Test novada_search with time_range vs timeRange
  console.log('\n=== CALL 17: novada_search with time_range (snake_case) ===');
  const r17 = await callTool('novada_search', {
    query: 'AI news',
    engine: 'google',
    num: 2,
    country: 'us',
    language: 'en',
    time_range: 'week',
  });
  console.log('Result:', JSON.stringify(r17.ok ? { ok: true, snippet: String(r17.result?.content?.[0]?.text || '').slice(0, 300) } : r17, null, 2));

  // novada_map: check include_subdomains vs includeSubdomains
  const mapTool = toolMap['novada_map'];
  if (mapTool) {
    console.log('\n=== novada_map schema ===');
    const props = mapTool.inputSchema?.properties || {};
    console.log('props:', Object.keys(props).join(', '));
    if (props.include_subdomains) console.log('include_subdomains:', JSON.stringify(props.include_subdomains));
    if (props.includeSubdomains) console.log('includeSubdomains:', JSON.stringify(props.includeSubdomains));
    if (props.max_depth) console.log('max_depth:', JSON.stringify(props.max_depth));
    if (props.maxDepth) console.log('maxDepth:', JSON.stringify(props.maxDepth));
  }

  console.log('\n=== CALL 18: novada_map with include_subdomains (snake_case) ===');
  const r18 = await callTool('novada_map', {
    url: 'https://example.com',
    limit: 5,
    include_subdomains: false,
    max_depth: 1,
  });
  console.log('Result:', JSON.stringify(r18.ok ? { ok: true, snippet: String(r18.result?.content?.[0]?.text || '').slice(0, 300) } : r18, null, 2));

  // Test a few more param name checks in other tools
  // novada_browser: check param naming
  const browserTool = toolMap['novada_browser'];
  if (browserTool) {
    console.log('\n=== novada_browser schema params ===');
    const props = browserTool.inputSchema?.properties || {};
    console.log('top-level props:', Object.keys(props).join(', '));
    if (props.session_id) console.log('session_id:', JSON.stringify(props.session_id).slice(0, 100));
    if (props.sessionId) console.log('sessionId:', JSON.stringify(props.sessionId).slice(0, 100));
  }

  // novada_extract with 'clean' param check
  const extractToolFull = toolMap['novada_extract'];
  if (extractToolFull) {
    const props = extractToolFull.inputSchema?.properties || {};
    console.log('\n=== novada_extract full param survey ===');
    console.log('all props:', Object.keys(props).join(', '));
  }

  await client.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
