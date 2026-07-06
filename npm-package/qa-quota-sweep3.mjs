// Test J was timeout=60000 but elapsed 60004ms and result was undefined
// The tool call itself succeeded (ok=true) but returned undefined content
// This test specifically reproduces the undefined result for unblock with timeout>=60000

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const creds = {
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
  NOVADA_BROWSER_WS: 'wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com',
  NOVADA_WEB_UNBLOCKER_KEY: 'b27ad6e6834dd36407b00f4e502e055e',
};

async function callTool(client, name, args) {
  const start = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args });
    const elapsed = Date.now() - start;
    return { ok: true, result, elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { ok: false, error: err, elapsed };
  }
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
    env: { ...process.env, ...creds },
  });

  const client = new Client({ name: 'qa-sweep3', version: '1.0.0' });
  await client.connect(transport);

  // Reproduce: unblock with timeout=60000 on an unreachable host
  // Expected: error message within user-specified timeout
  // Previous observation: returned undefined content at exactly 60004ms
  console.log('\n[REPRO] novada_unblock timeout=60000 on unreachable host');
  const unblock_60 = await callTool(client, 'novada_unblock', {
    url: 'https://totally-unreachable-domain-xyz-abc-99999.invalid/',
    method: 'render',
    timeout: 60000,
  });
  console.log('Elapsed:', unblock_60.elapsed, 'ms');
  console.log('ok:', unblock_60.ok);
  console.log('Result content:', JSON.stringify(unblock_60.result?.content, null, 2));
  console.log('Full result:', JSON.stringify(unblock_60.result, null, 2));
  if (!unblock_60.ok) {
    console.log('Error:', unblock_60.error?.message);
  }

  // Also test: novada_unblock with method=browser (uses fetchViaBrowser — DOES respect timeout)
  console.log('\n[BROWSER_MODE] novada_unblock timeout=5000 method=browser on unreachable host');
  const unblock_browser = await callTool(client, 'novada_unblock', {
    url: 'https://totally-unreachable-domain-xyz-abc-99999.invalid/',
    method: 'browser',
    timeout: 5000,
  });
  console.log('Elapsed:', unblock_browser.elapsed, 'ms');
  console.log('ok:', unblock_browser.ok);
  console.log('Result content first 500:', unblock_browser.result?.content?.[0]?.text?.slice(0, 500));

  // Confirm no quota burned
  console.log('\n[BALANCE] Final balance check');
  const bal = await callTool(client, 'novada_wallet_balance', {});
  console.log(bal.result?.content?.[0]?.text);

  await client.close();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
