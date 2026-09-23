import { ZodError } from "zod";
// ─── Error Codes ─────────────────────────────────────────────────────────────
export var NovadaErrorCode;
(function (NovadaErrorCode) {
    NovadaErrorCode["INVALID_API_KEY"] = "INVALID_API_KEY";
    NovadaErrorCode["RATE_LIMITED"] = "RATE_LIMITED";
    NovadaErrorCode["URL_UNREACHABLE"] = "URL_UNREACHABLE";
    NovadaErrorCode["SPA_NO_URLS_FOUND"] = "SPA_NO_URLS_FOUND";
    NovadaErrorCode["API_DOWN"] = "API_DOWN";
    NovadaErrorCode["WRONG_TARGET"] = "WRONG_TARGET";
    NovadaErrorCode["INVALID_PARAMS"] = "INVALID_PARAMS";
    NovadaErrorCode["PRODUCT_UNAVAILABLE"] = "PRODUCT_UNAVAILABLE";
    /** B1 (2026-09-21): upstream business code 11004 ("Insufficient balance") —
     *  the product IS active but its ledger has no funds. Distinct from
     *  PRODUCT_UNAVAILABLE (not activated / not provisioned): the fix is a
     *  top-up, not activation. Permanent + non-retryable: retrying cannot
     *  succeed until the ledger is funded. Mirrors the proxy preflight's
     *  reference shape (proxy_preflight.ts assertFlowLedgerActive). */
    NovadaErrorCode["INSUFFICIENT_BALANCE"] = "INSUFFICIENT_BALANCE";
    NovadaErrorCode["TASK_NOT_FOUND"] = "TASK_NOT_FOUND";
    NovadaErrorCode["TASK_PENDING"] = "TASK_PENDING";
    NovadaErrorCode["SESSION_EXPIRED"] = "SESSION_EXPIRED";
    NovadaErrorCode["PROXY_AUTH_FAILURE"] = "PROXY_AUTH_FAILURE";
    /** F15 (2026-09-10 audit): the fetch succeeded but OUR readability/Turndown parse
     *  pass crashed on the page's markup (e.g. amazon.com/dp/B0CX23V2ZK → raw
     *  "TypeError: … reading 'parentNode'"). Permanent for this page+parser — retrying
     *  the same call re-runs the same crashing parser; format="html" bypasses it. */
    NovadaErrorCode["PARSE_FAILED"] = "PARSE_FAILED";
    NovadaErrorCode["UNKNOWN"] = "UNKNOWN";
})(NovadaErrorCode || (NovadaErrorCode = {}));
const FAILURE_CLASS = {
    [NovadaErrorCode.INVALID_API_KEY]: "auth",
    [NovadaErrorCode.RATE_LIMITED]: "quota",
    [NovadaErrorCode.URL_UNREACHABLE]: "transient",
    [NovadaErrorCode.SPA_NO_URLS_FOUND]: "permanent",
    [NovadaErrorCode.API_DOWN]: "transient",
    [NovadaErrorCode.WRONG_TARGET]: "permanent",
    [NovadaErrorCode.INVALID_PARAMS]: "permanent",
    [NovadaErrorCode.PRODUCT_UNAVAILABLE]: "permanent",
    // "permanent" (not "quota") deliberately: matches the proxy preflight's
    // PRODUCT_UNAVAILABLE reference shape so a balance failure classifies
    // identically no matter which tool surfaced it (the B1 class invariant).
    [NovadaErrorCode.INSUFFICIENT_BALANCE]: "permanent",
    [NovadaErrorCode.TASK_NOT_FOUND]: "permanent",
    [NovadaErrorCode.TASK_PENDING]: "transient",
    [NovadaErrorCode.SESSION_EXPIRED]: "permanent",
    [NovadaErrorCode.PROXY_AUTH_FAILURE]: "auth",
    [NovadaErrorCode.PARSE_FAILED]: "permanent",
    [NovadaErrorCode.UNKNOWN]: "permanent",
};
const RETRY_AFTER_MS = {
    [NovadaErrorCode.RATE_LIMITED]: 30000,
    [NovadaErrorCode.URL_UNREACHABLE]: 10000,
    [NovadaErrorCode.API_DOWN]: 30000,
    [NovadaErrorCode.TASK_PENDING]: 5000,
};
// ─── Error Class ─────────────────────────────────────────────────────────────
export class NovadaError extends Error {
    code;
    agent_instruction;
    retryable;
    /** Optional short reason supplied by callers for INVALID_PARAMS detail. */
    detail;
    /**
     * Raw upstream business `code` from a developer-api envelope (e.g. `11009` =
     * "product not provisioned" for flow-balance endpoints), when known. Lets
     * callers classify on the STRUCTURED code instead of parsing `message` —
     * see plan_balance_all.ts's `isUnavailable` check, which keys off this field
     * (plus the pre-existing HTTP-404 message literal) instead of guessing from
     * upstream prose that can vary per endpoint/locale.
     */
    businessCode;
    constructor(opts) {
        super(opts.message);
        this.name = "NovadaError";
        this.code = opts.code;
        this.agent_instruction = opts.agent_instruction;
        this.retryable = opts.retryable;
        this.detail = opts.detail;
        this.businessCode = opts.businessCode;
    }
    /** Formats the error as an agent-readable string with failure classification. */
    toAgentString() {
        // Sanitize: collapse newlines (ALL Unicode line-terminator variants — see
        // ANY_LINE_TERMINATORS_RE's comment) to prevent agent_instruction injection.
        // P0 SECURITY (#2): redact any leaked credentials/internal hosts from the message
        // (a raw upstream string can carry user:pass@host or an internal *.novada.com host).
        const safeMsg = redactSecrets(this.message).replace(ANY_LINE_TERMINATORS_RE, " ").trim();
        const failureClass = FAILURE_CLASS[this.code];
        const retryAfter = RETRY_AFTER_MS[this.code];
        const lines = [
            `Error [${this.code}]: ${safeMsg}`,
            `failure_class: ${failureClass}`,
            `retry_recommended: ${this.retryable}`,
            ...(this.retryable && retryAfter ? [`retry_after_ms: ${retryAfter}`] : []),
            `agent_instruction: "${this.agent_instruction}"`,
        ];
        if (this.detail) {
            lines.push(`detail: "${redactSecrets(this.detail)}"`);
        }
        // Defense in depth: redact the fully-assembled output so no secret can slip
        // through via any field (agent_instruction templates are static, but cheap insurance).
        return redactSecrets(lines.join("\n"));
    }
}
// ─── AggregateError Summarization ────────────────────────────────────────────
/** Max number of distinct causes surfaced from an AggregateError summary. */
const AGGREGATE_CAUSE_LIMIT = 3;
/** Max length (chars) of each individual cause snippet in an aggregate-error summary. */
const AGGREGATE_CAUSE_MAX_CHARS = 120;
/**
 * FIX-A (2026-07-30, agent-first extract error path): `Promise.any()` escalation
 * ladders (e.g. extract.ts's direct-fetch-vs-proxy race) reject with a bare
 * `AggregateError` whose default `.message` is the literal string
 * "All promises were rejected" — an implementation detail with zero actionable
 * content for an agent (live field report: extracting cell.com surfaced this raw
 * string verbatim and the caller guessed "可能是限流" out of nowhere).
 *
 * This maps that AggregateError to a summary of its DISTINCT underlying causes
 * (first `AGGREGATE_CAUSE_LIMIT`, each truncated to `AGGREGATE_CAUSE_MAX_CHARS`
 * chars) so the caller has something to act on instead of nothing.
 *
 * Defensive by design (Worker Done-Definition #1 — a cause-summarizer that itself
 * throws must never mask the original error): every step is wrapped so any failure
 * here degrades to `null`, letting the caller fall back to the untouched original
 * error message.
 */
export function summarizeAggregateError(err) {
    try {
        const isAggregate = (typeof AggregateError !== "undefined" && err instanceof AggregateError) ||
            (typeof err === "object" && err !== null && "errors" in err && Array.isArray(err.errors));
        if (!isAggregate)
            return null;
        const rawErrors = err.errors;
        if (!Array.isArray(rawErrors) || rawErrors.length === 0)
            return null;
        const toCause = (e) => {
            const s = e instanceof Error ? e.message : String(e);
            const oneLine = s.replace(ANY_LINE_TERMINATORS_RE, " ").trim();
            return oneLine.length > AGGREGATE_CAUSE_MAX_CHARS
                ? oneLine.slice(0, AGGREGATE_CAUSE_MAX_CHARS - 1) + "…"
                : oneLine;
        };
        const seen = new Set();
        const causes = [];
        for (const e of rawErrors) {
            const cause = toCause(e);
            if (cause && !seen.has(cause)) {
                seen.add(cause);
                causes.push(cause);
                if (causes.length >= AGGREGATE_CAUSE_LIMIT)
                    break;
            }
        }
        if (causes.length === 0)
            return null;
        const message = `All ${rawErrors.length} fetch strategies failed: ${causes.join("; ")}`;
        return { message, causes };
    }
    catch {
        return null;
    }
}
// ─── agent_instruction Templates ─────────────────────────────────────────────
const INSTRUCTIONS = {
    [NovadaErrorCode.INVALID_API_KEY]: `\
Your API key is missing or invalid. Do not retry until the key is fixed.

Setup (one-time):
  claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp

Verify the key is active:
  Call novada_account section="summary" — it will confirm which products are accessible.

Get a key: https://dashboard.novada.com/api-key/`,
    [NovadaErrorCode.RATE_LIMITED]: `\
You have hit the Novada API rate limit. This is temporary and retryable.

Action: Wait 30–60 seconds before retrying this tool call.
Strategy: Use exponential backoff for automated retries (delay doubles each attempt).
Avoid: Parallel calls to the same endpoint — serialize them instead.`,
    [NovadaErrorCode.URL_UNREACHABLE]: `\
The target URL could not be reached. This may be temporary.

Action: Verify the URL is publicly accessible (not localhost, not behind auth, not a PDF redirect).
Retry: Yes — try once more after a 10-second wait.
Alternative: Use novada_extract with render="render" (or render="browser") if the URL is protected by anti-bot measures.`,
    [NovadaErrorCode.SPA_NO_URLS_FOUND]: `\
This site appears to be a JavaScript SPA — static crawling found no URLs.
Do not retry novada_map. Recommended next steps:
1. Use novada_crawl with render="render" to crawl JS-rendered pages.
2. Use novada_extract with render="render" (or format="html") to fetch rendered content directly.
3. Use novada_search with "site:<hostname>" to find indexed subpages.`,
    [NovadaErrorCode.API_DOWN]: `\
The Novada backend couldn't complete this request. This is on Novada's side — not your request, your parameters, or your API key.

Action: Retry ONCE. If it fails again, this data source is temporarily under maintenance (a known backend issue we're actively fixing) — stop retrying, it won't succeed by trying harder.
Meanwhile: to read a page directly, use novada_extract on the URL; for a web query, use novada_search or novada_research.
Status: https://status.novada.com · Still down after a while? support@novada.com.`,
    [NovadaErrorCode.WRONG_TARGET]: `\
The backend returned data for a DIFFERENT item than you requested — a data-integrity mismatch on Novada's side, not a problem with your request.

Action: Do NOT use these records. Do NOT blindly retry — a retry may return the same wrong item.
Alternative: read the exact target directly with novada_extract on the URL.
This has been logged for the Novada team to investigate.`,
    [NovadaErrorCode.INVALID_PARAMS]: `\
One or more parameters are invalid. Correct them and retry.

Common issues:
1. Invalid URL — must start with http:// or https:// (no localhost, no private IPs)
2. Missing required param — check the tool's input schema for required fields
3. Wrong enum value — e.g., render must be 'auto' | 'static' | 'render' | 'browser'
4. Out of range — e.g., num_results must be 1–20; depth must be 1–5
5. String too long — e.g., search query must be < 500 chars

Action: Review the tool description and parameter constraints, then retry.`,
    [NovadaErrorCode.PRODUCT_UNAVAILABLE]: `\
This Novada product is not active on your API key. Three options:

Option 1 — Activate (recommended):
  Visit: https://dashboard.novada.com/overview/products/
  Enable the required product, then retry.

Option 2 — Use an alternative tool:
  novada_search unavailable? Try: novada_research (uses internal search)
  novada_scrape unavailable? Try: novada_extract on the target URL directly
  novada_extract blocked by anti-bot? Try: render="browser" (or novada_browser with navigate action)

Option 3 — Contact support:
  Email: support@novada.com — include your API key prefix and this error code.`,
    [NovadaErrorCode.INSUFFICIENT_BALANCE]: `\
Your Novada balance for this product's ledger is insufficient — the upstream refused the request. Do NOT retry: this is a billing state, not a transient failure; retrying cannot succeed until the balance is topped up.

Action:
  1. Top up at https://dashboard.novada.com — note that Wallet and Capture are SEPARATE ledgers: novada_search / novada_scrape / render escalation bill the Capture ledger, so a funded Wallet alone does not unblock them.
  2. Verify per-product balances with novada_account(section="plans").
  3. Retry the original call only after the matching ledger shows a positive balance.`,
    [NovadaErrorCode.TASK_NOT_FOUND]: `\
The requested task_id does not exist or has expired.

Action: Use novada_scrape — it runs synchronously and returns results directly, with no task_id to track or poll.
Note: The async submit/status/result flow is no longer required; novada_scrape replaces it.`,
    [NovadaErrorCode.TASK_PENDING]: `\
The operation is still in progress.

Action: Wait 5–15 seconds, then retry the same tool call.
Note: novada_scrape runs synchronously and returns results directly — there is no separate status/result poll step.`,
    [NovadaErrorCode.SESSION_EXPIRED]: `\
The browser session has expired. Create a new session.

Action: Remove the session_id param and call novada_browser again to start a fresh session.
Note: Browser sessions expire after 10 minutes of inactivity.`,
    [NovadaErrorCode.PROXY_AUTH_FAILURE]: `\
Proxy authentication failed. Verify your proxy credentials.

Action:
  1. Check NOVADA_PROXY_USER and NOVADA_PROXY_PASS are correctly set.
  2. Call novada_account section="summary" to confirm proxy credentials are loaded.
  3. Regenerate credentials at https://dashboard.novada.com/overview/proxy/ if expired.`,
    [NovadaErrorCode.PARSE_FAILED]: `\
The page was fetched successfully but its HTML crashed the content parser (readability/markdown pass).
Do not retry the same call — the parser will crash on the same markup again. Changing render mode does not help: the failure is in parsing, not access.

Action: Retry with format="html" to get the raw page HTML (bypasses the parser) and extract what you need from it directly.
Alternative: For catalog platforms (amazon, github, tiktok, ...), use the matching novada_scrape operation for structured data.`,
    [NovadaErrorCode.UNKNOWN]: `\
An unexpected error occurred.

Action: Check the error message above for clues. If it persists, contact support@novada.com with the full error text.`,
};
// ─── Sanitization ────────────────────────────────────────────────────────────
/**
 * Review round 1 (2026-07-30, CRITICAL — live-verified over stdio, and LIVE in
 * prod on mcp.novada.com v0.9.32 today): every newline-handling pattern in this
 * file used to match ONLY `\r`/`\n` (`[\r\n]`). ECMA-262 (11.5) treats FOUR
 * characters as line terminators for `^`/`$` under a regex's `/m` flag: `\n`
 * (U+000A), `\r` (U+000D), U+2028 (LINE SEPARATOR), and U+2029 (PARAGRAPH
 * SEPARATOR). An attacker-controlled string containing a bare U+2028/U+2029
 * followed by `agent_instruction: "..."` sailed straight through every `[\r\n]`
 * pattern below unmodified — while this repo's OWN agent_instruction
 * extraction convention (`/^\s*agent_instruction\s*:\s*(.+)$/im`) DOES treat
 * U+2028/U+2029 as a line boundary in JS.
 *
 * WHO IS ACTUALLY EXPOSED (corrected 2026-07-30 by security review — an earlier
 * draft of this comment cited contract-test.py as a vulnerable consumer, which
 * is WRONG): Python's `re` under `(?im)` treats ONLY bare `\n` as a `^`/`$`
 * boundary — not `\r`, not U+2028/U+2029 — so contract-test.py was never at
 * risk from these variants, and our own harness therefore could not have caught
 * this. The exposed consumers are DOWNSTREAM JS/TS MCP clients (i.e. most real
 * agent runtimes, including the ones we ship this package for), which follow
 * ECMA-262 line-terminator semantics. Do not weaken this collapse on the
 * grounds that "our tests don't need it" — our tests are not the threat model.
 * Net effect: a forged "line" could masquerade as the FIRST line-anchored
 * agent_instruction match, ahead of the real one appended after it.
 *
 * Realistic exploit path (not merely theoretical): an agent scrapes an
 * untrusted page, passes a URL/param sourced from that page into a tool call,
 * the tool's error path echoes that string back (as scrape.ts, extract error
 * paths, and the resources/index.ts fix above all do) — the page's author now
 * controls a fake "agent_instruction:" line that lands in the calling agent's
 * context ahead of the genuine one.
 *
 * Fix: every pattern that used to test/replace `[\r\n]` (or a bare `\n`) now
 * uses this shared, named Unicode-aware line-terminator class instead of a
 * private ad-hoc regex — one definition, so a future newline-handling addition
 * to this file can reuse it correctly instead of re-introducing the ASCII-only
 * gap.
 */
// Exported (not just module-local) so any OTHER file that sanitizes untrusted
// text before it can reach a trust boundary reuses the SAME character class
// instead of re-defining its own ASCII-only one (see verify.ts's sanitizeClaim
// for the sibling fix that reuses this).
export const LINE_TERMINATOR_CHARS = "\\r\\n\\u2028\\u2029";
/** Matches ANY run of Unicode line-terminator characters (see comment above). */
const ANY_LINE_TERMINATORS_RE = new RegExp(`[${LINE_TERMINATOR_CHARS}]+`, "g");
/** Matches a single Unicode line terminator immediately before a markdown heading marker (`#`..`######`). */
const HEADING_INJECTION_RE = new RegExp(`[${LINE_TERMINATOR_CHARS}]\\s*#{1,6}\\s`, "g");
/** Matches a single Unicode line terminator immediately before the literal `agent_instruction:` token — the exact injection this sanitizer exists to defeat. */
const AGENT_INSTRUCTION_INJECTION_RE = new RegExp(`[${LINE_TERMINATOR_CHARS}]\\s*agent_instruction\\s*:`, "gi");
/**
 * Public Novada hosts that are safe to surface in error text. Any other
 * `*.novada.com` subdomain is treated as an internal endpoint (e.g. the
 * Browser API CDP host `upg-scbr2.novada.com`) and redacted.
 */
const PUBLIC_NOVADA_HOSTS = new Set([
    "novada.com",
    "www.novada.com",
    "dashboard.novada.com",
    "status.novada.com",
    "mcp.novada.com",
    "docs.novada.com",
]);
/**
 * P0 SECURITY (#2): strip secrets that an upstream error can leak in plaintext —
 * URL userinfo (`https://user:pass@host` → `https://host`), the literal
 * NOVADA_BROWSER_WS value, internal `*.novada.com` host strings not on the public
 * allowlist, proxy usernames (Novada format patterns), and local filesystem paths
 * (/Users/…, /home/…). Runs on EVERY error message + agent_instruction before it
 * reaches the caller.
 */
export function redactSecrets(msg) {
    let out = msg;
    // 1. Exact NOVADA_BROWSER_WS value (contains user:pass@host) — redact first,
    //    before host-level rules can partially rewrite it.
    const browserWs = process.env.NOVADA_BROWSER_WS?.trim();
    if (browserWs) {
        out = out.split(browserWs).join("[browser-ws-endpoint]");
    }
    // 2. URL userinfo in any scheme (http/https/ws/wss): strip the `user:pass@`.
    //    https://user:pass@host/x → https://host/x ; wss://u:p@h → wss://h
    out = out.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/@\s:]+(?::[^/@\s]*)?@/gi, "$1");
    // 3. Internal *.novada.com hosts not on the public allowlist → placeholder.
    out = out.replace(/\b(?:[a-z0-9-]+\.)+novada\.com\b/gi, (host) => PUBLIC_NOVADA_HOSTS.has(host.toLowerCase()) ? host : "[novada-internal-host]");
    // 4. Proxy usernames: Novada format patterns like `customer-x-zone-res`,
    //    `user-xyz-zone-isp`, or any `*-zone-(res|isp|mob|dcp|static|dedicated)` token.
    out = out.replace(/\b[a-zA-Z0-9_-]+-zone-(?:res|isp|mob|dcp|static|dedicated)\S*/g, "[proxy-username]");
    // 5. Local filesystem paths: /Users/… and /home/… — strip to avoid leaking
    //    the operator's username or directory structure in error messages.
    out = out.replace(/\/(?:Users|home)\/[^\s"')]+/g, "[local-path]");
    // 6. Prose-format credentials: "Account: value", "Password：value", etc.
    //    Matches both ASCII colon (:) and full-width colon (U+FF1A ：) so that
    //    non-ASCII API error messages (e.g. Chinese proxy responses) are also covered.
    //    Keywords: Account, Password, Passwd, Pwd, User, Username (case-insensitive).
    out = out.replace(/(Account|Password|Passwd|Pwd|User(?:name)?)\s*[:：]\s*\S+/gi, "$1: ***");
    return out;
}
/** Strip API keys, sensitive URL params, and injection patterns from any string before surfacing. */
export function sanitizeServerMsg(msg) {
    const cleaned = msg
        // URL query-param patterns
        .replace(/api_key=[^&\s"')]+/gi, "api_key=***")
        .replace(/apikey=[^&\s"')]+/gi, "apikey=***")
        .replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: Bearer ***")
        .replace(/https?:\/\/scraperapi\.novada\.com[^\s"')]+/gi, "[novada-api-url]")
        // JSON field patterns — strip keys echoed back in response bodies (C-1 fix)
        .replace(/"api_?key"\s*:\s*"[^"]*"/gi, '"api_key":"***"')
        .replace(/"auth(?:orization)?"\s*:\s*"[^"]*"/gi, '"authorization":"***"')
        .replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"***"')
        .replace(/"password"\s*:\s*"[^"]*"/gi, '"password":"***"')
        .replace(/"secret"\s*:\s*"[^"]*"/gi, '"secret":"***"')
        // Strip markdown headings and agent_instruction patterns that could inject trusted-looking
        // content — Unicode-aware (U+2028/U+2029 count too; see ANY_LINE_TERMINATORS_RE's comment).
        .replace(HEADING_INJECTION_RE, " ")
        .replace(AGENT_INSTRUCTION_INJECTION_RE, " [agent_instruction]:")
        .replace(ANY_LINE_TERMINATORS_RE, " ")
        .trim();
    // P0 SECURITY (#2): final credential/host redaction pass — strips URL userinfo,
    // the NOVADA_BROWSER_WS value, and internal *.novada.com hosts that survived above.
    return redactSecrets(cleaned);
}
/** Strip API keys and sensitive URL params from any string before surfacing. */
function sanitizeMessage(msg) {
    return sanitizeServerMsg(msg);
}
// ─── Error Classification ─────────────────────────────────────────────────────
/**
 * Maps raw errors (HTTP responses, network failures, ZodError) to a structured
 * NovadaError with agent_instruction. This is the single entry point for all
 * error handling in the tools layer.
 */
export function classifyError(error) {
    // ZodError — parameter validation failed
    if (error instanceof ZodError) {
        const detail = error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
        return new NovadaError({
            code: NovadaErrorCode.INVALID_PARAMS,
            message: `Parameter validation failed: ${detail}`,
            agent_instruction: INSTRUCTIONS[NovadaErrorCode.INVALID_PARAMS],
            retryable: false,
            detail,
        });
    }
    // Already a NovadaError — pass through
    if (error instanceof NovadaError) {
        return error;
    }
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        // Unknown tool name (core.ts's dispatch() default case). The message
        // itself already lists every valid tool name, class-derived from the
        // live registry (F-5) — give a crisp, specific instruction instead of
        // falling through to the generic UNKNOWN template below.
        if (msg.includes("unknown tool:")) {
            return new NovadaError({
                code: NovadaErrorCode.INVALID_PARAMS,
                message: sanitizeMessage(error.message),
                agent_instruction: "The tool name is wrong. Call novada_discover to see every valid tool name, " +
                    "or pick one from the 'Available:' list already in this error's message, then retry.",
                retryable: false,
            });
        }
        // Auth failures
        if (msg.includes("401") || msg.includes("api_key") || msg.includes("unauthorized") || msg.includes("invalid_api_key")) {
            return new NovadaError({
                code: NovadaErrorCode.INVALID_API_KEY,
                message: "Invalid or missing API key. Get one at https://novada.com",
                agent_instruction: INSTRUCTIONS[NovadaErrorCode.INVALID_API_KEY],
                retryable: false,
            });
        }
        // Rate limiting
        if (msg.includes("429") || (msg.includes("rate") && msg.includes("limit"))) {
            return new NovadaError({
                code: NovadaErrorCode.RATE_LIMITED,
                message: "Rate limit exceeded. API is throttling your requests.",
                agent_instruction: INSTRUCTIONS[NovadaErrorCode.RATE_LIMITED],
                retryable: true,
            });
        }
        // Product not activated (Novada-specific codes surfaced in error messages)
        if (msg.includes("11006") || msg.includes("product_unavailable") || msg.includes("not activated") || msg.includes("402")) {
            return new NovadaError({
                code: NovadaErrorCode.PRODUCT_UNAVAILABLE,
                message: "Product not activated on your account.",
                agent_instruction: INSTRUCTIONS[NovadaErrorCode.PRODUCT_UNAVAILABLE],
                retryable: false,
            });
        }
        // Task lifecycle errors
        if (msg.includes("task not found") || msg.includes("27404") || msg.includes("task_not_found")) {
            return new NovadaError({
                code: NovadaErrorCode.TASK_NOT_FOUND,
                message: "Task not found or expired.",
                agent_instruction: INSTRUCTIONS[NovadaErrorCode.TASK_NOT_FOUND],
                retryable: false,
            });
        }
        if (msg.includes("27202") || msg.includes("task_pending") || msg.includes("still processing")) {
            return new NovadaError({
                code: NovadaErrorCode.TASK_PENDING,
                message: "Task is still processing.",
                agent_instruction: INSTRUCTIONS[NovadaErrorCode.TASK_PENDING],
                retryable: true,
            });
        }
        // Session expired
        if (msg.includes("session_expired") || msg.includes("session not found") || msg.includes("session expired")) {
            return new NovadaError({
                code: NovadaErrorCode.SESSION_EXPIRED,
                message: "Browser session has expired.",
                agent_instruction: INSTRUCTIONS[NovadaErrorCode.SESSION_EXPIRED],
                retryable: false,
            });
        }
        // Proxy auth failure. "authorizationerror" / "account or password verification failed" (Fix C;
        // phrase narrowed 2026-09-21 correctness gate — the bare "account or password" substring
        // false-positived on benign page prose and MCP selector params, so it must be the full
        // gateway phrase; the real CDP error still matches via BOTH this phrase and "authorizationerror".
        // 2026-09-21): the Novada Browser API gateway rejects bad CDP credentials
        // with "AuthorizationError: Account or Password verification failed" — on a
        // CAPABLE runtime that is a genuine credential failure and must classify
        // here (this block runs BEFORE the connectovercdp/API_DOWN block below, so
        // the auth signal wins over the generic CDP-transport match). The
        // serverless transport FALSE-positive that used to produce the same string
        // never reaches classifyError anymore — browser.ts's runtime guard returns
        // before attempting the connection.
        if (msg.includes("407") ||
            msg.includes("proxy_auth") ||
            msg.includes("proxy authentication") ||
            msg.includes("authorizationerror") ||
            msg.includes("account or password verification failed")) {
            return new NovadaError({
                code: NovadaErrorCode.PROXY_AUTH_FAILURE,
                message: "Proxy authentication failed.",
                agent_instruction: INSTRUCTIONS[NovadaErrorCode.PROXY_AUTH_FAILURE],
                retryable: false,
            });
        }
        // Anti-bot wall (#14): map raw Playwright/CDP/Cloudflare strings to a clear
        // category instead of surfacing internal page text. Goes BEFORE generic
        // network handling so "Just a moment" / 403 challenges aren't misread.
        if (msg.includes("cf-challenge") ||
            msg.includes("cf-turnstile") ||
            msg.includes("cf_chl_opt") ||
            msg.includes("just a moment") ||
            msg.includes("access denied") ||
            msg.includes("captcha") ||
            (msg.includes("403") && (msg.includes("forbidden") || msg.includes("blocked")))) {
            return new NovadaError({
                code: NovadaErrorCode.URL_UNREACHABLE,
                message: "Blocked by anti-bot protection (Cloudflare/CAPTCHA challenge).",
                agent_instruction: INSTRUCTIONS[NovadaErrorCode.URL_UNREACHABLE],
                retryable: true,
            });
        }
        // Upstream browser unavailable (#14): CDP/Playwright connection failures —
        // dead WS endpoint, target closed, protocol error. These are an upstream
        // browser-service problem, not a bad URL.
        if (msg.includes("connectovercdp") ||
            msg.includes("browser api connection failed") ||
            msg.includes("target closed") ||
            msg.includes("target page, context or browser has been closed") ||
            msg.includes("browser has been closed") ||
            msg.includes("websocket") ||
            msg.includes("protocol error") ||
            msg.includes("browser.newcontext")) {
            return new NovadaError({
                code: NovadaErrorCode.API_DOWN,
                message: "Upstream browser unavailable — the cloud browser could not be reached or the session was closed.",
                agent_instruction: INSTRUCTIONS[NovadaErrorCode.API_DOWN],
                retryable: true,
            });
        }
        // Network / URL unreachable (domain unreachable)
        if (msg.includes("timeout") ||
            msg.includes("timed out") ||
            msg.includes("econnrefused") ||
            msg.includes("enotfound") ||
            msg.includes("eai_again") ||
            msg.includes("err_name_not_resolved") ||
            msg.includes("network error") ||
            msg.includes("failed to fetch") ||
            msg.includes("net::err")) {
            return new NovadaError({
                code: NovadaErrorCode.URL_UNREACHABLE,
                message: `Domain unreachable: ${sanitizeMessage(error.message)}`,
                agent_instruction: INSTRUCTIONS[NovadaErrorCode.URL_UNREACHABLE],
                retryable: true,
            });
        }
        // API down (5xx)
        if (msg.includes("503") || msg.includes("502") || msg.includes("500") || msg.includes("api_down")) {
            return new NovadaError({
                code: NovadaErrorCode.API_DOWN,
                message: "Novada API is temporarily unavailable.",
                agent_instruction: INSTRUCTIONS[NovadaErrorCode.API_DOWN],
                retryable: true,
            });
        }
    }
    // Fallback
    const rawMsg = error instanceof Error ? error.message : String(error);
    return new NovadaError({
        code: NovadaErrorCode.UNKNOWN,
        message: sanitizeMessage(rawMsg),
        agent_instruction: INSTRUCTIONS[NovadaErrorCode.UNKNOWN],
        retryable: false,
    });
}
// ─── Upstream business-code classification (B1, 2026-09-21) ──────────────────
//
// THE upstream-envelope `code` → taxonomy table — the single source of truth
// for every tool whose generic fallback used to `throw new Error(...)` on a
// non-zero envelope code (scrape.ts submit + download poll, search.ts submit,
// browser_flow.ts). Before this table, `code 11004` ("Insufficient balance")
// was classified THREE different ways: UNKNOWN/"contact support" (scrape),
// transient/retryable (search), and a plain formatted string (browser_flow) —
// while the proxy preflight correctly refused with PRODUCT_UNAVAILABLE +
// ledger evidence + a top-up instruction (the reference shape).
//
// CLASS-shaped on purpose: a future upstream code is a new ROW here — never a
// new branch in a tool file. Rows are ONLY codes whose meaning is verified
// GLOBALLY consistent across endpoints (each row cites its evidence).
//
// Deliberately EXCLUDED (endpoint-ambiguous — the same number means different
// things per endpoint, so a global row would misclassify somewhere):
//   10000 — browser_flow: auth failure; scrape download poll: "result not yet
//           available" (keep polling).
//   10001 — search submit: invalid/missing API key; scrape submit: missing
//           required params; scrape download poll: file-type limitation.
//   11008 — scrape submit: unknown platform (scrape.ts handles it locally with
//           a scrape-specific message BEFORE consulting this table).
// Endpoint-specific codes stay handled at their call site, BEFORE the shared
// fallback consults this table.
export const BUSINESS_CODE_MAP = [
    // Live-confirmed 2026-09: scraper/search/browser_flow envelopes return
    // {code:11004, msg:"Insufficient balance"} when the funding ledger is empty.
    { code: 11004, error: NovadaErrorCode.INSUFFICIENT_BALANCE, meaning: "Insufficient balance on the product's funding ledger" },
    // scrape.ts submit handler + classifyError's prose pattern both already
    // treated 11006 as not-activated.
    { code: 11006, error: NovadaErrorCode.PRODUCT_UNAVAILABLE, meaning: "Product not activated on this account" },
    // plan_balance_all.ts isNotProvisioned(): 11009 = "Failed to obtain user
    // information" — plan not provisioned (live-captured 2026-08).
    { code: 11009, error: NovadaErrorCode.PRODUCT_UNAVAILABLE, meaning: "Product not provisioned for this account" },
    // scrape.ts + browser_flow.ts errorMessages maps and developer_api.ts's
    // non-retry auth set all agree: 11000 = invalid API key.
    { code: 11000, error: NovadaErrorCode.INVALID_API_KEY, meaning: "Invalid API key" },
    // scrape.ts + search.ts both map 5000x to auth errors returned as HTTP 200.
    { code: 50001, error: NovadaErrorCode.INVALID_API_KEY, meaning: "Scraper API auth error" },
    { code: 50002, error: NovadaErrorCode.INVALID_API_KEY, meaning: "Scraper API auth error" },
    { code: 50003, error: NovadaErrorCode.INVALID_API_KEY, meaning: "Scraper API auth error" },
    // scrape.ts + search.ts both map envelope code 500 to a transient server error.
    { code: 500, error: NovadaErrorCode.API_DOWN, meaning: "Upstream server error" },
];
/**
 * Classify a raw upstream envelope `code` (optionally with its `msg`) through
 * BUSINESS_CODE_MAP. Structural code match wins; the ONLY prose fallback is the
 * insufficient-balance signal (so a balance refusal surfaced under a new/renamed
 * code still lands in the right class instead of UNKNOWN). Returns
 * NovadaErrorCode.UNKNOWN for anything unmapped — callers keep their existing
 * generic fallback for that case, so this function never squashes an
 * endpoint-specific classification that classifyError's prose pass would have
 * produced.
 */
export function classifyBusinessCode(code, msg) {
    const row = BUSINESS_CODE_MAP.find((r) => r.code === code);
    if (row)
        return row.error;
    if (msg && /insufficient\s+balance/i.test(msg))
        return NovadaErrorCode.INSUFFICIENT_BALANCE;
    return NovadaErrorCode.UNKNOWN;
}
/**
 * Creates a NovadaError for a specific code with a custom message.
 * Convenience factory used by tools that detect error codes from API response bodies.
 * `businessCode` optionally preserves the raw upstream developer-api envelope
 * `code` (e.g. 11009) so callers can classify structurally — see NovadaError.businessCode.
 */
export function makeNovadaError(code, message, detail, businessCode) {
    return new NovadaError({
        code,
        message,
        agent_instruction: INSTRUCTIONS[code],
        retryable: [
            NovadaErrorCode.RATE_LIMITED,
            NovadaErrorCode.URL_UNREACHABLE,
            NovadaErrorCode.API_DOWN,
            NovadaErrorCode.TASK_PENDING,
        ].includes(code),
        detail,
        businessCode,
    });
}
//# sourceMappingURL=errors.js.map