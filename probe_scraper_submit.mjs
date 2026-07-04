import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { spawn } from 'child_process';

const CREDS = {
  NOVADA_API_KEY: 'process.env.NOVADA_API_KEY',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
  NOVADA_BROWSER_WS: 'wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com',
};

async function makeClient() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
    env: { ...process.env, ...CREDS },
  });
  const client = new Client({ name: 'qa-probe', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

async function callTool(client, name, args) {
  try {
    const result = await client.callTool({ name, arguments: args });
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function log(label, data) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${label}`);
  console.log('-'.repeat(60));
  if (data && typeof data === 'object') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(data);
  }
}

async function main() {
  const client = await makeClient();
  const results = [];

  // 0. List tools to get real schema
  const tools = await client.listTools();
  const targetTool = tools.tools.find(t => t.name === 'novada_scraper_submit');
  log('SCHEMA - novada_scraper_submit', targetTool);

  // 1. Happy path - valid amazon submit
  const r1 = await callTool(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: 'amazon_product_keywords',
    params: { keyword: 'laptop', num: 3 }
  });
  log('T1 - Happy path: amazon_product_keywords', r1);
  results.push({ test: 'T1-happy-path', raw: r1 });

  // 2. Missing required 'operation' field
  const r2 = await callTool(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    params: { keyword: 'laptop' }
  });
  log('T2 - Missing required "operation"', r2);
  results.push({ test: 'T2-missing-operation', raw: r2 });

  // 3. Missing required 'platform' field
  const r3 = await callTool(client, 'novada_scraper_submit', {
    operation: 'amazon_product_keywords',
    params: { keyword: 'laptop' }
  });
  log('T3 - Missing required "platform"', r3);
  results.push({ test: 'T3-missing-platform', raw: r3 });

  // 4. Wrong type for platform (number)
  const r4 = await callTool(client, 'novada_scraper_submit', {
    platform: 12345,
    operation: 'amazon_product_keywords',
    params: { keyword: 'test' }
  });
  log('T4 - platform as number (wrong type)', r4);
  results.push({ test: 'T4-wrong-type-platform', raw: r4 });

  // 5. Wrong type for params (string instead of object)
  const r5 = await callTool(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: 'amazon_product_keywords',
    params: 'keyword=laptop'
  });
  log('T5 - params as string (wrong type)', r5);
  results.push({ test: 'T5-wrong-type-params', raw: r5 });

  // 6. Empty string platform
  const r6 = await callTool(client, 'novada_scraper_submit', {
    platform: '',
    operation: 'amazon_product_keywords',
    params: {}
  });
  log('T6 - empty string platform', r6);
  results.push({ test: 'T6-empty-platform', raw: r6 });

  // 7. Unknown platform
  const r7 = await callTool(client, 'novada_scraper_submit', {
    platform: 'totally-fake-site-xyz.com',
    operation: 'fake_operation',
    params: { foo: 'bar' }
  });
  log('T7 - unknown platform', r7);
  results.push({ test: 'T7-unknown-platform', raw: r7 });

  // 8. XSS injection in params
  const r8 = await callTool(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: 'amazon_product_keywords',
    params: { keyword: '<script>alert(1)</script>' }
  });
  log('T8 - XSS injection in params', r8);
  results.push({ test: 'T8-xss-injection', raw: r8 });

  // 9. SQL injection in platform
  const r9 = await callTool(client, 'novada_scraper_submit', {
    platform: "'; DROP TABLE users; --",
    operation: 'amazon_product_keywords',
    params: {}
  });
  log('T9 - SQL injection in platform', r9);
  results.push({ test: 'T9-sql-injection', raw: r9 });

  // 10. Huge string in params (>50KB)
  const hugeStr = 'A'.repeat(60000);
  const r10 = await callTool(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: 'amazon_product_keywords',
    params: { keyword: hugeStr }
  });
  log('T10 - huge string in params (60KB)', r10);
  results.push({ test: 'T10-huge-string', raw: r10 });

  // 11. Unicode/emoji in operation
  const r11 = await callTool(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: '🔥amazon_product_keywords🔥',
    params: { keyword: 'test' }
  });
  log('T11 - unicode/emoji in operation', r11);
  results.push({ test: 'T11-unicode-operation', raw: r11 });

  // 12. Extra/unknown params at top level
  const r12 = await callTool(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: 'amazon_product_keywords',
    params: { keyword: 'test' },
    unknown_extra_param: 'should_be_ignored',
    inject_key: '../../etc/passwd'
  });
  log('T12 - extra unknown params at top level', r12);
  results.push({ test: 'T12-extra-params', raw: r12 });

  // 13. null values for required fields
  const r13 = await callTool(client, 'novada_scraper_submit', {
    platform: null,
    operation: null,
    params: null
  });
  log('T13 - null values for all fields', r13);
  results.push({ test: 'T13-null-values', raw: r13 });

  // 14. params as array instead of object
  const r14 = await callTool(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: 'amazon_product_keywords',
    params: ['keyword', 'laptop']
  });
  log('T14 - params as array', r14);
  results.push({ test: 'T14-params-array', raw: r14 });

  // 15. Check if error messages leak API key or proxy credentials
  const r15 = await callTool(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: 'nonexistent_operation_that_should_error',
    params: {}
  });
  log('T15 - nonexistent operation (check for cred leak in error)', r15);
  const r15Str = JSON.stringify(r15);
  const credLeak =
    r15Str.includes('process.env.NOVADA_API_KEY') ||
    r15Str.includes('tongwu_TRDI7X') ||
    r15Str.includes('_Asd1644asd_') ||
    r15Str.includes('novada529MUW_2Q8WuZ');
  console.log('CREDENTIAL LEAK DETECTED:', credLeak);
  results.push({ test: 'T15-cred-leak-check', raw: r15, credLeak });

  // Summary analysis
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY ANALYSIS');
  console.log('='.repeat(60));

  // Check for agent_instruction in error responses
  for (const r of results) {
    if (!r.raw.ok) {
      const hasAgentInstruction = JSON.stringify(r.raw.error || '').includes('agent_instruction');
      if (!hasAgentInstruction) {
        console.log(`MISSING agent_instruction in error for ${r.test}`);
      }
    }
    // Check tool call result errors for agent_instruction
    if (r.raw.ok && r.raw.result) {
      const resStr = JSON.stringify(r.raw.result);
      if (resStr.includes('"isError":true') || resStr.includes('"isError": true')) {
        const hasAgentInstruction = resStr.includes('agent_instruction');
        console.log(`${r.test}: isError=true, agent_instruction present=${hasAgentInstruction}`);
      }
    }
  }

  await client.close();

  // Print all raw results for analysis
  console.log('\n\nFULL RESULTS JSON:');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
