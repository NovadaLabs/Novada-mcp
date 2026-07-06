// Try different auth methods and payload formats to isolate the 10001 error
import axios from '/Users/tongwu/Projects/novada-mcp/node_modules/axios/lib/axios.js';

const API_KEY = 'process.env.NOVADA_API_KEY';
const ENDPOINT = 'https://api-m.novada.com/v1/browser_flow/browser_flow_use';

async function testDirect(label, payload, headers) {
  try {
    const resp = await axios.post(ENDPOINT, payload, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers,
      },
      timeout: 30000,
    });
    console.log(`\n[${label}]`);
    console.log('  HTTP status:', resp.status);
    console.log('  Response:', JSON.stringify(resp.data).slice(0, 800));
  } catch (err) {
    console.log(`\n[${label}] ERROR`);
    if (err.response) {
      console.log('  HTTP status:', err.response.status);
      console.log('  Response:', JSON.stringify(err.response.data).slice(0, 800));
    } else {
      console.log('  Network error:', err.message?.slice(0, 200));
    }
  }
}

// Test 1: x-api-key header instead
await testDirect('x-api-key header', {
  url: 'https://example.com',
  actions: [{ type: 'screenshot' }],
}, { 'x-api-key': API_KEY });

// Test 2: apikey in query param style - try different payload keys
await testDirect('api_key in body', {
  url: 'https://example.com',
  actions: [{ type: 'screenshot' }],
  api_key: API_KEY,
}, { Authorization: `Bearer ${API_KEY}` });

// Test 3: Different action key names
await testDirect('action_list key', {
  url: 'https://example.com',
  action_list: [{ type: 'screenshot' }],
}, { Authorization: `Bearer ${API_KEY}` });

// Test 4: Steps instead of actions
await testDirect('steps key', {
  url: 'https://example.com',
  steps: [{ type: 'screenshot' }],
}, { Authorization: `Bearer ${API_KEY}` });

// Test 5: tasks instead of actions  
await testDirect('tasks key', {
  url: 'https://example.com',
  tasks: [{ type: 'screenshot' }],
}, { Authorization: `Bearer ${API_KEY}` });

// Test 6: No actions at all
await testDirect('no actions', {
  url: 'https://example.com',
}, { Authorization: `Bearer ${API_KEY}` });

// Test 7: Different HTTP method - GET
try {
  const resp = await axios.get(ENDPOINT, {
    params: { url: 'https://example.com' },
    headers: { Authorization: `Bearer ${API_KEY}` },
    timeout: 10000,
  });
  console.log('\n[GET method]', resp.status, JSON.stringify(resp.data).slice(0, 200));
} catch (err) {
  console.log('\n[GET method] ERROR:', err.response?.status, JSON.stringify(err.response?.data).slice(0, 200));
}

// Test 8: Inspect the actual endpoint being hit
console.log('\n[Endpoint info]', ENDPOINT);

console.log('\nDone.');
