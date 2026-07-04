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

const client = new Client({ name: 'verify-session', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

// Test edge cases for session_id
const cases = [
  { session_id: '', desc: 'empty string' },
  { session_id: 'a'.repeat(64), desc: '64 chars (max)' },
  { session_id: 'a'.repeat(65), desc: '65 chars (over max)' },
  { session_id: '../../../etc/passwd', desc: 'path traversal' },
  { session_id: '<script>alert(1)</script>', desc: 'XSS in session_id' },
  { session_id: "'; DROP TABLE sessions; --", desc: 'SQL injection in session_id' },
];

for (const { session_id, desc } of cases) {
  const r = await client.callTool({
    name: 'novada_browser_flow',
    arguments: { url: 'https://example.com', actions: [{ type: 'screenshot' }], country: '', session_id },
  });
  const text = r.content?.[0]?.text?.slice(0, 80) || '';
  const isError = r.isError;
  console.log(`[session_id ${desc}] isError:${isError} text:${text.replace(/\n/g, '|')}`);
}

await client.close();
