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

const client = new Client({ name: 'verify-iserror', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

// Check novada_search for comparison - how does it signal errors?
// Test invalid params on search to see isError behavior
const result1 = await client.callTool({
  name: 'novada_search',
  arguments: {
    query: 'test',
    engine: 'google',
    num: 3,
    country: '',
    language: '',
  },
});

console.log('[novada_search happy path]');
console.log('isError:', result1.isError);

// Test browser_flow
const result2 = await client.callTool({
  name: 'novada_browser_flow',
  arguments: { url: 'https://example.com', actions: [{ type: 'screenshot' }], country: '' },
});

console.log('\n[novada_browser_flow API error (10001)]');
console.log('isError:', result2.isError);
console.log('content[0].text starts with:', result2.content?.[0]?.text?.slice(0, 50));

// MCP spec says isError should be true when tool encounters error
// browser_flow returns an error response but isError is not set (undefined)
if (result2.isError !== true) {
  console.log('\nCONFIRMED DEFECT: isError not set to true on API error response');
}

await client.close();
