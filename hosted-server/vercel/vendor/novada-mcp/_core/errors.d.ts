export declare enum NovadaErrorCode {
    INVALID_API_KEY = "INVALID_API_KEY",
    RATE_LIMITED = "RATE_LIMITED",
    URL_UNREACHABLE = "URL_UNREACHABLE",
    SPA_NO_URLS_FOUND = "SPA_NO_URLS_FOUND",
    API_DOWN = "API_DOWN",
    WRONG_TARGET = "WRONG_TARGET",
    INVALID_PARAMS = "INVALID_PARAMS",
    PRODUCT_UNAVAILABLE = "PRODUCT_UNAVAILABLE",
    /** B1 (2026-09-21): upstream business code 11004 ("Insufficient balance") —
     *  the product IS active but its ledger has no funds. Distinct from
     *  PRODUCT_UNAVAILABLE (not activated / not provisioned): the fix is a
     *  top-up, not activation. Permanent + non-retryable: retrying cannot
     *  succeed until the ledger is funded. Mirrors the proxy preflight's
     *  reference shape (proxy_preflight.ts assertFlowLedgerActive). */
    INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE",
    TASK_NOT_FOUND = "TASK_NOT_FOUND",
    TASK_PENDING = "TASK_PENDING",
    SESSION_EXPIRED = "SESSION_EXPIRED",
    PROXY_AUTH_FAILURE = "PROXY_AUTH_FAILURE",
    /** F15 (2026-09-10 audit): the fetch succeeded but OUR readability/Turndown parse
     *  pass crashed on the page's markup (e.g. amazon.com/dp/B0CX23V2ZK → raw
     *  "TypeError: … reading 'parentNode'"). Permanent for this page+parser — retrying
     *  the same call re-runs the same crashing parser; format="html" bypasses it. */
    PARSE_FAILED = "PARSE_FAILED",
    /** Round 3 (S1-connector, 2026-10-13): a request that received NO HTTP response at
     *  all before its own client-side deadline elapsed (axios ECONNABORTED / a message
     *  matching /timeout/i) — distinct from API_DOWN (an explicit 5xx/error response WAS
     *  received) and from a generic network failure (DNS/ECONNREFUSED — also API_DOWN).
     *  Transient + retryable: the message names exactly how long the caller waited and,
     *  when a task_id already exists, that resuming with it (not re-submitting) is safe
     *  and does not incur a new charge. */
    TIMEOUT = "TIMEOUT",
    UNKNOWN = "UNKNOWN"
}
export type FailureClass = "transient" | "permanent" | "auth" | "quota";
export declare class NovadaError extends Error {
    readonly code: NovadaErrorCode;
    readonly agent_instruction: string;
    readonly retryable: boolean;
    /** Optional short reason supplied by callers for INVALID_PARAMS detail. */
    readonly detail?: string;
    /**
     * Raw upstream business `code` from a developer-api envelope (e.g. `11009` =
     * "product not provisioned" for flow-balance endpoints), when known. Lets
     * callers classify on the STRUCTURED code instead of parsing `message` —
     * see plan_balance_all.ts's `isUnavailable` check, which keys off this field
     * (plus the pre-existing HTTP-404 message literal) instead of guessing from
     * upstream prose that can vary per endpoint/locale.
     */
    readonly businessCode?: number;
    constructor(opts: {
        code: NovadaErrorCode;
        message: string;
        agent_instruction: string;
        retryable: boolean;
        detail?: string;
        businessCode?: number;
    });
    /** Formats the error as an agent-readable string with failure classification. */
    toAgentString(): string;
}
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
export declare function summarizeAggregateError(err: unknown): {
    message: string;
    causes: string[];
} | null;
export declare const BLOCK_CLASS_STATUSES: ReadonlySet<number>;
export declare const NOT_ESCALATE_STATUSES: ReadonlySet<number>;
/**
 * F2 discriminator: should a static/proxy fetch failure in render="auto" mode
 * escalate to the render (Web Unblocker) tier, or fail as today?
 *
 * - ANY leg's status in BLOCK_CLASS_STATUSES, or any leg matching a block-class
 *   network pattern → escalate (the block might not apply to a different fetch path).
 * - No block-class signal anywhere, and at least one leg's status is in
 *   NOT_ESCALATE_STATUSES (genuinely missing/unauthorized) → do not escalate.
 * - No status at all and no recognized network pattern (unclassified) → do not
 *   escalate, matching today's behavior — this function only ADDS escalation
 *   cases it has positive evidence for, it never removes the existing floor.
 */
export declare function isBlockClassFetchFailure(err: unknown): boolean;
/**
 * Marks `text` as a tool-level failure. Call this at the exact `return`
 * statement a formatter uses to report failure — e.g.
 * `return toolFailure(["## Extract Failed", ...].join("\n"));` — instead of
 * returning the formatted string bare. The dispatch choke point
 * (index.ts/mcp.ts) detects the mark via isToolFailure() and sets
 * isError:true, then strips it via stripToolFailureMark() before the text
 * reaches the caller — the marker itself is never visible to anyone.
 *
 * @param reason  Optional machine-readable tag for a consumer that needs to
 *                know WHY this failed without inspecting the message text
 *                (e.g. "ceiling_timeout"). Retrieved via getToolFailureReason().
 */
export declare function toolFailure(text: string, reason?: string): string;
/** True when `text` was produced by toolFailure() and not yet stripped. */
export declare function isToolFailure(text: unknown): boolean;
/** Removes the toolFailure() mark (and any reason tag), if present. Safe to
 *  call on any string (including one that was never marked) — a no-op in
 *  that case. */
export declare function stripToolFailureMark(text: string): string;
/** The reason tag passed to toolFailure(text, reason), if any — null when the
 *  text is unmarked, or marked with no reason tag. Never inspects the human
 *  message text itself. */
export declare function getToolFailureReason(text: unknown): string | null;
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
export declare const LINE_TERMINATOR_CHARS = "\\r\\n\\u2028\\u2029";
/**
 * P0 SECURITY (#2): strip secrets that an upstream error can leak in plaintext —
 * URL userinfo (`https://user:pass@host` → `https://host`), the literal
 * NOVADA_BROWSER_WS value, internal `*.novada.com` host strings not on the public
 * allowlist, proxy usernames (Novada format patterns), and local filesystem paths
 * (/Users/…, /home/…). Runs on EVERY error message + agent_instruction before it
 * reaches the caller.
 */
export declare function redactSecrets(msg: string): string;
/** Strip API keys, sensitive URL params, and injection patterns from any string before surfacing. */
export declare function sanitizeServerMsg(msg: string): string;
/**
 * Maps raw errors (HTTP responses, network failures, ZodError) to a structured
 * NovadaError with agent_instruction. This is the single entry point for all
 * error handling in the tools layer.
 */
export declare function classifyError(error: unknown): NovadaError;
export declare const BUSINESS_CODE_MAP: ReadonlyArray<{
    code: number;
    error: NovadaErrorCode;
    /** Verified meaning + where it was confirmed. */
    meaning: string;
}>;
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
export declare function classifyBusinessCode(code: number, msg?: string): NovadaErrorCode;
/**
 * Per-platform agent_instruction hint for upstream business code 10000. See the
 * table's doc comment above for the class rule this implements.
 */
export declare function serpCaptureFailedHint(scraperDomain: string): string;
/**
 * Creates a NovadaError for a specific code with a custom message.
 * Convenience factory used by tools that detect error codes from API response bodies.
 * `businessCode` optionally preserves the raw upstream developer-api envelope
 * `code` (e.g. 11009) so callers can classify structurally — see NovadaError.businessCode.
 */
export declare function makeNovadaError(code: NovadaErrorCode, message: string, detail?: string, businessCode?: number): NovadaError;
//# sourceMappingURL=errors.d.ts.map