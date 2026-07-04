import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const ENV = {
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
};

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
  env: ENV,
});

const client = new Client({ name: 'verify-iserror3', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

// browser_flow: Zod validation error (missing url)
const r1 = await client.callTool({
  name: 'novada_browser_flow',
  arguments: { actions: [{ type: 'screenshot' }], country: '' },
});
console.log('[browser_flow Zod error] isError:', r1.isError, '| text:', r1.content?.[0]?.text?.slice(0, 60));

// browser_flow: API error (valid params but 10001 from API)
const r2 = await client.callTool({
  name: 'novada_browser_flow',
  arguments: { url: 'https://example.com', actions: [{ type: 'screenshot' }], country: '' },
});
console.log('[browser_flow API error] isError:', r2.isError, '| text:', r2.content?.[0]?.text?.slice(0, 60));

// This confirms: Zod validation -> isError:true, API error content -> isError:undefined
// The isError inconsistency between validation errors and API errors affects browser_flow too

await client.close();
