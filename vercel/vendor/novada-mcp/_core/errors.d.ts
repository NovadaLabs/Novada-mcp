export declare enum NovadaErrorCode {
    INVALID_API_KEY = "INVALID_API_KEY",
    RATE_LIMITED = "RATE_LIMITED",
    URL_UNREACHABLE = "URL_UNREACHABLE",
    SPA_NO_URLS_FOUND = "SPA_NO_URLS_FOUND",
    API_DOWN = "API_DOWN",
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
 * P0 SECURITY (#2): strip secrets that an upstream error can leak in plaintext —
 * URL userinfo (`https://user:pass@host` → `https://host`), the literal
 * NOVADA_BROWSER_WS value, and internal `*.novada.com` host strings that aren't
 * on the public allowlist. Runs on EVERY error message + agent_instruction
 * before it reaches the caller.
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