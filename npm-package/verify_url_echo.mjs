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

const client = new Client({ name: 'verify-url-echo', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

// Test with a very long URL
const longUrl = 'https://example.com/' + 'x'.repeat(5000);
const r = await client.callTool({
  name: 'novada_browser_flow',
  arguments: { url: longUrl, actions: [{ type: 'screenshot' }], country: '' },
});

const text = r.content?.[0]?.text || '';
console.log('Response total length:', text.length);
console.log('URL in response? starts with https://example.com/xxx...:', text.includes('https://example.com/' + 'x'.repeat(100)));
console.log('Full URL echoed?:', text.includes(longUrl));
// If the full 5000-char URL is in the error text, it wastes LLM context window
// Error output should truncate the URL for agent consumption

await client.close();
