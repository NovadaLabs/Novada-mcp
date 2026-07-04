/**
 * QA client for proxy suite availability audit
 * Tests all 6 proxy tools: residential, isp, datacenter, mobile, static, dedicated
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = process.env.QA_KEY || "dummy";
const PROXY_USER = process.env.NOVADA_PROXY_USER || "";
const PROXY_PASS = process.env.NOVADA_PROXY_PASS || "";
const PROXY_ENDPOINT = process.env.NOVADA_PROXY_ENDPOINT || "";

const env = Object.assign({}, process.env, {
  NOVADA_API_KEY: KEY,
  NOVADA_PROXY_USER: PROXY_USER,
  NOVADA_PROXY_PASS: PROXY_PASS,
  NOVADA_PROXY_ENDPOINT: PROXY_ENDPOINT,
});

async function runTest(c, toolName, args, label) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: ${label} [${toolName}]`);
  console.log(`ARGS: ${JSON.stringify(args)}`);
  try {
    const r = await c.callTool({ name: toolName, arguments: args });
    const text = r.content?.[0]?.text ?? JSON.stringify(r);
    console.log(`RESULT (first 2000 chars):\n${text.slice(0, 2000)}`);
    return { ok: true, text, raw: r };
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env,
});
const c = new Client({ name: "audit-proxy", version: "0" }, { capabilities: {} });
await c.connect(t);

const results = {};

// ── Test 1: Residential proxy - url format (default) ─────────────────────────
results.res_url = await runTest(c, "novada_proxy_residential", {}, "Residential url (no params)");

// ── Test 2: Residential proxy - env format with country ──────────────────────
results.res_env = await runTest(c, "novada_proxy_residential", { format: "env", country: "us" }, "Residential env format, country=us");

// ── Test 3: Residential proxy - curl format with session ─────────────────────
results.res_curl = await runTest(c, "novada_proxy_residential", { format: "curl", country: "gb", session_id: "test-session-1" }, "Residential curl format, country=gb, session");

// ── Test 4: ISP proxy - url format ───────────────────────────────────────────
results.isp_url = await runTest(c, "novada_proxy_isp", {}, "ISP url (no params)");

// ── Test 5: ISP proxy - with country param (should warn country is ignored) ──
results.isp_country = await runTest(c, "novada_proxy_isp", { country: "us" }, "ISP with country=us (should warn)");

// ── Test 6: Datacenter proxy - url format ────────────────────────────────────
results.dc_url = await runTest(c, "novada_proxy_datacenter", {}, "Datacenter url (no params)");

// ── Test 7: Datacenter proxy - env format with country ───────────────────────
results.dc_env = await runTest(c, "novada_proxy_datacenter", { format: "env", country: "de" }, "Datacenter env, country=de");

// ── Test 8: Mobile proxy - url format ────────────────────────────────────────
results.mob_url = await runTest(c, "novada_proxy_mobile", {}, "Mobile url (no params)");

// ── Test 9: Mobile with carrier ──────────────────────────────────────────────
results.mob_carrier = await runTest(c, "novada_proxy_mobile", { country: "us", carrier: "verizon" }, "Mobile url, country=us, carrier=verizon");

// ── Test 10: Static proxy - no env var (expect error/config_required) ─────────
results.static_noenv = await runTest(c, "novada_proxy_static", { country: "us", session_id: "sess-1" }, "Static (no NOVADA_STATIC_PROXY_LIST)");

// ── Test 11: Dedicated proxy - no env var (expect config_required) ────────────
results.ded_noenv = await runTest(c, "novada_proxy_dedicated", { session_id: "my-session" }, "Dedicated (no NOVADA_DEDICATED_PROXY_LIST)");

// ── Test 12: Legacy proxy tool (novada_proxy) - url format ───────────────────
results.legacy_url = await runTest(c, "novada_proxy", { type: "residential" }, "Legacy novada_proxy, type=residential");

// ── Test 13: ISP proxy - session sticky ──────────────────────────────────────
results.isp_session = await runTest(c, "novada_proxy_isp", { session_id: "sticky-test-001" }, "ISP with session_id sticky");

// ── Test 14: Residential - invalid country (schema validation) ───────────────
results.res_invalid_country = await runTest(c, "novada_proxy_residential", { country: "USA" }, "Residential invalid country=USA (expect schema error)");

// ── Test 15: Dedicated - missing required session_id ─────────────────────────
results.ded_missing_session = await runTest(c, "novada_proxy_dedicated", {}, "Dedicated missing session_id (expect schema error)");

await c.close();

console.log("\n" + "=".repeat(60));
console.log("SUMMARY:");
for (const [k, v] of Object.entries(results)) {
  console.log(`  ${k}: ${v.ok ? "OK" : "ERROR: " + v.error}`);
}
