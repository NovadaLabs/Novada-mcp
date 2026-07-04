/**
 * QA red-team: required-param enforcement sweep
 * Drives novada-mcp build/index.js as a real MCP client over stdio.
 */

import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, 'build', 'index.js');

// Credentials from reference_novada_credentials.md
const env = {
  ...process.env,
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
  NOVADA_PROXY_HOST: '1b9b0a2b9011e022.vtv.na.novada.pro',
  NOVADA_PROXY_PORT: '7777',
  NOVADA_BROWSER_WS: 'wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com',
  NOVADA_WEB_UNBLOCKER_KEY: 'b27ad6e6834dd36407b00f4e502e055e',
};

const transport = new StdioClientTransport({
  command: 'node',
  args: [serverPath],
  env,
});

const client = new Client({ name: 'qa-red-team', version: '1.0.0' });

async function callTool(name, args) {
  try {
    const result = await client.callTool({ name, arguments: args });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err };
  }
}

function summarize(label, res) {
  if (res.ok) {
    const content = res.result?.content;
    let text = '';
    if (Array.isArray(content)) {
      text = content.map(c => c.text || JSON.stringify(c)).join('\n');
    } else {
      text = JSON.stringify(res.result);
    }
    console.log(`[PASS-or-ISSUE] ${label}: got success response`);
    console.log(`  Preview: ${text.slice(0, 300)}`);
  } else {
    const msg = res.error?.message || String(res.error);
    console.log(`[ERROR] ${label}: ${msg.slice(0, 400)}`);
  }
}

async function main() {
  await client.connect(transport);
  console.log('Connected to novada-mcp server\n');

  // List tools first
  const toolsResult = await client.listTools();
  const tools = toolsResult.tools;
  console.log(`Found ${tools.length} tools\n`);

  // Print schemas for tools we'll probe
  const probeTools = [
    'novada_search',
    'novada_extract',
    'novada_scrape',
    'novada_scraper_submit',
    'novada_scraper_status',
    'novada_scraper_result',
    'novada_proxy',
    'novada_proxy_residential',
    'novada_proxy_static',
    'novada_monitor',
    'novada_unblock',
    'novada_crawl',
  ];

  for (const toolName of probeTools) {
    const tool = tools.find(t => t.name === toolName);
    if (tool) {
      const required = tool.inputSchema?.required || [];
      console.log(`SCHEMA ${toolName}: required=[${required.join(', ')}]`);
    } else {
      console.log(`SCHEMA ${toolName}: NOT FOUND`);
    }
  }
  console.log('\n--- BEGIN PROBES ---\n');

  // === PROBE 1: novada_search - omit required 'query' ===
  console.log('PROBE 1: novada_search missing "query"');
  const p1 = await callTool('novada_search', { engine: 'google', num: 5, country: '', language: '' });
  summarize('novada_search missing query', p1);

  // === PROBE 2: novada_search - omit all params ===
  console.log('\nPROBE 2: novada_search missing all params');
  const p2 = await callTool('novada_search', {});
  summarize('novada_search empty args', p2);

  // === PROBE 3: novada_extract - omit required 'url' ===
  console.log('\nPROBE 3: novada_extract missing "url"');
  const p3 = await callTool('novada_extract', { format: 'markdown', render: 'auto' });
  summarize('novada_extract missing url', p3);

  // === PROBE 4: novada_extract - omit 'format' (required per schema) ===
  console.log('\nPROBE 4: novada_extract missing "format"');
  const p4 = await callTool('novada_extract', { url: 'https://example.com', render: 'auto' });
  summarize('novada_extract missing format', p4);

  // === PROBE 5: novada_scrape - omit required 'platform' ===
  console.log('\nPROBE 5: novada_scrape missing "platform"');
  const p5 = await callTool('novada_scrape', {
    operation: 'amazon_product_keywords',
    params: { keyword: 'test' },
    limit: 5,
    format: 'markdown',
  });
  summarize('novada_scrape missing platform', p5);

  // === PROBE 6: novada_scrape - omit required 'operation' ===
  console.log('\nPROBE 6: novada_scrape missing "operation"');
  const p6 = await callTool('novada_scrape', {
    platform: 'amazon.com',
    params: { keyword: 'test' },
    limit: 5,
    format: 'markdown',
  });
  summarize('novada_scrape missing operation', p6);

  // === PROBE 7: novada_scraper_submit - omit required 'platform' ===
  console.log('\nPROBE 7: novada_scraper_submit missing "platform"');
  const p7 = await callTool('novada_scraper_submit', {
    operation: 'amazon_product_asin',
    params: { asin: 'B09XYZ' },
  });
  summarize('novada_scraper_submit missing platform', p7);

  // === PROBE 8: novada_scraper_status - omit required 'task_id' ===
  console.log('\nPROBE 8: novada_scraper_status missing "task_id"');
  const p8 = await callTool('novada_scraper_status', {});
  summarize('novada_scraper_status missing task_id', p8);

  // === PROBE 9: novada_scraper_result - omit required 'task_id' ===
  console.log('\nPROBE 9: novada_scraper_result missing "task_id"');
  const p9 = await callTool('novada_scraper_result', { format: 'markdown' });
  summarize('novada_scraper_result missing task_id', p9);

  // === PROBE 10: novada_proxy - omit required 'type' ===
  console.log('\nPROBE 10: novada_proxy missing "type"');
  const p10 = await callTool('novada_proxy', { format: 'url' });
  summarize('novada_proxy missing type', p10);

  // === PROBE 11: novada_proxy_static - omit required 'country' ===
  console.log('\nPROBE 11: novada_proxy_static missing "country"');
  const p11 = await callTool('novada_proxy_static', { session_id: 'test123', format: 'url' });
  summarize('novada_proxy_static missing country', p11);

  // === PROBE 12: novada_proxy_static - omit required 'session_id' ===
  console.log('\nPROBE 12: novada_proxy_static missing "session_id"');
  const p12 = await callTool('novada_proxy_static', { country: 'us', format: 'url' });
  summarize('novada_proxy_static missing session_id', p12);

  // === PROBE 13: novada_monitor - omit required 'url' ===
  console.log('\nPROBE 13: novada_monitor missing "url"');
  const p13 = await callTool('novada_monitor', { format: 'markdown' });
  summarize('novada_monitor missing url', p13);

  // === PROBE 14: novada_unblock - omit required 'url' ===
  console.log('\nPROBE 14: novada_unblock missing "url"');
  const p14 = await callTool('novada_unblock', { method: 'render', timeout: 30000 });
  summarize('novada_unblock missing url', p14);

  // === PROBE 15: novada_crawl - omit required 'url' ===
  console.log('\nPROBE 15: novada_crawl missing "url"');
  const p15 = await callTool('novada_crawl', {
    max_pages: 3,
    strategy: 'bfs',
    render: 'auto',
  });
  summarize('novada_crawl missing url', p15);

  // === PROBE 16: novada_proxy_dedicated - omit required 'session_id' ===
  console.log('\nPROBE 16: novada_proxy_dedicated missing "session_id"');
  const p16 = await callTool('novada_proxy_dedicated', { format: 'url' });
  summarize('novada_proxy_dedicated missing session_id', p16);

  // === PROBE 17: novada_scraper_submit - missing 'operation' (required) ===
  console.log('\nPROBE 17: novada_scraper_submit missing "operation"');
  const p17 = await callTool('novada_scraper_submit', {
    platform: 'amazon.com',
    params: { keyword: 'test' },
  });
  summarize('novada_scraper_submit missing operation', p17);

  // === PROBE 18: novada_extract with empty string url (boundary) ===
  console.log('\nPROBE 18: novada_extract with empty string url');
  const p18 = await callTool('novada_extract', { url: '', format: 'markdown', render: 'auto' });
  summarize('novada_extract empty string url', p18);

  await client.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
