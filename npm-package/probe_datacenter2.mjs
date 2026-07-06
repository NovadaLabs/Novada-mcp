import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

// This time we include NOVADA_PROXY_ENDPOINT so the tool can actually work
const creds = {
  NOVADA_API_KEY: 'process.env.NOVADA_API_KEY',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
  // Providing the endpoint — required for the tool to resolve credentials
  NOVADA_PROXY_ENDPOINT: '1b9b0a2b9011e022.vtv.na.novada.pro:7777',
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

  const results = [];

  // 1. Happy path — format=url with endpoint set
  console.log('\n=== TEST A1: format=url (with ENDPOINT set) ===');
  const a1 = await call('novada_proxy_datacenter', { format: 'url' });
  console.log(JSON.stringify(a1, null, 2));
  results.push({ test: 'happy_url_with_endpoint', ...a1 });

  // 2. format=env
  console.log('\n=== TEST A2: format=env ===');
  const a2 = await call('novada_proxy_datacenter', { format: 'env' });
  console.log(JSON.stringify(a2, null, 2));
  results.push({ test: 'happy_env_with_endpoint', ...a2 });

  // 3. format=curl
  console.log('\n=== TEST A3: format=curl ===');
  const a3 = await call('novada_proxy_datacenter', { format: 'curl' });
  console.log(JSON.stringify(a3, null, 2));
  results.push({ test: 'happy_curl_with_endpoint', ...a3 });

  // 4. with country
  console.log('\n=== TEST A4: country=us ===');
  const a4 = await call('novada_proxy_datacenter', { format: 'url', country: 'us' });
  console.log(JSON.stringify(a4, null, 2));
  results.push({ test: 'happy_country', ...a4 });

  // 5. with session_id
  console.log('\n=== TEST A5: session_id + format=curl ===');
  const a5 = await call('novada_proxy_datacenter', { format: 'curl', session_id: 'my-session-42' });
  console.log(JSON.stringify(a5, null, 2));
  results.push({ test: 'happy_session_curl', ...a5 });

  // 6. Check if output leaks actual password
  console.log('\n=== TEST A6: credential exposure check ===');
  const a6 = await call('novada_proxy_datacenter', { format: 'url' });
  const txt = a6.result?.content?.[0]?.text ?? '';
  const exposesPass = txt.includes(creds.NOVADA_PROXY_PASS);
  const exposesUser = txt.includes(creds.NOVADA_PROXY_USER);
  const exposesKey = txt.includes(creds.NOVADA_API_KEY);
  console.log('Output text:', txt);
  console.log('Exposes PROXY_PASS?', exposesPass);
  console.log('Exposes PROXY_USER (full)?', exposesUser);
  console.log('Exposes API_KEY?', exposesKey);
  results.push({ test: 'credential_exposure', exposesPass, exposesUser, exposesKey, ...a6 });

  // 7. format=env credential check
  console.log('\n=== TEST A7: credential exposure in env format ===');
  const a7 = await call('novada_proxy_datacenter', { format: 'env' });
  const envTxt = a7.result?.content?.[0]?.text ?? '';
  const envExposesPass = envTxt.includes(creds.NOVADA_PROXY_PASS);
  const envExposesUser = envTxt.includes(creds.NOVADA_PROXY_USER);
  console.log('Output text:', envTxt);
  console.log('Exposes PROXY_PASS in env?', envExposesPass);
  console.log('Exposes PROXY_USER in env?', envExposesUser);
  results.push({ test: 'env_credential_exposure', envExposesPass, envExposesUser, ...a7 });

  // 8. Missing format — schema marks it required; does it silently use the default?
  console.log('\n=== TEST A8: {} missing format — schema required vs Zod default ===');
  const a8 = await call('novada_proxy_datacenter', {});
  console.log(JSON.stringify(a8, null, 2));
  results.push({ test: 'missing_format_with_default', ...a8 });

  // 9. Check if isError is set on "not configured" responses
  console.log('\n=== TEST A9: not-configured response isError flag ===');
  // Remove PROXY_ENDPOINT to trigger "not configured"
  // We do this in a fresh transport
  const transport2 = new StdioClientTransport({
    command: 'node',
    args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
    env: { ...process.env, NOVADA_API_KEY: creds.NOVADA_API_KEY },
  });
  const client2 = new Client({ name: 'probe2', version: '1.0.0' }, { capabilities: {} });
  await client2.connect(transport2);
  const a9 = await client2.callTool({ name: 'novada_proxy_datacenter', arguments: { format: 'url' } });
  console.log('isError flag present?', a9.isError);
  console.log(JSON.stringify(a9, null, 2));
  results.push({ test: 'not_configured_isError', isErrorFlag: a9.isError, content: a9.content });
  await client2.close();

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    const status = r.ok !== false ? 'OK' : 'ERR';
    const snippet = (r.result?.content?.[0]?.text || r.error?.message || '').slice(0, 120);
    console.log(`[${status}] ${r.test}: ${snippet}`);
  }

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
