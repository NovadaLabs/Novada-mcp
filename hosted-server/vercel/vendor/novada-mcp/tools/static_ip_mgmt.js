// Wraps static ISP IP management endpoints on api-m.novada.com (developer-api):
//   POST /v1/static_house/open   — purchase new static IPs
//   POST /v1/static_house/renew  — renew existing static IPs
//   POST /v1/static_house/export — export filtered IP list
//   POST /v1/static_house/list   — list static IPs with filters + pagination
//
// Combined into ONE tool with an `action` discriminator.
// "open" and "renew" are WRITE actions — gated behind the shared
// APPROVAL-TOKEN flow (F2-2/G-7 fix, 2026-09): first call (no
// `approval_token`) returns a preview + a signed, expiring, payload-bound
// token; only a second call carrying that exact token AND the exact same
// parameters executes. `confirm: true` alone is a deprecated no-op — see
// ../utils/approval.ts.
//
// "reveal_credentials" (owner decision 2026-11-01, option A) is a READ-ONLY
// action gated behind the SAME approval-token flow — not because it mutates
// anything, but because once real dial credentials are displayed in a chat
// transcript they may persist in the AI client's own history, so a human
// must see a masked preview and explicitly approve before they are shown.
// See the handler below for the full design note.
//
// 2026-11-01 FOLLOW-UP (independent security review, finding HIGH-1): the
// approval_token round-trips through the AGENT (it's a plain string the tool
// hands back and the agent echoes on the next call) — a prompt-injected or
// careless agent can simply make BOTH calls itself, back to back, with no
// human in the loop at all. On the LOCAL stdio server, when the connected
// MCP CLIENT advertises the `elicitation` capability, "reveal_credentials"
// now uses REAL MCP elicitation (server -> client -> human, a channel the
// agent cannot answer on its own behalf) as the confirmation instead of the
// approval_token round-trip — see handleRevealCredentials below and
// ElicitConfirmFn. The approval_token flow remains, UNCHANGED, as the
// fallback for clients that don't support elicitation, and is the ONLY
// mechanism available on the hosted endpoint (mcp.novada.com is stateless
// Streamable HTTP — a fresh Server+transport per HTTP request, closed again
// before any reply could arrive — so a server-initiated request that needs a
// later client reply cannot complete there; see reports/
// static-ip-reveal-credentials-2026-11-01.md for the evidence).
//
// "open"/"renew" are REFUSED at the action level on the hosted endpoint
// (mcp.novada.com) — see assertActionAvailableOnRuntime() below — before
// either the approval gate or any upstream call runs. "list"/"export"/
// "reveal_credentials" are available on every runtime.
//
// Field names match the API spec (docs/novada-api/static-isp-proxies.md).
import { z } from "zod";
import { devApiPost, maskCredentials, staticHouseStatusTotal } from "../_core/developer_api.js";
import { evaluateApprovalGate } from "../utils/approval.js";
import { isHostedEnvironment } from "../config.js";
import { NovadaError, NovadaErrorCode } from "../_core/errors.js";
// ─── Constants ───────────────────────────────────────────────────────────────
const ACTIONS = ["open", "renew", "export", "list", "reveal_credentials"];
const IP_TYPES = ["normal", "premium"];
const DURATIONS = ["week", "month"];
const IP_TYPE_LABELS = {
    normal: "Standard ISP IP",
    premium: "Premium ISP IP",
};
const DURATION_LABELS = {
    week: "1 week",
    month: "1 month",
};
// ─── Schema & Types ──────────────────────────────────────────────────────────
export const StaticIpMgmtParamsSchema = z
    .object({
    action: z
        .enum(ACTIONS)
        .describe('Action to perform. "open" = purchase new static IPs (WRITE, requires approval_token; local MCP server only). "renew" = renew existing IPs (WRITE, requires approval_token; local MCP server only). "export" = export filtered IP list (masked credentials). "list" = list static IPs with pagination (masked credentials). "reveal_credentials" = show REAL dial username/password for filtered IPs (requires approval_token; only use when the human explicitly asked for them).'),
    // ── "open" action fields ──────────────────────────────────────────────
    ip_type: z
        .enum(IP_TYPES)
        .optional()
        .describe('Required for "open". IP type: "normal" (Standard) or "premium" (Premium).'),
    region: z
        .string()
        // SECURITY (L3 review): flows into the HTTP request body — allowlist chars.
        .regex(/^[a-zA-Z0-9_-]{1,64}$/)
        .optional()
        .describe('Required for "open". Area/region code. Also optional filter for "list" and "export".'),
    duration: z
        .enum(DURATIONS)
        .optional()
        .describe('Required for "open" and "renew". Activation/renewal period: "week" or "month".'),
    num: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Required for "open". Number of static IPs to activate.'),
    // ── "renew" action fields ─────────────────────────────────────────────
    renew_ip_list: z
        .string()
        // SECURITY (L3 review): flows into the HTTP request body — restrict to IP list chars (digits, dots, commas).
        .regex(/^[\d.,]+$/)
        .optional()
        .describe('Required for "renew". Comma-separated list of IPs to renew.'),
    // ── "list" action fields ──────────────────────────────────────────────
    page: z
        .number()
        .int()
        .positive()
        .default(1)
        .describe('Page number for "list" action. Default 1.'),
    limit: z
        .number()
        .int()
        .positive()
        .max(200)
        .default(50)
        .describe('Entries per page for "list" action. Default 50, max 200.'),
    // ── Shared filter fields (list + export) ──────────────────────────────
    status: z
        .enum(["", "1", "2", "3"])
        .optional()
        .describe('Filter for "list"/"export". Omit to default to "1" (in-use only) — expired/released ' +
        'IPs are counted in a summary line but not returned. Pass "" explicitly for All, "1" ' +
        'for In use, "2" for Expired, or "3" for Released to override the default.'),
    key_word: z
        .string()
        // SECURITY (L3 review): flows into the HTTP request body — bound the length.
        .max(200)
        .optional()
        .describe('Search filter for "list"/"export". Searches remarks, order number, or IP.'),
    is_auto_renew: z
        .number()
        .int()
        .optional()
        .describe('Auto-renew filter for "list"/"export". 1=Yes, -1=No.'),
    // ── Confirm gate (deprecated flag; see approval_token below) ──────────
    confirm: z
        .literal(true)
        .optional()
        .describe('DEPRECATED — ignored. Setting this alone no longer authorizes "open"/"renew"/"reveal_credentials" execution (closed 2026-09, finding F2-2: an agent could self-supply confirm:true with no prior human-reviewed preview, including a PURCHASE — see F2-eval R9). Use approval_token instead: call once WITHOUT approval_token to receive a preview and a token, then call again with the identical parameters plus approval_token.'),
    approval_token: z
        .string()
        .min(1)
        .optional()
        .describe('Two-step approval token, required to execute "open"/"renew"/"reveal_credentials". Omit on the first call to receive a preview + a fresh approval_token (valid 10 minutes). Re-call with the EXACT SAME parameters plus this field set to that token to execute. Never invent a value — an invented or stale token is rejected.'),
})
    .strict();
export function validateStaticIpMgmtParams(args) {
    return StaticIpMgmtParamsSchema.parse(args ?? {});
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
function assertDefined(value, field, action) {
    if (value === undefined) {
        throw new Error(`"${field}" is required for action "${action}".`);
    }
    return value;
}
function optionalField(key, value) {
    return value !== undefined ? { [key]: value } : {};
}
function resolveStatus(status) {
    return status === undefined
        ? { effectiveStatus: "1", defaulted: true }
        : { effectiveStatus: status, defaulted: false };
}
/** Human summary line for the IPs hidden by the status default, or undefined when there's nothing to report. */
function buildStatusSummary(expiredCount, releasedCount) {
    const parts = [];
    if (expiredCount !== undefined)
        parts.push(`${expiredCount} expired`);
    if (releasedCount !== undefined)
        parts.push(`${releasedCount} released`);
    if (parts.length === 0)
        return undefined;
    return (`${parts.join(", ")} static IP(s) not shown (status defaulted to "1"=in-use). ` +
        `Call again with status:"2" for expired, status:"3" for released, or status:"" for all.`);
}
/** Shared note appended to list/export agent_instruction — the fix for the credential-leak half of the incident. */
const CREDENTIAL_NOTE = "Dial credentials (account/password), if present in the response, are masked. " +
    "Get real credentials from https://dashboard.novada.com.";
// ─── Hosted action-level refusal (2026-11-01, owner decision option A) ──────
//
// novada_static_ip_mgmt as a WHOLE TOOL is no longer HOSTED_HIDDEN (removed
// from hosted-server/vercel/api/mcp.ts's HOSTED_HIDDEN set so "list"/"export"/
// "reveal_credentials" — read-only, or gated-but-safe-to-preview — can run on
// mcp.novada.com). "open"/"renew" stay billable, irreversible WRITE actions
// that were never ported to the hosted gateway (no NOVADA_APPROVAL_SECRET
// provisioning story, no purchase-reconciliation story there) — they must
// still be refused on hosted, but now that the TOOL itself is visible, the
// refusal has to happen at the ACTION level, inside the tool, before either
// the approval gate or any upstream call runs (mirrors isBrowserAvailableOnRuntime
// in utils/runtime.ts / browser.ts's own internal runtime gate — tool logic
// has ONE home, per-repo CLAUDE.md, so this is NOT forked into mcp.ts).
//
// Thrown as a NovadaError (not returned as a plain string): mcp.ts's CallTool
// catch block special-cases `error instanceof NovadaError` BEFORE its generic
// substring-matching fallback, so this tool's own agent_instruction survives
// verbatim through redactHostedSecrets() on hosted, and is a complete no-op
// on every other runtime (isHostedEnvironment() is false there, so this never
// throws locally — "open"/"renew" work exactly as before via npx novada-mcp).
function assertActionAvailableOnRuntime(action) {
    if (!isHostedEnvironment())
        return;
    throw new NovadaError({
        code: NovadaErrorCode.PRODUCT_UNAVAILABLE,
        message: `novada_static_ip_mgmt action="${action}" is not available on the hosted Novada MCP endpoint — ` +
            `purchasing/renewing static IPs is a billable write action never ported to the hosted gateway.`,
        agent_instruction: `This write action is unavailable on the hosted endpoint. Install the local MCP server to use it — ` +
            `\`npx novada-mcp\` (npm package "novada-mcp") with your own NOVADA_API_KEY exposes the full tool ` +
            `surface, including action="${action}". 'list', 'export', and 'reveal_credentials' (read-only / ` +
            `approval-gated-but-read-only) remain available on the hosted endpoint.`,
        retryable: false,
    });
}
// ─── reveal_credentials (2026-11-01, owner decision option A) ───────────────
//
// Real static-ISP dial credentials (account/password) are masked everywhere
// by default (maskCredentials, 2026-10-30 incident fix above). A user who
// EXPLICITLY asks for them (e.g. to configure their own static IPs into
// AdsPower or another proxy-aware tool) can get them through this READ-ONLY
// action — gated behind the SAME two-step approval_token flow as the WRITE
// actions above, not because it mutates anything, but because once real
// credentials are displayed in a chat transcript they may be retained in the
// AI client's own history, so a human must see a masked preview and
// explicitly approve before they are shown.
//
// Filters are identical to "list" (status/region/key_word/page/limit/
// is_auto_renew; same resolveStatus() default-to-"1" behavior). `limit` is
// additionally clamped to REVEAL_CREDENTIALS_LIMIT_CAP regardless of what the
// caller requests — it defaults to the same 50 as "list", so this only
// clamps an explicit caller-requested limit above the cap — and the response
// says so when it does (limit_capped_to field + agent_instruction note).
//
// The approval gate binds the ENTIRE parsed-params object (minus
// approval_token/confirm — see evaluateApprovalGate) as its canonical
// payload, so status/region/key_word/page/limit are ALL part of what the
// token authorizes: widening any of them between the preview and the execute
// call (e.g. asking for a narrow preview then a broader reveal) invalidates
// the token automatically — no extra bookkeeping needed here, verified by
// static_ip_mgmt.test.ts.
const REVEAL_CREDENTIALS_LIMIT_CAP = 50;
/** Preview-safe projection — IP/port/region/expiry ONLY, never account/password. */
function toPreviewRow(row) {
    return { ip: row.ip, port: row.port, region: row.region, expire_time: row.expire_time };
}
/**
 * Real-credential row: {ip, port, region, expire_time, username, password}
 * plus two ready-to-paste formats, built ONLY from fields the API actually
 * returned — never invents a protocol/port static_house/list doesn't return
 * (it returns exactly one ip+port pair; no socks5 variant is documented or
 * observed, so only the generic colon-delimited and http:// forms are built).
 */
function toCredentialRow(row) {
    const { ip, port } = row;
    const username = row.account;
    const password = row.password;
    const out = {
        ip,
        port,
        region: row.region,
        expire_time: row.expire_time,
        username,
        password,
    };
    const haveIpPort = (typeof ip === "string" || typeof ip === "number")
        && (typeof port === "string" || typeof port === "number");
    const haveCreds = typeof username === "string" && username.length > 0
        && typeof password === "string" && password.length > 0;
    if (haveIpPort && haveCreds) {
        out.dial_string = `${ip}:${port}:${username}:${password}`;
        out.proxy_url = `http://${username}:${password}@${ip}:${port}`;
    }
    return out;
}
/** Human-facing elicitation confirmation message — built once, used for the ONE elicitInput call. */
function buildElicitMessage(count, capNote) {
    return (`Reveal the REAL proxy username and password for ${count} static ISP IP(s)? ` +
        "These credentials will be shown in this conversation and may be retained in the AI client's " +
        "own chat history. Only approve this if you explicitly asked to see or export these credentials " +
        "(e.g. to configure them in another tool)." + capNote);
}
/** Non-throwing "no credentials were shown" response for a declined/cancelled/failed elicitation. */
function buildDeclinedResponse(decision) {
    const reason = decision === "decline"
        ? "The human user declined to reveal credentials."
        : decision === "cancel"
            ? "The confirmation was cancelled before a decision was made."
            : "The confirmation could not be completed (the MCP client's elicitation call failed).";
    return JSON.stringify({
        status: "declined",
        action: "static_ip_reveal_credentials",
        decision,
        reason,
        agent_instruction: "No credentials were revealed. Do not retry automatically — only re-run this tool if the human " +
            "user explicitly asks again to see the credentials.",
    }, null, 2);
}
async function handleRevealCredentials(params, apiKey, elicitConfirm) {
    const { effectiveStatus } = resolveStatus(params.status);
    const requestedLimit = params.limit;
    const limitCapped = requestedLimit > REVEAL_CREDENTIALS_LIMIT_CAP;
    const effectiveLimit = Math.min(requestedLimit, REVEAL_CREDENTIALS_LIMIT_CAP);
    const body = {
        page: params.page,
        limit: effectiveLimit,
        status: effectiveStatus,
        ...optionalField("region", params.region),
        ...optionalField("key_word", params.key_word),
        ...optionalField("is_auto_renew", params.is_auto_renew),
    };
    const capNote = limitCapped
        ? ` Limit capped to ${REVEAL_CREDENTIALS_LIMIT_CAP} for a credential-revealing call (requested ${requestedLimit}).`
        : "";
    // ── Elicitation path (2026-11-01 follow-up, HIGH-1) ────────────────────────
    // When the connected MCP client supports elicitation, it is the ONLY
    // confirmation mechanism for this action — the approval_token flow is
    // completely bypassed (not merely "also accepted"): `params.approval_token`
    // is never read here, so an agent cannot pre-mint or replay a token to skip
    // the human-in-the-loop step. The human's answer comes back through
    // elicitConfirm (server -> MCP client -> human -> client -> server), a
    // channel the agent itself cannot answer on its own behalf. One upstream
    // call fetches the data needed for both the elicitation message AND (on
    // accept) the actual credential rows — no second agent-initiated call is
    // needed or possible.
    if (elicitConfirm) {
        const rawData = await devApiPost("/v1/static_house/list", body, { apiKey });
        const rows = Array.isArray(rawData?.list) ? rawData.list : [];
        const count = typeof rawData?.total === "number" ? rawData.total : rows.length;
        let decision;
        try {
            decision = await elicitConfirm(buildElicitMessage(count, capNote));
        }
        catch {
            // Fail closed: any failure of the elicitation round-trip (client
            // disconnected, malformed reply, transport error) means NO credentials
            // are shown — identical outcome to an explicit decline/cancel.
            decision = "error";
        }
        if (decision !== "accept") {
            return buildDeclinedResponse(decision);
        }
        return JSON.stringify({
            status: "ok",
            action: "static_ip_reveal_credentials",
            count,
            rows: rows.map(toCredentialRow),
            ...(limitCapped ? { limit_capped_to: REVEAL_CREDENTIALS_LIMIT_CAP } : {}),
            agent_instruction: "Real dial credentials for the filtered static ISP IPs. Show the user only what they asked for — do " +
                "not repeat credentials unnecessarily in later turns. Each row includes a ready-to-paste `dial_string` " +
                "(ip:port:username:password) and `proxy_url` (http://username:password@ip:port) when the API returned " +
                "a complete credential pair. Real credentials are also always available at https://dashboard.novada.com." +
                capNote,
        }, null, 2);
    }
    // ── Fallback: two-step approval_token flow (unchanged) ─────────────────────
    // Used whenever elicitConfirm is undefined — no connected client (hosted
    // endpoint, always), or a local client that didn't advertise elicitation.
    const revealGate = evaluateApprovalGate(params, "static_ip_reveal_credentials", "novada_static_ip_mgmt");
    if (!revealGate.authorized) {
        const rawData = await devApiPost("/v1/static_house/list", body, { apiKey });
        const rows = Array.isArray(rawData?.list) ? rawData.list : [];
        return JSON.stringify({
            status: "confirmation_required",
            action: "static_ip_reveal_credentials",
            preview: {
                count: typeof rawData?.total === "number" ? rawData.total : rows.length,
                rows: rows.map(toPreviewRow),
                ...(limitCapped ? { limit_capped_to: REVEAL_CREDENTIALS_LIMIT_CAP } : {}),
            },
            approval_token: revealGate.approvalToken,
            expires_at: new Date(revealGate.expiresAt).toISOString(),
            expires_in_seconds: revealGate.expiresInSeconds,
            agent_instruction: "This preview shows IP/port/region/expiry only — no credentials yet. Calling again with the EXACT " +
                "SAME parameters plus `approval_token` above will display the REAL proxy username and password for " +
                "these IPs in this conversation, which may be retained in the AI client's own chat history. Only do " +
                "this if the human user explicitly asked to see or export these credentials (e.g. to configure them " +
                "in another tool). `confirm: true` alone does nothing — it is deprecated and ignored." + capNote,
        }, null, 2);
    }
    const rawData = await devApiPost("/v1/static_house/list", body, { apiKey });
    const rows = Array.isArray(rawData?.list) ? rawData.list : [];
    return JSON.stringify({
        status: "ok",
        action: "static_ip_reveal_credentials",
        count: typeof rawData?.total === "number" ? rawData.total : rows.length,
        rows: rows.map(toCredentialRow),
        ...(limitCapped ? { limit_capped_to: REVEAL_CREDENTIALS_LIMIT_CAP } : {}),
        agent_instruction: "Real dial credentials for the filtered static ISP IPs. Show the user only what they asked for — do " +
            "not repeat credentials unnecessarily in later turns. Each row includes a ready-to-paste `dial_string` " +
            "(ip:port:username:password) and `proxy_url` (http://username:password@ip:port) when the API returned " +
            "a complete credential pair. Real credentials are also always available at https://dashboard.novada.com." +
            capNote,
    }, null, 2);
}
// ─── Handler ─────────────────────────────────────────────────────────────────
/**
 * Unified static ISP IP management tool.
 *
 * "open" and "renew" are WRITE actions gated behind a valid `approval_token`
 * (see ../utils/approval.ts) and refused outright on the hosted endpoint
 * (see assertActionAvailableOnRuntime above). "reveal_credentials" is a
 * READ-ONLY action confirmed either via live MCP elicitation (when
 * `elicitConfirm` is supplied — local stdio clients that advertise the
 * capability) or, as a fallback, the same `approval_token` flow as the WRITE
 * actions (shows real dial credentials on the execute call only). "list" and
 * "export" are read-only and ungated.
 *
 * `elicitConfirm` is `undefined` on every runtime/client that doesn't support
 * elicitation (including the hosted endpoint, always — see the 2026-11-01
 * follow-up note at the top of this file) and is otherwise built by the
 * caller (index.ts) from the live MCP Server's negotiated client
 * capabilities. Only "reveal_credentials" reads it; every other action
 * ignores it.
 */
export async function novadaStaticIpMgmt(params, apiKey, elicitConfirm) {
    switch (params.action) {
        case "open":
            return handleOpen(params, apiKey);
        case "renew":
            return handleRenew(params, apiKey);
        case "export":
            return handleExport(params, apiKey);
        case "list":
            return handleList(params, apiKey);
        case "reveal_credentials":
            return handleRevealCredentials(params, apiKey, elicitConfirm);
    }
}
// ── open ─────────────────────────────────────────────────────────────────────
async function handleOpen(params, apiKey) {
    assertActionAvailableOnRuntime("open");
    const ip_type = assertDefined(params.ip_type, "ip_type", "open");
    const region = assertDefined(params.region, "region", "open");
    const duration = assertDefined(params.duration, "duration", "open");
    const num = assertDefined(params.num, "num", "open");
    const openGate = evaluateApprovalGate(params, "static_ip_open", "novada_static_ip_mgmt");
    if (!openGate.authorized) {
        return JSON.stringify({
            status: "confirmation_required",
            action: "static_ip_open",
            preview: {
                ip_type,
                ip_type_label: IP_TYPE_LABELS[ip_type],
                region,
                duration,
                duration_label: DURATION_LABELS[duration],
                num,
            },
            approval_token: openGate.approvalToken,
            expires_at: new Date(openGate.expiresAt).toISOString(),
            expires_in_seconds: openGate.expiresInSeconds,
            agent_instruction: "This is a WRITE action that purchases static ISP IPs on the user's Novada account. Show the preview (IP type, region, duration, quantity) to the human user. To execute, call again with the EXACT SAME parameters plus `approval_token` set to the value above (valid 10 minutes). `confirm: true` alone does nothing — it is deprecated and ignored.",
        }, null, 2);
    }
    const body = { ip_type, region, duration, num };
    const data = maskCredentials(await devApiPost("/v1/static_house/open", body, { apiKey }));
    return JSON.stringify({
        status: "opened",
        data,
        agent_instruction: "Static IPs purchased. Use novada_static_ip_mgmt with action='list' to confirm they appear.",
    }, null, 2);
}
// ── renew ────────────────────────────────────────────────────────────────────
async function handleRenew(params, apiKey) {
    assertActionAvailableOnRuntime("renew");
    const renew_ip_list = assertDefined(params.renew_ip_list, "renew_ip_list", "renew");
    const duration = assertDefined(params.duration, "duration", "renew");
    const renewGate = evaluateApprovalGate(params, "static_ip_renew", "novada_static_ip_mgmt");
    if (!renewGate.authorized) {
        const ipCount = renew_ip_list.split(",").filter(Boolean).length;
        return JSON.stringify({
            status: "confirmation_required",
            action: "static_ip_renew",
            preview: {
                renew_ip_list,
                ip_count: ipCount,
                duration,
                duration_label: DURATION_LABELS[duration],
            },
            approval_token: renewGate.approvalToken,
            expires_at: new Date(renewGate.expiresAt).toISOString(),
            expires_in_seconds: renewGate.expiresInSeconds,
            agent_instruction: "This is a WRITE action that renews static ISP IPs on the user's Novada account. Show the preview (IP list, count, duration) to the human user. To execute, call again with the EXACT SAME parameters plus `approval_token` set to the value above (valid 10 minutes). `confirm: true` alone does nothing — it is deprecated and ignored.",
        }, null, 2);
    }
    const body = { renew_ip_list, duration };
    const data = maskCredentials(await devApiPost("/v1/static_house/renew", body, { apiKey }));
    return JSON.stringify({
        status: "renewed",
        data,
        agent_instruction: "Static IPs renewed. Use novada_static_ip_mgmt with action='list' to verify updated expiry dates.",
    }, null, 2);
}
// ── export ───────────────────────────────────────────────────────────────────
async function handleExport(params, apiKey) {
    const { effectiveStatus, defaulted } = resolveStatus(params.status);
    const body = {
        status: effectiveStatus,
        ...optionalField("region", params.region),
        ...optionalField("key_word", params.key_word),
        ...optionalField("is_auto_renew", params.is_auto_renew),
    };
    const [rawData, expiredCount, releasedCount] = await Promise.all([
        devApiPost("/v1/static_house/export", body, { apiKey }),
        defaulted ? staticHouseStatusTotal("2", apiKey) : Promise.resolve(undefined),
        defaulted ? staticHouseStatusTotal("3", apiKey) : Promise.resolve(undefined),
    ]);
    const data = maskCredentials(rawData);
    const summary = defaulted ? buildStatusSummary(expiredCount, releasedCount) : undefined;
    return JSON.stringify({
        status: "ok",
        data,
        ...(summary ? { summary } : {}),
        agent_instruction: `Export of static ISP IPs returned${defaulted ? ' (status defaulted to "1"=in-use)' : ""}. ` +
            `Data includes all IPs matching the applied filters. ${CREDENTIAL_NOTE}`,
    }, null, 2);
}
// ── list ─────────────────────────────────────────────────────────────────────
async function handleList(params, apiKey) {
    const { effectiveStatus, defaulted } = resolveStatus(params.status);
    const body = {
        page: params.page,
        limit: params.limit,
        status: effectiveStatus,
        ...optionalField("region", params.region),
        ...optionalField("key_word", params.key_word),
        ...optionalField("is_auto_renew", params.is_auto_renew),
    };
    const [rawData, expiredCount, releasedCount] = await Promise.all([
        devApiPost("/v1/static_house/list", body, { apiKey }),
        defaulted ? staticHouseStatusTotal("2", apiKey) : Promise.resolve(undefined),
        defaulted ? staticHouseStatusTotal("3", apiKey) : Promise.resolve(undefined),
    ]);
    const data = maskCredentials(rawData);
    const summary = defaulted ? buildStatusSummary(expiredCount, releasedCount) : undefined;
    return JSON.stringify({
        status: "ok",
        data,
        ...(summary ? { summary } : {}),
        agent_instruction: `Paginated list of static ISP IPs${defaulted ? ' (status defaulted to "1"=in-use)' : ""}. ` +
            `Use 'export' action for a full unfiltered dump. Use 'open' to purchase new IPs or 'renew' ` +
            `to extend existing ones. ${CREDENTIAL_NOTE}`,
    }, null, 2);
}
//# sourceMappingURL=static_ip_mgmt.js.map