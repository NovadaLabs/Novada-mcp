// probe_traffic_daily_deep.mjs — targeted follow-up probes
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = "process.env.NOVADA_API_KEY";
const PROXY_USER = "tongwu_TRDI7X";
const PROXY_PASS = "_Asd1644asd_";
const BROWSER_WS = "wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com";

const ENV = {
  NOVADA_API_KEY: API_KEY,
  NOVADA_DEVELOPER_API_KEY: API_KEY,
  NOVADA_PROXY_USER: PROXY_USER,
  NOVADA_PROXY_PASS: PROXY_PASS,
  NOVADA_BROWSER_WS: BROWSER_WS,
  HOME: process.env.HOME,
  PATH: process.env.PATH,
};

let client;
let transport;

async function connect() {
  transport = new StdioClientTransport({
    command: "node",
    args: [path.join(__dirname, "build", "index.js")],
    env: ENV,
  });
  client = new Client({ name: "probe-deep", version: "1.0" }, { capabilities: {} });
  await client.connect(transport);
}

async function disconnect() {
  try { await client.close(); } catch {}
}

async function callTool(name, args) {
  try {
    const r = await client.callTool({ name, arguments: args });
    return { ok: true, result: r };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function parseResult(r) {
  if (!r.ok) return { parseError: r.error?.message };
  const contentArr = r.result?.content || [];
  const text = contentArr.map(x => x.text || "").join("");
  try { return JSON.parse(text); }
  catch { return { rawText: text }; }
}

async function main() {
  await connect();

  console.log("=== DEEP PROBE 1: Empty products array behavior ===");
  // Schema says products is optional array — empty array should mean nothing selected
  // but code path says `params.products?.length ? selected = filter : selected = ALL`
  // So empty array falls back to ALL 5 — undocumented behavior
  const emptyProductsResult = await callTool("novada_traffic_daily", { products: [] });
  const ep = parseResult(emptyProductsResult);
  console.log("Empty products status:", ep.status);
  console.log("Empty products per_product keys:", ep.per_product ? Object.keys(ep.per_product) : "none");
  console.log("(Expected: 0 products queried, Got: ALL products queried if keys != [])");

  console.log("\n=== DEEP PROBE 2: Status 'partial' — which product fails? ===");
  // HP-1 with no args returns "partial", HP-3 with single product returns "ok"
  // Check each product individually to find the failing one
  const products = ["residential", "isp", "mobile", "datacenter", "static"];
  for (const p of products) {
    const r = await callTool("novada_traffic_daily", { products: [p] });
    const parsed = parseResult(r);
    const ps = parsed.per_product?.[p];
    console.log(`  ${p}: status=${ps?.status}, total_mb=${ps?.total_mb}, error=${ps?.error}`);
  }

  console.log("\n=== DEEP PROBE 3: What is 'mobile' raw response? ===");
  const mobileResult = await callTool("novada_traffic_daily", { products: ["mobile"] });
  const m = parseResult(mobileResult);
  console.log("Mobile raw:", JSON.stringify(m.per_product?.mobile?.raw, null, 2));

  console.log("\n=== DEEP PROBE 4: start_time > end_time (inverted range) ===");
  const invertedResult = await callTool("novada_traffic_daily", {
    start_time: "2026-12-31",
    end_time: "2026-01-01"
  });
  const inv = parseResult(invertedResult);
  console.log("Inverted range status:", inv.status);
  console.log("Inverted range errors:", JSON.stringify(inv.errors));

  console.log("\n=== DEEP PROBE 5: range field when no dates given ===");
  // Check if range contains actual dates or placeholder strings
  const noDateResult = await callTool("novada_traffic_daily", {});
  const nd = parseResult(noDateResult);
  console.log("range.start_time:", nd.range?.start_time);
  console.log("range.end_time:", nd.range?.end_time);
  console.log("(If these are placeholder strings, agent cannot know actual date range used)");

  console.log("\n=== DEEP PROBE 6: Only mobile product + dates ===");
  const mobileWithDates = await callTool("novada_traffic_daily", {
    products: ["mobile"],
    start_time: "2026-06-24",
    end_time: "2026-07-01"
  });
  const mwd = parseResult(mobileWithDates);
  console.log("Mobile + dates status:", mwd.status);
  console.log("Mobile + dates per_product:", JSON.stringify(mwd.per_product?.mobile, null, 2));

  console.log("\n=== DEEP PROBE 7: Output when isContent wrapping is checked ===");
  // Check whether content[0].type is always 'text'
  const r7 = await callTool("novada_traffic_daily", { products: ["residential"] });
  if (r7.ok) {
    const content = r7.result?.content || [];
    console.log("content type:", typeof content);
    console.log("content[0].type:", content[0]?.type);
    console.log("isError:", r7.result?.isError);
    console.log("structuredContent:", r7.result?.structuredContent);
  }

  console.log("\n=== DEEP PROBE 8: Does agent_instruction appear on partial errors? ===");
  const allProductResult = await callTool("novada_traffic_daily", {});
  const ap = parseResult(allProductResult);
  console.log("status:", ap.status);
  console.log("agent_instruction:", ap.agent_instruction);
  console.log("errors array:", JSON.stringify(ap.errors));

  await disconnect();
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
