import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const env = {
  ...process.env,
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
};

async function callTool(client, name, args) {
  try {
    const res = await client.callTool({ name, arguments: args });
    return res;
  } catch (err) {
    return { mcpError: err.message };
  }
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
    env,
  });
  const client = new Client({ name: 'qa-probe2', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);

  // Reproduce: missing product — what error message fires?
  console.log('=== A: omit product entirely ===');
  const a = await callTool(client, 'novada_proxy_account_list', { page: 1, limit: 10 });
  const aText = a?.content?.[0]?.text || JSON.stringify(a);
  console.log('ERROR TEXT:', aText);

  // Reproduce: null list — exact boundary — account="" (empty string)
  console.log('\n=== B: account="" empty string ===');
  const b = await callTool(client, 'novada_proxy_account_list', { product: '1', page: 1, limit: 10, account: '' });
  const bText = b?.content?.[0]?.text || JSON.stringify(b);
  console.log('RESULT:', bText);

  // Reproduce: unicode short (just emoji, no padding) — does it also return null list?
  console.log('\n=== C: account with only emoji ===');
  const c = await callTool(client, 'novada_proxy_account_list', { product: '1', page: 1, limit: 10, account: '🌏' });
  const cText = c?.content?.[0]?.text || JSON.stringify(c);
  console.log('RESULT:', cText);
  // Parse JSON to check list field
  try {
    const parsed = JSON.parse(cText);
    console.log('data.list type:', typeof parsed?.data?.list, '| value:', parsed?.data?.list);
  } catch(e) { console.log('not JSON'); }

  // Reproduce: 1000-char ASCII account — is list null?
  console.log('\n=== D: 1000-char ASCII account ===');
  const d = await callTool(client, 'novada_proxy_account_list', { product: '1', page: 1, limit: 10, account: 'A'.repeat(1000) });
  const dText = d?.content?.[0]?.text || JSON.stringify(d);
  try {
    const parsed = JSON.parse(dText);
    console.log('data.list:', parsed?.data?.list, '| isArray:', Array.isArray(parsed?.data?.list));
  } catch(e) { console.log('not JSON:', dText.slice(0, 200)); }

  // Compare: injection short string — list is [] not null
  console.log('\n=== E: injection account ===');
  const e = await callTool(client, 'novada_proxy_account_list', { product: '1', page: 1, limit: 10, account: "'; DROP TABLE;" });
  const eText = e?.content?.[0]?.text || JSON.stringify(e);
  try {
    const parsed = JSON.parse(eText);
    console.log('data.list:', parsed?.data?.list, '| isArray:', Array.isArray(parsed?.data?.list));
  } catch(e2) { console.log('not JSON'); }

  // Check: page=1 with limit=1 — does pagination metadata look right?
  console.log('\n=== F: pagination with limit=1 ===');
  const f = await callTool(client, 'novada_proxy_account_list', { product: '1', page: 1, limit: 1 });
  const fText = f?.content?.[0]?.text || JSON.stringify(f);
  try {
    const parsed = JSON.parse(fText);
    console.log('total:', parsed?.data?.total, '| list.length:', parsed?.data?.list?.length, '| page:', parsed?.data?.page);
  } catch(e2) { console.log(fText.slice(0, 300)); }

  // Check: page=999 (well past actual data) — empty list or error?
  console.log('\n=== G: page=999 (beyond data) ===');
  const g = await callTool(client, 'novada_proxy_account_list', { product: '1', page: 999, limit: 10 });
  const gText = g?.content?.[0]?.text || JSON.stringify(g);
  try {
    const parsed = JSON.parse(gText);
    console.log('total:', parsed?.data?.total, '| list:', parsed?.data?.list, '| isArray:', Array.isArray(parsed?.data?.list));
  } catch(e2) { console.log(gText.slice(0, 300)); }

  // Check raw output fields in happy path — look for unmasked sensitive data
  console.log('\n=== H: happy path — check for sensitive fields ===');
  const h = await callTool(client, 'novada_proxy_account_list', { product: '1', page: 1, limit: 1 });
  const hText = h?.content?.[0]?.text || JSON.stringify(h);
  try {
    const parsed = JSON.parse(hText);
    const item = parsed?.data?.list?.[0];
    if (item) {
      console.log('password field:', item.password);
      // Check if uid is a real number (privacy concern)
      console.log('uid exposed:', item.uid);
      // Check if account_before/account_after are exposed (split info)
      console.log('account_before:', item.account_before, '| account_after:', item.account_after);
    }
  } catch(e2) { console.log(hText.slice(0, 200)); }

  await client.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
