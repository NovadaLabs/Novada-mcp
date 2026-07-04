// probe_traffic_daily.mjs  — ESM MCP client for red-team testing
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = "1f35b477c9e1802778ec64aee2a6adfa";
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
  client = new Client({ name: "probe", version: "1.0" }, { capabilities: {} });
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

async function main() {
  await connect();

  // 1. List tools to get real schema
  const tools = await client.listTools();
  const trafficTool = tools.tools.find(t => t.name === "novada_traffic_daily");
  console.log("=== SCHEMA ===");
  console.log(JSON.stringify(trafficTool?.inputSchema, null, 2));

  const cases = [
    // --- Happy path ---
    { label: "HP-1: no args (defaults)", args: {} },
    { label: "HP-2: last 7 days explicit", args: { start_time: "2026-06-24", end_time: "2026-07-01" } },
    { label: "HP-3: single product", args: { products: ["residential"] } },
    { label: "HP-4: two products with range", args: { products: ["residential", "isp"], start_time: "2026-06-01", end_time: "2026-06-30" } },

    // --- Boundary ---
    { label: "BD-1: same start/end date", args: { start_time: "2026-07-01", end_time: "2026-07-01" } },
    { label: "BD-2: future end_time", args: { start_time: "2026-07-01", end_time: "2026-12-31" } },
    { label: "BD-3: far past range", args: { start_time: "2000-01-01", end_time: "2000-12-31" } },
    { label: "BD-4: all 5 products explicit", args: { products: ["residential", "isp", "mobile", "datacenter", "static"] } },
    { label: "BD-5: empty products array", args: { products: [] } },

    // --- Hostile type/validation ---
    { label: "HO-1: products wrong type (string not array)", args: { products: "residential" } },
    { label: "HO-2: start_time invalid format", args: { start_time: "01-01-2026" } },
    { label: "HO-3: end_time not a date", args: { end_time: "not-a-date" } },
    { label: "HO-4: start_time null", args: { start_time: null } },
    { label: "HO-5: unknown extra param", args: { start_time: "2026-06-24", end_time: "2026-07-01", fake_param: "injected" } },
    { label: "HO-6: product invalid enum value", args: { products: ["residential", "notaproduct"] } },
    { label: "HO-7: SQL injection in start_time", args: { start_time: "'; DROP TABLE users; --" } },
    { label: "HO-8: very long string for start_time", args: { start_time: "A".repeat(1000) } },
    { label: "HO-9: unicode in start_time", args: { start_time: "2026-…07-01" } },
    { label: "HO-10: numeric start_time", args: { start_time: 20260701 } },
  ];

  const results = [];

  for (const c of cases) {
    console.log(`\n=== ${c.label} ===`);
    console.log("args:", JSON.stringify(c.args));

    const t0 = Date.now();
    const r = await callTool("novada_traffic_daily", c.args);
    const ms = Date.now() - t0;

    if (r.ok) {
      const contentArr = r.result?.content || [];
      const text = contentArr.map(x => x.text || "").join("");
      console.log(`OK [${ms}ms] len=${text.length}`);
      // Print first 800 chars to not flood
      console.log(text.slice(0, 800));
      results.push({ label: c.label, ok: true, ms, text });
    } else {
      const err = r.error;
      console.log(`ERR [${ms}ms]`, err?.message, err?.code);
      results.push({ label: c.label, ok: false, ms, error: { code: err?.code, message: err?.message } });
    }
  }

  console.log("\n=== SUMMARY ===");
  for (const r of results) {
    if (r.ok) {
      console.log(`[OK  ${r.ms}ms] ${r.label}`);
    } else {
      console.log(`[ERR ${r.ms}ms] ${r.label} — code=${r.error?.code} msg=${r.error?.message?.slice(0, 80)}`);
    }
  }

  await disconnect();
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
