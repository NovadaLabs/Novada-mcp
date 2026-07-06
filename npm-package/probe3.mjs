import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const CREDS = {
  NOVADA_API_KEY: 'process.env.NOVADA_API_KEY',
};

async function makeClient() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
    env: { ...process.env, ...CREDS },
  });
  const client = new Client({ name: 'qa-probe3', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

async function callWithTimeout(client, name, args, timeoutMs) {
  const start = Date.now();
  return Promise.race([
    client.callTool({ name, arguments: args })
      .then(r => ({ ok: true, result: r, elapsed: Date.now() - start }))
      .catch(e => ({ ok: false, error: e, elapsed: Date.now() - start })),
    new Promise(resolve => setTimeout(() => resolve({
      ok: false,
      error: { code: 'TIMEOUT', message: `Timed out after ${timeoutMs}ms` },
      elapsed: timeoutMs
    }), timeoutMs))
  ]);
}

async function main() {
  const client = await makeClient();

  // T10 boundary: 30KB (below threshold) - does it work?
  console.log('\n=== T10a: 30KB params payload ===');
  const start30 = Date.now();
  const r30k = await callWithTimeout(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: 'amazon_product_keywords',
    params: { keyword: 'A'.repeat(30000) }
  }, 30000);
  console.log(`30KB: ok=${r30k.ok}, elapsed=${r30k.elapsed}ms`);
  if (!r30k.ok) console.log('Error:', JSON.stringify(r30k.error));
  else console.log('Submitted task_id:', JSON.stringify(r30k.result?.content?.[0]?.text).slice(0, 100));

  // T10 boundary: 50KB
  console.log('\n=== T10b: 50KB params payload ===');
  const r50k = await callWithTimeout(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: 'amazon_product_keywords',
    params: { keyword: 'A'.repeat(50000) }
  }, 30000);
  console.log(`50KB: ok=${r50k.ok}, elapsed=${r50k.elapsed}ms`);
  if (!r50k.ok) console.log('Error:', JSON.stringify(r50k.error));

  // T10 boundary: 60KB (the one that timed out before)
  console.log('\n=== T10c: 60KB params payload (original failing case) ===');
  const r60k = await callWithTimeout(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: 'amazon_product_keywords',
    params: { keyword: 'A'.repeat(60000) }
  }, 65000);  // Give it more time to see if it eventually responds
  console.log(`60KB: ok=${r60k.ok}, elapsed=${r60k.elapsed}ms`);
  if (!r60k.ok) console.log('Error code/message:', r60k.error?.code, r60k.error?.message);

  // T19: Validate the Zod schema actually strips (not rejects) extra top-level keys
  // by checking that a task IS submitted with unknown params at top level
  console.log('\n=== T19: extra top-level keys are stripped (not rejected) check ===');
  const r19 = await callWithTimeout(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: 'amazon_product_keywords',
    params: { keyword: 'watch' },
    extra_key_that_should_be_stripped: 'value'
  }, 15000);
  console.log(`T19: ok=${r19.ok}`);
  const text = r19.result?.content?.[0]?.text || '';
  console.log('Has task_id:', text.includes('task_id'));
  // The extra_key should be stripped - the task succeeds

  // T20: Check Zod validation error message quality — does it reveal internal structure?
  console.log('\n=== T20: Validation error leak check ===');
  const r20 = await callWithTimeout(client, 'novada_scraper_submit', {
    platform: { nested: 'object' },
    operation: 12345,
    params: null
  }, 10000);
  const r20text = r20.result?.content?.[0]?.text || '';
  console.log('Error text:', r20text);
  // Should NOT reveal stack traces, internal file paths, Zod internals

  await client.close();
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
