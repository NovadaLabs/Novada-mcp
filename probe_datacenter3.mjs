import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const creds = {
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
  NOVADA_PROXY_ENDPOINT: '1b9b0a2b9011e022.vtv.na.novada.pro:7777',
};

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
  env: { ...process.env, ...creds },
});

const client = new Client({ name: 'probe3', version: '1.0.0' }, { capabilities: {} });

async function call(toolName, args) {
  const start = Date.now();
  try {
    const result = await client.callTool({ name: toolName, arguments: args });
    return { ok: true, result, elapsed: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err, elapsed: Date.now() - start };
  }
}

async function main() {
  await client.connect(transport);

  // B1: env format with session_id — does the output env export include session?
  console.log('\n=== TEST B1: env format + session_id — does env export embed session? ===');
  const b1 = await call('novada_proxy_datacenter', { format: 'env', session_id: 'my-sticky-42' });
  console.log(b1.result?.content?.[0]?.text);

  // B2: inputSchema says format is required; but Zod has .default("url")
  // Schema says required=["format"] but calling with {} works due to Zod default.
  // This is a schema/behavior mismatch — document it.
  console.log('\n=== TEST B2: schema says format required but {} works (Zod default) ===');
  const b2 = await call('novada_proxy_datacenter', {});
  console.log('isError:', b2.result?.isError);
  console.log('Content snippet:', b2.result?.content?.[0]?.text?.slice(0, 80));

  // B3: URL param - does it affect output in any way?
  console.log('\n=== TEST B3: url param (optional, should scope config) ===');
  const b3 = await call('novada_proxy_datacenter', { format: 'url', url: 'https://api.example.com/data' });
  console.log(b3.result?.content?.[0]?.text);

  // B4: "env" format — check if session info appears in the exported vars
  console.log('\n=== TEST B4: env format + country=de + session_id — all three combined ===');
  const b4 = await call('novada_proxy_datacenter', { format: 'env', country: 'de', session_id: 'sess-123' });
  console.log(b4.result?.content?.[0]?.text);

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
