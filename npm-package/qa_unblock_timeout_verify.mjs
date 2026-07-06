/**
 * Verify that user-supplied timeout is ignored for method=render
 * Probe: set timeout=5000 (minimum) for render method — should timeout at 5s if honored,
 * but if the hardcoded 48s is used, it will either succeed or time out at 48s.
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

// Test: timeout=5000 (minimum allowed). If honored, a slow URL would take 5s before timeout.
// But actual behavior uses TIMEOUTS.RENDER=48000 regardless.
// We use a URL with simulated delay to see if 5000ms timeout is respected.
const start = Date.now();
try {
  const result = await client.callTool({
    name: 'novada_unblock',
    arguments: {
      url: 'https://httpbin.org/delay/8',  // 8 second delay endpoint
      method: 'render',
      timeout: 5000,  // should timeout at 5s if honored
    }
  });
  const elapsed = Date.now() - start;
  console.log(`Result after ${elapsed}ms:`);
  const txt = JSON.stringify(result).slice(0, 500);
  console.log(txt);
  if (elapsed < 7000) {
    console.log('VERDICT: timeout=5000 WAS respected (returned before 7s)');
  } else {
    console.log('VERDICT: timeout=5000 was IGNORED (took longer than 7s, used internal hardcoded timeout)');
  }
} catch (err) {
  const elapsed = Date.now() - start;
  console.log(`Error after ${elapsed}ms:`, err.message?.slice(0, 300));
  if (elapsed < 7000) {
    console.log('VERDICT: timeout=5000 WAS respected (errored before 7s)');
  } else {
    console.log('VERDICT: timeout=5000 was IGNORED (errored after 7s, used internal hardcoded timeout)');
  }
}

await client.close();
