import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const creds = {
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
  NOVADA_BROWSER_WS: 'wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com',
};

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
  env: { ...process.env, ...creds },
});

const client = new Client({ name: 'probe-client', version: '1.0.0' }, { capabilities: {} });

async function call(toolName, args) {
  const start = Date.now();
  try {
    const result = await client.callTool({ name: toolName, arguments: args });
    const elapsed = Date.now() - start;
    return { ok: true, result, elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { ok: false, error: err, elapsed };
  }
}

async function main() {
  await client.connect(transport);
  console.log('Connected');

  // 1. List tools — get real inputSchema
  const { tools } = await client.listTools();
  const tool = tools.find(t => t.name === 'novada_proxy_datacenter');
  console.log('\n=== SCHEMA ===');
  console.log(JSON.stringify(tool, null, 2));

  const results = [];

  // 2. Happy path — minimal valid call
  console.log('\n=== TEST 1: minimal valid (format=url) ===');
  const t1 = await call('novada_proxy_datacenter', { format: 'url' });
  console.log(JSON.stringify(t1, null, 2));
  results.push({ test: 'happy_minimal', ...t1 });

  // 3. Happy path with country + session_id
  console.log('\n=== TEST 2: with country + session_id ===');
  const t2 = await call('novada_proxy_datacenter', { format: 'url', country: 'us', session_id: 'test-session-001' });
  console.log(JSON.stringify(t2, null, 2));
  results.push({ test: 'happy_country_session', ...t2 });

  // 4. format=env
  console.log('\n=== TEST 3: format=env ===');
  const t3 = await call('novada_proxy_datacenter', { format: 'env' });
  console.log(JSON.stringify(t3, null, 2));
  results.push({ test: 'happy_env', ...t3 });

  // 5. format=curl
  console.log('\n=== TEST 4: format=curl ===');
  const t4 = await call('novada_proxy_datacenter', { format: 'curl' });
  console.log(JSON.stringify(t4, null, 2));
  results.push({ test: 'happy_curl', ...t4 });

  // 6. Missing required param (format)
  console.log('\n=== TEST 5: missing format (required) ===');
  const t5 = await call('novada_proxy_datacenter', {});
  console.log(JSON.stringify(t5, null, 2));
  results.push({ test: 'missing_required_format', ...t5 });

  // 7. Wrong type for format
  console.log('\n=== TEST 6: wrong type format=123 ===');
  const t6 = await call('novada_proxy_datacenter', { format: 123 });
  console.log(JSON.stringify(t6, null, 2));
  results.push({ test: 'wrong_type_format_int', ...t6 });

  // 8. Invalid enum value for format
  console.log('\n=== TEST 7: invalid format=xml ===');
  const t7 = await call('novada_proxy_datacenter', { format: 'xml' });
  console.log(JSON.stringify(t7, null, 2));
  results.push({ test: 'invalid_enum_format', ...t7 });

  // 9. Invalid country code (too long)
  console.log('\n=== TEST 8: country=TOOLONG ===');
  const t8 = await call('novada_proxy_datacenter', { format: 'url', country: 'TOOLONG' });
  console.log(JSON.stringify(t8, null, 2));
  results.push({ test: 'invalid_country_too_long', ...t8 });

  // 10. Injection in session_id
  console.log('\n=== TEST 9: injection in session_id ===');
  const t9 = await call('novada_proxy_datacenter', { format: 'url', session_id: '../../etc/passwd; rm -rf /' });
  console.log(JSON.stringify(t9, null, 2));
  results.push({ test: 'injection_session_id', ...t9 });

  // 11. Extremely long session_id (> 64 chars)
  console.log('\n=== TEST 10: session_id > 64 chars ===');
  const longId = 'a'.repeat(200);
  const t10 = await call('novada_proxy_datacenter', { format: 'url', session_id: longId });
  console.log(JSON.stringify(t10, null, 2));
  results.push({ test: 'long_session_id', ...t10 });

  // 12. Unicode in country
  console.log('\n=== TEST 11: unicode country ===');
  const t11 = await call('novada_proxy_datacenter', { format: 'url', country: '🇺🇸' });
  console.log(JSON.stringify(t11, null, 2));
  results.push({ test: 'unicode_country', ...t11 });

  // 13. Extra unknown param
  console.log('\n=== TEST 12: extra unknown param ===');
  const t12 = await call('novada_proxy_datacenter', { format: 'url', unknown_param: 'should_be_ignored', injected: true });
  console.log(JSON.stringify(t12, null, 2));
  results.push({ test: 'extra_unknown_params', ...t12 });

  // 14. Null format (null type coercion test)
  console.log('\n=== TEST 13: format=null ===');
  const t13 = await call('novada_proxy_datacenter', { format: null });
  console.log(JSON.stringify(t13, null, 2));
  results.push({ test: 'null_format', ...t13 });

  // 15. Empty string format
  console.log('\n=== TEST 14: format="" ===');
  const t14 = await call('novada_proxy_datacenter', { format: '' });
  console.log(JSON.stringify(t14, null, 2));
  results.push({ test: 'empty_string_format', ...t14 });

  // 16. URL format check — does output contain creds?
  console.log('\n=== TEST 15: check proxy URL for credential exposure ===');
  const t15 = await call('novada_proxy_datacenter', { format: 'url' });
  const outputStr = JSON.stringify(t15);
  const hasCreds = outputStr.includes(creds.NOVADA_PROXY_PASS) || outputStr.includes(creds.NOVADA_API_KEY);
  console.log('Contains known credentials:', hasCreds);
  console.log(JSON.stringify(t15, null, 2));
  results.push({ test: 'credential_exposure_check', hasCreds, ...t15 });

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    const status = r.ok ? 'OK' : 'ERR';
    const isContent = r.result?.content?.[0]?.type === 'text';
    const snippet = isContent ? r.result.content[0].text.slice(0, 100) : (r.error?.message || '').slice(0, 100);
    console.log(`[${status}] ${r.test} (${r.elapsed}ms): ${snippet}`);
  }

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
