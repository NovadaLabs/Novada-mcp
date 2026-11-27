#!/usr/bin/env node
/**
 * Offline self-test for monitoring/report/notify-dingtalk-layer-d.mjs
 * (no network, no key, no webhook — fetch is stubbed).
 *   node monitoring/report/notify-dingtalk-layer-d.selftest.mjs
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildLayerDMessage, layerDProblem, main, MAX_FAILURE_LINES, SEND_TIMEOUT_MS, withTimeout } from "./notify-dingtalk-layer-d.mjs";

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

console.log("[selftest] masking — known secrets by value, identifiers kept (review D4)");
{
  const shortKey = "k3yK3yK3yK3yK3y9"; // 16 chars: below the length heuristic
  const rep2 = { ...MIXED, results: [row("novada_scrape_linkedin", "FAIL", "③-backend", "P1", `op linkedin_company_information_url failed for key ${shortKey}`)] };
  const { text } = buildLayerDMessage(rep2, { knownSecrets: [shortKey] });
  expect(!text.includes(shortKey), "a short key passed as a known secret is masked by value");
  expect(text.includes("linkedin_company_information_url"), "snake_case identifiers are not mistaken for tokens");
}

console.log("[selftest] withTimeout — every send carries an AbortSignal (review D3)");
{
  let seen;
  await withTimeout(async (_u, init) => { seen = init; return new Response("{}"); })("https://x.invalid", { method: "POST" });
  expect(seen?.signal instanceof AbortSignal && seen.method === "POST", `signal attached, init preserved (timeout ${SEND_TIMEOUT_MS} ms)`);
}

console.log("[selftest] buildLayerDMessage — all green");
{
  const allPass = { ...MIXED, exitCode: 0, results: [row("novada_setup", "PASS"), row("novada_map", "PASS")], summary: { maxSeverity: null, maxOursSeverity: null, testKeyDegradedCount: 0, missingTools: [] } };
  const { text } = buildLayerDMessage(allPass);
  expect(text.includes("**2/2 正常**"), "2/2 healthy");
  expect(!text.includes("失败明细"), "no failure section when nothing failed");
  expect(!text.includes("测试 key 降级"), "no degradation line when not degraded");
}

console.log("[selftest] buildLayerDMessage — probe could not run (2026-11-27 outage)");
{
  // Shape written by full-tools-probe's FATAL path when tools/list fails (site unreachable):
  // startedAt null, results [], liveToolCount 0, exitCode 1.
  const fatal = { startedAt: null, finishedAt: "2026-11-27T01:57:45.366Z", mcpUrl: "https://mcp.novada.com/mcp", liveToolCount: 0, results: [], summary: { maxSeverity: null, maxOursSeverity: null, testKeyDegradedCount: 0 }, exitCode: 1 };
  const { title, text } = buildLayerDMessage(fatal);
  expect(!text.includes("0/0 正常") && !/\*\*\d+\/\d+ 正常\*\*/.test(text), "a run that tested nothing never shows an 'N/M 正常' health line");
  expect(title.includes("未能运行") && text.includes("未能运行"), "title and body say the probe could not run");
  expect(text.includes("tools/list") && text.includes("exitCode 1"), "body names the failing step and the exit code");
  expect(text.includes("MCP Health"), "body points to the MCP Health alerts for the outage itself");
  const empty2 = { ...fatal, startedAt: "2026-11-27T01:57:00.000Z", liveToolCount: 29, results: [] };
  expect(buildLayerDMessage(empty2).text.includes("未能运行"), "zero result rows is treated as 'could not run' even if startedAt is set");
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

console.log("[selftest] layerDProblem — send only on problems (owner 2026-11-27)");
{
  const GREEN = { finishedAt: "2026-11-28T02:59:00.000Z", exitCode: 0, results: [row("novada_setup", "PASS"), row("novada_research", "SLOW"), row("novada_scrape_github", "ASYNC")], summary: { testKeyDegradedCount: 0 } };
  expect(layerDProblem(GREEN) === null, "PASS/SLOW/ASYNC only, exitCode 0, key not degraded → no problem");
  expect(layerDProblem({ ...GREEN, exitCode: undefined }) === null, "missing exitCode alone is not a problem");
  // Problem matrix — one row per class; each must be detected on an otherwise-green report.
  const cases = [
    ["no-results", { ...GREEN, results: [] }],
    ["no-results", { ...GREEN, results: undefined }],
    ["fail", { ...GREEN, results: [...GREEN.results, row("novada_scrape_bing", "FAIL", "③-backend", "P1", "x")] }],
    ["missing", { ...GREEN, results: [...GREEN.results, row("novada_scrape_shein", "MISSING")] }],
    ["unknown-status", { ...GREEN, results: [...GREEN.results, row("novada_x", "TIMEOUT")] }],
    ["unknown-status", { ...GREEN, results: [...GREEN.results, { name: "novada_y" }] }],
    ["test-key-degraded", { ...GREEN, summary: { testKeyDegradedCount: 2 } }],
    ["nonzero-exit", { ...GREEN, exitCode: 1 }],
  ];
  for (const [want, rep] of cases) expect(layerDProblem(rep) === want, `problem class '${want}' detected`);
  expect(layerDProblem(null) === "no-results" && layerDProblem({}) === "no-results", "null / empty object → problem (fail closed)");

  const greenPath = path.join(dir, "green.json");
  writeFileSync(greenPath, JSON.stringify(GREEN));
  const env = { DINGTALK_WEBHOOK_URL: "https://oapi.dingtalk.com/robot/send?access_token=TEST" };
  let called = 0;
  const okFetch = async () => { called += 1; return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 }); };
  expect((await main([greenPath], env, { fetchFn: okFetch, sleep: async () => {} })) === 0 && called === 0, "configured + all healthy → exit 0, NO network call");
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => { logs.push(a.join(" ")); };
  let dryCode;
  try { dryCode = await main([greenPath], { ...env, DRY_RUN: "1" }, { fetchFn: okFetch }); } finally { console.log = origLog; }
  expect(dryCode === 0 && logs.some((l) => l.includes("skip: all")) && !logs.some((l) => l.includes("dry-run printed")), "dry-run + all healthy → skipped by the gate, not printed as a send");
  const fatalPath = path.join(dir, "fatal.json");
  writeFileSync(fatalPath, JSON.stringify({ finishedAt: "2026-11-27T01:57:45.366Z", results: [], exitCode: 1 }));
  expect((await main([fatalPath], env, { fetchFn: okFetch, sleep: async () => {} })) === 0 && called === 1, "probe could not run → still sent");
  called = 0;
  expect((await main([reportPath], env, { fetchFn: okFetch, sleep: async () => {} })) === 0 && called === 1, "mixed report with failures → sent");
}

console.log("[selftest] could-not-run paths always reach the group (review 2026-11-27 HIGH)");
{
  const env = { DINGTALK_WEBHOOK_URL: "https://oapi.dingtalk.com/robot/send?access_token=TEST" };
  const bodies = [];
  const fetchFn = async (_u, init) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 }); };
  expect((await main(["--fatal", "run-daily-report: probe wrote no report (probe exit 137)"], env, { fetchFn, sleep: async () => {} })) === 0 && bodies.length === 1, "--fatal <reason> → sent, exit 0");
  const t1 = bodies[0]?.markdown?.text || "";
  expect(t1.includes("未能运行") && t1.includes("probe exit 137"), "--fatal message says could-not-run and carries the reason");
  expect(!t1.includes("exitCode 1"), "--fatal message does not invent an exitCode of its own");
  bodies.length = 0;
  const trunc = path.join(dir, "truncated.json");
  writeFileSync(trunc, '{"results": [');
  expect((await main([trunc], env, { fetchFn, sleep: async () => {} })) === 2 && bodies.length === 1, "unparseable report → could-not-run still sent, exit stays 2");
  expect((bodies[0]?.markdown?.text || "").includes("report unreadable"), "unreadable-report reason is in the message");
  bodies.length = 0;
  expect((await main([path.join(dir, "gone.json")], env, { fetchFn, sleep: async () => {} })) === 2 && bodies.length === 1, "missing report file → could-not-run still sent, exit stays 2");
}

console.log("[selftest] message names why it was sent");
{
  const fatalErr = { finishedAt: "2026-11-28T02:00:00.000Z", results: [], exitCode: 1, summary: { fatalError: "TypeError: cannot read properties of undefined (reading 'tools')" } };
  const t = buildLayerDMessage(fatalErr).text;
  expect(t.includes("原因：TypeError"), "probe's own fatalError is shown as the reason");
  const unk = { finishedAt: "2026-11-28T02:00:00.000Z", exitCode: 0, results: [row("novada_a", "PASS"), row("novada_b", "TIMEOUT")], summary: {} };
  expect(buildLayerDMessage(unk).text.includes("novada_b=TIMEOUT"), "unknown-status rows are named");
  const nz = { finishedAt: "2026-11-28T02:00:00.000Z", exitCode: 3, results: [row("novada_a", "PASS")], summary: {} };
  expect(buildLayerDMessage(nz).text.includes("探针退出码: 3"), "non-zero probe exit is stated");
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
