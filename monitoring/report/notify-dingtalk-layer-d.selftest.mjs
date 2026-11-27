#!/usr/bin/env node
/**
 * Offline self-test for monitoring/report/notify-dingtalk-layer-d.mjs
 * (no network, no key, no webhook — fetch is stubbed).
 *   node monitoring/report/notify-dingtalk-layer-d.selftest.mjs
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildHeartbeatMessage, buildLayerDMessage, collectHealthWeek, collectLayerDWeek, EXPECTED_HEALTH_RUNS_PER_WEEK, layerDProblem, main, MAX_FAILURE_LINES, reportTimeFromName, SEND_TIMEOUT_MS, withTimeout } from "./notify-dingtalk-layer-d.mjs";

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

console.log("[selftest] weekly heartbeat (owner 2026-11-28)");
{
  expect(reportTimeFromName("full-2026-11-27T01-57-45-366Z.json") === Date.parse("2026-11-27T01:57:45.366Z"), "report timestamp parsed from file name");
  expect(reportTimeFromName("full-latest.json") === null && reportTimeFromName("x.json") === null, "non-report names ignored");

  const NOW = Date.parse("2026-11-30T02:59:00.000Z"); // a Monday
  const hb = mkdtempSync(path.join(tmpdir(), "layerd-hb-"));
  const green = JSON.stringify({ exitCode: 0, results: [row("novada_setup", "PASS")], summary: {} });
  const red = JSON.stringify({ exitCode: 1, results: [row("novada_setup", "FAIL", "③-backend", "P1", "x")], summary: {} });
  writeFileSync(path.join(hb, "full-2026-11-30T01-57-00-000Z.json"), green);
  writeFileSync(path.join(hb, "full-2026-11-29T01-57-00-000Z.json"), red);
  writeFileSync(path.join(hb, "full-2026-11-29T09-00-00-000Z.json"), green); // manual extra run, same day
  writeFileSync(path.join(hb, "full-2026-11-27T01-57-00-000Z.json"), "{trunc");
  writeFileSync(path.join(hb, "full-2026-11-23T01-57-00-000Z.json"), red); // previous Monday: > 7 days, excluded
  writeFileSync(path.join(hb, "full-2026-11-30T05-00-00-000Z.json"), red); // later today than `now`: excluded
  writeFileSync(path.join(hb, "notes.txt"), "x");
  const ld = collectLayerDWeek(hb, NOW);
  expect(ld.runs === 4 && ld.days === 3, `window = last 7 days, distinct days counted (runs ${ld.runs}, days ${ld.days})`);
  expect(ld.problems === 1 && ld.unreadable === 1, `problem and unreadable reports counted (problems ${ld.problems}, unreadable ${ld.unreadable})`);
  expect(typeof collectLayerDWeek(path.join(hb, "nope"), NOW).error === "string", "missing reports dir → error, not zeros");

  const runsBody = { workflow_runs: [
    { created_at: "2026-11-29T06:37:00Z", event: "schedule", status: "completed", conclusion: "success" },
    { created_at: "2026-11-28T06:37:00Z", event: "schedule", status: "completed", conclusion: "failure" },
    { created_at: "2026-11-28T22:13:00Z", event: "workflow_dispatch", status: "completed", conclusion: "success" }, // manual: ignored
    { created_at: "2026-11-22T06:37:00Z", event: "schedule", status: "completed", conclusion: "success" }, // outside window
  ] };
  let apiUrl = "";
  const h1 = await collectHealthWeek({ repo: "o/r", now: NOW, fetchFn: async (u) => { apiUrl = u; return new Response(JSON.stringify(runsBody), { status: 200 }); } });
  expect(h1.runs === 2 && h1.jobErrors === 1, `only SCHEDULED GitHub runs in the window are counted (runs ${h1.runs}, jobErrors ${h1.jobErrors})`);
  expect(apiUrl.includes("/repos/o/r/actions/workflows/mcp-health-dingtalk.yml/runs") && apiUrl.includes("created=%3E%3D2026-11-23"), "queries the MCP Health workflow since 7 days ago");
  const h2 = await collectHealthWeek({ repo: "o/r", now: NOW, fetchFn: async () => new Response("{}", { status: 403 }) });
  const h3 = await collectHealthWeek({ repo: "o/r", now: NOW, fetchFn: async () => { throw new Error("ENOTFOUND"); } });
  expect(/403/.test(h2.error || "") && /ENOTFOUND/.test(h3.error || ""), "API HTTP error / network error → error, not zeros");

  const ok = buildHeartbeatMessage({ now: NOW, layerD: { runs: 7, days: 7, problems: 0, unreadable: 0 }, health: { runs: 21, jobErrors: 0, gapDays: [] } }).text;
  expect(ok.includes("7/7") && ok.includes("**21** 次") && !ok.includes("⚠️"), "healthy week with GitHub's usual drops (21 of 35): no warning");
  const bad = buildHeartbeatMessage({ now: NOW, layerD: { runs: 3, days: 3, problems: 1, unreadable: 0 }, health: { runs: 15, jobErrors: 0, gapDays: ["2026-11-27", "2026-11-28"] } }).text;
  expect(bad.includes("3/7") && bad.includes("少于 7 天") && bad.includes("2026-11-27、2026-11-28 整天没有运行"), "missed Layer D days and whole-day GitHub gaps are flagged");

  // Gap detection from real-shaped API data: 21 runs spread over every day → no gap; a 2-day hole → flagged.
  const spread = (days, perDay) => days.flatMap((d) => Array.from({ length: perDay }, (_, i) => ({ created_at: `${d}T${String(i * 6).padStart(2, "0")}:37:00Z`, event: "schedule", status: "completed", conclusion: "success" })));
  const week = ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"];
  const gNone = await collectHealthWeek({ repo: "o/r", now: NOW, fetchFn: async () => new Response(JSON.stringify({ workflow_runs: spread(week, 3).concat(spread(["2026-11-30"], 1)) }), { status: 200 }) });
  expect(gNone.runs === 19 && gNone.gapDays.length === 0, `3 runs/day every day → no gap (runs ${gNone.runs}, gaps ${gNone.gapDays})`);
  const gHole = await collectHealthWeek({ repo: "o/r", now: NOW, fetchFn: async () => new Response(JSON.stringify({ workflow_runs: spread(week.filter((d) => d !== "2026-11-26" && d !== "2026-11-27"), 5) }), { status: 200 }) });
  expect(gHole.gapDays.join(",") === "2026-11-26,2026-11-27", `whole-day gaps reported in order (${gHole.gapDays})`);
  const gZero = await collectHealthWeek({ repo: "o/r", now: NOW, fetchFn: async () => new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 }) });
  expect(gZero.runs === 0 && gZero.gapDays.length === 6, "schedule fully stopped → all 6 days flagged");
  expect(bad.includes("应已单独报过"), "heartbeat does not claim problem messages were delivered");

  // Pin EXPECTED_HEALTH_RUNS_PER_WEEK to the workflow's crons (runs/day = number of hours in each cron).
  const wf = readFileSync(new URL("../../.github/workflows/mcp-health-dingtalk.yml", import.meta.url), "utf8");
  const perDay = [...wf.matchAll(/cron:\s*"(\S+)\s+(\S+)\s+\*\s+\*\s+\*"/g)].reduce((n, m) => n + m[2].split(",").length, 0);
  expect(perDay * 7 === EXPECTED_HEALTH_RUNS_PER_WEEK, `expected weekly runs match the workflow crons (${perDay}/day × 7 = ${perDay * 7})`);

  // Review round 3 HIGH: a rolling 168 h window could include LAST Monday's report and show 7/7 with a day missing.
  const prevTZ = process.env.TZ;
  try {
    for (const tz of ["UTC", "Europe/Berlin"]) {
      process.env.TZ = tz;
      // A TZ switch that silently does nothing must fail loudly, not pass vacuously.
      expect(new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset() === (tz === "UTC" ? 0 : -60), `[${tz}] runtime TZ switch took effect`);
      const d1 = mkdtempSync(path.join(tmpdir(), "layerd-hb-edge-"));
      const at = (iso) => writeFileSync(path.join(d1, `full-${iso.replace(/[:.]/g, "-")}.json`), green);
      at("2026-11-23T02:05:30.000Z"); // last Monday, 20 s inside 168 h
      for (const day of ["24", "26", "27", "28", "29"]) at(`2026-11-${day}T02:05:00.000Z`); // Wednesday 25 missing
      at("2026-11-30T02:05:10.000Z");
      const e = collectLayerDWeek(d1, Date.parse("2026-11-30T02:05:15.000Z"));
      expect(e.days === 6, `[${tz}] last Monday's report not counted, missed Wednesday shows (days ${e.days}/7)`);
      at("2026-11-25T02:05:00.000Z");
      const full = collectLayerDWeek(d1, Date.parse("2026-11-30T02:05:15.000Z"));
      expect(full.days === 7, `[${tz}] a full week is 7/7, never 8/7 (days ${full.days})`);
    }
    // Local date, not UTC date: a report at 23:30Z on Tue 11-24 is Wednesday 00:30 in Berlin.
    for (const [tz, want] of [["Europe/Berlin", 7], ["UTC", 6]]) {
      process.env.TZ = tz;
      const d3 = mkdtempSync(path.join(tmpdir(), "layerd-hb-local-"));
      const at3 = (iso) => writeFileSync(path.join(d3, `full-${iso.replace(/[:.]/g, "-")}.json`), green);
      for (const day of ["26", "27", "28", "29", "30"]) at3(`2026-11-${day}T01:57:00.000Z`);
      at3("2026-11-24T01:57:00.000Z");
      at3("2026-11-24T23:30:00.000Z"); // Berlin: Wed 11-25 00:30 · UTC: still Tue 11-24
      const l = collectLayerDWeek(d3, Date.parse("2026-11-30T02:00:00.000Z"));
      expect(l.days === want, `[${tz}] days counted by LOCAL date (${l.days}/7, want ${want}/7)`);
    }
    // Spring DST week (EU 2027-03-28): 02:57 local runs are 167 h apart.
    process.env.TZ = "Europe/Berlin";
    expect(new Date(Date.UTC(2027, 2, 29)).getTimezoneOffset() === -120, "[DST week] Berlin is on summer time by 03-29");
    const d2 = mkdtempSync(path.join(tmpdir(), "layerd-hb-dst-"));
    const at2 = (iso) => writeFileSync(path.join(d2, `full-${iso.replace(/[:.]/g, "-")}.json`), green);
    at2("2027-03-22T01:57:00.000Z"); // Mon 02:57 CET
    for (const day of ["23", "25", "26", "27"]) at2(`2027-03-${day}T01:57:00.000Z`); // Wed 24 missing
    at2("2027-03-28T00:57:00.000Z"); // Sun 01:57 CET (the switch is at 01:00Z)
    at2("2027-03-29T00:57:00.000Z"); // Mon 02:57 CEST
    const dst = collectLayerDWeek(d2, Date.parse("2027-03-29T00:58:00.000Z"));
    expect(dst.days === 6, `[DST week] previous Monday excluded, missed Wednesday shows (days ${dst.days}/7)`);
  } finally {
    if (prevTZ === undefined) delete process.env.TZ;
    else process.env.TZ = prevTZ;
  }
  const unk = buildHeartbeatMessage({ now: NOW, layerD: { error: "reports dir unreadable: ENOENT" }, health: { error: "GitHub API HTTP 403" } }).text;
  expect(unk.match(/未能统计/g)?.length === 2 && !/\*\*0/.test(unk), "an unreadable source says 未能统计, never renders as 0");

  const env = { DINGTALK_WEBHOOK_URL: "https://oapi.dingtalk.com/robot/send?access_token=TEST" };
  const posts = [];
  const fetchFn = async (u, init) => {
    if (String(u).startsWith("https://api.github.com/")) return new Response(JSON.stringify(runsBody), { status: 200 });
    posts.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 });
  };
  expect((await main(["--heartbeat", hb], env, { fetchFn, sleep: async () => {}, now: NOW })) === 0 && posts.length === 1, "--heartbeat sends exactly one message, exit 0");
  expect((posts[0]?.markdown?.title || "").includes("周心跳"), "heartbeat title is recognisable");
  posts.length = 0;
  expect((await main(["--heartbeat", path.join(hb, "nope")], env, { fetchFn: async (u, i) => { if (String(u).startsWith("https://api.github.com/")) throw new Error("down"); return fetchFn(u, i); }, sleep: async () => {}, now: NOW })) === 0 && posts.length === 1, "heartbeat still sent when both sources fail (says 未能统计)");
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
