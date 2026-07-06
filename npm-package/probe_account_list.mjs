import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';

const NOVADA_API_KEY = 'process.env.NOVADA_API_KEY';
const NOVADA_PROXY_USER = 'tongwu_TRDI7X';
const NOVADA_PROXY_PASS = '_Asd1644asd_';

const env = {
  ...process.env,
  NOVADA_API_KEY,
  NOVADA_PROXY_USER,
  NOVADA_PROXY_PASS,
};

let results = [];

async function callTool(client, name, args) {
  const label = `${name}(${JSON.stringify(args)})`;
  try {
    const start = Date.now();
    const res = await client.callTool({ name, arguments: args });
    const elapsed = Date.now() - start;
    results.push({ label, elapsed, result: res, error: null });
    return res;
  } catch (err) {
    results.push({ label, elapsed: 0, result: null, error: err });
    return null;
  }
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
    env,
  });

  const client = new Client({ name: 'qa-probe', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);

  // 1. List tools — find the real schema
  console.log('=== listTools ===');
  const toolsResult = await client.listTools();
  const tools = toolsResult.tools || [];
  const target = tools.find(t => t.name === 'novada_proxy_account_list');
  console.log('Found target tool:', target ? 'YES' : 'NO');
  if (target) {
    console.log('inputSchema:', JSON.stringify(target.inputSchema, null, 2));
    console.log('description excerpt:', target.description?.slice(0, 300));
  }

  // 2. Happy path — product=1 (Residential), page=1, limit=10
  console.log('\n=== CALL 1: happy path product=1 ===');
  const r1 = await callTool(client, 'novada_proxy_account_list', { product: '1', page: 1, limit: 10 });
  console.log('result:', JSON.stringify(r1, null, 2));

  // 3. Happy path — product=4 (Unlimited)
  console.log('\n=== CALL 2: happy path product=4 ===');
  const r2 = await callTool(client, 'novada_proxy_account_list', { product: '4', page: 1, limit: 10 });
  console.log('result:', JSON.stringify(r2, null, 2));

  // 4. Missing required param: no product
  console.log('\n=== CALL 3: missing required param product ===');
  const r3 = await callTool(client, 'novada_proxy_account_list', { page: 1, limit: 10 });
  console.log('result:', JSON.stringify(r3, null, 2));

  // 5. Wrong type: product as integer (schema says string enum)
  console.log('\n=== CALL 4: product as integer 1 (wrong type) ===');
  const r4 = await callTool(client, 'novada_proxy_account_list', { product: 1, page: 1, limit: 10 });
  console.log('result:', JSON.stringify(r4, null, 2));

  // 6. Invalid product value (not in enum)
  console.log('\n=== CALL 5: invalid product value "99" ===');
  const r5 = await callTool(client, 'novada_proxy_account_list', { product: '99', page: 1, limit: 10 });
  console.log('result:', JSON.stringify(r5, null, 2));

  // 7. limit=0 (boundary)
  console.log('\n=== CALL 6: limit=0 boundary ===');
  const r6 = await callTool(client, 'novada_proxy_account_list', { product: '1', page: 1, limit: 0 });
  console.log('result:', JSON.stringify(r6, null, 2));

  // 8. limit=201 (above max 200)
  console.log('\n=== CALL 7: limit=201 above max ===');
  const r7 = await callTool(client, 'novada_proxy_account_list', { product: '1', page: 1, limit: 201 });
  console.log('result:', JSON.stringify(r7, null, 2));

  // 9. limit=200 (at max boundary)
  console.log('\n=== CALL 8: limit=200 at max ===');
  const r8 = await callTool(client, 'novada_proxy_account_list', { product: '1', page: 1, limit: 200 });
  console.log('result:', JSON.stringify(r8, null, 2));

  // 10. page=0 (below min of 1)
  console.log('\n=== CALL 9: page=0 below min ===');
  const r9 = await callTool(client, 'novada_proxy_account_list', { product: '1', page: 0, limit: 10 });
  console.log('result:', JSON.stringify(r9, null, 2));

  // 11. Unknown/extra param injection
  console.log('\n=== CALL 10: extra unknown param ===');
  const r10 = await callTool(client, 'novada_proxy_account_list', { product: '1', page: 1, limit: 10, __proto__: 'injected', extra: 'field' });
  console.log('result:', JSON.stringify(r10, null, 2));

  // 12. SQL/command injection in account field
  console.log('\n=== CALL 11: injection in account field ===');
  const r11 = await callTool(client, 'novada_proxy_account_list', { product: '1', page: 1, limit: 10, account: "'; DROP TABLE users; --" });
  console.log('result:', JSON.stringify(r11, null, 2));

  // 13. Unicode/huge account filter
  console.log('\n=== CALL 12: unicode account filter ===');
  const r12 = await callTool(client, 'novada_proxy_account_list', { product: '1', page: 1, limit: 10, account: '你好世界🌏' + 'A'.repeat(1000) });
  console.log('result:', JSON.stringify(r12, null, 2));

  // 14. Status filter
  console.log('\n=== CALL 13: status filter "1" ===');
  const r13 = await callTool(client, 'novada_proxy_account_list', { product: '1', page: 1, limit: 10, status: '1' });
  console.log('result:', JSON.stringify(r13, null, 2));

  // 15. Invalid status value
  console.log('\n=== CALL 14: invalid status "99" ===');
  const r14 = await callTool(client, 'novada_proxy_account_list', { product: '1', page: 1, limit: 10, status: '99' });
  console.log('result:', JSON.stringify(r14, null, 2));

  // 16. Empty string product
  console.log('\n=== CALL 15: empty string product ===');
  const r15 = await callTool(client, 'novada_proxy_account_list', { product: '', page: 1, limit: 10 });
  console.log('result:', JSON.stringify(r15, null, 2));

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    const status = r.error ? 'ERROR' : (r.result?.isError ? 'TOOL_ERROR' : 'OK');
    console.log(`[${status}] ${r.elapsed}ms | ${r.label}`);
    if (r.error) console.log('  err:', r.error.message);
  }

  await client.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
