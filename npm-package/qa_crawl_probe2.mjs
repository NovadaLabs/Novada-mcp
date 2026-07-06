import { Client } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const env = {
  ...process.env,
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
  NOVADA_BROWSER_WS: 'wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com',
  NOVADA_WEB_UNBLOCKER_KEY: 'b27ad6e6834dd36407b00f4e502e055e',
};

const transport = new StdioClientTransport({
  command: 'node',
  args: [path.join(__dirname, 'build/index.js')],
  env,
});

const client = new Client({ name: 'qa-probe2', version: '1.0.0' });

async function callTool(name, args, label) {
  console.log(`\n=== ${label} ===`);
  console.log('Args:', JSON.stringify(args, null, 2));
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.[0]?.text ?? JSON.stringify(result);
    const preview = text.length > 800 ? text.slice(0, 800) + `\n...[truncated ${text.length} chars]` : text;
    console.log('Result:', preview);
    console.log('isError:', result.isError);
    return { ok: true, raw: text, result };
  } catch (e) {
    console.log('Error code:', e.code, 'Message:', e.message);
    return { ok: false, error: e };
  }
}

async function main() {
  await client.connect(transport);
  console.log('Connected to MCP server');

  // DEFECT CONFIRM-1: missing required max_pages silently uses default
  // schema says max_pages is required. When omitted, should it error?
  // In PROBE-4 it succeeded — test again with explicit confirmation
  const r4 = await callTool('novada_crawl', {
    url: 'https://example.com',
    strategy: 'bfs',
    render: 'auto',
    format: 'markdown'
  }, 'CONFIRM-1: All required except max_pages - does schema enforcement fire?');

  // DEFECT CONFIRM-2: additionalProperties:false but PROBE-12 (unknown_param) succeeded
  // Re-run to confirm
  const r12 = await callTool('novada_crawl', {
    url: 'https://example.com',
    max_pages: 2,
    strategy: 'bfs',
    render: 'auto',
    format: 'markdown',
    INJECTED_KEY: 'evil'
  }, 'CONFIRM-2: additionalProperties:false bypass - unknown param accepted?');

  // PROBE-16: Verify format is also "required" by spec but schema says it is
  // Try missing format + missing max_pages
  await callTool('novada_crawl', {
    url: 'https://example.com',
    strategy: 'bfs',
    render: 'auto'
  }, 'PROBE-16: Both max_pages and format missing');

  // PROBE-17: limit alias — schema shows it but it's NOT in required[].
  // Does it override max_pages if both provided?
  await callTool('novada_crawl', {
    url: 'https://example.com',
    max_pages: 1,
    limit: 5,
    strategy: 'bfs',
    render: 'auto',
    format: 'markdown'
  }, 'PROBE-17: Both max_pages=1 and limit=5 (alias conflict)');

  // PROBE-18: mode alias vs strategy — both provided, conflicting
  await callTool('novada_crawl', {
    url: 'https://example.com',
    max_pages: 2,
    strategy: 'bfs',
    mode: 'dfs',
    render: 'auto',
    format: 'markdown'
  }, 'PROBE-18: strategy=bfs + mode=dfs (alias conflict)');

  // PROBE-19: select_paths with regex injection (glob says safe but verify)
  await callTool('novada_crawl', {
    url: 'https://example.com',
    max_pages: 2,
    strategy: 'bfs',
    render: 'auto',
    format: 'markdown',
    select_paths: ['/../../../etc/passwd', '/docs/**']
  }, 'PROBE-19: Path traversal in select_paths');

  // PROBE-20: select_paths maxItems boundary — 21 items (above max=20)
  const tooManyPaths = Array.from({length: 21}, (_, i) => `/path${i}/**`);
  await callTool('novada_crawl', {
    url: 'https://example.com',
    max_pages: 2,
    strategy: 'bfs',
    render: 'auto',
    format: 'markdown',
    select_paths: tooManyPaths
  }, 'PROBE-20: select_paths with 21 items (above maxItems=20)');

  // PROBE-21: Very long URL (>2000 chars)
  const longPath = 'a'.repeat(2048);
  await callTool('novada_crawl', {
    url: `https://example.com/${longPath}`,
    max_pages: 2,
    strategy: 'bfs',
    render: 'auto',
    format: 'markdown'
  }, 'PROBE-21: Very long URL path (2048 chars)');

  // PROBE-22: Null values for optional fields
  await callTool('novada_crawl', {
    url: 'https://example.com',
    max_pages: 2,
    strategy: 'bfs',
    render: 'auto',
    format: 'markdown',
    instructions: null,
    select_paths: null
  }, 'PROBE-22: null values for optional string/array params');

  // PROBE-23: Check error response format — does it include agent_instruction?
  // Missing required fields should return errors with proper structure
  const r3 = await callTool('novada_crawl', {
    max_pages: 2,
    strategy: 'bfs',
    render: 'auto',
    format: 'markdown'
  }, 'PROBE-23: Missing url - check error format has agent_instruction');
  // analyze full error text
  console.log('Full error result for PROBE-23:', r3.raw);

  await client.close();
  console.log('\n=== DONE ===');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
