// Fresh client just for T19 — checking extra key stripping behavior
import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const CREDS = { NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa' };

async function makeClient() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
    env: { ...process.env, ...CREDS },
  });
  const client = new Client({ name: 'qa-probe4', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

async function callWithTimeout(client, name, args, timeoutMs = 15000) {
  const start = Date.now();
  return Promise.race([
    client.callTool({ name, arguments: args })
      .then(r => ({ ok: true, result: r, elapsed: Date.now() - start }))
      .catch(e => ({ ok: false, error: e, elapsed: Date.now() - start })),
    new Promise(resolve => setTimeout(() => resolve({
      ok: false, error: { code: 'TIMEOUT' }, elapsed: timeoutMs
    }), timeoutMs))
  ]);
}

async function main() {
  const client = await makeClient();

  // T19: extra top-level keys stripped - fresh session
  console.log('\n=== T19-FRESH: extra top-level keys stripped (not rejected) ===');
  const r19 = await callWithTimeout(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: 'amazon_product_keywords',
    params: { keyword: 'watch' },
    extra_key: 'injected_value',
    another_extra: 99999
  }, 15000);
  console.log(`ok=${r19.ok}, elapsed=${r19.elapsed}ms`);
  const text19 = r19.result?.content?.[0]?.text || JSON.stringify(r19.error);
  console.log('Response:', text19.slice(0, 300));

  // T21: Check error message for missing agent_instruction in Zod validation errors
  // The summary analysis from probe1 showed Zod errors DON'T include agent_instruction
  // Is this by design or a gap?
  console.log('\n=== T21: Zod validation error - no agent_instruction present ===');
  const r21 = await callWithTimeout(client, 'novada_scraper_submit', {
    platform: 12345
  }, 10000);
  const text21 = r21.result?.content?.[0]?.text || '';
  console.log('Error text:', text21);
  console.log('Has agent_instruction:', text21.includes('agent_instruction'));
  console.log('isError:', r21.result?.isError);

  // T22: Check the Zod error for params - does 'params' being required in schema
  // but having a default({}) in Zod cause inconsistency?
  // Schema says required:[platform,operation,params] but params has default:{}
  console.log('\n=== T22: params omitted (has default in Zod) ===');
  const r22 = await callWithTimeout(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: 'amazon_product_keywords'
    // params intentionally omitted
  }, 15000);
  const text22 = r22.result?.content?.[0]?.text || '';
  console.log('Response (params omitted):', text22.slice(0, 300));
  // Zod default({}) should make params optional at runtime even though
  // schema marks it as required. This is a schema-vs-runtime inconsistency.

  await client.close();
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
