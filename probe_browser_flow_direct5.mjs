// Probe the browser flow endpoint with a minimal verbose curl-equivalent
// to check what the API actually expects
import axios from '/Users/tongwu/Projects/novada-mcp/node_modules/axios/lib/axios.js';

const API_KEY = '1f35b477c9e1802778ec64aee2a6adfa';
const ENDPOINT = 'https://api-m.novada.com/v1/browser_flow/browser_flow_use';

// Log all request details
const instance = axios.create();
instance.interceptors.request.use(req => {
  console.log('\n[REQUEST]');
  console.log('  URL:', req.url);
  console.log('  Method:', req.method);
  console.log('  Headers:', JSON.stringify(req.headers, null, 2).slice(0, 500));
  console.log('  Data:', JSON.stringify(req.data).slice(0, 500));
  return req;
});

// Test with integer code 11006 workaround: maybe it needs different actions schema
// The API returns 10001 = "Invalid parameter" but actually the content might not be correctly parsed

// What if actions need to be a JSON string?
try {
  const resp = await instance.post(ENDPOINT, {
    url: 'https://example.com',
    actions: JSON.stringify([{ type: 'screenshot' }]),  // actions as JSON string
  }, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
  console.log('\n[actions as JSON string] HTTP', resp.status, JSON.stringify(resp.data).slice(0, 300));
} catch (err) {
  console.log('\n[actions as JSON string] ERROR', err.response?.status, JSON.stringify(err.response?.data).slice(0, 300));
}

// What about snake_case -> action_steps?
try {
  const resp = await axios.post(ENDPOINT, {
    url: 'https://example.com',
    action_steps: [{ type: 'screenshot' }],
  }, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
  console.log('\n[action_steps] HTTP', resp.status, JSON.stringify(resp.data).slice(0, 300));
} catch (err) {
  console.log('\n[action_steps] ERROR', err.response?.status, JSON.stringify(err.response?.data).slice(0, 300));
}

// What about ops/commands key?
for (const key of ['ops', 'commands', 'operations', 'flow', 'sequence', 'script']) {
  try {
    const resp = await axios.post(ENDPOINT, {
      url: 'https://example.com',
      [key]: [{ type: 'screenshot' }],
    }, {
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 8000,
    });
    console.log(`\n[key=${key}] HTTP ${resp.status}`, JSON.stringify(resp.data).slice(0, 200));
  } catch (err) {
    console.log(`\n[key=${key}] ERROR`, err.response?.status, JSON.stringify(err.response?.data).slice(0, 200));
  }
}

console.log('\nDone.');
