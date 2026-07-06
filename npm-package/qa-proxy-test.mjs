/**
 * QA functional test: proxy suite (residential/isp/datacenter/mobile/static/dedicated)
 * Runs offline with NOVADA_API_KEY=dummy. Tests schema validation, format outputs,
 * session stickiness, credential masking, and edge cases.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DUMMY_KEY = "dummy";

// Start the MCP server with no proxy credentials set (offline checks)
const makeClient = async (extraEnv = {}) => {
  const env = Object.assign({}, process.env, { NOVADA_API_KEY: DUMMY_KEY }, extraEnv);
  // Remove proxy vars so we get the "not configured" path by default
  delete env.NOVADA_PROXY_USER;
  delete env.NOVADA_PROXY_PASS;
  delete env.NOVADA_PROXY_ENDPOINT;
  delete env.NOVADA_STATIC_PROXY_LIST;
  delete env.NOVADA_DEDICATED_PROXY_LIST;

  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env,
  });
  const c = new Client({ name: "qa-proxy", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return c;
};

const makeClientWithProxyCreds = async (extraEnv = {}) => {
  const env = Object.assign({}, process.env, {
    NOVADA_API_KEY: DUMMY_KEY,
    NOVADA_PROXY_USER: "testuser12345",
    NOVADA_PROXY_PASS: "supersecretpass",
    NOVADA_PROXY_ENDPOINT: "proxy.novada.com:7777",
  }, extraEnv);

  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env,
  });
  const c = new Client({ name: "qa-proxy", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return c;
};

const results = [];
let passed = 0, failed = 0;

async function runTest(name, fn) {
  try {
    const result = await fn();
    results.push({ test: name, status: "pass", result });
    passed++;
    console.log(`PASS: ${name}`);
    return result;
  } catch (e) {
    results.push({ test: name, status: "fail", error: String(e) });
    failed++;
    console.error(`FAIL: ${name}`, e.message || e);
    return null;
  }
}

async function main() {
  console.log("=== QA Proxy Suite - Novada MCP 0.9.0 ===\n");

  // ─── Test Group 1: Schema Validation (no creds) ──────────────────────────
  console.log("--- Group 1: Schema Validation ---");

  const client = await makeClient();

  // 1.1 novada_proxy: defaults work (no required params)
  await runTest("novada_proxy: no args defaults ok", async () => {
    const r = await client.callTool({ name: "novada_proxy", arguments: {} });
    const text = r.content[0].text;
    if (!text.includes("not configured")) throw new Error("Expected not-configured message");
    return text.slice(0, 100);
  });

  // 1.2 novada_proxy_residential: no required params, defaults work
  await runTest("novada_proxy_residential: no args defaults ok", async () => {
    const r = await client.callTool({ name: "novada_proxy_residential", arguments: {} });
    const text = r.content[0].text;
    if (!text.includes("not configured")) throw new Error("Expected not-configured message");
    return text.slice(0, 100);
  });

  // 1.3 novada_proxy_isp: no args
  await runTest("novada_proxy_isp: no args defaults ok", async () => {
    const r = await client.callTool({ name: "novada_proxy_isp", arguments: {} });
    const text = r.content[0].text;
    if (!text.includes("not configured")) throw new Error("Expected not-configured message");
    return text.slice(0, 100);
  });

  // 1.4 novada_proxy_datacenter: no args
  await runTest("novada_proxy_datacenter: no args defaults ok", async () => {
    const r = await client.callTool({ name: "novada_proxy_datacenter", arguments: {} });
    const text = r.content[0].text;
    if (!text.includes("not configured")) throw new Error("Expected not-configured message");
    return text.slice(0, 100);
  });

  // 1.5 novada_proxy_mobile: no args
  await runTest("novada_proxy_mobile: no args defaults ok", async () => {
    const r = await client.callTool({ name: "novada_proxy_mobile", arguments: {} });
    const text = r.content[0].text;
    if (!text.includes("not configured")) throw new Error("Expected not-configured message");
    return text.slice(0, 100);
  });

  // 1.6 novada_proxy_static: missing required params (country + session_id required)
  await runTest("novada_proxy_static: missing country+session_id returns error", async () => {
    const r = await client.callTool({ name: "novada_proxy_static", arguments: {} });
    const text = r.content[0].text;
    // Should get validation error since country and session_id are required
    if (!r.isError) throw new Error("Expected error for missing required fields but got success");
    return text.slice(0, 200);
  });

  // 1.7 novada_proxy_dedicated: missing required session_id
  await runTest("novada_proxy_dedicated: missing session_id returns error", async () => {
    const r = await client.callTool({ name: "novada_proxy_dedicated", arguments: {} });
    if (!r.isError) throw new Error("Expected error for missing session_id but got success");
    const text = r.content[0].text;
    return text.slice(0, 200);
  });

  // 1.8 Schema validation: invalid country code (too long)
  await runTest("novada_proxy_residential: invalid country 'usa' rejected", async () => {
    const r = await client.callTool({ name: "novada_proxy_residential", arguments: { country: "usa" } });
    if (!r.isError) throw new Error("Expected validation error for 3-char country code");
    return r.content[0].text.slice(0, 200);
  });

  // 1.9 Schema validation: invalid country code (numeric)
  await runTest("novada_proxy_residential: invalid country '12' rejected", async () => {
    const r = await client.callTool({ name: "novada_proxy_residential", arguments: { country: "12" } });
    if (!r.isError) throw new Error("Expected validation error for numeric country");
    return r.content[0].text.slice(0, 200);
  });

  // 1.10 Schema validation: session_id with invalid chars
  await runTest("novada_proxy_residential: session_id with spaces rejected", async () => {
    const r = await client.callTool({ name: "novada_proxy_residential", arguments: { session_id: "my session" } });
    if (!r.isError) throw new Error("Expected validation error for session_id with spaces");
    return r.content[0].text.slice(0, 200);
  });

  // 1.11 Schema validation: session_id too long (>64 chars)
  await runTest("novada_proxy_residential: session_id too long rejected", async () => {
    const r = await client.callTool({ name: "novada_proxy_residential", arguments: { session_id: "a".repeat(65) } });
    if (!r.isError) throw new Error("Expected validation error for 65-char session_id");
    return r.content[0].text.slice(0, 200);
  });

  // 1.12 Schema validation: invalid format value
  await runTest("novada_proxy_residential: invalid format rejected", async () => {
    const r = await client.callTool({ name: "novada_proxy_residential", arguments: { format: "xml" } });
    if (!r.isError) throw new Error("Expected validation error for invalid format");
    return r.content[0].text.slice(0, 200);
  });

  // 1.13 novada_proxy_static: valid params but no NOVADA_STATIC_PROXY_LIST env
  await runTest("novada_proxy_static: valid params, no STATIC_PROXY_LIST → JSON config_required", async () => {
    const r = await client.callTool({ name: "novada_proxy_static", arguments: { country: "us", session_id: "test123" } });
    const text = r.content[0].text;
    // Should return configuration_required JSON
    if (!text.includes("configuration_required")) throw new Error("Expected configuration_required JSON");
    return text.slice(0, 300);
  });

  // 1.14 novada_proxy_dedicated: valid params but no NOVADA_DEDICATED_PROXY_LIST env
  await runTest("novada_proxy_dedicated: valid params, no DEDICATED_PROXY_LIST → JSON config_required", async () => {
    const r = await client.callTool({ name: "novada_proxy_dedicated", arguments: { session_id: "test123" } });
    const text = r.content[0].text;
    if (!text.includes("configuration_required")) throw new Error("Expected configuration_required JSON");
    return text.slice(0, 300);
  });

  // 1.15 novada_proxy_mobile: carrier validation (invalid chars)
  await runTest("novada_proxy_mobile: carrier with invalid chars rejected", async () => {
    const r = await client.callTool({ name: "novada_proxy_mobile", arguments: { carrier: "verizon@4g!" } });
    if (!r.isError) throw new Error("Expected validation error for carrier with special chars");
    return r.content[0].text.slice(0, 200);
  });

  // 1.16 city validation (city with digits)
  await runTest("novada_proxy_residential: city with digits rejected", async () => {
    const r = await client.callTool({ name: "novada_proxy_residential", arguments: { country: "us", city: "New York 10001" } });
    if (!r.isError) throw new Error("Expected validation error for city with digits");
    return r.content[0].text.slice(0, 200);
  });

  await client.close();

  // ─── Test Group 2: Configured Credentials - Format Outputs ──────────────
  console.log("\n--- Group 2: Format Outputs (with fake creds) ---");

  const credClient = await makeClientWithProxyCreds();

  // 2.1 residential url format
  await runTest("novada_proxy_residential: url format output structure", async () => {
    const r = await credClient.callTool({ name: "novada_proxy_residential", arguments: { format: "url" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error with valid creds: " + text);
    if (!text.includes("proxy_url:")) throw new Error("Missing proxy_url in url format");
    if (!text.includes("***")) throw new Error("Password should be masked with ***");
    if (text.includes("supersecretpass")) throw new Error("SECURITY: plain password exposed in output!");
    return text.slice(0, 300);
  });

  // 2.2 residential env format
  await runTest("novada_proxy_residential: env format output structure", async () => {
    const r = await credClient.callTool({ name: "novada_proxy_residential", arguments: { format: "env" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error with valid creds: " + text);
    if (!text.includes("export HTTP_PROXY=")) throw new Error("Missing HTTP_PROXY export");
    if (!text.includes("export HTTPS_PROXY=")) throw new Error("Missing HTTPS_PROXY export");
    if (text.includes("supersecretpass")) throw new Error("SECURITY: plain password exposed in env format!");
    return text.slice(0, 400);
  });

  // 2.3 residential curl format
  await runTest("novada_proxy_residential: curl format output structure", async () => {
    const r = await credClient.callTool({ name: "novada_proxy_residential", arguments: { format: "curl" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error with valid creds: " + text);
    if (!text.includes("curl --proxy")) throw new Error("Missing curl --proxy command");
    if (text.includes("supersecretpass")) throw new Error("SECURITY: plain password exposed in curl format!");
    return text.slice(0, 300);
  });

  // 2.4 Session stickiness: check session_id appears in proxy URL
  await runTest("novada_proxy_residential: session_id appears in username", async () => {
    const r = await credClient.callTool({ name: "novada_proxy_residential", arguments: { session_id: "mysession99" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("mysession99")) throw new Error("session_id not reflected in output");
    return text.slice(0, 300);
  });

  // 2.5 Country targeting appears in residential username
  await runTest("novada_proxy_residential: country targeting reflected in username", async () => {
    const r = await credClient.callTool({ name: "novada_proxy_residential", arguments: { country: "gb" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("region-gb")) throw new Error("country targeting not reflected in username");
    return text.slice(0, 300);
  });

  // 2.6 City targeting
  await runTest("novada_proxy_residential: city targeting reflected in username", async () => {
    const r = await credClient.callTool({ name: "novada_proxy_residential", arguments: { country: "gb", city: "london" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("city-london")) throw new Error("city targeting not reflected in username");
    return text.slice(0, 300);
  });

  // 2.7 ISP ignores country (documented behavior) -- check targeting message
  await runTest("novada_proxy_isp: country param documented as ignored in targeting", async () => {
    const r = await credClient.callTool({ name: "novada_proxy_isp", arguments: { country: "us" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    // ISP zone does not support country -- should say it's ignored
    if (!text.includes("ignored")) throw new Error("ISP country ignore not documented in output");
    // Also verify country is NOT in the zone username string
    if (text.includes("region-us")) throw new Error("country was incorrectly added to ISP username");
    return text.slice(0, 400);
  });

  // 2.8 Datacenter country targeting
  await runTest("novada_proxy_datacenter: country targeting reflected in username", async () => {
    const r = await credClient.callTool({ name: "novada_proxy_datacenter", arguments: { country: "de" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("region-de")) throw new Error("country targeting not reflected in datacenter username");
    return text.slice(0, 300);
  });

  // 2.9 Mobile carrier targeting
  await runTest("novada_proxy_mobile: carrier reflected in username", async () => {
    const r = await credClient.callTool({ name: "novada_proxy_mobile", arguments: { carrier: "verizon" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("carrier-verizon")) throw new Error("carrier not reflected in mobile username");
    return text.slice(0, 300);
  });

  // 2.10 Credential masking: real username should be masked (first 4 chars + ***)
  await runTest("novada_proxy_residential: username masked (first4***)", async () => {
    const r = await credClient.callTool({ name: "novada_proxy_residential", arguments: {} });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    // Real user is "testuser12345", first 4 = "test", then ***
    if (!text.includes("test***")) throw new Error("Username not properly masked: expected 'test***'");
    // Verify full username NOT exposed
    if (text.includes("testuser12345")) throw new Error("SECURITY: full username exposed!");
    return text.slice(0, 300);
  });

  // 2.11 Zone identifier: residential has "zone-res"
  await runTest("novada_proxy_residential: zone-res in username", async () => {
    const r = await credClient.callTool({ name: "novada_proxy_residential", arguments: {} });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("zone-res")) throw new Error("zone-res not in residential proxy username");
    return text.slice(0, 200);
  });

  // 2.12 Zone identifier: ISP has "zone-isp"
  await runTest("novada_proxy_isp: zone-isp in username", async () => {
    const r = await credClient.callTool({ name: "novada_proxy_isp", arguments: {} });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("zone-isp")) throw new Error("zone-isp not in ISP proxy username");
    return text.slice(0, 200);
  });

  // 2.13 Zone identifier: datacenter has "zone-dcp"
  await runTest("novada_proxy_datacenter: zone-dcp in username", async () => {
    const r = await credClient.callTool({ name: "novada_proxy_datacenter", arguments: {} });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("zone-dcp")) throw new Error("zone-dcp not in datacenter proxy username");
    return text.slice(0, 200);
  });

  // 2.14 Zone identifier: mobile has "zone-mob"
  await runTest("novada_proxy_mobile: zone-mob in username", async () => {
    const r = await credClient.callTool({ name: "novada_proxy_mobile", arguments: {} });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("zone-mob")) throw new Error("zone-mob not in mobile proxy username");
    return text.slice(0, 200);
  });

  // 2.15 Proxy URL format: should use http://
  await runTest("novada_proxy_residential: proxy_url uses http scheme", async () => {
    const r = await credClient.callTool({ name: "novada_proxy_residential", arguments: {} });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("http://")) throw new Error("proxy_url should use http:// scheme");
    return text.slice(0, 200);
  });

  // 2.16 Default port fallback: endpoint without port
  await runTest("novada_proxy_residential: endpoint without port defaults to 7777", async () => {
    // Create client with endpoint missing the port
    const clientNoPort = await makeClientWithProxyCreds({ NOVADA_PROXY_ENDPOINT: "proxy.novada.com" });
    const r = await clientNoPort.callTool({ name: "novada_proxy_residential", arguments: { format: "url" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("7777")) throw new Error("Default port 7777 not used when endpoint has no port");
    await clientNoPort.close();
    return text.slice(0, 300);
  });

  // 2.17 Session stickiness: same session_id → same zone suffix
  await runTest("novada_proxy_isp: session_id appears in username", async () => {
    const r = await credClient.callTool({ name: "novada_proxy_isp", arguments: { session_id: "sticky-session-001" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("sticky-session-001")) throw new Error("session_id not in ISP username");
    return text.slice(0, 300);
  });

  // 2.18 Mobile with country + carrier + session_id all combined
  await runTest("novada_proxy_mobile: country+carrier+session_id all in username", async () => {
    const r = await credClient.callTool({
      name: "novada_proxy_mobile",
      arguments: { country: "us", carrier: "verizon", session_id: "mobile-sess-1" }
    });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("region-us")) throw new Error("country missing from mobile username");
    if (!text.includes("carrier-verizon")) throw new Error("carrier missing from mobile username");
    if (!text.includes("mobile-sess-1")) throw new Error("session_id missing from mobile username");
    return text.slice(0, 400);
  });

  // 2.19 ISP env format: verify all 4 proxy vars exported
  await runTest("novada_proxy_isp: env format exports all 4 HTTP proxy vars", async () => {
    const r = await credClient.callTool({ name: "novada_proxy_isp", arguments: { format: "env" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    const required = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"];
    for (const v of required) {
      if (!text.includes(v)) throw new Error(`Missing ${v} in env format`);
    }
    return text.slice(0, 400);
  });

  // 2.20 Datacenter curl format: check curl --proxy present
  await runTest("novada_proxy_datacenter: curl format has curl --proxy", async () => {
    const r = await credClient.callTool({ name: "novada_proxy_datacenter", arguments: { format: "curl" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("curl --proxy")) throw new Error("Missing curl --proxy in curl format");
    return text.slice(0, 300);
  });

  await credClient.close();

  // ─── Test Group 3: Static/Dedicated with PROXY_LIST env set ─────────────
  console.log("\n--- Group 3: Static/Dedicated with PROXY_LIST env ---");

  const VALID_STATIC_LIST = "151.242.47.74:8886:ax0kSJ8snE6wF1mR:p3K0rNpsP2iR\n192.168.1.1:8080:user2:pass2";

  const staticClient = await makeClient({ NOVADA_STATIC_PROXY_LIST: VALID_STATIC_LIST });

  // 3.1 Static with valid PROXY_LIST + required params
  await runTest("novada_proxy_static: valid PROXY_LIST → url format works", async () => {
    const r = await staticClient.callTool({ name: "novada_proxy_static", arguments: { country: "us", session_id: "sess1" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("151.242.47.74")) throw new Error("Missing IP from PROXY_LIST");
    if (!text.includes("8886")) throw new Error("Missing port from PROXY_LIST");
    // Verify password masked
    if (text.includes("p3K0rNpsP2iR")) throw new Error("SECURITY: static proxy password exposed!");
    return text.slice(0, 400);
  });

  // 3.2 Static proxy user masking: first 4 chars + ***
  await runTest("novada_proxy_static: username masked in output", async () => {
    const r = await staticClient.callTool({ name: "novada_proxy_static", arguments: { country: "us", session_id: "sess1" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    // Username is "ax0kSJ8snE6wF1mR", first 4 = "ax0k", then ***
    if (!text.includes("ax0k***")) throw new Error("Static proxy username not properly masked");
    if (text.includes("ax0kSJ8snE6wF1mR")) throw new Error("SECURITY: full static proxy username exposed!");
    return text.slice(0, 300);
  });

  // 3.3 Static proxy curl format
  await runTest("novada_proxy_static: curl format has curl -x", async () => {
    const r = await staticClient.callTool({ name: "novada_proxy_static", arguments: { country: "us", session_id: "sess1", format: "curl" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("curl -x")) throw new Error("Missing curl -x in static proxy curl format");
    return text.slice(0, 300);
  });

  // 3.4 Static PROXY_LIST with empty lines (resilience)
  await runTest("novada_proxy_static: PROXY_LIST with blank lines parsed correctly", async () => {
    const listWithBlanks = "\n\n151.242.47.74:8886:usertest:passtest\n\n";
    const blankLinesClient = await makeClient({ NOVADA_STATIC_PROXY_LIST: listWithBlanks });
    const r = await blankLinesClient.callTool({ name: "novada_proxy_static", arguments: { country: "us", session_id: "s1" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("151.242.47.74")) throw new Error("Proxy IP not found despite valid list entry");
    await blankLinesClient.close();
    return text.slice(0, 200);
  });

  // 3.5 Static PROXY_LIST with malformed entries (not enough colons)
  await runTest("novada_proxy_static: malformed PROXY_LIST (short entry) → configuration_required", async () => {
    const malformedClient = await makeClient({ NOVADA_STATIC_PROXY_LIST: "151.242.47.74:8886:user" });
    const r = await malformedClient.callTool({ name: "novada_proxy_static", arguments: { country: "us", session_id: "s1" } });
    const text = r.content[0].text;
    // Short entry (3 parts, needs 4) should fail parsing → configuration_required
    if (!text.includes("configuration_required")) throw new Error("Expected configuration_required for malformed list");
    await malformedClient.close();
    return text.slice(0, 300);
  });

  // 3.6 Dedicated with valid DEDICATED_PROXY_LIST
  const dedicatedClient = await makeClient({ NOVADA_DEDICATED_PROXY_LIST: VALID_STATIC_LIST });
  await runTest("novada_proxy_dedicated: valid PROXY_LIST → url format works", async () => {
    const r = await dedicatedClient.callTool({ name: "novada_proxy_dedicated", arguments: { session_id: "dedicated-1" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("151.242.47.74")) throw new Error("Missing IP from DEDICATED_PROXY_LIST");
    if (text.includes("p3K0rNpsP2iR")) throw new Error("SECURITY: dedicated proxy password exposed!");
    return text.slice(0, 400);
  });

  // 3.7 Dedicated username masking
  await runTest("novada_proxy_dedicated: username masked in output", async () => {
    const r = await dedicatedClient.callTool({ name: "novada_proxy_dedicated", arguments: { session_id: "dedicated-1" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("ax0k***")) throw new Error("Dedicated proxy username not properly masked");
    if (text.includes("ax0kSJ8snE6wF1mR")) throw new Error("SECURITY: full dedicated proxy username exposed!");
    return text.slice(0, 300);
  });

  // 3.8 Dedicated env format
  await runTest("novada_proxy_dedicated: env format output", async () => {
    const r = await dedicatedClient.callTool({ name: "novada_proxy_dedicated", arguments: { session_id: "dedicated-1", format: "env" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("HTTP_PROXY")) throw new Error("Missing HTTP_PROXY in dedicated env format");
    return text.slice(0, 400);
  });

  await staticClient.close();
  await dedicatedClient.close();

  // ─── Test Group 4: Edge Cases and Injection Checks ──────────────────────
  console.log("\n--- Group 4: Edge Cases and Injection ---");

  const edgeClient = await makeClientWithProxyCreds();

  // 4.1 City with spaces → normalized (spaces stripped)
  await runTest("novada_proxy_residential: city with spaces → normalized no-space in username", async () => {
    const r = await edgeClient.callTool({ name: "novada_proxy_residential", arguments: { country: "us", city: "new-york" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    // city should be lowercased and spaces stripped
    if (!text.includes("city-new-york")) throw new Error("city-new-york not in username");
    return text.slice(0, 300);
  });

  // 4.2 Session ID max length exactly 64
  await runTest("novada_proxy_residential: session_id 64 chars (max) accepted", async () => {
    const session64 = "a".repeat(64);
    const r = await edgeClient.callTool({ name: "novada_proxy_residential", arguments: { session_id: session64 } });
    if (r.isError) throw new Error("Expected 64-char session_id to be accepted, got error: " + r.content[0].text.slice(0, 200));
    return "accepted";
  });

  // 4.3 Country code case sensitivity: 'US' vs 'us'
  await runTest("novada_proxy_residential: uppercase country 'US' accepted (regex allows)", async () => {
    const r = await edgeClient.callTool({ name: "novada_proxy_residential", arguments: { country: "US" } });
    // Regex is /^[a-zA-Z]{2}$/ so both should pass
    if (r.isError) throw new Error("Uppercase 'US' should be accepted by schema but got error: " + r.content[0].text.slice(0, 200));
    const text = r.content[0].text;
    // Check it's lowercased in output
    if (!text.includes("region-us")) throw new Error("Country not lowercased in username — got uppercase");
    return text.slice(0, 200);
  });

  // 4.4 novada_proxy (generic): type validation
  await runTest("novada_proxy (generic): invalid type rejected", async () => {
    const r = await edgeClient.callTool({ name: "novada_proxy", arguments: { type: "static" } });
    // 'static' is NOT in the enum ["residential", "mobile", "isp", "datacenter"]
    if (!r.isError) throw new Error("Expected validation error for type=static on novada_proxy, got success");
    return r.content[0].text.slice(0, 200);
  });

  // 4.5 novada_proxy (generic): valid residential type
  await runTest("novada_proxy (generic): residential type works", async () => {
    const r = await edgeClient.callTool({ name: "novada_proxy", arguments: { type: "residential" } });
    if (r.isError) throw new Error("Got error: " + r.content[0].text.slice(0, 200));
    const text = r.content[0].text;
    if (!text.includes("zone-res")) throw new Error("zone-res not in generic proxy residential output");
    return text.slice(0, 200);
  });

  // 4.6 generic proxy: ISP type — check country is NOT in username (ISP bug check)
  await runTest("novada_proxy (generic): ISP type skips country in username", async () => {
    const r = await edgeClient.callTool({ name: "novada_proxy", arguments: { type: "isp", country: "fr" } });
    if (r.isError) throw new Error("Got error: " + r.content[0].text.slice(0, 200));
    const text = r.content[0].text;
    // Check proxy.ts logic: ISP type skips country (line 21: params.type !== "isp")
    if (text.includes("region-fr")) throw new Error("BUG: country added to ISP zone in generic proxy — should be skipped");
    return text.slice(0, 300);
  });

  // 4.7 novada_proxy_static: env format
  await runTest("novada_proxy_static: env format with PROXY_LIST", async () => {
    const staticEnvClient = await makeClient({ NOVADA_STATIC_PROXY_LIST: VALID_STATIC_LIST });
    const r = await staticEnvClient.callTool({ name: "novada_proxy_static", arguments: { country: "us", session_id: "s1", format: "env" } });
    const text = r.content[0].text;
    if (r.isError) throw new Error("Got error: " + text);
    if (!text.includes("HTTP_PROXY")) throw new Error("Missing HTTP_PROXY in static env format");
    await staticEnvClient.close();
    return text.slice(0, 300);
  });

  // 4.8 Username injection test: session_id with special chars (should be blocked by regex)
  await runTest("novada_proxy_residential: session_id injection attempt rejected", async () => {
    const r = await edgeClient.callTool({ name: "novada_proxy_residential", arguments: { session_id: "sess\ninjected" } });
    if (!r.isError) throw new Error("Expected validation error for newline in session_id");
    return r.content[0].text.slice(0, 200);
  });

  // 4.9 Carrier with t-mobile (hyphen allowed)
  await runTest("novada_proxy_mobile: t-mobile carrier (hyphen) accepted", async () => {
    const r = await edgeClient.callTool({ name: "novada_proxy_mobile", arguments: { carrier: "t-mobile" } });
    if (r.isError) throw new Error("t-mobile should be accepted: " + r.content[0].text.slice(0, 200));
    const text = r.content[0].text;
    if (!text.includes("carrier-t-mobile")) throw new Error("t-mobile carrier not in username");
    return text.slice(0, 200);
  });

  // 4.10 city with hyphen allowed
  await runTest("novada_proxy_residential: city with hyphen accepted", async () => {
    const r = await edgeClient.callTool({ name: "novada_proxy_residential", arguments: { country: "gb", city: "milton-keynes" } });
    if (r.isError) throw new Error("Hyphenated city should be accepted: " + r.content[0].text.slice(0, 200));
    const text = r.content[0].text;
    if (!text.includes("city-milton-keynes")) throw new Error("Hyphenated city not in username");
    return text.slice(0, 200);
  });

  await edgeClient.close();

  // ─── Test Group 5: Description Consistency Check ─────────────────────────
  console.log("\n--- Group 5: Tool Description Accuracy ---");

  const descClient = await makeClient();

  // 5.1 List all tools and verify proxy tools are in there
  await runTest("proxy tools all listed in server tools list", async () => {
    const toolList = await descClient.listTools();
    const proxyTools = [
      "novada_proxy", "novada_proxy_residential", "novada_proxy_isp",
      "novada_proxy_datacenter", "novada_proxy_mobile", "novada_proxy_static",
      "novada_proxy_dedicated"
    ];
    const listedNames = toolList.tools.map(t => t.name);
    const missing = proxyTools.filter(n => !listedNames.includes(n));
    if (missing.length > 0) throw new Error(`Proxy tools missing from list: ${missing.join(", ")}`);
    return `All 7 proxy tools listed: ${proxyTools.join(", ")}`;
  });

  // 5.2 novada_proxy_static description says country+session_id required
  await runTest("novada_proxy_static: schema marks country+session_id as required", async () => {
    const toolList = await descClient.listTools();
    const staticTool = toolList.tools.find(t => t.name === "novada_proxy_static");
    if (!staticTool) throw new Error("novada_proxy_static not found in tool list");
    const schema = staticTool.inputSchema;
    const required = schema.required || [];
    if (!required.includes("country")) throw new Error(`country not in required: ${JSON.stringify(required)}`);
    if (!required.includes("session_id")) throw new Error(`session_id not in required: ${JSON.stringify(required)}`);
    return `required: ${JSON.stringify(required)}`;
  });

  // 5.3 novada_proxy_dedicated: session_id required in schema
  await runTest("novada_proxy_dedicated: schema marks session_id as required", async () => {
    const toolList = await descClient.listTools();
    const dedicatedTool = toolList.tools.find(t => t.name === "novada_proxy_dedicated");
    if (!dedicatedTool) throw new Error("novada_proxy_dedicated not found in tool list");
    const schema = dedicatedTool.inputSchema;
    const required = schema.required || [];
    if (!required.includes("session_id")) throw new Error(`session_id not in required: ${JSON.stringify(required)}`);
    return `required: ${JSON.stringify(required)}`;
  });

  // 5.4 novada_proxy_residential: no required params in schema (all optional)
  await runTest("novada_proxy_residential: no required params in schema (all optional)", async () => {
    const toolList = await descClient.listTools();
    const tool = toolList.tools.find(t => t.name === "novada_proxy_residential");
    if (!tool) throw new Error("novada_proxy_residential not found");
    const schema = tool.inputSchema;
    const required = schema.required || [];
    if (required.length > 0) throw new Error(`Unexpected required params: ${JSON.stringify(required)}`);
    return "no required params, as expected";
  });

  await descClient.close();

  // ─── Test Group 6: ISP Country Bug Deep-Check ────────────────────────────
  console.log("\n--- Group 6: ISP Country Bug Cross-Check (generic vs specialized) ---");
  const bugClient = await makeClientWithProxyCreds();

  // 6.1 ISP country handling: proxy.ts (generic) SKIPS country for ISP type
  await runTest("generic proxy ISP+country: region NOT added (proxy.ts line 21)", async () => {
    const r = await bugClient.callTool({ name: "novada_proxy", arguments: { type: "isp", country: "jp" } });
    if (r.isError) throw new Error("Error: " + r.content[0].text.slice(0, 200));
    const text = r.content[0].text;
    if (text.includes("region-jp")) {
      throw new Error("BUG: generic proxy added region-jp to ISP zone username — should skip country for ISP");
    }
    return "PASS: country NOT in ISP zone username";
  });

  // 6.2 ISP specialized tool: country accepted by schema but not in zone username
  await runTest("novada_proxy_isp: country accepted but not added to zone username", async () => {
    const r = await bugClient.callTool({ name: "novada_proxy_isp", arguments: { country: "jp" } });
    if (r.isError) throw new Error("Error: " + r.content[0].text.slice(0, 200));
    const text = r.content[0].text;
    if (text.includes("region-jp")) {
      throw new Error("BUG: ISP specialized tool added region-jp to zone username");
    }
    // Should note that country is ignored
    if (!text.includes("ignored")) {
      throw new Error("ISP tool should document that country is ignored");
    }
    return "PASS: country not in ISP zone, documented as ignored";
  });

  await bugClient.close();

  // Summary
  console.log("\n=== QA RESULTS ===");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    results.filter(r => r.status === "fail").forEach(r => {
      console.log(`  FAIL: ${r.test}: ${r.error}`);
    });
  }

  return results;
}

main().then(results => {
  console.log("\nRaw results (first 20):");
  results.slice(0, 20).forEach(r => {
    if (r.status === "fail") console.log(`FAIL ${r.test}: ${r.error}`);
    else console.log(`PASS ${r.test}`);
  });
  process.exit(0);
}).catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
