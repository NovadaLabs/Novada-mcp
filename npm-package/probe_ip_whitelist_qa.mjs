import { Client } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CREDS = {
  NOVADA_API_KEY: 'process.env.NOVADA_API_KEY',
  NOVADA_DEVELOPER_API_KEY: 'process.env.NOVADA_API_KEY',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
};

const results = [];

function log(label, data) {
  const entry = { label, data };
  results.push(entry);
  process.stderr.write(`\n=== ${label} ===\n`);
  process.stderr.write(JSON.stringify(data, null, 2) + '\n');
}

async function callTool(client, name, args, label) {
  const start = Date.now();
  try {
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 25000 });
    const elapsed = Date.now() - start;
    log(label, { ok: true, elapsed_ms: elapsed, result: res });
    return { ok: true, elapsed_ms: elapsed, result: res };
  } catch (err) {
    const elapsed = Date.now() - start;
    log(label, { ok: false, elapsed_ms: elapsed, error: { message: err.message, code: err.code, data: err.data } });
    return { ok: false, elapsed_ms: elapsed, error: err };
  }
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(__dirname, 'build/index.js')],
    env: { ...process.env, ...CREDS },
  });

  const client = new Client({ name: 'qa-probe', version: '1.0.0' });
  await client.connect(transport);

  // 1. listTools — read real schema
  const toolsList = await client.listTools();
  const wlTool = toolsList.tools.find(t => t.name === 'novada_ip_whitelist');
  log('TOOL_SCHEMA', { found: !!wlTool, inputSchema: wlTool?.inputSchema });

  // 2. Happy path: list product=1 (read-only, safe)
  await callTool(client, 'novada_ip_whitelist', { action: 'list', product: '1' }, 'HAPPY_LIST_PRODUCT1');

  // 3. Happy path: list product=4
  await callTool(client, 'novada_ip_whitelist', { action: 'list', product: '4' }, 'HAPPY_LIST_PRODUCT4');

  // 4. Happy path: list product=5
  await callTool(client, 'novada_ip_whitelist', { action: 'list', product: '5' }, 'HAPPY_LIST_PRODUCT5');

  // 5. Add without confirm — should return confirmation_required (not call API)
  await callTool(client, 'novada_ip_whitelist', {
    action: 'add', product: '1', ip: '203.0.113.42'
  }, 'ADD_NO_CONFIRM_PREVIEW');

  // 6. Add without ip — should return error + agent_instruction
  await callTool(client, 'novada_ip_whitelist', {
    action: 'add', product: '1'
  }, 'ADD_MISSING_IP');

  // 7. Del without ips — should return error + agent_instruction
  await callTool(client, 'novada_ip_whitelist', {
    action: 'del', product: '1'
  }, 'DEL_MISSING_IPS');

  // 8. Remark without id — should return error + agent_instruction
  await callTool(client, 'novada_ip_whitelist', {
    action: 'remark', product: '1'
  }, 'REMARK_MISSING_ID');

  // 9. Wrong product code — should fail Zod validation
  await callTool(client, 'novada_ip_whitelist', {
    action: 'list', product: '2'
  }, 'INVALID_PRODUCT_2');

  // 10. Missing product entirely — should fail Zod (product is required)
  await callTool(client, 'novada_ip_whitelist', {
    action: 'list'
  }, 'MISSING_PRODUCT');

  // 11. Missing action entirely — should fail Zod
  await callTool(client, 'novada_ip_whitelist', {
    product: '1'
  }, 'MISSING_ACTION');

  // 12. Injection attempt in ip field — should be rejected by IP regex
  await callTool(client, 'novada_ip_whitelist', {
    action: 'add', product: '1', ip: "'; DROP TABLE whitelist; --"
  }, 'INJECTION_IN_IP');

  // 13. Injection in ips (del) — should be rejected
  await callTool(client, 'novada_ip_whitelist', {
    action: 'del', product: '1', ips: "1.2.3.4,'; DROP TABLE--"
  }, 'INJECTION_IN_IPS');

  // 14. Unicode/emoji in remark field — check max 200 chars
  await callTool(client, 'novada_ip_whitelist', {
    action: 'add', product: '1', ip: '203.0.113.1',
    remark: '🤖'.repeat(60)  // 60*4 bytes = 240 chars in some encodings but 60 unicode chars
  }, 'UNICODE_REMARK_PREVIEW');

  // 15. Remark over 200 chars — should fail Zod
  await callTool(client, 'novada_ip_whitelist', {
    action: 'remark', product: '1', id: '123',
    remark: 'x'.repeat(201)
  }, 'REMARK_TOO_LONG');

  // 16. Extra unknown params — strict() should reject
  await callTool(client, 'novada_ip_whitelist', {
    action: 'list', product: '1', bogusParam: 'evil'
  }, 'EXTRA_UNKNOWN_PARAM');

  // 17. lock=2 (out of range per description 0/1) — no Zod constraint on value
  await callTool(client, 'novada_ip_whitelist', {
    action: 'list', product: '1', lock: 2
  }, 'LOCK_OUT_OF_RANGE');

  // 18. lock as string instead of number — Zod should coerce or reject
  await callTool(client, 'novada_ip_whitelist', {
    action: 'list', product: '1', lock: '1'
  }, 'LOCK_AS_STRING');

  // 19. Hugely large lock value
  await callTool(client, 'novada_ip_whitelist', {
    action: 'list', product: '1', lock: 999999999
  }, 'LOCK_HUGE_VALUE');

  // 20. IPv6 happy path ip
  await callTool(client, 'novada_ip_whitelist', {
    action: 'add', product: '1', ip: '2001:db8::1'
  }, 'IPV6_IP_PREVIEW');

  // 21. CIDR notation IP
  await callTool(client, 'novada_ip_whitelist', {
    action: 'add', product: '1', ip: '192.168.0.0/24'
  }, 'CIDR_IP_PREVIEW');

  // 22. Empty string ip — should fail refine
  await callTool(client, 'novada_ip_whitelist', {
    action: 'add', product: '1', ip: ''
  }, 'EMPTY_STRING_IP');

  // 23. Confirm:false explicitly (not literal true) — should fail Zod or treat as no-confirm
  await callTool(client, 'novada_ip_whitelist', {
    action: 'add', product: '1', ip: '203.0.113.5', confirm: false
  }, 'CONFIRM_FALSE');

  // 24. list with ip filter (valid IP filter)
  await callTool(client, 'novada_ip_whitelist', {
    action: 'list', product: '1', ip: '203.0.113.42'
  }, 'LIST_WITH_IP_FILTER');

  // 25. list with time range filter
  await callTool(client, 'novada_ip_whitelist', {
    action: 'list', product: '1', start_time: '2026-01-01', end_time: '2026-12-31'
  }, 'LIST_WITH_TIME_FILTER');

  // 26. list with lock=0
  await callTool(client, 'novada_ip_whitelist', {
    action: 'list', product: '1', lock: 0
  }, 'LIST_WITH_LOCK_0');

  await client.close();

  // Summary to stdout
  process.stdout.write(JSON.stringify({
    total: results.length,
    results: results.map(r => ({
      label: r.label,
      ok: r.data.ok,
      elapsed_ms: r.data.elapsed_ms,
      has_error_code: r.data.ok === false ? r.data.error?.code : null,
      content_preview: r.data.ok
        ? (r.data.result?.content?.[0]?.text?.slice(0, 300))
        : null,
    }))
  }, null, 2));
}

main().catch(err => {
  process.stderr.write('FATAL: ' + err.stack + '\n');
  process.exit(1);
});
