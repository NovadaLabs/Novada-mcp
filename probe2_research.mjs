import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER_PATH = '/Users/tongwu/Projects/novada-mcp/build/index.js';
const NOVADA_API_KEY = 'process.env.NOVADA_API_KEY';

async function makeClient() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    env: {
      ...process.env,
      NOVADA_API_KEY,
      NOVADA_PROXY_USER: 'tongwu_TRDI7X',
      NOVADA_PROXY_PASS: '_Asd1644asd_',
    },
  });
  const client = new Client({ name: 'qa-probe2', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}

async function callTool(client, name, args, timeoutMs = 90000) {
  const start = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
    const elapsed = Date.now() - start;
    return { ok: true, result, elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { ok: false, error: err, elapsed };
  }
}

function summarizeFull(r, label) {
  console.log(`\n=== ${label} ===`);
  console.log(`Elapsed: ${r.elapsed}ms`);
  if (r.ok) {
    const txt = JSON.stringify(r.result);
    console.log(`isError: ${r.result.isError}`);
    console.log(`Content length: ${txt.length}`);
    console.log(`Full response: ${txt}`);
  } else {
    console.log(`Error code: ${r.error?.code}`);
    console.log(`Error message: ${r.error?.message}`);
    const data = r.error?.data;
    if (data) console.log(`Error data: ${JSON.stringify(data)}`);
  }
}

async function main() {
  // Test A: Extra unknown params with injection — does additionalProperties:false reject them at MCP level?
  // The schema has additionalProperties:false but we saw step 8 only complained about question<5chars, not about unknownParam
  // Re-test with valid question to confirm unknown params actually sneak through
  console.log('\n=== TEST A: Extra unknown params with valid question ===');
  let { client, transport } = await makeClient();
  const rA = await callTool(client, 'novada_research', {
    question: 'capital of Germany',
    depth: 'quick',
    unknownParam: 'injected value',
    __proto__: 'polluted',
    constructor: 'polluted'
  });
  summarizeFull(rA, 'extra unknown params with valid question');
  await transport.close();

  // Test B: query alias with empty string (no minLength constraint on query like there is on question)
  console.log('\n=== TEST B: query alias with 1-char string (no minLength on query) ===');
  ({ client, transport } = await makeClient());
  const rB = await callTool(client, 'novada_research', {
    query: 'x', // very short, no minLength on query
    depth: 'quick'
  });
  summarizeFull(rB, 'query alias with 1-char string');
  await transport.close();

  // Test C: question exactly 4 chars (boundary - minLength is 5)
  console.log('\n=== TEST C: question 4 chars (boundary below minLength=5) ===');
  ({ client, transport } = await makeClient());
  const rC = await callTool(client, 'novada_research', {
    question: 'test', // exactly 4 chars
    depth: 'quick'
  });
  summarizeFull(rC, 'question 4 chars');
  await transport.close();

  // Test D: question exactly 5 chars (boundary - at minLength=5)
  console.log('\n=== TEST D: question exactly 5 chars (boundary at minLength=5) ===');
  ({ client, transport } = await makeClient());
  const rD = await callTool(client, 'novada_research', {
    question: 'tests', // exactly 5 chars
    depth: 'quick'
  });
  summarizeFull(rD, 'question 5 chars');
  await transport.close();

  // Test E: project param maxLength=30 boundary test
  console.log('\n=== TEST E: project param 31 chars (over maxLength=30) ===');
  ({ client, transport } = await makeClient());
  const rE = await callTool(client, 'novada_research', {
    question: 'climate change',
    depth: 'quick',
    project: 'A'.repeat(31)
  });
  summarizeFull(rE, 'project 31 chars');
  await transport.close();

  // Test F: question with only whitespace (passes minLength=5 but effectively empty)
  console.log('\n=== TEST F: question all whitespace ===');
  ({ client, transport } = await makeClient());
  const rF = await callTool(client, 'novada_research', {
    question: '     ', // 5 spaces, passes minLength:5
    depth: 'quick'
  });
  summarizeFull(rF, 'question all whitespace (5 spaces)');
  await transport.close();

  // Test G: Check if the full happy path response leaks local file paths
  // (saw /Users/tongwu/Downloads/novada-mcp in response - confirm and get full path)
  console.log('\n=== TEST G: Response inspecting for path leak ===');
  ({ client, transport } = await makeClient());
  const rG = await callTool(client, 'novada_research', {
    question: 'Python programming basics',
    depth: 'quick'
  });
  console.log(`Elapsed: ${rG.elapsed}ms`);
  if (rG.ok) {
    const txt = JSON.stringify(rG.result);
    // Check for path leak
    const pathMatch = txt.match(/\/Users\/[^\\"\s]+/g);
    console.log('Local paths found in response:', pathMatch ? [...new Set(pathMatch)] : 'NONE');
    console.log(`isError: ${rG.result.isError}`);
    console.log(`Full response (first 2000): ${txt.slice(0, 2000)}`);
  }
  await transport.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
