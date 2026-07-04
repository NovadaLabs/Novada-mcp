/**
 * Verify country validation: schema says minLength=2, maxLength=2
 * Test: country="US" valid, country=" !" (2 non-alpha chars), country="\x00\x00" (null bytes)
 */
import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const env = {
  ...process.env,
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_WEB_UNBLOCKER_KEY: 'b27ad6e6834dd36407b00f4e502e055e',
};

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
  env,
});

const client = new Client({ name: 'qa-probe', version: '1.0.0' });
await client.connect(transport);

async function probe(args, label) {
  const start = Date.now();
  try {
    const result = await client.callTool({ name: 'novada_unblock', arguments: args });
    const elapsed = Date.now() - start;
    const txt = JSON.stringify(result.content?.[0]?.text ?? result).slice(0, 300);
    console.log(`\n[${label}] (${elapsed}ms): ${result.isError ? 'ERROR' : 'OK'}: ${txt}`);
  } catch (err) {
    console.log(`\n[${label}] THROW: ${err.message?.slice(0, 200)}`);
  }
}

// Valid ISO country
await probe({ url: 'https://httpbin.org/get', method: 'render', timeout: 30000, country: 'us' }, 'country-valid-us');

// 2 chars but non-alpha (spaces, special chars) — only length=2 constraint, no regex
await probe({ url: 'https://httpbin.org/get', method: 'render', timeout: 30000, country: '!!' }, 'country-non-alpha-!!');

// 2 chars numeric
await probe({ url: 'https://httpbin.org/get', method: 'render', timeout: 30000, country: '12' }, 'country-numeric-12');

// 1 char (below min) — should fail
await probe({ url: 'https://httpbin.org/get', method: 'render', timeout: 30000, country: 'u' }, 'country-1char');

await client.close();
console.log('\nDone.');
