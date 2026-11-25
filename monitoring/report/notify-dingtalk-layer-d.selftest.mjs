#!/usr/bin/env node
/**
 * Offline self-test for monitoring/report/notify-dingtalk-layer-d.mjs
 * (no network, no key, no webhook — fetch is stubbed).
 *   node monitoring/report/notify-dingtalk-layer-d.selftest.mjs
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildLayerDMessage, main, MAX_FAILURE_LINES } from "./notify-dingtalk-layer-d.mjs";

let failures = 0;
function expect(cond, msg) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL:"} ${msg}`);
  if (!cond) failures += 1;
}

const row = (name, status, domain = "-", severity = null, error = null) => ({ name, status, domain, severity, error });
const MIXED = {
  startedAt: "2026-11-25T02:57:00.000Z",
  finishedAt: "2026-11-25T02:59:36.676Z",
  mcpUrl: "https://mcp.novada.com/mcp",
  liveToolCount: 29,
  exitCode: 1,
  results: [
    row("novada_setup", "PASS"),
    row("novada_research", "SLOW"),
    row("novada_scrape_github", "ASYNC"),
    row("novada_proxy", "FAIL", "①-mcp-code", "P0", "Error [PRODUCT_UNAVAILABLE]: Your Residential proxy plan is EXPIRED\nfailure_class: permanent"),
    row("novada_scrape_bing", "FAIL", "③-backend", "P1", "Error [API_DOWN]: Novada API is temporarily unavailable."),
    row("novada_search", "FAIL", "②-gateway", "P0", "free gateway cap; token abcdefghijklmnopqrstuvwxyz0123456789ABCD leaked?"),
    row("novada_scrape_shein", "MISSING", "①-mcp-code", "P0", "absent from live tools/list"),
  ],
  summary: { maxSeverity: "P0", maxOursSeverity: "P0", testKeyDegradedCount: 1, monitoringDegraded: true, missingTools: ["novada_scrape_shein"] },
};

console.log("[selftest] buildLayerDMessage — mixed report");
{
  const { title, text } = buildLayerDMessage(MIXED);
  expect(title.includes("2026-11-25"), "title carries the run date (from finishedAt)");
  expect(text.includes("**2/7 正常**"), "PASS+SLOW counted as healthy over all probed rows (2/7)");
  expect(text.includes("失败 3") && text.includes("我方 1") && text.includes("网关/配置 1") && text.includes("上游 1"), "FAIL split by domain ①/②/③");
  expect(text.includes("缺失 1") && text.includes("novada_scrape_shein"), "MISSING counted and named");
  expect(text.includes("处理中 1"), "ASYNC counted separately (not a failure)");
  expect(text.includes("novada_scrape_bing") && text.includes("API_DOWN"), "failure line names the tool and the error code");
  expect(!text.includes("failure_class"), "only the first line of a multi-line error is shown");
  expect(!/[A-Za-z0-9]{32,}/.test(text), "long token-like strings are masked");
  expect(text.includes("测试 key 降级"), "test-key degradation is surfaced (results not trustworthy)");
  expect(text.includes("最高严重度（我方）: P0"), "worst OURS severity is shown");
  const order = ["novada_proxy", "novada_search", "novada_scrape_bing"].map((n) => text.indexOf(n));
  expect(order[0] < order[1] && order[1] < order[2], "failure lines ordered ① → ② → ③");
}

console.log("[selftest] buildLayerDMessage — all green");
{
  const allPass = { ...MIXED, exitCode: 0, results: [row("novada_setup", "PASS"), row("novada_map", "PASS")], summary: { maxSeverity: null, maxOursSeverity: null, testKeyDegradedCount: 0, missingTools: [] } };
  const { text } = buildLayerDMessage(allPass);
  expect(text.includes("**2/2 正常**"), "2/2 healthy");
  expect(!text.includes("失败明细"), "no failure section when nothing failed");
  expect(!text.includes("测试 key 降级"), "no degradation line when not degraded");
}

console.log("[selftest] buildLayerDMessage — truncation");
{
  const many = { ...MIXED, results: Array.from({ length: MAX_FAILURE_LINES + 5 }, (_, i) => row(`novada_t${i}`, "FAIL", "③-backend", "P2", "Error [API_DOWN]: x")) };
  const { text } = buildLayerDMessage(many);
  expect(text.includes(`另有 5 项`), "remainder note names how many were cut");
  const shown = text.split("\n").filter((l) => l.startsWith("- novada_t")).length;
  expect(shown === MAX_FAILURE_LINES, `exactly ${MAX_FAILURE_LINES} failure lines shown (got ${shown})`);
  expect(text.length < 4000, `message stays well under DingTalk's size limit (${text.length} chars)`);
}

// ── main(): config handling + send path (fetch stubbed) ────────────────────
const dir = mkdtempSync(path.join(tmpdir(), "layerd-notify-"));
const reportPath = path.join(dir, "full-2026-11-25T02-59-36-676Z.json");
writeFileSync(reportPath, JSON.stringify(MIXED));

console.log("[selftest] main — not configured");
{
  let called = 0;
  const code = await main([reportPath], {}, { fetchFn: async () => { called += 1; return new Response("{}"); } });
  expect(code === 0 && called === 0, "no DINGTALK_WEBHOOK_URL → skip, exit 0, no network");
}

console.log("[selftest] main — configured, DingTalk accepts");
{
  const calls = [];
  const fetchFn = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 }); };
  const env = { DINGTALK_WEBHOOK_URL: "https://oapi.dingtalk.com/robot/send?access_token=TEST", DINGTALK_SECRET: "SECtest", DINGTALK_KEYWORD: "NovadaMonitor" };
  const code = await main([reportPath], env, { fetchFn, sleep: async () => {} });
  expect(code === 0 && calls.length === 1, "exactly one POST, exit 0");
  expect(/[?&]timestamp=\d+&sign=/.test(calls[0]?.url || ""), "URL is signed (加签 timestamp + sign)");
  const md = calls[0]?.body?.markdown;
  expect(calls[0]?.body?.msgtype === "markdown" && (md?.title + md?.text).includes("NovadaMonitor"), "markdown body carries the configured keyword");
}

console.log("[selftest] main — DingTalk rejects");
{
  const fetchFn = async () => new Response(JSON.stringify({ errcode: 310000, errmsg: "keywords not in content" }), { status: 200 });
  const code = await main([reportPath], { DINGTALK_WEBHOOK_URL: "https://oapi.dingtalk.com/robot/send?access_token=TEST" }, { fetchFn, sleep: async () => {} });
  expect(code === 1, "errcode != 0 → exit 1 (caller logs it, never fatal to the daily job)");
}

console.log("[selftest] main — bad input");
{
  expect((await main([], {}, {})) === 2, "no report path → exit 2");
  expect((await main([path.join(dir, "nope.json")], {}, {})) === 2, "missing report file → exit 2");
  const bad = path.join(dir, "bad.json");
  writeFileSync(bad, "{not json");
  expect((await main([bad], {}, {})) === 2, "unparseable report → exit 2");
}

if (failures > 0) {
  console.error(`[notify-layer-d selftest] ${failures} failure(s)`);
  process.exit(1);
}
console.log("[notify-layer-d selftest] OK");
