import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const ENV = {
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_BROWSER_WS: 'wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com',
  PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
};

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
  env: ENV,
});

const client = new Client({ name: 'verify-error', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

// Call with completely valid params - should succeed but actually returns error
const result = await client.callTool({
  name: 'novada_browser_flow',
  arguments: {
    url: 'https://example.com',
    actions: [{ type: 'screenshot' }],
    country: '',
  },
});

console.log('[Exact response shape]');
console.log('isError:', result.isError);
console.log('content count:', result.content?.length);
result.content?.forEach((c, i) => {
  console.log(`content[${i}].type:`, c.type);
  console.log(`content[${i}].text (full):`);
  console.log(c.text);
});

// Check if the error has any structured data beyond text
console.log('\n[Full result JSON]');
console.log(JSON.stringify(result, null, 2));

await client.close();
