import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';

const creds = {
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
  NOVADA_BROWSER_WS: 'wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com',
  NOVADA_WEB_UNBLOCKER_KEY: 'b27ad6e6834dd36407b00f4e502e055e',
};

async function callTool(client, name, args) {
  const start = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args });
    const elapsed = Date.now() - start;
    return { ok: true, result, elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { ok: false, error: err, elapsed };
  }
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
    env: { ...process.env, ...creds },
  });

  const client = new Client({ name: 'qa-sweep', version: '1.0.0' });
  await client.connect(transport);

  // List available tools
  const tools = await client.listTools();
  console.log('TOOLS AVAILABLE:', tools.tools.map(t => t.name).join(', '));
  console.log('TOTAL TOOLS:', tools.tools.length);
  console.log('---');

  const results = [];

  // === STEP 1: Baseline wallet balance ===
  console.log('\n[1] novada_wallet_balance (baseline)');
  const bal1 = await callTool(client, 'novada_wallet_balance', {});
  console.log('Result:', JSON.stringify(bal1.result, null, 2));
  results.push({ step: 1, label: 'wallet_balance_before', ...bal1 });

  // === STEP 2: novada_search with INVALID query params ===
  console.log('\n[2] novada_search with empty query (should fail or return error)');
  const search_bad = await callTool(client, 'novada_search', { query: '', engine: 'google', num: 1, country: '', language: '' });
  console.log('Result:', JSON.stringify(search_bad.result?.content?.[0]?.text?.slice(0, 500), null, 2));
  results.push({ step: 2, label: 'search_empty_query', ...search_bad });

  // === STEP 3: novada_extract with completely invalid URL ===
  console.log('\n[3] novada_extract with invalid URL (should fail gracefully)');
  const extract_bad = await callTool(client, 'novada_extract', { url: 'https://this-domain-does-not-exist-xyz-12345.invalid/', format: 'markdown', render: 'static' });
  console.log('Result:', JSON.stringify(extract_bad.result?.content?.[0]?.text?.slice(0, 500), null, 2));
  results.push({ step: 3, label: 'extract_invalid_url', ...extract_bad });

  // === STEP 4: novada_scrape with invalid/unknown platform + operation ===
  console.log('\n[4] novada_scrape with nonexistent platform');
  const scrape_bad = await callTool(client, 'novada_scrape', {
    platform: 'nonexistent-platform-xyz.com',
    operation: 'fake_operation',
    params: {},
    limit: 5,
    format: 'markdown',
  });
  console.log('Result:', JSON.stringify(scrape_bad.result?.content?.[0]?.text?.slice(0, 500), null, 2));
  results.push({ step: 4, label: 'scrape_invalid_platform', ...scrape_bad });

  // === STEP 5: novada_unblock with unreachable URL ===
  console.log('\n[5] novada_unblock with unreachable target');
  const unblock_bad = await callTool(client, 'novada_unblock', {
    url: 'https://unreachable-host-xyz-99999.invalid/',
    method: 'render',
    timeout: 10000,
  });
  console.log('Result:', JSON.stringify(unblock_bad.result?.content?.[0]?.text?.slice(0, 500), null, 2));
  results.push({ step: 5, label: 'unblock_unreachable', ...unblock_bad });

  // === STEP 6: novada_research with minimal valid query (succeeds - credit check) ===
  console.log('\n[6] novada_research with valid query (real call to check credit burn)');
  const research_ok = await callTool(client, 'novada_research', { question: 'test', depth: 'quick' });
  console.log('Result (first 500 chars):', JSON.stringify(research_ok.result?.content?.[0]?.text?.slice(0, 500), null, 2));
  results.push({ step: 6, label: 'research_valid', ...research_ok });

  // === STEP 7: novada_wallet_balance AFTER failures ===
  console.log('\n[7] novada_wallet_balance (after failures)');
  const bal2 = await callTool(client, 'novada_wallet_balance', {});
  console.log('Result:', JSON.stringify(bal2.result, null, 2));
  results.push({ step: 7, label: 'wallet_balance_after', ...bal2 });

  // === STEP 8: novada_plan_balance_all ===
  console.log('\n[8] novada_plan_balance_all (check quota for all products)');
  const plan_bal1 = await callTool(client, 'novada_plan_balance_all', {});
  console.log('Result:', JSON.stringify(plan_bal1.result?.content?.[0]?.text?.slice(0, 1000), null, 2));
  results.push({ step: 8, label: 'plan_balance_before', ...plan_bal1 });

  // === STEP 9: novada_extract with a real URL (valid, to burn quota knowingly) ===
  console.log('\n[9] novada_extract with real URL to confirm quota baseline');
  const extract_ok = await callTool(client, 'novada_extract', { url: 'https://httpbin.org/json', format: 'markdown', render: 'static' });
  console.log('Result (first 300):', JSON.stringify(extract_ok.result?.content?.[0]?.text?.slice(0, 300), null, 2));
  results.push({ step: 9, label: 'extract_valid', ...extract_ok });

  // === STEP 10: novada_scraper_submit with bad URL ===
  console.log('\n[10] novada_scraper_submit with bad platform (invalid)');
  const scraper_submit_bad = await callTool(client, 'novada_scraper_submit', {
    platform: 'bad-platform-xyz.com',
    operation: 'nonexistent_operation',
    params: { url: 'https://example.com' },
  });
  console.log('Result:', JSON.stringify(scraper_submit_bad.result?.content?.[0]?.text?.slice(0, 500), null, 2));
  results.push({ step: 10, label: 'scraper_submit_bad_platform', ...scraper_submit_bad });

  // === STEP 11: novada_wallet_balance FINAL ===
  console.log('\n[11] novada_wallet_balance (final - after all tests)');
  const bal3 = await callTool(client, 'novada_wallet_balance', {});
  console.log('Result:', JSON.stringify(bal3.result, null, 2));
  results.push({ step: 11, label: 'wallet_balance_final', ...bal3 });

  // === STEP 12: novada_plan_balance_all FINAL ===
  console.log('\n[12] novada_plan_balance_all (final)');
  const plan_bal2 = await callTool(client, 'novada_plan_balance_all', {});
  console.log('Result:', JSON.stringify(plan_bal2.result?.content?.[0]?.text?.slice(0, 1000), null, 2));
  results.push({ step: 12, label: 'plan_balance_after', ...plan_bal2 });

  console.log('\n\n=== SUMMARY ===');
  for (const r of results) {
    const text = r.result?.content?.[0]?.text;
    const isError = text?.includes('error') || text?.includes('Error') || text?.includes('fail') || !r.ok;
    console.log(`[${r.step}] ${r.label}: ok=${r.ok} elapsed=${r.elapsed}ms error_keyword=${isError}`);
  }

  await client.close();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
