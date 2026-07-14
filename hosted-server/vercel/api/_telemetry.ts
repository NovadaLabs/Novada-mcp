/**
 * Behavior telemetry for the Novada hosted MCP gateway.
 *
 * Principles (owner-decided, non-negotiable):
 *   1. METADATA ONLY — arg NAMES (Object.keys), never arg values.
 *   2. FAIL-OPEN — any error is swallowed; requests are never affected.
 *   3. SIMPLE — one INSERT per event via Supabase REST, no queue.
 *
 * Env vars (dedicated names, never in SERVER_CONSUMPTION_ENV_VARS):
 *   TELEMETRY_SUPABASE_URL — REST endpoint, e.g. https://xxxx.supabase.co
 *   TELEMETRY_SUPABASE_KEY — service_role key (or anon key with INSERT policy)
 * If either is unset, all calls are no-ops and zero network activity occurs.
 */

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
  /** ONLY key names — never values. */
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

/**
 * Pure builder for a tool_call event row — no I/O, fully unit-testable.
 *
 * LEAK FENCE: `args` is only used for `Object.keys(args)` — the values
 * are never read, never serialised, never included in the returned row.
 * A test in telemetry.test.mjs proves this for any value shape.
 */
export function buildToolCallEvent(params: {
  request_id: string;
  token_hash: string | null;
  plan: string | null;
  client_name: string | null;
  client_version: string | null;
  protocol_version: string | null;
  tool: string;
  args: Record<string, unknown> | null;
  outcome: string;
  latency_ms: number;
  charged: boolean;
  over_cap_allowed: boolean;
  quota_remaining: number;
  server_version: string | null;
  region: string | null;
}): McpEventRow {
  return {
    event_type: "tool_call",
    request_id: params.request_id,
    token_hash: params.token_hash,
    plan: params.plan,
    client_name: params.client_name,
    client_version: params.client_version,
    protocol_version: params.protocol_version,
    tool: params.tool,
    // METADATA ONLY: args are consumed by exactly two reducers — Object.keys
    // (names) and extractTargetDomain (hostname only). Values never pass through.
    arg_keys: params.args !== null ? Object.keys(params.args) : [],
    target_domain: extractTargetDomain(params.args),
    outcome: params.outcome,
    latency_ms: params.latency_ms,
    charged: params.charged,
    over_cap_allowed: params.over_cap_allowed,
    quota_remaining: params.quota_remaining,
    server_version: params.server_version,
    region: params.region,
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
      await fetch(`${url}/rest/v1/mcp_events`, {
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
    } finally {
      clearTimeout(tid);
    }
  } catch (err) {
    // Deliberately swallowed — telemetry must never surface as a customer error.
    // Warn-only so ops can see persistent failures in Vercel logs without alarming.
    console.warn("[telemetry] emit failed:", err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120));
  }
}
