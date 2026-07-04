/**
 * QA probe for novada_unblock tool - adversarial testing
 */
import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const env = {
  ...process.env,
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_WEB_UNBLOCKER_KEY: 'b27ad6e6834dd36407b00f4e502e055e',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
  NOVADA_BROWSER_WS: 'wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com',
};

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
  env,
});

const client = new Client({ name: 'qa-probe', version: '1.0.0' });

async function callTool(name, args, label) {
  const start = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args });
    const elapsed = Date.now() - start;
    console.log(`\n=== [${label}] (${elapsed}ms) ===`);
    const txt = JSON.stringify(result, null, 2);
    console.log(txt.slice(0, 3000));
    if (txt.length > 3000) console.log(`... [truncated, total ${txt.length} chars]`);
    return { ok: true, result, elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`\n=== [${label}] ERROR (${elapsed}ms) ===`);
    console.log('code:', err.code);
    console.log('message:', err.message);
    console.log('data:', JSON.stringify(err.data, null, 2));
    return { ok: false, err, elapsed };
  }
}

async function main() {
  await client.connect(transport);
  console.log('Connected to MCP server\n');

  // 1. List tools - inspect schema
  const tools = await client.listTools();
  const unblockTool = tools.tools.find(t => t.name === 'novada_unblock');
  if (!unblockTool) {
    console.log('ERROR: novada_unblock not found in tools!');
    console.log('Available tools:', tools.tools.map(t => t.name));
    await client.close();
    return;
  }
  console.log('=== SCHEMA ===');
  console.log(JSON.stringify(unblockTool.inputSchema, null, 2));

  // 2. Happy path - valid call with render=render
  await callTool('novada_unblock', {
    url: 'https://httpbin.org/get',
    method: 'render',
    timeout: 30000,
  }, 'HAPPY-PATH-render');

  // 3. Happy path - method=browser
  await callTool('novada_unblock', {
    url: 'https://httpbin.org/html',
    method: 'browser',
    timeout: 30000,
  }, 'HAPPY-PATH-browser');

  // 4. Missing required: url
  await callTool('novada_unblock', {
    method: 'render',
    timeout: 30000,
  }, 'MISSING-url');

  // 5. Missing required: method
  await callTool('novada_unblock', {
    url: 'https://httpbin.org/get',
    timeout: 30000,
  }, 'MISSING-method');

  // 6. Missing required: timeout
  await callTool('novada_unblock', {
    url: 'https://httpbin.org/get',
    method: 'render',
  }, 'MISSING-timeout');

  // 7. Wrong type: url is integer
  await callTool('novada_unblock', {
    url: 12345,
    method: 'render',
    timeout: 30000,
  }, 'WRONG-TYPE-url-integer');

  // 8. Wrong type: timeout is string
  await callTool('novada_unblock', {
    url: 'https://httpbin.org/get',
    method: 'render',
    timeout: 'thirty-thousand',
  }, 'WRONG-TYPE-timeout-string');

  // 9. Invalid method enum
  await callTool('novada_unblock', {
    url: 'https://httpbin.org/get',
    method: 'headless',
    timeout: 30000,
  }, 'INVALID-method-enum');

  // 10. Timeout below minimum (< 5000)
  await callTool('novada_unblock', {
    url: 'https://httpbin.org/get',
    method: 'render',
    timeout: 100,
  }, 'TIMEOUT-below-min');

  // 11. Timeout above maximum (> 120000)
  await callTool('novada_unblock', {
    url: 'https://httpbin.org/get',
    method: 'render',
    timeout: 999999,
  }, 'TIMEOUT-above-max');

  // 12. Empty string url
  await callTool('novada_unblock', {
    url: '',
    method: 'render',
    timeout: 30000,
  }, 'EMPTY-url');

  // 13. URL injection - path traversal style
  await callTool('novada_unblock', {
    url: 'file:///etc/passwd',
    method: 'render',
    timeout: 30000,
  }, 'URL-injection-file-scheme');

  // 14. URL injection - javascript scheme
  await callTool('novada_unblock', {
    url: 'javascript:alert(1)',
    method: 'render',
    timeout: 30000,
  }, 'URL-injection-js-scheme');

  // 15. max_chars boundary - at max (500000)
  await callTool('novada_unblock', {
    url: 'https://httpbin.org/get',
    method: 'render',
    timeout: 30000,
    max_chars: 500000,
  }, 'MAX-CHARS-at-max');

  // 16. max_chars above max (> 500000)
  await callTool('novada_unblock', {
    url: 'https://httpbin.org/get',
    method: 'render',
    timeout: 30000,
    max_chars: 500001,
  }, 'MAX-CHARS-above-max');

  // 17. max_chars below min (< 1000)
  await callTool('novada_unblock', {
    url: 'https://httpbin.org/get',
    method: 'render',
    timeout: 30000,
    max_chars: 500,
  }, 'MAX-CHARS-below-min');

  // 18. Unknown extra param
  await callTool('novada_unblock', {
    url: 'https://httpbin.org/get',
    method: 'render',
    timeout: 30000,
    unknown_param: 'should-be-ignored-or-rejected',
  }, 'EXTRA-unknown-param');

  // 19. Unicode URL
  await callTool('novada_unblock', {
    url: 'https://例え.jp/',
    method: 'render',
    timeout: 30000,
  }, 'UNICODE-url');

  // 20. Very long URL (10k chars)
  const longUrl = 'https://httpbin.org/get?' + 'a'.repeat(10000);
  await callTool('novada_unblock', {
    url: longUrl,
    method: 'render',
    timeout: 30000,
  }, 'HUGE-url');

  // 21. wait_for CSS injection
  await callTool('novada_unblock', {
    url: 'https://httpbin.org/html',
    method: 'render',
    timeout: 30000,
    wait_for: '"; DROP TABLE users; --',
  }, 'WAITFOR-injection');

  // 22. country with invalid value
  await callTool('novada_unblock', {
    url: 'https://httpbin.org/get',
    method: 'render',
    timeout: 30000,
    country: 'XYZ',
  }, 'INVALID-country-3char');

  // 23. Unreachable host (should timeout or return error)
  await callTool('novada_unblock', {
    url: 'https://this-host-does-not-exist-12345.invalid/',
    method: 'render',
    timeout: 10000,
  }, 'UNREACHABLE-host');

  await client.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
