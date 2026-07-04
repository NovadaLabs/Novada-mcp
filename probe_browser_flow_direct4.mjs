// Check dashboard API for account status and what browser_flow products are active
import axios from '/Users/tongwu/Projects/novada-mcp/node_modules/axios/lib/axios.js';

const API_KEY = '1f35b477c9e1802778ec64aee2a6adfa';

async function probe(label, url, method = 'POST', payload = null, headers = {}) {
  try {
    const config = {
      url,
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}`, ...headers },
      timeout: 15000,
    };
    if (payload) config.data = payload;
    const resp = await axios(config);
    console.log(`\n[${label}] HTTP ${resp.status}`);
    console.log('  Response:', JSON.stringify(resp.data).slice(0, 600));
  } catch (err) {
    console.log(`\n[${label}] ERROR`);
    if (err.response) {
      console.log('  HTTP status:', err.response.status);
      console.log('  Body:', JSON.stringify(err.response.data).slice(0, 400) || err.response.statusText);
    } else {
      console.log('  Network error:', err.message?.slice(0, 300));
    }
  }
}

// Check account info/balance via developer API
await probe('developer account balance', 'https://api.novada.com/g/api/developer/wallet/balance', 'POST');

// Check account product list
await probe('developer product list', 'https://api.novada.com/g/api/developer/product/list', 'POST');

// Check actual browser API endpoint (account info might reveal activation)
await probe('api.novada.com browser product', 'https://api.novada.com/g/api/proxy/browser_proxy_info', 'POST');

// Try querying the browser flow with apikey in form-data style
const FormData = (await import('/Users/tongwu/Projects/novada-mcp/node_modules/form-data/lib/form_data.js')).default;
const form = new FormData();
form.append('url', 'https://example.com');
form.append('actions', JSON.stringify([{ type: 'screenshot' }]));

try {
  const resp = await axios.post('https://api-m.novada.com/v1/browser_flow/browser_flow_use', form, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      ...form.getHeaders(),
    },
    timeout: 15000,
  });
  console.log('\n[form-data POST] HTTP', resp.status);
  console.log('  Response:', JSON.stringify(resp.data).slice(0, 400));
} catch (err) {
  console.log('\n[form-data POST] ERROR');
  if (err.response) {
    console.log('  HTTP:', err.response.status, JSON.stringify(err.response.data).slice(0, 300));
  } else {
    console.log('  Network:', err.message?.slice(0, 200));
  }
}

// Try with api_key param in URL
await probe('api_key in URL query', 'https://api-m.novada.com/v1/browser_flow/browser_flow_use?api_key=' + API_KEY, 'POST', {
  url: 'https://example.com',
  actions: [{ type: 'screenshot' }],
}, { Authorization: '' });

console.log('\nDone.');
