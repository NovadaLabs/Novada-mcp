import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const ENV = {
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
  NOVADA_BROWSER_WS: 'wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com',
  PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
};

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
  env: ENV,
});

const client = new Client({ name: 'qa-probe', version: '1.0.0' }, { capabilities: {} });

async function call(name, args) {
  const start = Date.now();
  try {
    const res = await client.callTool({ name, arguments: args });
    const elapsed = Date.now() - start;
    return { ok: true, res, elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { ok: false, err, elapsed };
  }
}

function inspect(label, result) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${label}] (${result.elapsed}ms)`);
  if (result.ok) {
    const content = result.res?.content;
    if (Array.isArray(content)) {
      content.forEach((c, i) => {
        if (c.type === 'text') {
          console.log(`  content[${i}].text:`, c.text?.slice(0, 800));
        } else {
          console.log(`  content[${i}]:`, JSON.stringify(c).slice(0, 400));
        }
      });
    } else {
      console.log('  result:', JSON.stringify(result.res).slice(0, 800));
    }
  } else {
    const e = result.err;
    console.log('  ERROR code:', e?.code);
    console.log('  ERROR msg:', e?.message?.slice(0, 400));
    console.log('  ERROR data:', JSON.stringify(e?.data)?.slice(0, 400));
  }
}

await client.connect(transport);
console.log('Connected.');

// 1. List tools - find novada_browser_flow schema
const tools = await client.listTools();
const tool = tools.tools.find(t => t.name === 'novada_browser_flow');
if (!tool) {
  console.error('novada_browser_flow NOT FOUND in tool list!');
  console.log('Available:', tools.tools.map(t => t.name).join(', '));
  process.exit(1);
}
console.log('\n[SCHEMA] novada_browser_flow');
console.log(JSON.stringify(tool.inputSchema, null, 2));

// 2. HAPPY PATH - valid minimal call
console.log('\n\n### TEST 1: Happy path - simple navigate + screenshot');
const t1 = await call('novada_browser_flow', {
  url: 'https://example.com',
  actions: [{ type: 'screenshot' }],
  country: '',
});
inspect('T1 happy path screenshot', t1);

// 3. HAPPY PATH - click + type actions
console.log('\n### TEST 2: Happy path - scroll action');
const t2 = await call('novada_browser_flow', {
  url: 'https://example.com',
  actions: [{ type: 'scroll', value: 'down' }],
  country: '',
});
inspect('T2 scroll action', t2);

// 4. MISSING REQUIRED - no url
console.log('\n### TEST 3: Missing required param - no url');
const t3 = await call('novada_browser_flow', {
  actions: [{ type: 'screenshot' }],
  country: '',
});
inspect('T3 missing url', t3);

// 5. MISSING REQUIRED - no actions
console.log('\n### TEST 4: Missing required param - no actions');
const t4 = await call('novada_browser_flow', {
  url: 'https://example.com',
  country: '',
});
inspect('T4 missing actions', t4);

// 6. MISSING REQUIRED - no country
console.log('\n### TEST 5: Missing required param - no country (should fail or coerce)');
const t5 = await call('novada_browser_flow', {
  url: 'https://example.com',
  actions: [{ type: 'screenshot' }],
});
inspect('T5 missing country', t5);

// 7. WRONG TYPE - actions not array
console.log('\n### TEST 6: Wrong type - actions is string');
const t6 = await call('novada_browser_flow', {
  url: 'https://example.com',
  actions: 'screenshot',
  country: '',
});
inspect('T6 actions as string', t6);

// 8. WRONG TYPE - url is number
console.log('\n### TEST 7: Wrong type - url as integer');
const t7 = await call('novada_browser_flow', {
  url: 12345,
  actions: [{ type: 'screenshot' }],
  country: '',
});
inspect('T7 url as number', t7);

// 9. EMPTY ACTIONS ARRAY
console.log('\n### TEST 8: Empty actions array');
const t8 = await call('novada_browser_flow', {
  url: 'https://example.com',
  actions: [],
  country: '',
});
inspect('T8 empty actions array', t8);

// 10. UNKNOWN ACTION TYPE
console.log('\n### TEST 9: Unknown action type');
const t9 = await call('novada_browser_flow', {
  url: 'https://example.com',
  actions: [{ type: 'flyover', target: '#nonexistent' }],
  country: '',
});
inspect('T9 unknown action type', t9);

// 11. INJECTION - XSS in url
console.log('\n### TEST 10: XSS injection in url');
const t10 = await call('novada_browser_flow', {
  url: 'javascript:alert("xss")',
  actions: [{ type: 'screenshot' }],
  country: '',
});
inspect('T10 javascript: URL injection', t10);

// 12. INJECTION - SQL injection in selector
console.log('\n### TEST 11: SQL injection in selector');
const t11 = await call('novada_browser_flow', {
  url: 'https://example.com',
  actions: [{ type: 'click', selector: "'; DROP TABLE users; --" }],
  country: '',
});
inspect('T11 SQL injection in selector', t11);

// 13. HUGE VALUE - very long url
console.log('\n### TEST 12: URL length boundary - 2000 char url');
const hugeUrl = 'https://example.com/' + 'a'.repeat(2000);
const t12 = await call('novada_browser_flow', {
  url: hugeUrl,
  actions: [{ type: 'screenshot' }],
  country: '',
});
inspect('T12 very long URL', t12);

// 14. UNICODE in values
console.log('\n### TEST 13: Unicode in text action');
const t13 = await call('novada_browser_flow', {
  url: 'https://example.com',
  actions: [{ type: 'type', selector: 'input', value: '你好世界 🌍 <script>alert(1)</script>' }],
  country: '',
});
inspect('T13 unicode+injection in type value', t13);

// 15. EXTRA/UNKNOWN PARAMS
console.log('\n### TEST 14: Extra unknown param');
const t14 = await call('novada_browser_flow', {
  url: 'https://example.com',
  actions: [{ type: 'screenshot' }],
  country: '',
  unknownParam: 'should-be-ignored',
  anotherFakeParam: { nested: true },
});
inspect('T14 extra unknown params', t14);

// 16. VALID TYPE but malformed action - missing required selector for click
console.log('\n### TEST 15: Valid type but missing action sub-field (click without selector)');
const t15 = await call('novada_browser_flow', {
  url: 'https://example.com',
  actions: [{ type: 'click' }],
  country: '',
});
inspect('T15 click action without selector', t15);

// 17. SESSION_ID - test sticky session
console.log('\n### TEST 16: session_id sticky session');
const t16 = await call('novada_browser_flow', {
  url: 'https://example.com',
  actions: [{ type: 'screenshot' }],
  country: '',
  session_id: 'qa-test-session-001',
});
inspect('T16 session_id sticky', t16);

// 18. Wait action with ms
console.log('\n### TEST 17: Wait action with delay');
const t17 = await call('novada_browser_flow', {
  url: 'https://example.com',
  actions: [{ type: 'wait', delay: 500 }, { type: 'screenshot' }],
  country: 'us',
});
inspect('T17 wait + screenshot with country=us', t17);

// 19. NULL url
console.log('\n### TEST 18: null url');
const t18 = await call('novada_browser_flow', {
  url: null,
  actions: [{ type: 'screenshot' }],
  country: '',
});
inspect('T18 null url', t18);

await client.close();
console.log('\nDone.');
