#!/usr/bin/env node
/**
 * monitoring/dingtalk/checks.mjs
 *
 * The CHECK TABLE: one row per class of signal, each a {id, label, probe,
 * cost, severity} entry (class-not-instance — adding a new probe is a new
 * ROW here, never a new branch in run.mjs). Every `probe` function has the
 * identical signature and return shape so run.mjs, the dedupe state
 * machine (state.mjs), and the daily-report renderer never special-case a
 * specific check by id.
 *
 * Dependency-free (Node >=20 built-in `fetch` only) and fully dependency-
 * injected (`fetchFn`) so checks.test.mjs runs offline against a stub
 * fetch — same pattern as monitoring/lib/mcp-client.mjs and
 * monitoring/report/linear-sync.mjs's `requestFn` injection.
 *
 * Probe contract (every probe, free or billable):
 *   async (ctx) => {
 *     ok: boolean,
 *     latencyMs: number,
 *     errorClass: string|null,   // "network" | "timeout" | "http" | "shape" | "tool" | "rpc" | "config" | "exception" | null
 *     errorCode: string|null,    // NovadaErrorCode (billable tool checks) or a short local code
 *     note: string,              // one-line human-readable summary, safe to print (no secrets)
 *     detail: Record<string, unknown>|null,  // extra structured data (e.g. {version}, {toolCount})
 *   }
 *
 * ctx shape: { mcpUrl, apiKey, fetchFn, timeoutMs, expectedToolCount }
 * `apiKey` is undefined for free checks — probes that need it guard with
 * `if (!ctx.apiKey) return fail(...)` so a misconfigured call site fails
 * loudly instead of silently probing unauthenticated.
 *
 * `timeoutMs` is set PER ROW by CHECK_TABLE (via runChecks — see its own
 * comment) and threaded through ctx into every httpGet/rpcCall this probe
 * makes. A caller invoking a probe directly (as every test in
 * checks.test.mjs does) without going through runChecks gets
 * DEFAULT_TIMEOUT_MS, which is intentionally identical to FREE_CHECK_TIMEOUT_MS.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * 2026-10-23 incident (GitHub Actions run 39935519239): the first real daily
 * run reported `novada_scrape_bing` as FAIL "timeout after 10000ms". Measured
 * directly: the upstream scraper call (scraper.novada.com, Santa Clara) alone
 * takes 6-15s for a Bing/Google SERP — a flat 10s probe timeout produces a
 * false failure on every billable check whose upstream happens to be slow
 * but not actually down.
 *
 * Fix (class, not instance — a timeout COLUMN on CHECK_TABLE, never a
 * per-tool special case): free checks (metadata/discovery against the
 * hosted gateway itself) keep the original short timeout. Billable tool
 * checks dispatch into the SAME hosted Vercel function the server budgets
 * against via npm-package/src/config.ts's HOSTED_FUNCTION_LIMIT_MS (60_000ms
 * — the platform's own hard wall-clock kill) — duplicated here as a named
 * constant (not imported: this file is dependency-free/.mjs and CI's plain
 * `node --test` on Node 20 can't parse config.ts's TypeScript syntax; if
 * that source value ever changes, checks.test.mjs fails until this copy is updated) plus a small margin
 * for our own network/TLS overhead, so the probe can NEVER time out before
 * the hosted server itself would have given up and returned something.
 */
const FREE_CHECK_TIMEOUT_MS = DEFAULT_TIMEOUT_MS; // 10_000 — unchanged behavior for metadata/discovery checks
export const HOSTED_FUNCTION_LIMIT_MS = 60_000; // mirrors npm-package/src/config.ts HOSTED_FUNCTION_LIMIT_MS
const BILLABLE_PROBE_MARGIN_MS = 5_000;
export const BILLABLE_CHECK_TIMEOUT_MS = HOSTED_FUNCTION_LIMIT_MS + BILLABLE_PROBE_MARGIN_MS; // 65_000

/**
 * "慢" (slow) latency budgets — a SEPARATE, lower bar than timeoutMs. A
 * check that completes successfully but blows this budget isn't a failure
 * (it still returned ok:true) but IS worth flagging in the daily report so
 * creeping latency is visible before it becomes an actual timeout. Also a
 * CHECK_TABLE column (class-level: free vs billable), consumed by
 * run.mjs's renderDailyReport, never computed ad hoc per id.
 */
const FREE_SLOW_THRESHOLD_MS = 3_000;
const BILLABLE_SLOW_THRESHOLD_MS = 20_000;

/** True when `err` is this process's OWN probe-side abort — either a manual
 * `AbortController.abort()` (names its error "AbortError", used by
 * httpGet/rpcCall below) or the native `AbortSignal.timeout()` convenience
 * (names its error "TimeoutError", used by probeUnauthenticated401's inline
 * fetch) — verified empirically on Node 24 (both APIs exist since Node 20).
 * Distinct from a DNS/connection-level network failure (ECONNREFUSED,
 * ENOTFOUND, …), which keeps errorClass "network" — see classifyFailure()
 * in run.mjs for why these must never collapse into the same annotation. */
function isTimeoutError(err) {
  return err?.name === "AbortError" || err?.name === "TimeoutError";
}

/** Error code regex matching npm-package/src/_core/errors.ts's
 * `NovadaError.toAgentString()` output: "Error [CODE]: message". This is
 * the ONE place that format is parsed — if that format ever changes, fix
 * it here only. */
const STRUCTURED_ERROR_RE = /^Error \[([A-Z0-9_]+)\]:\s*(.*)$/m;

function ok(latencyMs, note, detail = null) {
  return { ok: true, latencyMs, errorClass: null, errorCode: null, note, detail };
}

function fail(latencyMs, errorClass, errorCode, note, detail = null) {
  return { ok: false, latencyMs, errorClass, errorCode, note, detail };
}

/** The ONE env var name every auth-requiring probe below needs populated
 * into `ctx.apiKey` (wired by run.mjs's main() from process.env). Exported
 * so the workflow-env lint (workflow.test.mjs) and CHECK_TABLE rows both
 * name it from one place, never a repeated string literal. */
export const API_KEY_ENV_VAR = "NOVADA_TEST_KEY";

const MISCONFIGURED_NOTE = `monitor misconfigured: ${API_KEY_ENV_VAR} missing`;

/**
 * Shared guard — every probe that needs `ctx.apiKey` calls this FIRST and
 * returns immediately if it's non-null. Returns a `{errorClass: "config"}`
 * fail (never "network"/"http"/"tool" — the shapes a real product outage
 * produces) when the key is absent, so a monitor wired without its secret
 * can never masquerade as an outage.
 *
 * CRITICAL finding (2026-10-23 review): before this guard existed on
 * `probeInitialize`/`probeToolsList` (it already existed, differently
 * worded, on `probeNovadaSetup`), a CI job missing `NOVADA_TEST_KEY` made
 * every P0 check fail with the SAME shape as a real `mcp.novada.com`
 * outage — run.mjs's runAlertMode() routes "config"-class failures to a
 * distinct, send-ONCE "misconfigured" notice instead of the outage dedupe/
 * heartbeat state machine (see its own comment for why).
 */
function requireApiKey(ctx, label) {
  if (ctx.apiKey) return null;
  return fail(0, "config", null, `${label}: ${MISCONFIGURED_NOTE}`);
}

/**
 * Parse a response body as plain JSON or SSE (`data:` lines) — mirrors
 * monitoring/lib/mcp-client.mjs's parseResponseBody, duplicated here
 * (rather than imported) so this file stays a fully self-contained,
 * independently-testable module with no path-relative import into a
 * sibling monitoring/ directory that might move independently.
 */
function parseMaybeSse(rawText, contentType) {
  const trimmed = rawText.trim();
  if (trimmed === "") throw new Error("empty response body");
  const looksLikeSse = (contentType || "").includes("text/event-stream") || /^(event:|data:|id:|retry:|:)/m.test(trimmed);
  if (!looksLikeSse) return JSON.parse(trimmed);
  const payloads = trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice("data:".length).trim())
    .filter((l) => l.length > 0 && l !== "[DONE]");
  for (let i = payloads.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(payloads[i]);
    } catch {
      /* try the previous data: line */
    }
  }
  throw new Error("SSE response had no parseable data: line");
}

async function httpGet(url, { fetchFn = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetchFn(url, { method: "GET", headers, signal: controller.signal });
    const latencyMs = Date.now() - startedAt;
    const text = await res.text();
    return { httpStatus: res.status, headers: res.headers, text, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const timedOut = isTimeoutError(err);
    return { httpStatus: 0, error: timedOut ? `timeout after ${timeoutMs}ms` : String(err?.message || err), latencyMs, isTimeout: timedOut };
  } finally {
    clearTimeout(timer);
  }
}

async function rpcCall(mcpUrl, method, params, { apiKey, fetchFn = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const res = await fetchFn(mcpUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? {} }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    const httpStatus = res.status;
    const contentType = res.headers.get?.("content-type") || "";
    const rawText = await res.text();
    let parsed = null;
    let parseError = null;
    try {
      parsed = parseMaybeSse(rawText, contentType);
    } catch (err) {
      parseError = err.message;
    }
    return { httpStatus, parsed, parseError, latencyMs, rawText };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const timedOut = isTimeoutError(err);
    return { httpStatus: 0, error: timedOut ? `timeout after ${timeoutMs}ms` : String(err?.message || err), latencyMs, isTimeout: timedOut };
  } finally {
    clearTimeout(timer);
  }
}

// ── Free checks ──────────────────────────────────────────────────────────────

export async function probeInitialize(ctx) {
  const guard = requireApiKey(ctx, "initialize");
  if (guard) return guard;
  const r = await rpcCall(
    ctx.mcpUrl,
    "initialize",
    { protocolVersion: "2026-06-18", capabilities: {}, clientInfo: { name: "dingtalk-health-check", version: "1.0.0" } },
    ctx
  );
  if (r.httpStatus === 0) return fail(r.latencyMs, r.isTimeout ? "timeout" : "network", null, `initialize: ${r.error}`);
  if (r.httpStatus !== 200) return fail(r.latencyMs, "http", null, `initialize: HTTP ${r.httpStatus}`);
  if (r.parseError) return fail(r.latencyMs, "shape", null, `initialize: unparseable response (${r.parseError})`);
  const version = r.parsed?.result?.serverInfo?.version;
  if (!version) return fail(r.latencyMs, "shape", null, "initialize: missing result.serverInfo.version");
  return ok(r.latencyMs, `version ${version}`, { version });
}

export async function probeToolsList(ctx) {
  const guard = requireApiKey(ctx, "tools_list");
  if (guard) return guard;
  const r = await rpcCall(ctx.mcpUrl, "tools/list", {}, ctx);
  if (r.httpStatus === 0) return fail(r.latencyMs, r.isTimeout ? "timeout" : "network", null, `tools/list: ${r.error}`);
  if (r.httpStatus !== 200) return fail(r.latencyMs, "http", null, `tools/list: HTTP ${r.httpStatus}`);
  if (r.parseError) return fail(r.latencyMs, "shape", null, `tools/list: unparseable response (${r.parseError})`);
  const tools = r.parsed?.result?.tools;
  if (!Array.isArray(tools)) return fail(r.latencyMs, "shape", null, "tools/list: missing result.tools array");
  const count = tools.length;
  const expected = ctx.expectedToolCount;
  if (typeof expected === "number" && count !== expected) {
    return fail(r.latencyMs, "shape", null, `tools/list: count ${count} != golden baseline ${expected}`, { count, expected });
  }
  return ok(r.latencyMs, `${count} tools`, { count });
}

export async function probeOAuthDiscovery(ctx) {
  const base = new URL(ctx.mcpUrl);
  const origin = `${base.protocol}//${base.host}`;
  const startedAt = Date.now();

  const pr = await httpGet(`${origin}/.well-known/oauth-protected-resource/mcp`, ctx);
  const as = await httpGet(`${origin}/.well-known/oauth-authorization-server`, ctx);
  const latencyMs = Date.now() - startedAt;

  if (pr.httpStatus === 0) return fail(latencyMs, pr.isTimeout ? "timeout" : "network", null, `oauth-protected-resource: ${pr.error}`);
  if (pr.httpStatus !== 200) return fail(latencyMs, "http", null, `oauth-protected-resource: HTTP ${pr.httpStatus}`);
  if (as.httpStatus === 0) return fail(latencyMs, as.isTimeout ? "timeout" : "network", null, `oauth-authorization-server: ${as.error}`);
  if (as.httpStatus !== 200) return fail(latencyMs, "http", null, `oauth-authorization-server: HTTP ${as.httpStatus}`);

  let prJson, asJson;
  try {
    prJson = JSON.parse(pr.text);
  } catch {
    return fail(latencyMs, "shape", null, "oauth-protected-resource: non-JSON body");
  }
  try {
    asJson = JSON.parse(as.text);
  } catch {
    return fail(latencyMs, "shape", null, "oauth-authorization-server: non-JSON body");
  }

  // RFC 9728 / RFC 8414 required fields this server's own builders set
  // (hosted-server/vercel/api/_oauth.ts buildPrMetadata/buildAsMetadata).
  const prMissing = ["resource", "authorization_servers"].filter((k) => !(k in prJson));
  const asMissing = ["issuer", "authorization_endpoint", "token_endpoint"].filter((k) => !(k in asJson));
  if (prMissing.length > 0 || asMissing.length > 0) {
    return fail(
      latencyMs,
      "shape",
      null,
      `oauth discovery: missing fields pr=[${prMissing.join(",")}] as=[${asMissing.join(",")}]`
    );
  }
  return ok(latencyMs, "both discovery documents present with required fields");
}

export async function probeUnauthenticated401(ctx) {
  // /mcp is POST-only for JSON-RPC in normal use, but the hosted gateway's
  // auth gate runs before method dispatch — a bare unauthenticated POST
  // proves "sign-in entry works" with exactly ONE request (no auxiliary GET
  // needed first — an earlier draft of this probe fired a throwaway GET via
  // httpGet() and discarded its result, doubling live-endpoint traffic for
  // no reason; fixed before this ever shipped).
  const startedAt = Date.now();
  try {
    const res = await (ctx.fetchFn || fetch)(ctx.mcpUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(ctx.timeoutMs || DEFAULT_TIMEOUT_MS) : undefined,
    });
    const latencyMs = Date.now() - startedAt;
    const wwwAuth = res.headers.get?.("www-authenticate") || "";
    if (res.status !== 401) {
      return fail(latencyMs, "http", null, `unauthenticated /mcp: expected 401, got ${res.status}`);
    }
    if (!wwwAuth) {
      return fail(latencyMs, "shape", null, "unauthenticated /mcp: 401 missing WWW-Authenticate header");
    }
    if (!/resource_metadata/i.test(wwwAuth)) {
      return fail(latencyMs, "shape", null, "unauthenticated /mcp: WWW-Authenticate missing resource_metadata");
    }
    return ok(latencyMs, "401 + WWW-Authenticate present (sign-in entry reachable)");
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const timedOut = isTimeoutError(err);
    const msg = timedOut ? `timeout after ${ctx.timeoutMs || DEFAULT_TIMEOUT_MS}ms` : String(err?.message || err);
    return fail(latencyMs, timedOut ? "timeout" : "network", null, `unauthenticated /mcp: ${msg}`);
  }
}

export async function probeNovadaSetup(ctx) {
  const guard = requireApiKey(ctx, "novada_setup");
  if (guard) return guard;
  const r = await rpcCall(ctx.mcpUrl, "tools/call", { name: "novada_setup", arguments: {} }, ctx);
  return interpretToolCallResult(r, "novada_setup");
}

// ── Billable, daily-only checks ──────────────────────────────────────────────

/** Shared interpreter for a `tools/call` response: handles transport, JSON-RPC
 * protocol errors, and the MCP `isError: true` + structured-error-text
 * convention (npm-package/src/_core/errors.ts's toAgentString() format). */
function interpretToolCallResult(r, label) {
  if (r.httpStatus === 0) return fail(r.latencyMs, r.isTimeout ? "timeout" : "network", null, `${label}: ${r.error}`);
  if (r.httpStatus !== 200) return fail(r.latencyMs, "http", null, `${label}: HTTP ${r.httpStatus}`);
  if (r.parseError) return fail(r.latencyMs, "shape", null, `${label}: unparseable response (${r.parseError})`);
  if (r.parsed?.error) {
    return fail(r.latencyMs, "rpc", null, `${label}: JSON-RPC error ${JSON.stringify(r.parsed.error).slice(0, 200)}`);
  }
  const result = r.parsed?.result;
  const text = Array.isArray(result?.content) && result.content[0]?.text ? result.content[0].text : "";
  if (result?.isError === true) {
    const m = STRUCTURED_ERROR_RE.exec(text);
    const code = m ? m[1] : null;
    const msg = m ? m[2] : text.slice(0, 200);
    return fail(r.latencyMs, "tool", code, `${label}: ${code ? `[${code}] ` : ""}${msg}`);
  }
  return ok(r.latencyMs, `${label}: ok`);
}

export async function probeNovadaSearch(ctx) {
  const guard = requireApiKey(ctx, "novada_search");
  if (guard) return guard;
  const r = await rpcCall(ctx.mcpUrl, "tools/call", { name: "novada_search", arguments: { query: "novada mcp health check", num: 1 } }, ctx);
  return interpretToolCallResult(r, "novada_search");
}

export async function probeNovadaExtract(ctx) {
  const guard = requireApiKey(ctx, "novada_extract");
  if (guard) return guard;
  const r = await rpcCall(ctx.mcpUrl, "tools/call", { name: "novada_extract", arguments: { url: "https://example.com" } }, ctx);
  return interpretToolCallResult(r, "novada_extract");
}

export async function probeScrapeGoogle(ctx) {
  const guard = requireApiKey(ctx, "novada_scrape_google");
  if (guard) return guard;
  const r = await rpcCall(
    ctx.mcpUrl,
    "tools/call",
    { name: "novada_scrape_google", arguments: { operation: "web_search", params: { q: "novada mcp" } } },
    ctx
  );
  return interpretToolCallResult(r, "novada_scrape_google");
}

export async function probeScrapeBing(ctx) {
  const guard = requireApiKey(ctx, "novada_scrape_bing");
  if (guard) return guard;
  const r = await rpcCall(
    ctx.mcpUrl,
    "tools/call",
    { name: "novada_scrape_bing", arguments: { operation: "web_search", params: { q: "novada mcp" } } },
    ctx
  );
  return interpretToolCallResult(r, "novada_scrape_bing");
}

export async function probeNovadaAccount(ctx) {
  const guard = requireApiKey(ctx, "novada_account");
  if (guard) return guard;
  const r = await rpcCall(ctx.mcpUrl, "tools/call", { name: "novada_account", arguments: { section: "summary" } }, ctx);
  return interpretToolCallResult(r, "novada_account");
}

/**
 * The CHECK TABLE. `cost: "free"` rows run in both --mode alert and --mode
 * daily; `cost: "billable"` rows run ONLY in --mode daily (see run.mjs).
 * `severity` is this row's class-level severity when it fails — matches the
 * design doc §5.1(b)'s "metadata/initialize/tools/list failures = P0" and
 * §5.1(e)'s "single upstream provider failure = P2, noted as upstream"
 * (e.g. a lone Google SERP failure is expected/known-noisy backend
 * degradation, not a page-worthy MCP-side bug).
 *
 * `label`/`labelZh`: English id/label stay in code (log lines, this file,
 * tests); `labelZh` is what actually goes into a DingTalk message (owner-
 * facing surface) — run.mjs's composers/renderDailyReport read `labelZh`,
 * never `label`, for anything sent to DingTalk (2026-10-23 review finding).
 *
 * `requiredEnvVars`: class-level declaration of which CI secret(s) this
 * check's probe needs populated for it to even attempt a real call (never
 * hardcoded per-id anywhere else — see `requireApiKey()` above and
 * `requiredEnvVarsForCosts()` below, which workflow.test.mjs uses to assert
 * every job in mcp-health-dingtalk.yml actually wires what its mode's rows
 * declare they need — the exact class of gap behind the CRITICAL
 * 2026-10-23 finding, generalized so no FUTURE row can silently repeat it).
 *
 * `timeoutMs`/`slowThresholdMs` (2026-10-23 fix for the first real daily
 * run's false "timeout after 10000ms" FAIL on `novada_scrape_bing` — see
 * this file's constants above for the incident writeup): class-level, by
 * `cost` — every `free` row gets FREE_CHECK_TIMEOUT_MS/
 * FREE_SLOW_THRESHOLD_MS, every `billable` row gets
 * BILLABLE_CHECK_TIMEOUT_MS/BILLABLE_SLOW_THRESHOLD_MS. `runChecks()` below
 * threads `timeoutMs` into each probe's ctx; `slowThresholdMs` is read by
 * run.mjs's renderDailyReport to flag a successful-but-slow check without
 * ever turning it into a false failure.
 */
export const CHECK_TABLE = [
  { id: "initialize", label: "initialize (serverInfo.version)", labelZh: "初始化检查（serverInfo.version）", probe: probeInitialize, cost: "free", severity: "P0", requiredEnvVars: [API_KEY_ENV_VAR], timeoutMs: FREE_CHECK_TIMEOUT_MS, slowThresholdMs: FREE_SLOW_THRESHOLD_MS },
  { id: "tools_list", label: "tools/list (count vs golden baseline)", labelZh: "工具列表检查（对比基线数量）", probe: probeToolsList, cost: "free", severity: "P0", requiredEnvVars: [API_KEY_ENV_VAR], timeoutMs: FREE_CHECK_TIMEOUT_MS, slowThresholdMs: FREE_SLOW_THRESHOLD_MS },
  { id: "oauth_discovery", label: "OAuth discovery (.well-known/*)", labelZh: "OAuth 发现端点检查", probe: probeOAuthDiscovery, cost: "free", severity: "P0", requiredEnvVars: [], timeoutMs: FREE_CHECK_TIMEOUT_MS, slowThresholdMs: FREE_SLOW_THRESHOLD_MS },
  { id: "unauthenticated_401", label: "unauthenticated /mcp -> 401 (sign-in entry)", labelZh: "未授权访问检查（登录入口可达性）", probe: probeUnauthenticated401, cost: "free", severity: "P0", requiredEnvVars: [], timeoutMs: FREE_CHECK_TIMEOUT_MS, slowThresholdMs: FREE_SLOW_THRESHOLD_MS },
  { id: "novada_setup", label: "novada_setup (free tool dispatch)", labelZh: "novada_setup 免费工具调用检查", probe: probeNovadaSetup, cost: "free", severity: "P1", requiredEnvVars: [API_KEY_ENV_VAR], timeoutMs: FREE_CHECK_TIMEOUT_MS, slowThresholdMs: FREE_SLOW_THRESHOLD_MS },
  { id: "novada_search", label: "novada_search", labelZh: "novada_search 工具检查", probe: probeNovadaSearch, cost: "billable", severity: "P1", requiredEnvVars: [API_KEY_ENV_VAR], timeoutMs: BILLABLE_CHECK_TIMEOUT_MS, slowThresholdMs: BILLABLE_SLOW_THRESHOLD_MS },
  { id: "novada_extract", label: "novada_extract (https://example.com)", labelZh: "novada_extract 工具检查", probe: probeNovadaExtract, cost: "billable", severity: "P1", requiredEnvVars: [API_KEY_ENV_VAR], timeoutMs: BILLABLE_CHECK_TIMEOUT_MS, slowThresholdMs: BILLABLE_SLOW_THRESHOLD_MS },
  { id: "novada_scrape_google", label: "novada_scrape_google web_search", labelZh: "novada_scrape_google 工具检查（Google 搜索）", probe: probeScrapeGoogle, cost: "billable", severity: "P2", requiredEnvVars: [API_KEY_ENV_VAR], timeoutMs: BILLABLE_CHECK_TIMEOUT_MS, slowThresholdMs: BILLABLE_SLOW_THRESHOLD_MS },
  { id: "novada_scrape_bing", label: "novada_scrape_bing web_search", labelZh: "novada_scrape_bing 工具检查（Bing 搜索）", probe: probeScrapeBing, cost: "billable", severity: "P2", requiredEnvVars: [API_KEY_ENV_VAR], timeoutMs: BILLABLE_CHECK_TIMEOUT_MS, slowThresholdMs: BILLABLE_SLOW_THRESHOLD_MS },
  { id: "novada_account", label: "novada_account (section=summary)", labelZh: "novada_account 账户信息检查", probe: probeNovadaAccount, cost: "billable", severity: "P1", requiredEnvVars: [API_KEY_ENV_VAR], timeoutMs: BILLABLE_CHECK_TIMEOUT_MS, slowThresholdMs: BILLABLE_SLOW_THRESHOLD_MS },
];

/**
 * Class-level derivation: the set of env var names that must be populated
 * for EVERY row whose `cost` is in `costs` to run as a real check (not a
 * "config" guard fail). Used by workflow.test.mjs to assert each workflow
 * job's `env:` block actually provides what its mode requires — computed
 * from this table, never from a hardcoded per-check-id list, so adding a
 * row with a new `requiredEnvVars` entry is automatically enforced.
 *
 * @param {Array<"free"|"billable">} costs
 * @returns {Set<string>}
 */
export function requiredEnvVarsForCosts(costs) {
  const vars = new Set();
  for (const row of CHECK_TABLE) {
    if (!costs.includes(row.cost)) continue;
    for (const v of row.requiredEnvVars || []) vars.add(v);
  }
  return vars;
}

/**
 * Run every check in the table whose `cost` is in `costs`, in parallel.
 * Never throws — a probe function itself never throws (each wraps its own
 * try/catch internally via rpcCall/httpGet), but this wrapper adds a last-
 * resort catch anyway so one unexpected throw can't abort the whole batch.
 *
 * Each probe is invoked with `row.timeoutMs` (the CHECK_TABLE column, class-
 * level by `cost`) spliced into its ctx, taking priority over any
 * `ctx.timeoutMs` the caller passed in — this is the ONE place the flat
 * 10s-for-everything bug lived (a single `ctx.timeoutMs` set once in
 * run.mjs's main() and reused unchanged for every check, free or billable);
 * fixed by making the per-check budget authoritative here instead.
 *
 * @param {{mcpUrl: string, apiKey?: string, fetchFn?: typeof fetch, timeoutMs?: number, expectedToolCount?: number}} ctx
 * @param {Array<"free"|"billable">} costs
 * @returns {Promise<Array<{id: string, label: string, severity: string, cost: string} & Awaited<ReturnType<typeof probeInitialize>>>>}
 */
export async function runChecks(ctx, costs = ["free"]) {
  const rows = CHECK_TABLE.filter((row) => costs.includes(row.cost));
  const results = await Promise.all(
    rows.map(async (row) => {
      try {
        const rowCtx = { ...ctx, timeoutMs: row.timeoutMs ?? ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS };
        const r = await row.probe(rowCtx);
        return { id: row.id, label: row.label, severity: row.severity, cost: row.cost, ...r };
      } catch (err) {
        return {
          id: row.id,
          label: row.label,
          severity: row.severity,
          cost: row.cost,
          ok: false,
          latencyMs: 0,
          errorClass: "exception",
          errorCode: null,
          note: `probe threw: ${String(err?.message || err)}`,
          detail: null,
        };
      }
    })
  );
  return results;
}
