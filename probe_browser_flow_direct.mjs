// Direct API call to diagnose the actual HTTP response
import axios from '/Users/tongwu/Projects/novada-mcp/node_modules/axios/lib/axios.js';

const API_KEY = 'process.env.NOVADA_API_KEY';
const ENDPOINT = 'https://api-m.novada.com/v1/browser_flow/browser_flow_use';

async function testDirect(label, payload) {
  try {
    const resp = await axios.post(ENDPOINT, payload, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 30000,
    });
    console.log(`\n[${label}]`);
    console.log('  HTTP status:', resp.status);
    console.log('  Response:', JSON.stringify(resp.data).slice(0, 500));
  } catch (err) {
    console.log(`\n[${label}] ERROR`);
    if (err.response) {
      console.log('  HTTP status:', err.response.status);
      console.log('  Response:', JSON.stringify(err.response.data).slice(0, 500));
    } else {
      console.log('  Network error:', err.message);
    }
  }
}

// Test 1: Exact payload from the tool
await testDirect('exact_tool_payload', {
  url: 'https://example.com',
  actions: [{ type: 'screenshot' }],
});

// Test 2: With country field
await testDirect('with_country', {
  url: 'https://example.com',
  actions: [{ type: 'screenshot' }],
  country: 'us',
});

// Test 3: Different action format
await testDirect('click_action', {
  url: 'https://example.com',
  actions: [{ type: 'click', selector: 'body' }],
});

console.log('\nDone.');
