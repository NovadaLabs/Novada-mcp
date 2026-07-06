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

const client = new Client({ name: 'qa-probe', version: '1.0.0' });

async function callTool(name, args, label) {
  console.log(`\n=== ${label} ===`);
  console.log('Args:', JSON.stringify(args, null, 2));
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.[0]?.text ?? JSON.stringify(result);
    // Truncate long output
    const preview = text.length > 600 ? text.slice(0, 600) + `\n...[truncated ${text.length} chars]` : text;
    console.log('Result:', preview);
    return { ok: true, raw: text, result };
  } catch (e) {
    console.log('Error code:', e.code, 'Message:', e.message);
    return { ok: false, error: e };
  }
}

async function main() {
  await client.connect(transport);
  console.log('Connected to MCP server');

  // Step 1: List tools to get real schema
  const tools = await client.listTools();
  const crawlTool = tools.tools.find(t => t.name === 'novada_crawl');
  if (!crawlTool) {
    console.log('novada_crawl NOT FOUND. Available tools:', tools.tools.map(t => t.name).join(', '));
    await client.close();
    return;
  }
  console.log('\n=== novada_crawl schema ===');
  console.log(JSON.stringify(crawlTool.inputSchema, null, 2));
  console.log('Description:', crawlTool.description?.slice(0, 300));

  // PROBE 1: Happy path — minimal valid args
  await callTool('novada_crawl', {
    url: 'https://example.com',
    max_pages: 2,
    strategy: 'bfs',
    render: 'auto'
  }, 'PROBE-1: Happy path minimal');

  // PROBE 2: Happy path with format=json and select_paths
  await callTool('novada_crawl', {
    url: 'https://httpbin.org',
    max_pages: 2,
    strategy: 'dfs',
    render: 'static',
    format: 'json',
    select_paths: ['/get', '/post']
  }, 'PROBE-2: Happy path with format=json + select_paths');

  // PROBE 3: Missing required param — no url
  await callTool('novada_crawl', {
    max_pages: 2,
    strategy: 'bfs',
    render: 'auto'
  }, 'PROBE-3: Missing required url');

  // PROBE 4: Missing required param — no max_pages
  await callTool('novada_crawl', {
    url: 'https://example.com',
    strategy: 'bfs',
    render: 'auto'
  }, 'PROBE-4: Missing required max_pages');

  // PROBE 5: Wrong type — max_pages as string
  await callTool('novada_crawl', {
    url: 'https://example.com',
    max_pages: '2',
    strategy: 'bfs',
    render: 'auto'
  }, 'PROBE-5: max_pages as string (type coercion)');

  // PROBE 6: Boundary — max_pages=0 (below minimum)
  await callTool('novada_crawl', {
    url: 'https://example.com',
    max_pages: 0,
    strategy: 'bfs',
    render: 'auto'
  }, 'PROBE-6: max_pages=0 (below min=1)');

  // PROBE 7: Boundary — max_pages=21 (above maximum)
  await callTool('novada_crawl', {
    url: 'https://example.com',
    max_pages: 21,
    strategy: 'bfs',
    render: 'auto'
  }, 'PROBE-7: max_pages=21 (above max=20)');

  // PROBE 8: Invalid enum value for strategy
  await callTool('novada_crawl', {
    url: 'https://example.com',
    max_pages: 2,
    strategy: 'random',
    render: 'auto'
  }, 'PROBE-8: strategy=random (invalid enum)');

  // PROBE 9: Invalid enum for render
  await callTool('novada_crawl', {
    url: 'https://example.com',
    max_pages: 2,
    strategy: 'bfs',
    render: 'browser'
  }, 'PROBE-9: render=browser (invalid if not in schema)');

  // PROBE 10: Injection — URL with script injection
  await callTool('novada_crawl', {
    url: 'https://example.com/<script>alert(1)</script>',
    max_pages: 2,
    strategy: 'bfs',
    render: 'auto'
  }, 'PROBE-10: URL injection attempt');

  // PROBE 11: Empty string URL
  await callTool('novada_crawl', {
    url: '',
    max_pages: 2,
    strategy: 'bfs',
    render: 'auto'
  }, 'PROBE-11: Empty string URL');

  // PROBE 12: Unknown/extra param
  await callTool('novada_crawl', {
    url: 'https://example.com',
    max_pages: 2,
    strategy: 'bfs',
    render: 'auto',
    unknown_param: 'surprise'
  }, 'PROBE-12: Extra unknown param');

  // PROBE 13: max_pages negative
  await callTool('novada_crawl', {
    url: 'https://example.com',
    max_pages: -1,
    strategy: 'bfs',
    render: 'auto'
  }, 'PROBE-13: max_pages=-1 (negative)');

  // PROBE 14: Non-URL string for url
  await callTool('novada_crawl', {
    url: 'not-a-url',
    max_pages: 2,
    strategy: 'bfs',
    render: 'auto'
  }, 'PROBE-14: Non-URL string');

  // PROBE 15: Unicode/emoji in url param
  await callTool('novada_crawl', {
    url: 'https://example.com/\u{1F4A3}',
    max_pages: 2,
    strategy: 'bfs',
    render: 'auto'
  }, 'PROBE-15: Unicode/emoji in URL');

  await client.close();
  console.log('\n=== DONE ===');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
