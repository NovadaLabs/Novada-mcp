import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const CREDS = {
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
};

async function makeClient() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
    env: { ...process.env, ...CREDS },
  });
  const client = new Client({ name: 'qa-probe2', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

async function callTool(client, name, args, timeoutMs = 15000) {
  return Promise.race([
    client.callTool({ name, arguments: args }).then(r => ({ ok: true, result: r })).catch(e => ({ ok: false, error: e })),
    new Promise(resolve => setTimeout(() => resolve({ ok: false, error: { code: 'TIMEOUT', message: `Timed out after ${timeoutMs}ms` } }), timeoutMs))
  ]);
}

async function main() {
  const client = await makeClient();

  // T12 DEEP: Verify that inputSchema says additionalProperties:false
  // but Zod doesn't use .strict() — extra keys silently accepted
  console.log('\n=== T12-RECHECK: additionalProperties:false in schema vs Zod strip behavior ===');
  const r12deep = await callTool(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: 'amazon_product_keywords',
    params: { keyword: 'test' },
    __proto__: { polluted: true },       // prototype pollution attempt
    constructor: { pwned: true },         // constructor clobber attempt
    unknown_field_xyz: 'injected_value',  // unknown field
  });
  console.log('Result:', JSON.stringify(r12deep, null, 2));
  // If ok=true, the extra fields were stripped by Zod (default behavior) not rejected.
  // The discrepancy is: inputSchema reports additionalProperties:false (should reject),
  // but Zod z.object() strips by default without .strict()

  // T10 RETEST with smaller huge payload and shorter timeout
  console.log('\n=== T10-RETEST: Large params payload (10KB) ===');
  const r10small = await callTool(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: 'amazon_product_keywords',
    params: { keyword: 'A'.repeat(10000) }
  }, 20000);
  console.log('10KB result:', JSON.stringify(r10small, null, 2));

  // T16: Test if operation field maxLength(100) is enforced
  console.log('\n=== T16: operation exactly at max length (100) ===');
  const r16 = await callTool(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: 'a'.repeat(100),
    params: {}
  }, 10000);
  console.log('100-char operation result:', JSON.stringify(r16, null, 2));

  // T17: operation at max+1 length (101 chars)
  console.log('\n=== T17: operation at max+1 length (101) ===');
  const r17 = await callTool(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: 'a'.repeat(101),
    params: {}
  }, 10000);
  console.log('101-char operation result:', JSON.stringify(r17, null, 2));

  // T18: Check if the inputSchema's additionalProperties:false is actually enforced
  // by sending ONLY extra fields (no platform/operation/params)
  console.log('\n=== T18: Only unknown fields, no required fields ===');
  const r18 = await callTool(client, 'novada_scraper_submit', {
    totally_unknown: 'foo',
    another_unknown: 123
  }, 10000);
  console.log('Only unknown fields:', JSON.stringify(r18, null, 2));

  await client.close();
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
