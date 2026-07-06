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

const client = new Client({ name: 'verify-iserror2', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

// Check how errors are reported in the tool handler code
// by looking at what happens on a thrown error (MCP SDK converts it to isError:true)
// vs a returned error string (tool returns text with isError undefined)

// Test: call browser_flow with bad API key to trigger a thrown error (auth failure)
const ENV_NO_KEY = { ...ENV, NOVADA_API_KEY: undefined };

// This can't easily be done without restarting the server with a bad key
// Instead, check if any other tool that throws returns isError:true
// novada_scraper_status with a bad task_id
try {
  const result = await client.callTool({
    name: 'novada_scraper_status',
    arguments: { task_id: 'nonexistent-task-000000' },
  });
  console.log('[scraper_status bad id] isError:', result.isError);
  console.log('  text:', result.content?.[0]?.text?.slice(0, 100));
} catch (err) {
  console.log('[scraper_status bad id] threw:', err.message?.slice(0, 100));
}

// Check novada_search with completely invalid params
try {
  const result = await client.callTool({
    name: 'novada_search',
    arguments: { query: '', engine: 'google', num: 1, country: '', language: '' },
  });
  console.log('[search empty query] isError:', result.isError);
  console.log('  text:', result.content?.[0]?.text?.slice(0, 100));
} catch (err) {
  console.log('[search empty query] threw:', err.message?.slice(0, 100));
}

await client.close();
