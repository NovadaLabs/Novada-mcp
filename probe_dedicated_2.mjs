import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const env = {
  ...process.env,
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
  NOVADA_PROXY_HOST: '1b9b0a2b9011e022.vtv.na.novada.pro',
  NOVADA_PROXY_PORT: '7777',
};

async function callTool(client, name, args) {
  console.log(`\n--- CALL: ${name} ---`);
  console.log('ARGS:', JSON.stringify(args, null, 2));
  try {
    const result = await client.callTool({ name, arguments: args });
    console.log('RESULT:', JSON.stringify(result, null, 2));
    return result;
  } catch (err) {
    console.log('ERROR:', JSON.stringify({ code: err.code, message: err.message, data: err.data }, null, 2));
    return { error: err };
  }
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
    env,
  });
  const client = new Client({ name: 'qa-probe-2', version: '1.0.0' });
  await client.connect(transport);

  // Issue 1: format has a default value "url", so missing format is NOT a bug —
  // Zod default kicks in. Verify this is actually accepted (not a defect).
  console.log('\n=== Verify: missing format uses default ===');
  await callTool(client, 'novada_proxy_dedicated', {
    session_id: 'test-session-005',
    // format intentionally omitted — schema has default: "url"
  });

  // Issue 2: extra/unknown params with additionalProperties:false in schema
  // but passed "country" and "unknown_param" — did the MCP layer strip them silently?
  // Test: pass addl props and see if tool sees them
  console.log('\n=== Extra params test: additionalProperties false in schema ===');
  await callTool(client, 'novada_proxy_dedicated', {
    session_id: 'extra-param-test',
    format: 'url',
    country: 'us',
    unknown_extra: 'hello',
  });

  // Issue 3: url field accepts non-URL values — no URI validation
  // Reproduce: passes through to configuration_required path (no url validation executed in this path)
  console.log('\n=== URL validation: malformed URL accepted? ===');
  await callTool(client, 'novada_proxy_dedicated', {
    session_id: 'url-test',
    format: 'url',
    url: 'javascript:alert(1)',  // XSS-style injection in URL
  });

  // Issue 4: behavior inconsistency — format=url vs env vs curl produce different
  // response structures (format "url" and "env" are strings, "curl" is different format)
  // Test with NOVADA_DEDICATED_PROXY_LIST set to see real output shape divergence
  const transport2 = new StdioClientTransport({
    command: 'node',
    args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
    env: {
      ...env,
      NOVADA_DEDICATED_PROXY_LIST: '151.242.47.74:8886:testuser:testpass',
    },
  });
  const client2 = new Client({ name: 'qa-probe-2b', version: '1.0.0' });
  await client2.connect(transport2);

  console.log('\n=== Real output with NOVADA_DEDICATED_PROXY_LIST set: format=url ===');
  await callTool(client2, 'novada_proxy_dedicated', {
    session_id: 'my-session',
    format: 'url',
  });

  console.log('\n=== Real output with NOVADA_DEDICATED_PROXY_LIST set: format=env ===');
  await callTool(client2, 'novada_proxy_dedicated', {
    session_id: 'my-session',
    format: 'env',
  });

  console.log('\n=== Real output with NOVADA_DEDICATED_PROXY_LIST set: format=curl ===');
  await callTool(client2, 'novada_proxy_dedicated', {
    session_id: 'my-session',
    format: 'curl',
  });

  // Issue 5: session_id is IGNORED in env format (look at source code: env format
  // doesn't use session_id in output at all)
  console.log('\n=== session_id ignored in env format? ===');
  const r1 = await callTool(client2, 'novada_proxy_dedicated', {
    session_id: 'session-AAA',
    format: 'env',
  });
  const r2 = await callTool(client2, 'novada_proxy_dedicated', {
    session_id: 'session-BBB',
    format: 'env',
  });
  const text1 = r1?.content?.[0]?.text;
  const text2 = r2?.content?.[0]?.text;
  console.log('\nOutputs identical for different session_id (env)?', text1 === text2);

  // Issue 6: proxy password LEAKS in env format output
  // The env format outputs proxyUser but masks proxyPass — let's verify
  console.log('\n=== Check password masking in env format ===');
  const envResult = await callTool(client2, 'novada_proxy_dedicated', {
    session_id: 'test',
    format: 'env',
  });
  const envText = envResult?.content?.[0]?.text ?? '';
  console.log('\nContains "testpass"?', envText.includes('testpass'));
  console.log('\nContains "testuser"?', envText.includes('testuser'));

  // Issue 7: url param passed but never used in any output path when proxy list IS set
  console.log('\n=== url param used in output when list is set? ===');
  const withUrl = await callTool(client2, 'novada_proxy_dedicated', {
    session_id: 'test',
    format: 'url',
    url: 'https://example.com/target',
  });
  const withoutUrl = await callTool(client2, 'novada_proxy_dedicated', {
    session_id: 'test',
    format: 'url',
  });
  const textWithUrl = withUrl?.content?.[0]?.text ?? '';
  const textWithoutUrl = withoutUrl?.content?.[0]?.text ?? '';
  console.log('\nOutput with url == output without url?', textWithUrl === textWithoutUrl);
  console.log('\nUrl appears in output?', textWithUrl.includes('example.com'));

  // Issue 8: Multiline NOVADA_DEDICATED_PROXY_LIST - only first entry used
  // "session_id" is supposed to route to a specific IP, but implementation just takes entry[0]
  const transport3 = new StdioClientTransport({
    command: 'node',
    args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
    env: {
      ...env,
      NOVADA_DEDICATED_PROXY_LIST: '1.2.3.4:8886:user1:pass1\n5.6.7.8:9999:user2:pass2',
    },
  });
  const client3 = new Client({ name: 'qa-probe-2c', version: '1.0.0' });
  await client3.connect(transport3);

  console.log('\n=== session_id routing: does different session_id pick different IP? ===');
  const sess1 = await callTool(client3, 'novada_proxy_dedicated', {
    session_id: 'session-one',
    format: 'url',
  });
  const sess2 = await callTool(client3, 'novada_proxy_dedicated', {
    session_id: 'session-two',
    format: 'url',
  });
  const ip1 = sess1?.content?.[0]?.text ?? '';
  const ip2 = sess2?.content?.[0]?.text ?? '';
  console.log('\nsession-one IP:', ip1.includes('1.2.3.4') ? '1.2.3.4' : ip1.includes('5.6.7.8') ? '5.6.7.8' : 'unknown');
  console.log('session-two IP:', ip2.includes('1.2.3.4') ? '1.2.3.4' : ip2.includes('5.6.7.8') ? '5.6.7.8' : 'unknown');
  console.log('Both return same entry?', ip1 === ip2);

  await client.close();
  await client2.close();
  await client3.close();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
