/**
 * Behavior telemetry for the Novada hosted MCP gateway.
 *
 * Principles (owner-decided, non-negotiable):
 *   1. METADATA ONLY — arg NAMES (Object.keys), never arg values. The 4-key
 *      `operation` allowlist below (operation/platform/render/format) is the
 *      ONE owner-signed exception (2026-07-23) — closed enum tokens only,
 *      never keyword/url/other free text. See extractOperation().
 *   2. FAIL-OPEN — any error is swallowed; requests are never affected.
 *   3. SIMPLE — one INSERT per event via Supabase REST, no queue.
 *
 * Env vars (dedicated names, never in SERVER_CONSUMPTION_ENV_VARS):
 *   TELEMETRY_SUPABASE_URL — REST endpoint, e.g. https://xxxx.supabase.co
 *   TELEMETRY_SUPABASE_KEY — service_role key (or anon key with INSERT policy)
 *   NOVADA_LOG_IDENTITY_AES_KEY — base64, 32 raw bytes (AES-256). Absent →
 *     hq_identity/key_version are null and the request continues unaffected.
 * If TELEMETRY_SUPABASE_URL/KEY are unset, all calls are no-ops and zero
 * network activity occurs.
 */

import { PLATFORM_SCRAPER_TOOLS } from "../vendor/novada-mcp/tools/platform_scrapers.js";
import { NovadaErrorCode } from "../vendor/novada-mcp/_core/errors.js";
import type { FailureClass } from "../vendor/novada-mcp/_core/errors.js";

// NOTE ON FILE STRUCTURE: the governed product-map / status-bucket / failure-class
// helpers below deliberately live IN THIS FILE rather than as separate sibling
// modules. This repo's tests import "../api/_telemetry.ts" directly via Node's
// built-in TypeScript type-stripping (`node --test`, no bundler) — Node's runtime
// module resolver does NOT remap a "./sibling.js" specifier to a sibling
// "sibling.ts" source file the way the Vercel/esbuild build step does, so a
// cross-.ts-file relative import here would resolve at build time but fail at
// `node --test` time. Every other file in api/ that's directly test-imported
// (_plan.ts, _oauth.ts) follows the same rule: relative imports only reach
// already-compiled vendor `.js` files, never a sibling `.ts` source. Keeping
// these helpers as clearly-delimited sections in one file (rather than actually
// separate modules) preserves that constraint while still keeping each concern
// single-purpose and independently readable.

export type StatusBucket = "success" | "blocked" | "failed" | "pending" | "not_applicable";
export type RejectionStage = "pre_auth" | "rate_limited" | "cap_blocked" | "tool_filtered" | "dispatched";
export type AuthMethod = "path" | "query" | "bearer";
export type PushStatus = "pending" | "pushed" | "failed";

// ─── §7: governed TOOL -> PRODUCT static map ──────────────────────────────────
// SINGLE authoritative place a tool name resolves to a product. Deliberately NOT
// a regex/prefix guess against the tool name — a new tool added to the registry
// without a corresponding entry here resolves to `null`, never a silently-wrong
// guess (roundtable doc §2.3 "product": "绝不让下游 regex `tool` 反推（新工具会静默错分）").
//
// Sourced from npm-package/src/tools/registry.ts's TOOL_REGISTRY + core.ts's
// HIDDEN_ALIASES (backward-compat names) — re-grouped into the product taxonomy
// the roundtable defined (Search / Scraper / Unblocker / Browser / Proxy / Meta),
// a DIFFERENT axis than TOOL_REGISTRY's ToolCategory.
//
// D1 (owner-approved 2026-07-23): novada_extract -> Unblocker (not Scraper) — it
// shares Web Unblocker's engine and novada_unblock already maps there.
export type Product = "Search" | "Scraper" | "Unblocker" | "Browser" | "Proxy";

const BASE_TOOL_TO_PRODUCT: Record<string, Product | null> = {
  // ─── Search ───────────────────────────────────────────────────────────────
  novada_search: "Search",
  novada_search_feedback: "Search",
  novada_research: "Search",
  // PENDING owner — §7 待定 (2026-07-23): may split into its own product line;
  // rows tagged Search until decided.
  novada_verify: "Search",

  // ─── Scraper ──────────────────────────────────────────────────────────────
  // (the 15 novada_scrape_<platform> tools are added below, derived from
  // PLATFORM_SCRAPER_TOOLS — not hand-listed here.)
  novada_scrape: "Scraper",
  novada_crawl: "Scraper",
  novada_map: "Scraper",
  novada_site_copy: "Scraper",
  novada_monitor: "Scraper",
  novada_ai_monitor: "Scraper",
  novada_scraper_submit: "Scraper",
  novada_scraper_status: "Scraper",
  novada_scraper_result: "Scraper",
  novada_scraper_task_mgmt: "Scraper",

  // ─── Unblocker (D1) ───────────────────────────────────────────────────────
  novada_extract: "Unblocker",
  novada_unblock: "Unblocker",

  // ─── Browser ──────────────────────────────────────────────────────────────
  novada_browser: "Browser",
  novada_browser_flow: "Browser",

  // ─── Proxy ────────────────────────────────────────────────────────────────
  novada_proxy: "Proxy",
  novada_proxy_residential: "Proxy",
  novada_proxy_isp: "Proxy",
  novada_proxy_datacenter: "Proxy",
  novada_proxy_mobile: "Proxy",
  novada_proxy_static: "Proxy",
  novada_proxy_dedicated: "Proxy",
  novada_proxy_account_create: "Proxy",
  novada_proxy_account_list: "Proxy",
  novada_ip_whitelist: "Proxy",
  novada_static_ip_mgmt: "Proxy",

  // ─── Meta / null — never a single product's usage signal ─────────────────
  novada_account: null,
  novada_health: null,
  novada_health_all: null,
  novada_wallet_balance: null,
  novada_wallet_usage_record: null,
  novada_traffic_daily: null,
  novada_plan_balance_all: null,
  novada_capture_logs: null,
  novada_account_summary: null,
  novada_discover: null,
  novada_setup: null,
  novada_session_stats: null,
  novada_capture_apikey: null,
};

/** All novada_scrape_<platform> tools -> Scraper, derived (never hand-listed) —
 *  a newly added platform config in platform_scrapers.ts needs zero edits here. */
const TOOL_TO_PRODUCT: Record<string, Product | null> = { ...BASE_TOOL_TO_PRODUCT };
for (const t of PLATFORM_SCRAPER_TOOLS) {
  TOOL_TO_PRODUCT[t.toolDefinition.name] = "Scraper";
}

/** Pure lookup — null for any tool absent from the map (never guesses). */
export function resolveProduct(tool: string | null): Product | null {
  if (tool === null) return null;
  return TOOL_TO_PRODUCT[tool] ?? null;
}

// ─── §6: governed status_bucket + failure_class derivation ───────────────────
// SINGLE authoritative place that maps a tool_call `outcome` string (the raw
// internal enum already used throughout mcp.ts — "ok" | a NovadaErrorCode value
// | "cap_blocked" | "TIMEOUT" | "TOOL_NOT_ENABLED" | "NOT_AVAILABLE_ON_HOSTED" |
// "MISSING_TOKEN" | "INVALID_TOKEN" | "GATEWAY_RATE_LIMITED" | "error" | the
// future WS-B "TARGET_BLOCKED") down to the 5-bucket customer-facing status
// domain, and the (non-exported) npm-package error->failure_class table.

/**
 * KEEP IN SYNC with npm-package/src/_core/errors.ts's internal (NOT exported)
 * `FAILURE_CLASS` table. That table is intentionally not exported (a private
 * implementation detail of NovadaError.toAgentString()), so this hosted-server
 * copy exists for the same reason mcp.ts already duplicates FIRST_RUN_NOTICE and
 * redactSecrets() locally: the vendor dir is regenerated at deploy time and is
 * stale between deploys, so importing a would-be export would break the local
 * tsc gate against a stale vendor snapshot.
 */
const FAILURE_CLASS_MIRROR: Record<NovadaErrorCode, FailureClass> = {
  [NovadaErrorCode.INVALID_API_KEY]:     "auth",
  [NovadaErrorCode.RATE_LIMITED]:        "quota",
  [NovadaErrorCode.URL_UNREACHABLE]:     "transient",
  [NovadaErrorCode.SPA_NO_URLS_FOUND]:   "permanent",
  [NovadaErrorCode.API_DOWN]:            "transient",
  [NovadaErrorCode.WRONG_TARGET]:        "permanent",
  [NovadaErrorCode.INVALID_PARAMS]:      "permanent",
  [NovadaErrorCode.PRODUCT_UNAVAILABLE]: "permanent",
  [NovadaErrorCode.TASK_NOT_FOUND]:      "permanent",
  [NovadaErrorCode.TASK_PENDING]:        "transient",
  [NovadaErrorCode.SESSION_EXPIRED]:     "permanent",
  [NovadaErrorCode.PROXY_AUTH_FAILURE]:  "auth",
  [NovadaErrorCode.UNKNOWN]:             "permanent",
};

/** Pure lookup — null for any code not in the mirror (never throws). */
export function resolveFailureClass(code: NovadaErrorCode | null): FailureClass | null {
  if (code === null) return null;
  return FAILURE_CLASS_MIRROR[code] ?? null;
}

/**
 * Governed outcome -> status_bucket mapping (§6 of the roundtable doc).
 *
 * `gatewayCeilingHit` disambiguates the §6 "structural defect #15/#16": a
 * withWallClock timeout throws the SAME NovadaErrorCode.TASK_PENDING as a
 * genuine scrape poll-pending result, but the two belong in different buckets
 * (gateway timeout = failed; real poll-pending = pending). WS-B (npm-package) is
 * expected to eventually split these into distinct error codes; this flag is the
 * WS-A-only stopgap so the two are never conflated in the meantime.
 *
 * `TARGET_BLOCKED` is WS-B (npm-package) work, not yet emitted by any code path
 * today — included here (owner decision: add 'blocked' as an allowed value,
 * leave unpopulated) so this governed function needs ZERO further edits once
 * npm-package starts throwing it.
 */
export function statusBucket(input: { outcome: string | null; gatewayCeilingHit?: boolean }): StatusBucket {
  const o = input.outcome;
  if (o === "ok") return "success";
  if (o === "TARGET_BLOCKED") return "blocked";
  // TOOL_NOT_ENABLED is a governed extension of §6 (not itself a §6 outcome) —
  // the caller's own ?tools=/?groups= URL filter, distinguished from the
  // architectural NOT_AVAILABLE_ON_HOSTED case via `is_hosted_limitation`.
  if (o === "TOOL_NOT_ENABLED" || o === "NOT_AVAILABLE_ON_HOSTED") return "not_applicable";
  if (o === NovadaErrorCode.TASK_PENDING) return input.gatewayCeilingHit ? "failed" : "pending";
  // Everything else — every other NovadaErrorCode value, "cap_blocked",
  // "GATEWAY_RATE_LIMITED", "MISSING_TOKEN", "INVALID_TOKEN", "TIMEOUT",
  // "INVALID_PARAMS", and a generic "error" — is a customer-visible failure.
  return "failed";
}

/** Row shape matching the mcp_events table. ts is a server default (omitted). */
export interface McpEventRow {
  event_type: "tool_call" | "initialize";
  request_id: string;
  token_hash: string | null;
  plan: string | null;
  client_name: string | null;
  client_version: string | null;
  protocol_version: string | null;
  tool: string | null;
  /** ONLY key names — never values (capped: see ARG_KEYS_MAX_COUNT/ARG_KEY_MAX_CHARS). */
  arg_keys: string[] | null;
  /** HOSTNAME ONLY of the target URL (lowercase, no leading "www.") — never path/query/port/credentials/fragment. */
  target_domain: string | null;
  outcome: string | null;
  latency_ms: number | null;
  charged: boolean | null;
  over_cap_allowed: boolean | null;
  quota_remaining: number | null;
  server_version: string | null;
  region: string | null;
  /** Restored (§2.2) — distribution/auth channel. Always "mcp" today (the only
   *  channel this gateway serves); auth-method detail lives in `auth_method`. */
  channel: string | null;
  /** Kept by design, ALWAYS null (§2.2) — identity resolution is HQ's job, never backfilled here. */
  account_uid: string | null;
  /** Product family, write-time-fixed via the governed TOOL_TO_PRODUCT map — never re-derived downstream. */
  product: string | null;
  /** Customer-visible coarse status (§6): success | blocked | failed | pending | not_applicable. */
  status_bucket: string | null;
  /** NovadaErrorCode enum member ONLY — NEVER a raw error.message (redaction-history: NOV leak). */
  error_code: NovadaErrorCode | null;
  failure_class: FailureClass | null;
  retryable: boolean | null;
  /** pre_auth | rate_limited | cap_blocked | tool_filtered | dispatched. */
  rejection_stage: string | null;
  /** True for "not applicable on hosted" (architectural), false for a caller's own ?tools=/?groups= filter. */
  is_hosted_limitation: boolean | null;
  /** Allowlisted-only capture of args.operation/args.platform/args.render/args.format — see extractOperation(). */
  operation: string | null;
  /** Truncated + control-char-stripped User-Agent header. Never raw IP alongside it. */
  user_agent: string | null;
  auth_method: string | null;
  /** AES-256-GCM(apikey), base64 `nonce:ciphertext:tag`. Null when the AES key env var is absent. */
  hq_identity: string | null;
  key_version: string | null;
  /** True when the row's outcome is our OWN wall-clock ceiling firing (withWallClock), not an upstream signal. */
  gateway_ceiling_hit: boolean | null;
  /** Push-worker-owned — always null/"pending" at INSERT time from this file; a separate worker updates these. */
  pushed_at: string | null;
  push_status: string | null;
}

/** True when both required telemetry env vars are present. */
export function telemetryEnabled(): boolean {
  return !!(process.env.TELEMETRY_SUPABASE_URL && process.env.TELEMETRY_SUPABASE_KEY);
}

// ─── Target-domain extraction (Tier 2, owner-approved) ───────────────────────

/**
 * Find the first URL-shaped candidate in a tool's args, covering the actual
 * param shapes across the URL-taking tools:
 *   • args.url         — extract / crawl / map / site_copy / monitor /
 *                        browser_flow (string; extract batch mode may pass an
 *                        array → FIRST element)
 *   • args.urls        — extract batch alias (array → FIRST element)
 *   • args.params.url  — novada_scrape url-param operations (nested params obj)
 *   • args.actions[].url — novada_browser navigate actions (first with a url)
 * novada_search and other non-URL tools match none of these → null
 * (search queries stay uncollected — Tier 3 pending).
 */
function firstUrlCandidate(args: Record<string, unknown>): unknown {
  const url = args.url;
  if (typeof url === "string") return url;
  if (Array.isArray(url) && url.length > 0) return url[0];
  const urls = args.urls;
  if (Array.isArray(urls) && urls.length > 0) return urls[0];
  const params = args.params;
  if (params && typeof params === "object" && !Array.isArray(params)) {
    const pUrl = (params as Record<string, unknown>).url;
    if (typeof pUrl === "string") return pUrl;
  }
  const actions = args.actions;
  if (Array.isArray(actions)) {
    for (const a of actions) {
      if (a && typeof a === "object" && typeof (a as Record<string, unknown>).url === "string") {
        return (a as Record<string, unknown>).url;
      }
    }
  }
  return null;
}

/**
 * Extract the target HOSTNAME from a tool's args — pure, never throws.
 *
 * Returns the hostname ONLY: lowercase, leading "www." stripped. NEVER the
 * path, query string, port, credentials, or fragment — `new URL().hostname`
 * structurally cannot contain any of those. Batch (url/urls array): FIRST
 * URL's hostname only, by design — one domain signal per event, not a list.
 * Any parse failure, or no URL-shaped param at all → null.
 */
export function extractTargetDomain(args: Record<string, unknown> | null): string | null {
  if (!args) return null;
  const candidate = firstUrlCandidate(args);
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  try {
    const hostname = new URL(candidate).hostname.toLowerCase().replace(/^www\./, "");
    return hostname || null;
  } catch {
    return null;
  }
}

// ─── arg_keys defensive caps ──────────────────────────────────────────────────
// A future tool could accept an object with attacker-controlled key names (or a
// caller could pass a huge object) — cap both dimensions so a names-only leak
// fence can't become a token-budget or storage-abuse vector.
const ARG_KEYS_MAX_COUNT = 40;
const ARG_KEY_MAX_CHARS = 64;

function safeArgKeys(args: Record<string, unknown> | null): string[] {
  if (args === null) return [];
  return Object.keys(args)
    .slice(0, ARG_KEYS_MAX_COUNT)
    .map((k) => (k.length > ARG_KEY_MAX_CHARS ? k.slice(0, ARG_KEY_MAX_CHARS) : k));
}

// ─── tool-name defensive cap ──────────────────────────────────────────────────
// `tool` comes from request.params.name (z.string with no .max() in the vendored
// MCP SDK), so an authenticated caller can supply an arbitrarily large name. Its
// sibling fields (arg_keys/operation/user_agent) are all capped; cap this one too
// so a multi-MB name can't ride into the row, the HQ payload, or the push retry
// loop (storage/egress abuse). Real tool names are ≤ ~30 chars. [audit 2026-07-31 P7]
const TOOL_MAX_CHARS = 64;
function capTool(tool: string | null): string | null {
  if (tool === null) return null;
  return tool.length > TOOL_MAX_CHARS ? tool.slice(0, TOOL_MAX_CHARS) : tool;
}

// ─── `operation` allowlist extraction (owner-signed exception, 2026-07-23) ───
// This is the ONLY place a param VALUE (not just its key name) is captured.
// Scope is deliberately narrow: exactly these 4 top-level keys, each expected to
// hold a short closed-enum token (e.g. "product_by_asin", "amazon.com", "render",
// "json") per the tool's own Zod schema — NEVER keyword/url/other free text.
// Priority order favors the most diagnostic field first when a tool call
// carries more than one (e.g. novada_scrape has both `platform` and `operation`).
const OPERATION_ALLOWLIST_KEYS = ["operation", "platform", "render", "format"] as const;
const OPERATION_MAX_CHARS = 64;
// STRICT ALLOWLIST (not a denylist): the value must FULLY match this shape —
// letters, digits, dot, underscore, hyphen only. Anything else (whitespace,
// `:` `/` `\` `<` `>` `&` quotes, or any other metacharacter) is dropped. This
// closes HTML/script-metacharacter injection into the `operation` column —
// a short enumerated denylist of "bad" characters could never enumerate every
// injection-capable character; an allowlist of "known-safe" characters can.
const OPERATION_VALUE_ALLOWLIST = /^[A-Za-z0-9._-]+$/;

/**
 * Extract ONE allowlisted categorical arg value — pure, never throws.
 * Defensive guards beyond the key allowlist itself: only a non-empty string,
 * capped length, and the value must fully match OPERATION_VALUE_ALLOWLIST — a
 * URL, free-text sentence, or any string containing a non-allowlisted
 * character (whitespace, `:`/`/`/`\`/`<`/`>`/`&`/quotes/etc.) fails this shape
 * check and is dropped (returns null / falls through to the next key), never captured.
 */
export function extractOperation(args: Record<string, unknown> | null): string | null {
  if (!args) return null;
  for (const key of OPERATION_ALLOWLIST_KEYS) {
    const v = args[key];
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (trimmed.length === 0 || trimmed.length > OPERATION_MAX_CHARS) continue;
    if (!OPERATION_VALUE_ALLOWLIST.test(trimmed)) continue;
    return trimmed;
  }
  return null;
}

// ─── User-Agent sanitization ──────────────────────────────────────────────────
// Truncate + strip control characters. Deliberately never paired with raw IP
// (see McpEventRow.account_uid / the roundtable doc §4 privacy redline) — UA
// alone, capped and control-char-stripped, is a much lower fingerprinting/
// injection risk than UA+IP+ts together.
const USER_AGENT_MAX_CHARS = 200;

function sanitizeUserAgent(raw: string | null): string | null {
  if (!raw) return null;
  // eslint-disable-next-line no-control-regex -- deliberately stripping C0/DEL control chars
  const stripped = raw.replace(/[\x00-\x1F\x7F]/g, "").trim();
  if (stripped.length === 0) return null;
  return stripped.length > USER_AGENT_MAX_CHARS ? stripped.slice(0, USER_AGENT_MAX_CHARS) : stripped;
}

// ─── hq_identity: AES-256-GCM(apikey) ─────────────────────────────────────────

const HQ_IDENTITY_KEY_VERSION = "aes-gcm-v1";
const HQ_IDENTITY_NONCE_BYTES = 12;

async function importHqIdentityKey(rawKeyBase64: string): Promise<CryptoKey | null> {
  try {
    const raw = Buffer.from(rawKeyBase64, "base64");
    if (raw.length !== 32) return null; // AES-256-GCM requires exactly 32 key bytes
    return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt"]);
  } catch {
    return null;
  }
}

/**
 * AES-256-GCM(apikey) -> HQ-decryptable identity blob, base64 `nonce:ciphertext:tag`.
 *
 * A FRESH random 12-byte nonce is generated for EVERY call — never reused
 * across rows, even for the same apikey — required for AES-GCM's confidentiality
 * guarantee. Key material comes ONLY from NOVADA_LOG_IDENTITY_AES_KEY (base64,
 * 32 raw bytes); it is NEVER hardcoded, logged, or returned — used purely as
 * opaque key material for one encrypt call. Absent/invalid key -> { null, null }
 * and the caller continues unaffected (fail-open, principle #2 above).
 */
export async function encryptHqIdentity(apiKey: string): Promise<{ hq_identity: string | null; key_version: string | null }> {
  const rawKeyB64 = process.env.NOVADA_LOG_IDENTITY_AES_KEY;
  if (!rawKeyB64) return { hq_identity: null, key_version: null };
  try {
    const key = await importHqIdentityKey(rawKeyB64);
    if (!key) return { hq_identity: null, key_version: null };
    const nonce = new Uint8Array(HQ_IDENTITY_NONCE_BYTES);
    crypto.getRandomValues(nonce);
    const plaintext = new TextEncoder().encode(apiKey);
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext));
    // WebCrypto's AES-GCM appends the 16-byte auth tag to the ciphertext output.
    const tag = encrypted.slice(encrypted.length - 16);
    const ciphertext = encrypted.slice(0, encrypted.length - 16);
    const b64 = (u8: Uint8Array) => Buffer.from(u8).toString("base64");
    return { hq_identity: `${b64(nonce)}:${b64(ciphertext)}:${b64(tag)}`, key_version: HQ_IDENTITY_KEY_VERSION };
  } catch {
    // Fail-open — telemetry must never break a customer request.
    return { hq_identity: null, key_version: null };
  }
}

/**
 * Pure builder for a tool_call event row — no I/O, fully unit-testable.
 *
 * LEAK FENCE: `args` is only used by THREE reducers — Object.keys (names, via
 * safeArgKeys), extractTargetDomain (hostname only), and extractOperation (the
 * one owner-signed 4-key allowlisted value). No other part of `args` is ever
 * read, serialised, or included in the returned row. A test in
 * telemetry.test.mjs proves this for any value shape.
 *
 * `product`, `status_bucket`, and `failure_class` are ALWAYS derived internally
 * from governed, single-authoritative functions (never caller-supplied) so no
 * call site can drift from the canonical mapping. `hq_identity`/`key_version`
 * MUST be supplied by the caller (pre-computed via encryptHqIdentity) because
 * that step is async and this builder is deliberately synchronous/pure.
 */
export function buildToolCallEvent(params: {
  request_id: string;
  token_hash: string | null;
  plan: string | null;
  client_name: string | null;
  client_version: string | null;
  protocol_version: string | null;
  tool: string | null;
  args: Record<string, unknown> | null;
  outcome: string;
  latency_ms: number;
  charged: boolean;
  over_cap_allowed: boolean;
  quota_remaining: number;
  server_version: string | null;
  region: string | null;
  /** From an actual thrown NovadaError's `.code` — null for guard-site rejections
   *  that never construct one (auth/rate-limit/cap/tool-filter gates). */
  error_code?: NovadaErrorCode | null;
  /** From an actual thrown NovadaError's `.retryable` — null when no NovadaError exists. */
  retryable?: boolean | null;
  rejection_stage?: RejectionStage | null;
  is_hosted_limitation?: boolean | null;
  gateway_ceiling_hit?: boolean | null;
  auth_method?: AuthMethod | null;
  /** Raw User-Agent header value — sanitized (truncated + control-stripped) inside this builder. */
  user_agent?: string | null;
  hq_identity?: string | null;
  key_version?: string | null;
}): McpEventRow {
  const errorCode = params.error_code ?? null;
  const cappedTool = capTool(params.tool);
  return {
    event_type: "tool_call",
    request_id: params.request_id,
    token_hash: params.token_hash,
    plan: params.plan,
    client_name: params.client_name,
    client_version: params.client_version,
    protocol_version: params.protocol_version,
    tool: cappedTool,
    arg_keys: safeArgKeys(params.args),
    target_domain: extractTargetDomain(params.args),
    outcome: params.outcome,
    latency_ms: params.latency_ms,
    charged: params.charged,
    over_cap_allowed: params.over_cap_allowed,
    quota_remaining: params.quota_remaining,
    server_version: params.server_version,
    region: params.region,
    channel: "mcp",
    account_uid: null,
    product: resolveProduct(cappedTool),
    status_bucket: statusBucket({ outcome: params.outcome, gatewayCeilingHit: !!params.gateway_ceiling_hit }),
    error_code: errorCode,
    failure_class: resolveFailureClass(errorCode),
    retryable: params.retryable ?? null,
    rejection_stage: params.rejection_stage ?? "dispatched",
    is_hosted_limitation: !!params.is_hosted_limitation,
    operation: extractOperation(params.args),
    user_agent: sanitizeUserAgent(params.user_agent ?? null),
    auth_method: params.auth_method ?? null,
    hq_identity: params.hq_identity ?? null,
    key_version: params.key_version ?? null,
    gateway_ceiling_hit: !!params.gateway_ceiling_hit,
    pushed_at: null,
    push_status: "pending" satisfies PushStatus,
  };
}

/**
 * Pure builder for an initialize event row — emitted from server.oninitialized.
 * client_name / client_version are populated from server.getClientVersion();
 * protocol_version is unavailable via the SDK public API in stateless mode → null.
 */
export function buildInitializeEvent(params: {
  request_id: string;
  token_hash: string | null;
  plan: string | null;
  client_name: string | null;
  client_version: string | null;
  protocol_version: string | null;
  server_version: string | null;
  region: string | null;
  auth_method?: AuthMethod | null;
  user_agent?: string | null;
  hq_identity?: string | null;
  key_version?: string | null;
}): McpEventRow {
  return {
    event_type: "initialize",
    request_id: params.request_id,
    token_hash: params.token_hash,
    plan: params.plan,
    client_name: params.client_name,
    client_version: params.client_version,
    protocol_version: params.protocol_version,
    tool: null,
    arg_keys: null,
    target_domain: null,
    outcome: null,
    latency_ms: null,
    charged: null,
    over_cap_allowed: null,
    quota_remaining: null,
    server_version: params.server_version,
    region: params.region,
    channel: "mcp",
    account_uid: null,
    product: null,
    // oninitialized only fires after a successfully-negotiated handshake — there
    // is no failure path into this builder, so this is a literal, not a lookup.
    status_bucket: "success" satisfies StatusBucket,
    error_code: null,
    failure_class: null,
    retryable: null,
    rejection_stage: null,
    is_hosted_limitation: false,
    operation: null,
    user_agent: sanitizeUserAgent(params.user_agent ?? null),
    auth_method: params.auth_method ?? null,
    hq_identity: params.hq_identity ?? null,
    key_version: params.key_version ?? null,
    gateway_ceiling_hit: false,
    pushed_at: null,
    push_status: "pending" satisfies PushStatus,
  };
}

const TELEMETRY_TIMEOUT_MS = 3_000;

/**
 * Fire-and-forget Supabase INSERT.
 * - No-ops silently when telemetry is disabled (env vars absent).
 * - All errors are swallowed (logged as warn at most).
 * - Hard 3s fetch timeout so a stalled Supabase endpoint never blocks.
 * Called via waitUntil() in mcp.ts so it runs after the response is sent.
 */
export async function emitEvent(row: McpEventRow): Promise<void> {
  if (!telemetryEnabled()) return;
  const url = process.env.TELEMETRY_SUPABASE_URL!;
  const key = process.env.TELEMETRY_SUPABASE_KEY!;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT_MS);
    try {
      const res = await fetch(`${url}/rest/v1/mcp_events`, {
        method: "POST",
        headers: {
          "apikey": key,
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify(row),
        signal: controller.signal,
      });
      // Surface non-2xx so ops can see persistent insert failures in Vercel logs.
      // Status only — never the body (could echo row data); never throw (fail-open).
      if (!res.ok) console.warn("telemetry insert failed", res.status);
    } finally {
      clearTimeout(tid);
    }
  } catch (err) {
    // Deliberately swallowed — telemetry must never surface as a customer error.
    // Warn-only so ops can see persistent failures in Vercel logs without alarming.
    console.warn("[telemetry] emit failed:", err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120));
  }
}
