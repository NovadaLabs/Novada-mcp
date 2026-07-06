import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";
const ALL = [];

function mkClient() {
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
  });
  const c = new Client({ name: "qa-conc", version: "0" }, { capabilities: {} });
  return { t, c };
}

async function call(c, name, args) {
  try {
    const r = await c.callTool({ name, arguments: args });
    return r;
  } catch (e) {
    return { error: e.message, content: [{ type: "text", text: String(e) }] };
  }
}

function rec(id, r) {
  const text = r?.content?.[0]?.text ?? JSON.stringify(r);
  ALL.push({ id, isError: r?.isError, text: text.slice(0, 500) });
  console.log(`\n--- ${id} ---`);
  console.log("isError:", r?.isError);
  console.log(text.slice(0, 500));
}

// GROUP 1: search_feedback schema/validation
async function g1() {
  const { t, c } = mkClient(); await c.connect(t);

  // S1: missing search_id
  rec("S1_missing_search_id", await call(c, "novada_search_feedback", { query: "test", rating: "good" }));
  // S2: missing query
  rec("S2_missing_query", await call(c, "novada_search_feedback", { search_id: "abc", rating: "good" }));
  // S3: missing rating
  rec("S3_missing_rating", await call(c, "novada_search_feedback", { search_id: "abc", query: "test" }));
  // S4: invalid rating value
  rec("S4_invalid_rating", await call(c, "novada_search_feedback", { search_id: "abc", query: "test", rating: "excellent" }));
  // S5: search_id with spaces (invalid regex)
  rec("S5_search_id_spaces", await call(c, "novada_search_feedback", { search_id: "has spaces", query: "t", rating: "good" }));
  // S6: search_id with injection chars
  rec("S6_search_id_injection", await call(c, "novada_search_feedback", { search_id: "id';DROP--", query: "t", rating: "good" }));
  // S7: empty search_id
  rec("S7_empty_search_id", await call(c, "novada_search_feedback", { search_id: "", query: "t", rating: "good" }));
  // S8: valid minimal
  rec("S8_valid_minimal", await call(c, "novada_search_feedback", { search_id: "search001", query: "test query", rating: "good" }));
  // S9: invalid useful_url
  rec("S9_invalid_useful_url", await call(c, "novada_search_feedback", { search_id: "s1", query: "t", rating: "ok", useful_urls: ["not-a-url"] }));
  // S10: note exceeds 2000 chars
  rec("S10_note_too_long", await call(c, "novada_search_feedback", { search_id: "s1", query: "t", rating: "bad", note: "x".repeat(2001) }));
  // S11: 51 useful_urls (over max 50)
  const urls51 = Array.from({length:51}, (_,i)=>`https://example.com/p${i}`);
  rec("S11_51_useful_urls", await call(c, "novada_search_feedback", { search_id: "s1", query: "t", rating: "ok", useful_urls: urls51 }));
  // S12: query exceeds 2000 chars
  rec("S12_query_too_long", await call(c, "novada_search_feedback", { search_id: "s1", query: "q".repeat(2001), rating: "good" }));
  // S13: search_id 129 chars (over max 128)
  rec("S13_search_id_129", await call(c, "novada_search_feedback", { search_id: "a".repeat(129), query: "t", rating: "good" }));
  // S14: search_id exactly 128 (boundary ok)
  rec("S14_search_id_128", await call(c, "novada_search_feedback", { search_id: "a".repeat(128), query: "t", rating: "good" }));
  // S15: null args
  rec("S15_null_args", await call(c, "novada_search_feedback", null));
  // S16: format=json valid
  rec("S16_format_json", await call(c, "novada_search_feedback", { search_id: "fj1", query: "t", rating: "good", format: "json" }));
  // S17: invalid format
  rec("S17_invalid_format", await call(c, "novada_search_feedback", { search_id: "fj2", query: "t", rating: "good", format: "xml" }));

  await c.close();
}

// GROUP 2: session_stats validation
async function g2() {
  const { t, c } = mkClient(); await c.connect(t);

  // S18: baseline (auth-free)
  rec("S18_stats_baseline", await call(c, "novada_session_stats", {}));
  // S19: recent_limit=0 (below min 1)
  rec("S19_recent_limit_0", await call(c, "novada_session_stats", { recent_limit: 0 }));
  // S20: recent_limit=101 (above max 100)
  rec("S20_recent_limit_101", await call(c, "novada_session_stats", { recent_limit: 101 }));
  // S21: recent_limit=100 (at boundary)
  rec("S21_recent_limit_100", await call(c, "novada_session_stats", { recent_limit: 100 }));
  // S22: stats after feedback calls
  await call(c, "novada_search_feedback", { search_id: "st1", query: "q1", rating: "good" });
  await call(c, "novada_search_feedback", { search_id: "st2", query: "q2", rating: "bad" });
  rec("S22_stats_after_feedback", await call(c, "novada_session_stats", { format: "json" }));
  // S23: recent_limit float
  rec("S23_recent_limit_float", await call(c, "novada_session_stats", { recent_limit: 1.5 }));
  // S24: format=json
  rec("S24_stats_json", await call(c, "novada_session_stats", { format: "json" }));
  // S25: invalid format
  rec("S25_stats_invalid_format", await call(c, "novada_session_stats", { format: "csv" }));
  // S26: null args (should default)
  rec("S26_stats_null_args", await call(c, "novada_session_stats", null));

  await c.close();
}

// GROUP 3: state accumulation / count consistency
async function g3() {
  const { t, c } = mkClient(); await c.connect(t);

  // S27: same search_id x3 - submissions_for_search should be 3
  await call(c, "novada_search_feedback", { search_id: "dup", query: "t", rating: "good" });
  await call(c, "novada_search_feedback", { search_id: "dup", query: "t", rating: "bad" });
  const r27 = await call(c, "novada_search_feedback", { search_id: "dup", query: "t", rating: "ok", format: "json" });
  rec("S27_dup_search_id_x3", r27);
  // verify submissions_for_search
  try {
    const p = JSON.parse(r27?.content?.[0]?.text || "{}");
    console.log(">>> submissions_for_search =", p.submissions_for_search, "(expected 3)");
    ALL.push({ id: "S27_check", submissions_for_search: p.submissions_for_search, expected: 3, pass: p.submissions_for_search === 3 });
  } catch {}

  // S28: total feedback count check
  const r28 = await call(c, "novada_search_feedback", { search_id: "cnt", query: "t", rating: "ok", format: "json" });
  rec("S28_total_count", r28);
  try {
    const p = JSON.parse(r28?.content?.[0]?.text || "{}");
    console.log(">>> total_feedback_this_session =", p.total_feedback_this_session, "(expected 4)");
    ALL.push({ id: "S28_check", total: p.total_feedback_this_session, expected: 4, pass: p.total_feedback_this_session === 4 });
  } catch {}

  // S29: stats after feedback storm
  rec("S29_stats_after_storm", await call(c, "novada_session_stats", { format: "json" }));

  // S30: numeric search_id (valid)
  rec("S30_numeric_search_id", await call(c, "novada_search_feedback", { search_id: "12345", query: "numeric id", rating: "good" }));

  // S31: 50 useful_urls (max boundary - should succeed)
  const urls50 = Array.from({length:50}, (_,i)=>`https://example.com/p${i}`);
  const r31 = await call(c, "novada_search_feedback", { search_id: "max-urls", query: "t", rating: "good", useful_urls: urls50, format: "json" });
  rec("S31_50_useful_urls_max", r31);
  try {
    const p = JSON.parse(r31?.content?.[0]?.text || "{}");
    console.log(">>> useful_url_count =", p.useful_url_count, "(expected 50)");
    ALL.push({ id: "S31_check", useful_url_count: p.useful_url_count, expected: 50, pass: p.useful_url_count === 50 });
  } catch {}

  // S32: stats tool_counts verification
  rec("S32_stats_tool_counts", await call(c, "novada_session_stats", { format: "json", recent_limit: 5 }));

  await c.close();
}

// GROUP 4: double-recordToolCall check
async function g4() {
  const { t, c } = mkClient(); await c.connect(t);

  // Get initial count
  const r_init = await call(c, "novada_session_stats", { format: "json" });
  let snap = {};
  try { snap = JSON.parse(r_init?.content?.[0]?.text || "{}"); } catch {}
  const initial = snap.total_calls || 0;
  console.log("S33 initial total_calls:", initial);
  ALL.push({ id: "S33_initial", total_calls: initial });

  // One feedback call
  await call(c, "novada_search_feedback", { search_id: "dc1", query: "t", rating: "good" });

  // One more stats call
  const r_after = await call(c, "novada_session_stats", { format: "json" });
  let snap2 = {};
  try { snap2 = JSON.parse(r_after?.content?.[0]?.text || "{}"); } catch {}
  const afterTwo = snap2.total_calls || 0;
  const delta = afterTwo - initial;
  console.log(`S34 after 2 more calls: total_calls=${afterTwo}, delta=${delta}, expected_delta=2`);
  ALL.push({ id: "S34_delta_check", initial, afterTwo, delta, expected_delta: 2, pass: delta === 2 });

  await c.close();
}

// GROUP 5: first-call self-count
async function g5() {
  const { t, c } = mkClient(); await c.connect(t);

  const r = await call(c, "novada_session_stats", { format: "json" });
  let snap = {};
  try { snap = JSON.parse(r?.content?.[0]?.text || "{}"); } catch {}
  console.log("S35 first call: total_calls=", snap.total_calls, "expected=1");
  console.log("S35 tool_counts:", JSON.stringify(snap.tool_counts));
  ALL.push({
    id: "S35_self_count",
    total_calls: snap.total_calls,
    expected: 1,
    pass: snap.total_calls === 1,
    tool_counts: snap.tool_counts
  });

  await c.close();
}

// GROUP 6: required params + strip behavior
async function g6() {
  const { t, c } = mkClient(); await c.connect(t);

  // S36: empty object - all required missing
  rec("S36_empty_obj", await call(c, "novada_search_feedback", {}));
  // S37: only format provided
  rec("S37_only_format", await call(c, "novada_search_feedback", { format: "json" }));
  // S38: unknown field (should strip)
  rec("S38_unknown_field", await call(c, "novada_session_stats", { format: "json", unknown_field: "stripped" }));
  // S39: extra injection field
  rec("S39_extra_injection_field", await call(c, "novada_search_feedback", {
    search_id: "inj-test",
    query: "test",
    rating: "good",
    injection_field: "'; DROP TABLE--",
    format: "json"
  }));

  await c.close();
}

// GROUP 7: MCP contract checks
async function g7() {
  const { t, c } = mkClient(); await c.connect(t);

  // S40: validation error should have isError=true
  const r40 = await call(c, "novada_search_feedback", { search_id: "x", query: "y" }); // missing rating
  rec("S40_isError_on_validation", r40);
  ALL.push({ id: "S40_check", isError: r40.isError, pass: r40.isError === true });

  // S41: valid call should NOT have isError
  const r41 = await call(c, "novada_search_feedback", { search_id: "valid", query: "test", rating: "good" });
  rec("S41_no_isError_on_valid", r41);
  ALL.push({ id: "S41_check", isError: r41.isError, pass: !r41.isError });

  // S42: session_stats invalid recent_limit - isError
  const r42 = await call(c, "novada_session_stats", { recent_limit: 0 });
  rec("S42_stats_isError", r42);
  ALL.push({ id: "S42_check", isError: r42.isError, pass: r42.isError === true });

  // S43: stats json must be parseable
  const r43 = await call(c, "novada_session_stats", { format: "json" });
  try {
    const p = JSON.parse(r43?.content?.[0]?.text || "");
    rec("S43_stats_json_parseable", { content: [{ type: "text", text: `OK: status=${p.status}, scope=${p.scope}` }] });
    ALL.push({ id: "S43_check", parseable: true, status: p.status, scope: p.scope });
  } catch {
    rec("S43_stats_json_parseable", { isError: true, content: [{ type: "text", text: "NOT PARSEABLE" }] });
    ALL.push({ id: "S43_check", parseable: false });
  }

  // S44: feedback json must be parseable
  const r44 = await call(c, "novada_search_feedback", { search_id: "json-out", query: "t", rating: "good", format: "json" });
  try {
    const p = JSON.parse(r44?.content?.[0]?.text || "");
    rec("S44_feedback_json_parseable", { content: [{ type: "text", text: `OK: status=${p.status}` }] });
    ALL.push({ id: "S44_check", parseable: true, status: p.status });
  } catch {
    rec("S44_feedback_json_parseable", { isError: true, content: [{ type: "text", text: "NOT PARSEABLE" }] });
    ALL.push({ id: "S44_check", parseable: false });
  }

  await c.close();
}

// GROUP 8: agent_instruction in error path
async function g8() {
  const { t, c } = mkClient(); await c.connect(t);

  // S45: feedback zod error should have agent_instruction
  const r45 = await call(c, "novada_search_feedback", { search_id: "err", query: "q" }); // no rating
  const text45 = r45?.content?.[0]?.text || "";
  const has_ai = text45.includes("agent_instruction") || text45.includes("Fix the parameter");
  rec("S45_zod_error_agent_instruction", r45);
  ALL.push({ id: "S45_check", has_agent_instruction: has_ai, text_slice: text45.slice(0, 200) });

  // S46: stats zod error
  const r46 = await call(c, "novada_session_stats", { recent_limit: -5 });
  rec("S46_stats_zod_error", r46);
  ALL.push({ id: "S46_check", isError: r46.isError, text: r46?.content?.[0]?.text?.slice(0, 200) });

  // S47: session_stats auth-free (should work with dummy key, no auth needed)
  // The index.ts handles session_stats BEFORE the API key gate
  const r47 = await call(c, "novada_session_stats", { format: "json" });
  const text47 = r47?.content?.[0]?.text || "";
  const is_auth_error = text47.includes("INVALID_API_KEY") || text47.includes("NOVADA_API_KEY is not set");
  rec("S47_stats_auth_free", { content: [{ type: "text", text: `is_auth_error: ${is_auth_error}` }], isError: is_auth_error });
  ALL.push({ id: "S47_check", is_auth_error, pass: !is_auth_error });

  // S48: search_feedback auth-free (should work with dummy key)
  const r48 = await call(c, "novada_search_feedback", { search_id: "authtest", query: "t", rating: "good", format: "json" });
  const text48 = r48?.content?.[0]?.text || "";
  const is_auth_error48 = text48.includes("INVALID_API_KEY") || text48.includes("NOVADA_API_KEY is not set");
  rec("S48_feedback_auth_free", { content: [{ type: "text", text: `is_auth_error: ${is_auth_error48}` }], isError: is_auth_error48 });
  ALL.push({ id: "S48_check", is_auth_error: is_auth_error48, pass: !is_auth_error48 });

  await c.close();
}

// GROUP 9: recent_calls order and ring-buffer behavior
async function g9() {
  const { t, c } = mkClient(); await c.connect(t);

  // Make 5 feedback calls with distinct search_ids, then check recent order
  for (let i = 0; i < 5; i++) {
    await call(c, "novada_search_feedback", { search_id: `order-${i}`, query: `q${i}`, rating: "good" });
  }
  const rStats = await call(c, "novada_session_stats", { format: "json", recent_limit: 10 });
  let statsSnap = {};
  try { statsSnap = JSON.parse(rStats?.content?.[0]?.text || "{}"); } catch {}
  rec("S49_recent_calls_order", rStats);
  // recent_calls should be newest first per the implementation (.slice(-N).reverse())
  const recent = statsSnap.recent_calls || [];
  console.log(">>> recent_calls tools:", recent.map(r => r.tool));
  ALL.push({ id: "S49_recent_order", recent_tools: recent.map(r => r.tool) });

  await c.close();
}

// RUN ALL GROUPS
await g1();
await g2();
await g3();
await g4();
await g5();
await g6();
await g7();
await g8();
await g9();

console.log("\n\n=== FINAL SUMMARY ===");
for (const r of ALL) {
  if (r.pass !== undefined) {
    console.log(`${r.id}: ${r.pass ? "PASS" : "FAIL"} ${JSON.stringify(r).slice(0, 200)}`);
  }
}

import { writeFileSync, mkdirSync } from "fs";
mkdirSync("/tmp/novada-qa-0.9.0", { recursive: true });
writeFileSync("/tmp/novada-qa-0.9.0/conc-feedback-raw.json", JSON.stringify(ALL, null, 2));
console.log("Raw results written to /tmp/novada-qa-0.9.0/conc-feedback-raw.json");
