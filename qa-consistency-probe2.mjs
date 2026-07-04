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
  NOVADA_BROWSER_WS: 'wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com',
  NOVADA_WEB_UNBLOCKER_KEY: 'b27ad6e6834dd36407b00f4e502e055e',
};

const transport = new StdioClientTransport({
  command: 'node',
  args: [serverPath],
  env,
});

const client = new Client({ name: 'qa-probe2', version: '1.0.0' });

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

  // ---- DEFECT PROBE 1: onlyMainContent camelCase silently ignored ----
  // novada_extract schema has NO onlyMainContent, but accepting unknown params without error
  // Let's verify that the tool executes the same way with and without onlyMainContent=true
  // by checking the output mentions "main content only"
  console.log('\n=== PROBE A: Does onlyMainContent camelCase silently get ignored? ===');
  console.log('Schema says: only snake_case params exist. camelCase params must be silently dropped.');
  const extractTool = toolMap['novada_extract'];
  const props = extractTool.inputSchema?.properties || {};
  console.log('extract props:', Object.keys(props).join(', '));
  // 'clean' is snake_case boolean (strips nav). Test if passing 'onlyMainContent' is silently ignored vs error
  const r_clean_false = await callTool('novada_extract', {
    url: 'https://www.bbc.com/news',
    format: 'markdown',
    render: 'auto',
    max_chars: 2000,
  });
  const snippet_no_clean = String(r_clean_false.result?.content?.[0]?.text || '').slice(0, 300);
  console.log('Without clean flag, content starts with:', snippet_no_clean.slice(0, 100));

  // ---- DEFECT PROBE 2: novada_crawl has both 'strategy' (required) and 'mode' (alias, optional) ----
  // Check: passing 'mode' instead of 'strategy' with strategy omitted - should fail validation
  console.log('\n=== PROBE B: novada_crawl - pass mode only (omit required strategy) ===');
  const r_mode_only = await callTool('novada_crawl', {
    url: 'https://example.com',
    max_pages: 1,
    mode: 'bfs',  // alias, but strategy is required
    render: 'static',
    format: 'markdown',
  });
  console.log('Result with mode only (strategy omitted):', JSON.stringify(r_mode_only.ok ? { ok: true, snippet: String(r_mode_only.result?.content?.[0]?.text || '').slice(0, 300) } : r_mode_only));

  // ---- DEFECT PROBE 3: novada_crawl has 'limit' and 'max_pages' as aliases ----
  // Both are in schema. Does passing only 'limit' work when 'max_pages' is required?
  console.log('\n=== PROBE C: novada_crawl - pass limit only (omit required max_pages) ===');
  const r_limit_only = await callTool('novada_crawl', {
    url: 'https://example.com',
    limit: 1,  // alias
    strategy: 'bfs',
    render: 'static',
    format: 'markdown',
  });
  console.log('Result with limit only (max_pages omitted):', JSON.stringify(r_limit_only.ok ? { ok: true, snippet: String(r_limit_only.result?.content?.[0]?.text || '').slice(0, 300) } : r_limit_only));

  // ---- DEFECT PROBE 4: novada_research has 'question' (required?) and 'query' (alias) ----
  // Check required fields
  const researchTool = toolMap['novada_research'];
  console.log('\n=== PROBE D: novada_research schema required fields ===');
  console.log('required:', researchTool.inputSchema?.required);
  console.log('props:', Object.keys(researchTool.inputSchema?.properties || {}));

  // Test: pass only 'query' (alias), not 'question'
  console.log('\n=== PROBE D2: novada_research with query only (no question) ===');
  const r_research_query = await callTool('novada_research', {
    query: 'What is 1+1?',
    depth: 'quick',
  });
  console.log('Result:', JSON.stringify(r_research_query.ok ? { ok: true, snippet: String(r_research_query.result?.content?.[0]?.text || '').slice(0, 300) } : r_research_query));

  // ---- DEFECT PROBE 5: novada_extract render enum has 'js' AND 'render' ----
  // novada_crawl render enum only has 'render', not 'js'
  // Test: pass render='js' to novada_crawl (should fail since 'js' is not in crawl's enum)
  console.log('\n=== PROBE E: novada_crawl with render=js (not in its enum) ===');
  const r_crawl_js = await callTool('novada_crawl', {
    url: 'https://example.com',
    max_pages: 1,
    strategy: 'bfs',
    render: 'js',   // only valid in novada_extract, not novada_crawl
    format: 'markdown',
  });
  console.log('Result:', JSON.stringify(r_crawl_js.ok ? { ok: true, snippet: String(r_crawl_js.result?.content?.[0]?.text || '').slice(0, 200) } : r_crawl_js));

  // ---- DEFECT PROBE 6: novada_extract render='browser' vs novada_unblock method='browser' ----
  // Verify these two tools use different param names for the same concept
  console.log('\n=== PROBE F: Schema comparison novada_extract render vs novada_unblock method ===');
  const unblockTool = toolMap['novada_unblock'];
  const unblockProps = unblockTool.inputSchema?.properties || {};
  console.log('novada_extract: render enum:', JSON.stringify(props.render?.enum));
  console.log('novada_unblock: method enum:', JSON.stringify(unblockProps.method?.enum));
  console.log('-> extract uses "render=" param, unblock uses "method=" - DIFFERENT param names for same concept');

  // ---- DEFECT PROBE 7: novada_proxy_isp country param - says country targeting not supported ----
  // The schema has 'country' param but the output says "ISP zone does not support country targeting"
  // This is a documentation/behavior mismatch
  const ispTool = toolMap['novada_proxy_isp'];
  console.log('\n=== PROBE G: novada_proxy_isp country schema ===');
  const ispProps = ispTool.inputSchema?.properties || {};
  console.log('country in schema:', JSON.stringify(ispProps.country));
  // Already confirmed it silently ignores country (see CALL 12 output above)
  // But the schema doesn't say it's a no-op - it documents it as a real param

  // ---- DEFECT PROBE 8: novada_extract 'urls' array param vs 'url' single ----
  // Both in schema. Test: pass urls array with no url - is it accepted?
  console.log('\n=== PROBE H: novada_extract with urls array (no url param) ===');
  const extractRequired = extractTool.inputSchema?.required || [];
  console.log('extract required:', extractRequired);
  const r_urls = await callTool('novada_extract', {
    urls: ['https://example.com', 'https://httpbin.org/get'],
    format: 'markdown',
    render: 'auto',
    max_chars: 1000,
  });
  console.log('Result:', JSON.stringify(r_urls.ok ? { ok: true, snippet: String(r_urls.result?.content?.[0]?.text || '').slice(0, 300) } : r_urls));

  // ---- DEFECT PROBE 9: novada_research - missing 'format' param ----
  // All other content tools have format. novada_research does not. Inconsistency.
  console.log('\n=== PROBE I: novada_research missing format param (inconsistent with peers) ===');
  const researchProps = researchTool.inputSchema?.properties || {};
  console.log('research props:', Object.keys(researchProps).join(', '));
  console.log('Has format?', 'format' in researchProps ? 'YES' : 'NO (missing - inconsistent with novada_extract/search/crawl)');

  // ---- DEFECT PROBE 10: novada_scrape 'format=toon' vs novada_scraper_result 'format=toon' ----
  // Check scraper_result schema
  const scraperResultTool = toolMap['novada_scraper_result'];
  if (scraperResultTool) {
    const srProps = scraperResultTool.inputSchema?.properties || {};
    console.log('\n=== PROBE J: novada_scraper_result format schema ===');
    console.log('format:', JSON.stringify(srProps.format));
  }

  // ---- DEFECT PROBE 11: novada_extract max_chars=500 should fail (min=1000) ----
  // Confirmed from CALL 4 that it returns a soft error (ok:true) not a tool-level error
  // But the error message says "max_chars: Too small" - this means validation runs but
  // result is ok:true (soft error in content). Is this consistent with other tools?
  console.log('\n=== PROBE K: Validation error delivery mode - soft vs hard ===');
  const r_bad_maxchars = await callTool('novada_extract', {
    url: 'https://example.com',
    format: 'markdown',
    render: 'auto',
    max_chars: 100,  // too small (min 1000)
  });
  console.log('ok field:', r_bad_maxchars.ok);
  console.log('isError field:', r_bad_maxchars.result?.isError);
  console.log('content text:', String(r_bad_maxchars.result?.content?.[0]?.text || '').slice(0, 200));

  // Check novada_search with invalid engine
  const r_bad_engine = await callTool('novada_search', {
    query: 'test',
    engine: 'INVALID_ENGINE',
    num: 1,
    country: 'us',
    language: 'en',
  });
  console.log('\nnovada_search with invalid engine:');
  console.log('ok field:', r_bad_engine.ok);
  console.log('isError field:', r_bad_engine.result?.isError);
  console.log('content text:', String(r_bad_engine.result?.content?.[0]?.text || '').slice(0, 200));

  // ---- DEFECT PROBE 12: novada_proxy_dedicated 'country' missing from schema ----
  const dedicatedTool = toolMap['novada_proxy_dedicated'];
  if (dedicatedTool) {
    const dedProps = dedicatedTool.inputSchema?.properties || {};
    console.log('\n=== PROBE L: novada_proxy_dedicated schema ===');
    console.log('props:', Object.keys(dedProps).join(', '));
    console.log('country:', 'country' in dedProps ? JSON.stringify(dedProps.country) : 'MISSING');
    // All other proxy tools have 'country', dedicated doesn't - is this intentional?
  }

  await client.close();
  console.log('\nDone probe 2.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
