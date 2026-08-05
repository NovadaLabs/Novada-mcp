export declare enum NovadaErrorCode {
    INVALID_API_KEY = "INVALID_API_KEY",
    RATE_LIMITED = "RATE_LIMITED",
    URL_UNREACHABLE = "URL_UNREACHABLE",
    SPA_NO_URLS_FOUND = "SPA_NO_URLS_FOUND",
    API_DOWN = "API_DOWN",
    WRONG_TARGET = "WRONG_TARGET",
    INVALID_PARAMS = "INVALID_PARAMS",
    PRODUCT_UNAVAILABLE = "PRODUCT_UNAVAILABLE",
    TASK_NOT_FOUND = "TASK_NOT_FOUND",
    TASK_PENDING = "TASK_PENDING",
    SESSION_EXPIRED = "SESSION_EXPIRED",
    PROXY_AUTH_FAILURE = "PROXY_AUTH_FAILURE",
    UNKNOWN = "UNKNOWN"
}
export type FailureClass = "transient" | "permanent" | "auth" | "quota";
export declare class NovadaError extends Error {
    readonly code: NovadaErrorCode;
    readonly agent_instruction: string;
    readonly retryable: boolean;
    /** Optional short reason supplied by callers for INVALID_PARAMS detail. */
    readonly detail?: string;
    constructor(opts: {
        code: NovadaErrorCode;
        message: string;
        agent_instruction: string;
        retryable: boolean;
        detail?: string;
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
/**
 * Creates a NovadaError for a specific code with a custom message.
 * Convenience factory used by tools that detect error codes from API response bodies.
 */
export declare function makeNovadaError(code: NovadaErrorCode, message: string, detail?: string): NovadaError;
//# sourceMappingURL=errors.d.ts.map