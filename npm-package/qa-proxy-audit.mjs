/**
 * QA audit client for novada-mcp proxy suite (6 tools)
 * PERSPECTIVE: AVAILABILITY
 * Tests: novada_proxy, novada_proxy_residential, novada_proxy_isp,
 *        novada_proxy_datacenter, novada_proxy_mobile, novada_proxy_static,
 *        novada_proxy_dedicated
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execSync } from "child_process";

const KEY = process.env.QA_KEY || "dummy";
const PROXY_USER = process.env.QA_PROXY_USER || "";
const PROXY_PASS = process.env.QA_PROXY_PASS || "";
const PROXY_ENDPOINT = process.env.QA_PROXY_ENDPOINT || "";

function log(label, data) {
  console.log(`\n=== ${label} ===`);
  if (typeof data === "string") {
    console.log(data.slice(0, 2000));
  } else {
    console.log(JSON.stringify(data, null, 2).slice(0, 2000));
  }
}

async function makeClient() {
  const env = Object.assign({}, process.env, {
    NOVADA_API_KEY: KEY,
    ...(PROXY_USER ? { NOVADA_PROXY_USER: PROXY_USER } : {}),
    ...(PROXY_PASS ? { NOVADA_PROXY_PASS: PROXY_PASS } : {}),
    ...(PROXY_ENDPOINT ? { NOVADA_PROXY_ENDPOINT: PROXY_ENDPOINT } : {}),
  });
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env,
  });
  const c = new Client({ name: "audit-proxy", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return c;
}

async function callTool(client, name, args) {
  try {
    const r = await client.callTool({ name, arguments: args });
    return { ok: true, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function main() {
  const results = {};

  // ─── Test 1: novada_proxy (legacy) — url format ───────────────────────────────
  console.log("\n[TEST 1] novada_proxy — url format (residential)");
  let c1 = await makeClient();
  let r1 = await callTool(c1, "novada_proxy", { type: "residential", format: "url" });
  results.proxy_url = r1;
  log("novada_proxy url", r1);
  await c1.close();

  // ─── Test 2: novada_proxy — env format ────────────────────────────────────────
  console.log("\n[TEST 2] novada_proxy — env format");
  let c2 = await makeClient();
  let r2 = await callTool(c2, "novada_proxy", { type: "residential", format: "env" });
  results.proxy_env = r2;
  log("novada_proxy env", r2);
  await c2.close();

  // ─── Test 3: novada_proxy — curl format ───────────────────────────────────────
  console.log("\n[TEST 3] novada_proxy — curl format");
  let c3 = await makeClient();
  let r3 = await callTool(c3, "novada_proxy", { type: "datacenter", format: "curl" });
  results.proxy_curl = r3;
  log("novada_proxy curl", r3);
  await c3.close();

  // ─── Test 4: novada_proxy_residential — url, no country ──────────────────────
  console.log("\n[TEST 4] novada_proxy_residential — url format, no targeting");
  let c4 = await makeClient();
  let r4 = await callTool(c4, "novada_proxy_residential", { format: "url" });
  results.residential_url = r4;
  log("novada_proxy_residential url", r4);
  await c4.close();

  // ─── Test 5: novada_proxy_residential — with country ─────────────────────────
  console.log("\n[TEST 5] novada_proxy_residential — country=us, session_id");
  let c5 = await makeClient();
  let r5 = await callTool(c5, "novada_proxy_residential", {
    country: "us",
    session_id: "audit-session-1",
    format: "curl"
  });
  results.residential_country_session = r5;
  log("novada_proxy_residential country+session", r5);
  await c5.close();

  // ─── Test 6: novada_proxy_isp — url format ────────────────────────────────────
  console.log("\n[TEST 6] novada_proxy_isp — url format");
  let c6 = await makeClient();
  let r6 = await callTool(c6, "novada_proxy_isp", { format: "url" });
  results.isp_url = r6;
  log("novada_proxy_isp url", r6);
  await c6.close();

  // ─── Test 7: novada_proxy_isp — country targeting (should warn ignored) ───────
  console.log("\n[TEST 7] novada_proxy_isp — with country (should document it's ignored for ISP zone)");
  let c7 = await makeClient();
  let r7 = await callTool(c7, "novada_proxy_isp", { country: "gb", format: "url" });
  results.isp_country = r7;
  log("novada_proxy_isp country=gb", r7);
  await c7.close();

  // ─── Test 8: novada_proxy_datacenter — url format ─────────────────────────────
  console.log("\n[TEST 8] novada_proxy_datacenter — url format");
  let c8 = await makeClient();
  let r8 = await callTool(c8, "novada_proxy_datacenter", { format: "url" });
  results.datacenter_url = r8;
  log("novada_proxy_datacenter url", r8);
  await c8.close();

  // ─── Test 9: novada_proxy_mobile — url + carrier ──────────────────────────────
  console.log("\n[TEST 9] novada_proxy_mobile — url format, country+carrier");
  let c9 = await makeClient();
  let r9 = await callTool(c9, "novada_proxy_mobile", {
    country: "us",
    carrier: "verizon",
    format: "url"
  });
  results.mobile_url = r9;
  log("novada_proxy_mobile url", r9);
  await c9.close();

  // ─── Test 10: novada_proxy_static — no credentials configured ─────────────────
  console.log("\n[TEST 10] novada_proxy_static — no NOVADA_STATIC_PROXY_LIST (expect config_required)");
  let c10 = await makeClient();
  let r10 = await callTool(c10, "novada_proxy_static", {
    country: "us",
    session_id: "audit-static-1",
    format: "url"
  });
  results.static_no_config = r10;
  log("novada_proxy_static no config", r10);
  await c10.close();

  // ─── Test 11: novada_proxy_dedicated — no credentials configured ──────────────
  console.log("\n[TEST 11] novada_proxy_dedicated — no NOVADA_DEDICATED_PROXY_LIST (expect config_required)");
  let c11 = await makeClient();
  let r11 = await callTool(c11, "novada_proxy_dedicated", {
    session_id: "audit-dedicated-1",
    format: "url"
  });
  results.dedicated_no_config = r11;
  log("novada_proxy_dedicated no config", r11);
  await c11.close();

  // ─── Test 12: Schema validation — invalid country ──────────────────────────────
  console.log("\n[TEST 12] Schema validation — invalid country (3 chars) should fail");
  let c12 = await makeClient();
  let r12 = await callTool(c12, "novada_proxy_residential", { country: "usa" });
  results.residential_invalid_country = r12;
  log("residential invalid country=usa", r12);
  await c12.close();

  // ─── Test 13: proxy_static — required params missing (no country) ──────────────
  console.log("\n[TEST 13] novada_proxy_static — missing required country param");
  let c13 = await makeClient();
  let r13 = await callTool(c13, "novada_proxy_static", {
    session_id: "audit-test"
    // missing country — required
  });
  results.static_no_country = r13;
  log("static missing country", r13);
  await c13.close();

  // ─── Test 14: proxy_dedicated — required session_id missing ───────────────────
  console.log("\n[TEST 14] novada_proxy_dedicated — missing required session_id");
  let c14 = await makeClient();
  let r14 = await callTool(c14, "novada_proxy_dedicated", {});
  results.dedicated_no_session = r14;
  log("dedicated missing session_id", r14);
  await c14.close();

  // ─── Test 15: Masking check — verify pass is masked ──────────────────────────
  console.log("\n[TEST 15] Masking — verify real pass does NOT appear in output");
  let c15 = await makeClient();
  let r15 = await callTool(c15, "novada_proxy_residential", { format: "url" });
  results.masking_check = r15;
  const outputStr = JSON.stringify(r15);
  const passLeaked = PROXY_PASS && outputStr.includes(PROXY_PASS);
  console.log(`Pass leaked in output: ${passLeaked}`);
  log("masking check result", r15);
  await c15.close();

  // ─── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n\n=== SUMMARY ===");
  for (const [test, res] of Object.entries(results)) {
    const ok = res.ok;
    console.log(`${ok ? "PASS" : "FAIL"} ${test}`);
  }

  // Now do real proxied curl test
  if (PROXY_USER && PROXY_PASS && PROXY_ENDPOINT) {
    console.log("\n\n=== REAL PROXY ROUTING TEST ===");
    // Get proxy URL from the tool first
    const c16 = await makeClient();
    const r16 = await callTool(c16, "novada_proxy_residential", {
      country: "us",
      session_id: "qa-curl-test",
      format: "url"
    });
    await c16.close();
    log("Proxy config for curl test", r16);

    // Build the actual proxy URL with credentials and do a real request
    const proxyUrl = `http://${encodeURIComponent(PROXY_USER + "-zone-res-region-us-session-qa-curl-test")}:${PROXY_PASS}@${PROXY_ENDPOINT}`;
    console.log(`\nTesting proxy connectivity via curl...`);
    console.log(`Proxy: http://${PROXY_USER.slice(0,4)}***:***@${PROXY_ENDPOINT}`);
    try {
      const curlResult = execSync(
        `curl -s --proxy "${proxyUrl}" --max-time 15 https://api.ipify.org?format=json 2>&1`,
        { timeout: 20000 }
      ).toString();
      console.log(`Curl result: ${curlResult}`);
      results.live_curl_test = { ok: true, result: curlResult };
    } catch (e) {
      console.log(`Curl failed: ${e.message}`);
      results.live_curl_test = { ok: false, error: e.message };
    }
  } else {
    console.log("\nSkipping live curl test — proxy credentials not provided");
    results.live_curl_test = { ok: false, error: "No proxy credentials provided" };
  }

  return results;
}

main().then(r => {
  console.log("\n\n=== FINAL RESULTS JSON ===");
  console.log(JSON.stringify(r, null, 2));
}).catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
