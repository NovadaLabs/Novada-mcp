/**
 * QA: Concurrency - Final targeted probes
 * 1. Confirm isError not set on novada_browser_flow API errors
 * 2. Concurrent navigate on shared browser session (race on page.goto)
 * 3. Check if novada_extract errors also misreport isError
 * 4. Verify novada_search file output format (file path in response text)
 */

import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const CREDS = {
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
  NOVADA_BROWSER_WS: 'wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com',
  PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
};

async function makeClient(name) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
    env: CREDS,
  });
  const client = new Client({ name, version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

async function run() {
  console.log('=== TARGETED PROBE #3 ===\n');

  // ── PROBE 1: isError on browser_flow API errors ────────────────────────────
  console.log('=== PROBE 1: novada_browser_flow isError flag on API error ===');
  {
    const { client } = await makeClient('bf-iserror');
    const r = await client.callTool({ name: 'novada_browser_flow', arguments: {
      url: 'https://httpbin.org/get',
      actions: [{ type: 'screenshot' }],
      country: '',
      session_id: 'probe1-session',
    }});
    const text = r.content?.[0]?.text || '';
    const isApiError = text.includes('API Error') || text.includes('api error');
    console.log(`isError field: ${JSON.stringify(r.isError)}`);
    console.log(`Response contains "API Error": ${isApiError}`);
    console.log(`BUG CONFIRMED: isError should be true but is ${JSON.stringify(r.isError)}: ${isApiError && !r.isError}`);
    console.log(`Full response text (first 300 chars):\n${text.slice(0, 300)}`);
    await client.close();
  }
  console.log();

  // ── PROBE 2: isError on browser_flow endpoint unavailable ─────────────────────
  console.log('=== PROBE 2: novada_browser_flow - Endpoint Unavailable response ===');
  {
    const { client } = await makeClient('bf-404');
    // This will trigger the same API error path - checking both response types
    const r = await client.callTool({ name: 'novada_browser_flow', arguments: {
      url: 'https://example.com',
      actions: [{ type: 'wait', delay: 100 }],
      country: 'us',
    }});
    console.log(`isError field: ${JSON.stringify(r.isError)}`);
    const text = r.content?.[0]?.text || '';
    const isErrorContent = text.includes('Error') || text.includes('error');
    console.log(`Contains error content: ${isErrorContent}`);
    console.log(`isError should be true but isn't: ${isErrorContent && !r.isError}`);
    console.log(`Text:\n${text.slice(0, 300)}`);
    await client.close();
  }
  console.log();

  // ── PROBE 3: Concurrent browser navigate (in-process) race on page.goto ─────
  // This is the key concurrency bug: 2 concurrent callTool on same session_id
  // from the same MCP process. Both get the same `existingPage`, then both call
  // page.goto() concurrently — the second goto can cancel the first navigation.
  console.log('=== PROBE 3: In-process concurrent navigations on SAME session_id (race) ===');
  {
    const { client } = await makeClient('browser-race');
    // First: establish session with initial navigate
    const init = await client.callTool({ name: 'novada_browser', arguments: {
      actions: [
        { action: 'navigate', url: 'https://httpbin.org/get', wait_until: 'domcontentloaded' }
      ],
      timeout: 60000,
      session_id: 'race-session-X',
    }});
    const initText = init.content?.[0]?.text || '';
    console.log(`Init: ok=${!init.isError} text=${initText.slice(0, 100)}`);

    // Now fire 3 concurrent navigations on same session_id
    const [r1, r2, r3] = await Promise.all([
      client.callTool({ name: 'novada_browser', arguments: {
        actions: [{ action: 'navigate', url: 'https://httpbin.org/get', wait_until: 'domcontentloaded' }],
        timeout: 60000,
        session_id: 'race-session-X',
      }}),
      client.callTool({ name: 'novada_browser', arguments: {
        actions: [{ action: 'navigate', url: 'https://httpbin.org/ip', wait_until: 'domcontentloaded' }],
        timeout: 60000,
        session_id: 'race-session-X',
      }}),
      client.callTool({ name: 'novada_browser', arguments: {
        actions: [{ action: 'navigate', url: 'https://httpbin.org/headers', wait_until: 'domcontentloaded' }],
        timeout: 60000,
        session_id: 'race-session-X',
      }}),
    ]);

    console.log(`[Race-1] isError=${r1.isError} text=${r1.content?.[0]?.text?.slice(0, 200)}`);
    console.log(`[Race-2] isError=${r2.isError} text=${r2.content?.[0]?.text?.slice(0, 200)}`);
    console.log(`[Race-3] isError=${r3.isError} text=${r3.content?.[0]?.text?.slice(0, 200)}`);

    const anyError = r1.isError || r2.isError || r3.isError;
    const r1HasGet = r1.content?.[0]?.text?.includes('/get');
    const r2HasIp = r2.content?.[0]?.text?.includes('/ip');
    const r3HasHeaders = r3.content?.[0]?.text?.includes('/headers');
    const anyNavOnWrongPage = (!r1HasGet && !r1.isError) || (!r2HasIp && !r2.isError) || (!r3HasHeaders && !r3.isError);
    console.log(`Any errors: ${anyError} | Race errors detected: ${anyNavOnWrongPage}`);

    await client.close();
  }
  console.log();

  // ── PROBE 4: novada_extract error isError flag ─────────────────────────────
  console.log('=== PROBE 4: novada_extract error type (soft error vs isError) ===');
  {
    const { client } = await makeClient('extract-err');
    // Use a URL that times out (api.ipify.org did in probe E)
    const r = await client.callTool({ name: 'novada_extract', arguments: {
      url: 'https://httpbin.org/ip',
      format: 'markdown',
      render: 'auto',
    }});
    console.log(`isError field: ${JSON.stringify(r.isError)}`);
    const text = r.content?.[0]?.text || '';
    console.log(`Contains "Error": ${text.includes('Error') || text.includes('error')}`);
    console.log(`Text (first 200 chars):\n${text.slice(0, 200)}`);
    await client.close();
  }
  console.log();

  // ── PROBE 5: novada_search - is file path always first in response? ─────────────
  console.log('=== PROBE 5: novada_search response format - file path visibility ===');
  {
    const { client } = await makeClient('search-fmt');
    const r = await client.callTool({ name: 'novada_search', arguments: {
      query: 'test query format check',
      engine: 'duckduckgo',
      num: 3,
      country: '',
      language: '',
    }});
    const text = r.content?.[0]?.text || '';
    const startsWithFilePath = text.startsWith('📁');
    const hasFilePath = text.includes('📁 /Users/tongwu/Downloads/');
    console.log(`Response starts with file path: ${startsWithFilePath}`);
    console.log(`File path embedded in response: ${hasFilePath}`);
    // The file path appearing in the agent-visible response is a defect:
    // agents should not see local filesystem paths (PII leak, environment exposure)
    console.log(`POTENTIAL DEFECT: agent-visible local filesystem path in response: ${hasFilePath}`);
    console.log(`First 200 chars:\n${text.slice(0, 200)}`);
    await client.close();
  }
  console.log();

  console.log('=== TARGETED PROBE #3 COMPLETE ===');
}

run().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
