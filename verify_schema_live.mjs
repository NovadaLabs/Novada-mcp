import { Client } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/tongwu/Projects/novada-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const ENV = {
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_BROWSER_WS: 'wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com',
  PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
};

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
  env: ENV,
});

const client = new Client({ name: 'verify-schema', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

const tools = await client.listTools();
const tool = tools.tools.find(t => t.name === 'novada_browser_flow');

// Key assertions
const schema = tool.inputSchema;
const required = schema.required || [];
const countryProp = schema.properties?.country;
const sessionIdProp = schema.properties?.session_id;

console.log('[Schema check]');
console.log('required[]:', JSON.stringify(required));
console.log('country in required:', required.includes('country'));
console.log('country.default:', JSON.stringify(countryProp?.default));
console.log('session_id in required:', required.includes('session_id'));

// The bug: country has a default ("") but is in required[]
// This means:
// - JSON schema consumers (LLMs, validators) think country is mandatory
// - But Zod/tool parses OK without it
if (required.includes('country') && countryProp?.default !== undefined) {
  console.log('\nCONFIRMED DEFECT: country is in required[] but has default', JSON.stringify(countryProp.default));
  console.log('Per JSON schema spec, a field with a default value should NOT be in required[]');
}

if (!required.includes('session_id')) {
  console.log('\nOK: session_id is optional (not in required[])');
}

await client.close();
