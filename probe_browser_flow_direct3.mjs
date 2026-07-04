// Probe deeper: check if the 10001 is a feature not activated vs wrong format
// Test with BROWSER_WS endpoint (CDP-based browser) vs the browser_flow API
import axios from '/Users/tongwu/Projects/novada-mcp/node_modules/axios/lib/axios.js';

const API_KEY = 'process.env.NOVADA_API_KEY';

// Check what base API URL returns 
async function probeUrl(label, url, method = 'GET', payload = null, headers = {}) {
  try {
    const config = {
      url,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      timeout: 15000,
    };
    if (payload) config.data = payload;
    const resp = await axios(config);
    console.log(`\n[${label}]`);
    console.log('  HTTP status:', resp.status);
    console.log('  Response:', JSON.stringify(resp.data).slice(0, 400));
  } catch (err) {
    console.log(`\n[${label}] ERROR`);
    if (err.response) {
      console.log('  HTTP status:', err.response.status);
      console.log('  Response:', JSON.stringify(err.response.data).slice(0, 400) || err.response.statusText);
    } else {
      console.log('  Network error:', err.message?.slice(0, 300));
    }
  }
}

// Probe API base route
await probeUrl('api-m base GET', 'https://api-m.novada.com/', 'GET', null, { Authorization: `Bearer ${API_KEY}` });

// Probe if browser_flow root exists
await probeUrl('browser_flow root GET', 'https://api-m.novada.com/v1/browser_flow/', 'GET', null, { Authorization: `Bearer ${API_KEY}` });

// Probe the endpoint with different payload variations - maybe it expects string "actions"
await probeUrl('actions as string type', 'https://api-m.novada.com/v1/browser_flow/browser_flow_use', 'POST', {
  url: 'https://example.com',
  actions: [{ action: 'screenshot' }],  // maybe "action" not "type"?
}, { Authorization: `Bearer ${API_KEY}` });

await probeUrl('action_type key', 'https://api-m.novada.com/v1/browser_flow/browser_flow_use', 'POST', {
  url: 'https://example.com',
  actions: [{ action_type: 'screenshot' }],
}, { Authorization: `Bearer ${API_KEY}` });

// Check novada_browser tool to see what endpoint IT uses (CDP)
// Try the hs-scbr2 (HTTPS) endpoint
await probeUrl('browser HTTPS health', 'https://hs-scbr2.novada.com/', 'GET', null, {});

// Check if there's a distinct browser_flow activation check
await probeUrl('browser status endpoint', 'https://api-m.novada.com/v1/browser_flow/', 'POST', {
  url: 'https://example.com',
  actions: [{ type: 'screenshot' }],
}, { Authorization: `Bearer ${API_KEY}` });

console.log('\nDone.');
