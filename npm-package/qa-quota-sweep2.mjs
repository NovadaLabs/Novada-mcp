import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const creds = {
  NOVADA_API_KEY: '1f35b477c9e1802778ec64aee2a6adfa',
  NOVADA_PROXY_USER: 'tongwu_TRDI7X',
  NOVADA_PROXY_PASS: '_Asd1644asd_',
  NOVADA_BROWSER_WS: 'wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com',
  NOVADA_WEB_UNBLOCKER_KEY: 'b27ad6e6834dd36407b00f4e502e055e',
};

async function callTool(client, name, args) {
  const start = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args });
    const elapsed = Date.now() - start;
    return { ok: true, result, elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { ok: false, error: err, elapsed };
  }
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/tongwu/Projects/novada-mcp/build/index.js'],
    env: { ...process.env, ...creds },
  });

  const client = new Client({ name: 'qa-sweep2', version: '1.0.0' });
  await client.connect(transport);

  // === TEST A: novada_unblock with explicit short timeout — does it respect it? ===
  console.log('\n[A] novada_unblock with explicit 5s timeout — does it respect it?');
  const unblock_short = await callTool(client, 'novada_unblock', {
    url: 'https://unreachable-host-xyz-99999.invalid/',
    method: 'render',
    timeout: 5000,
  });
  console.log('Elapsed:', unblock_short.elapsed, 'ms');
  console.log('Result:', unblock_short.result?.content?.[0]?.text?.slice(0, 500));

  // === TEST B: novada_research with a REAL 5-char query ===
  console.log('\n[B] novada_research with 5-char query "hello"');
  const research_hello = await callTool(client, 'novada_research', { question: 'hello', depth: 'quick' });
  console.log('Elapsed:', research_hello.elapsed, 'ms');
  console.log('Result:', research_hello.result?.content?.[0]?.text?.slice(0, 800));

  // === TEST C: wallet balance before scrape ===
  console.log('\n[C] wallet balance before novada_scrape valid call');
  const bal_before = await callTool(client, 'novada_wallet_balance', {});
  const balBefore = JSON.parse(bal_before.result?.content?.[0]?.text || '{}');
  console.log('Balance before:', balBefore?.data?.balance);

  // === TEST D: novada_scrape with valid platform but BAD operation (consume quota?) ===
  console.log('\n[D] novada_scrape amazon.com with bad operation name');
  const scrape_bad_op = await callTool(client, 'novada_scrape', {
    platform: 'amazon.com',
    operation: 'invalid_nonexistent_operation_xyz',
    params: {},
    limit: 5,
    format: 'markdown',
  });
  console.log('Elapsed:', scrape_bad_op.elapsed, 'ms');
  console.log('Result:', scrape_bad_op.result?.content?.[0]?.text?.slice(0, 600));

  // === TEST E: wallet balance after scrape error ===
  console.log('\n[E] wallet balance after bad scrape operation');
  const bal_after = await callTool(client, 'novada_wallet_balance', {});
  const balAfter = JSON.parse(bal_after.result?.content?.[0]?.text || '{}');
  console.log('Balance after:', balAfter?.data?.balance);
  console.log('Delta:', (balBefore?.data?.balance - balAfter?.data?.balance).toFixed(4));

  // === TEST F: novada_extract with extremely long URL path (does it sanitize?) ===
  console.log('\n[F] novada_extract with injection-attempt URL');
  const extract_inject = await callTool(client, 'novada_extract', {
    url: 'https://example.com/' + 'A'.repeat(2000),
    format: 'markdown',
    render: 'static',
  });
  console.log('Elapsed:', extract_inject.elapsed, 'ms');
  console.log('Result:', extract_inject.result?.content?.[0]?.text?.slice(0, 400));

  // === TEST G: novada_scraper_submit on valid platform (amazon) but bad params — does it charge? ===
  console.log('\n[G] novada_wallet_balance before scraper_submit error');
  const bal_g_before = await callTool(client, 'novada_wallet_balance', {});
  const balGBefore = JSON.parse(bal_g_before.result?.content?.[0]?.text || '{}');
  console.log('Balance G before:', balGBefore?.data?.balance);

  const scraper_bad_op = await callTool(client, 'novada_scraper_submit', {
    platform: 'amazon.com',
    operation: 'totally_fake_operation',
    params: { keyword: 'test' },
  });
  console.log('scraper_submit result:', scraper_bad_op.result?.content?.[0]?.text?.slice(0, 500));

  const bal_g_after = await callTool(client, 'novada_wallet_balance', {});
  const balGAfter = JSON.parse(bal_g_after.result?.content?.[0]?.text || '{}');
  console.log('Balance G after:', balGAfter?.data?.balance);
  console.log('Delta:', (balGBefore?.data?.balance - balGAfter?.data?.balance).toFixed(4));

  // === TEST H: novada_proxy with missing required fields ===
  console.log('\n[H] novada_proxy with missing type/format (required params)');
  const proxy_missing = await callTool(client, 'novada_proxy', {});
  console.log('Result:', proxy_missing.result?.content?.[0]?.text?.slice(0, 300));

  // === TEST I: novada_health_all (read-only, confirm no credits burned) ===
  console.log('\n[I] novada_health_all (read-only health check)');
  const bal_i_before = await callTool(client, 'novada_wallet_balance', {});
  const balIBefore = JSON.parse(bal_i_before.result?.content?.[0]?.text || '{}');
  const health = await callTool(client, 'novada_health_all', {});
  console.log('Health result:', health.result?.content?.[0]?.text?.slice(0, 600));
  const bal_i_after = await callTool(client, 'novada_wallet_balance', {});
  const balIAfter = JSON.parse(bal_i_after.result?.content?.[0]?.text || '{}');
  console.log('Balance before health:', balIBefore?.data?.balance);
  console.log('Balance after health:', balIAfter?.data?.balance);
  console.log('Delta:', (balIBefore?.data?.balance - balIAfter?.data?.balance).toFixed(4));

  // === TEST J: novada_unblock with 10s timeout on unreachable host ===
  console.log('\n[J] novada_unblock with 10s explicit timeout — verifying timeout respect');
  const unblock_10s = await callTool(client, 'novada_unblock', {
    url: 'https://totally-unreachable-domain-xyz-abc-99999.invalid/',
    method: 'render',
    timeout: 10000,
  });
  console.log('Elapsed:', unblock_10s.elapsed, 'ms');
  console.log('Result:', unblock_10s.result?.content?.[0]?.text?.slice(0, 400));

  // === Final: wallet balance ===
  console.log('\n[FINAL] wallet_balance');
  const balFinal = await callTool(client, 'novada_wallet_balance', {});
  console.log('Result:', balFinal.result?.content?.[0]?.text);

  await client.close();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
