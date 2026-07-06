import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, 'build/index.js');

const env = {
  ...process.env,
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
  NOVADA_PROXY_HOST: '1b9b0a2b9011e022.vtv.na.novada.pro',
  NOVADA_PROXY_PORT: '7777',
  NOVADA_PROXY_ENDPOINT: 'http://1b9b0a2b9011e022.vtv.na.novada.pro:7777',
  NOVADA_WEB_UNBLOCKER_KEY: 'b27ad6e6834dd36407b00f4e502e055e',
};

const transport = new StdioClientTransport({
  command: 'node',
  args: [serverPath],
  env,
});

const client = new Client({ name: 'qa-probe3', version: '1.0.0' });

async function callTool(name, args) {
  try {
    const result = await client.callTool({ name, arguments: args });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message, code: err.code };
  }
}

async function main() {
  await client.connect(transport);
  console.log('Connected');

  const { tools } = await client.listTools();
  const toolMap = {};
  for (const t of tools) toolMap[t.name] = t;

  // ---- CRITICAL DEFECT: novada_crawl 'mode' and 'limit' aliases bypass required field validation ----
  // 'strategy' is in required[], but 'mode' is accepted as alias - schema says required but tool accepts without
  // 'max_pages' is in required[], but 'limit' is accepted as alias - same issue
  // CONFIRMED ALREADY. Now dig deeper to verify it actually uses the alias value.

  // ---- DEFECT: novada_extract 'url' is required but 'urls' is NOT - passing only urls array fails ----
  // CONFIRMED: ok:true but isError:true + "url: Invalid input" error
  // This means the tool advertises 'urls' batch mode in the description but the schema doesn't allow it

  // ---- Check novada_proxy_isp: does country param silently not work vs fail? ----
  // From call 12: it says "ISP zone does not support country targeting — 'US' ignored"
  // This means the schema documents 'country' as working, but the tool ignores it silently
  // The description says "ISP proxies are best for social and ecommerce" - no mention of country being a no-op

  // ---- DEFECT: novada_extract render='js' vs novada_crawl render enum inconsistency ----
  // extract has 'js' as an alias for 'render' in its enum
  // crawl does NOT have 'js' - only auto/static/render
  // Test: passing 'js' to crawl gives validation error (confirmed above)
  // This is an inconsistency - should both accept 'js'?

  // ---- Let's probe novada_proxy_isp country behavior more carefully ----
  console.log('=== ISP Proxy country param behavior ===');
  // The schema description says ISP is "best for social and ecommerce" and has country param
  // but the tool output says targeting is ignored. Let's check what the url actually contains.
  const r_isp_country = await callTool('novada_proxy_isp', {
    format: 'url',
    country: 'gb',
  });
  console.log('ISP with country=gb:', JSON.stringify(r_isp_country.ok ? {
    snippet: String(r_isp_country.result?.content?.[0]?.text || '').slice(0, 400)
  } : r_isp_country));

  // ---- novada_proxy_dedicated: no 'country' in schema ----
  // Is this intentional (dedicated IPs don't support geo)? Or an omission?
  // Other proxy tools: residential, isp, datacenter, mobile, static - all have country
  // Dedicated: no country. Session_id maps to a specific IP which may have a fixed geo.
  // This seems intentional but creates inconsistency in param surface.
  console.log('\n=== novada_proxy_dedicated schema check ===');
  const dedTool = toolMap['novada_proxy_dedicated'];
  console.log('required:', dedTool?.inputSchema?.required);
  console.log('props:', Object.keys(dedTool?.inputSchema?.properties || {}));

  // ---- novada_extract: 'render' enum has 'js' as alias for 'render' ----
  // This is self-referential naming confusion: enum['render','js','...'] where 'render' is in a param called 'render'
  // Plus the description says "'js' (or 'render')" - so 'render' is the canonical and 'js' is alias
  // This is confusing - the param is named 'render', one of its values is also 'render'
  // And the description further says novada_extract uses 'render=' while novada_unblock uses 'method='
  console.log('\n=== novada_extract render enum self-reference ===');
  const extractTool = toolMap['novada_extract'];
  const renderSchema = extractTool?.inputSchema?.properties?.render;
  console.log('render enum:', renderSchema?.enum);
  console.log('render description:', renderSchema?.description?.slice(0, 200));

  // ---- novada_unblock: no 'js' in method enum (only render/browser) ----
  // extract: render enum = ["auto","static","render","js","browser"]
  // unblock: method enum = ["render","browser"]
  // Inconsistency: 'js' only works on extract, not unblock
  // Also: extract render='browser' vs unblock method='browser' - same concept, different param name

  // ---- Check novada_crawl required fields enforcement with mode alias ----
  // From probe 2, passing mode='bfs' without strategy succeeded. Let's verify the actual
  // strategy used in the output
  console.log('\n=== novada_crawl: mode alias - what strategy is actually used? ===');
  const r_mode_dfs = await callTool('novada_crawl', {
    url: 'https://example.com',
    max_pages: 1,
    mode: 'dfs',   // Try dfs mode via alias
    render: 'static',
    format: 'markdown',
  });
  const modeOutput = String(r_mode_dfs.result?.content?.[0]?.text || '').slice(0, 400);
  console.log('crawl with mode=dfs output:', modeOutput);

  // ---- novada_extract required=['url','format','render'] but 'urls' array in schema not in required ----
  // The urls array is an alias - but it fails at validation if url is absent
  // This means the 'urls' param is essentially unusable as a standalone - you must always pass 'url'
  // even if you're using batch mode via 'urls'
  console.log('\n=== novada_extract: can urls replace url? ===');
  console.log('extract required:', extractTool?.inputSchema?.required);
  // test with url as array (same as urls)
  const r_url_array = await callTool('novada_extract', {
    url: ['https://example.com'],  // url as array directly
    format: 'markdown',
    render: 'auto',
    max_chars: 1000,
  });
  console.log('url as array:', JSON.stringify(r_url_array.ok ? {
    ok: true,
    snippet: String(r_url_array.result?.content?.[0]?.text || '').slice(0, 200)
  } : r_url_array));

  // ---- Final: full schema dump of novada_extract and novada_research for format comparison ----
  console.log('\n=== novada_research: no format param - confirmed inconsistency ===');
  console.log('Peer tools with format: novada_extract, novada_search, novada_scrape, novada_crawl, novada_monitor');
  console.log('novada_research: NO format param (always returns markdown)');
  console.log('This means agent cannot request JSON output from research - inconsistent with all peers');

  await client.close();
  console.log('\nDone probe 3.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
