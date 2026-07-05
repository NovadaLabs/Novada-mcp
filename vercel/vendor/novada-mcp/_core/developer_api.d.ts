export declare const DEVELOPER_API_BASE = "https://api-m.novada.com";
export interface DeveloperApiEnvelope<T = unknown> {
    code?: number;
    msg?: string;
    message?: string;
    data?: T | null;
}
export declare function maskPasswords<T>(value: T, seen?: WeakSet<object>): T;
/** Return the developer-api bearer token. Prefers NOVADA_DEVELOPER_API_KEY; falls back to NOVADA_API_KEY. */
export declare function getDeveloperApiKey(): string;
/**
 * Some Novada developer-api endpoints accept a typo'd field `strat_time` (and
 * matching `end_time`). To stay forward-compatible if/when the typo is fixed,
 * we always emit BOTH `strat_time` and `start_time` when a caller provides a
 * date-range. Server reads whichever it understands; the unused key is ignored.
 */
export declare function withDateRangeCompat<T extends Record<string, unknown>>(body: T, opts: {
    start?: string;
    end?: string;
}): T & Record<string, unknown>;
/**
 * POST to a developer-api endpoint and unwrap the standard `{code, msg, data}`
 * envelope. Body is encoded as `multipart/form-data` (NOT JSON) per the API
 * contract. Throws NovadaError on auth/transport/business failures.
 */
export declare function devApiPost<T = unknown>(path: string, body: Record<string, unknown>, opts?: {
    apiKey?: string;
    timeoutMs?: number;
}): Promise<T>;
/** Run several developer-api calls in parallel and collect per-call outcomes. */
export interface ParallelResult<T> {
    key: string;
    ok: boolean;
    data?: T;
    error?: string;
}
export declare function devApiParallel<T = unknown>(calls: Array<{
    key: string;
    path: string;
    body: Record<string, unknown>;
}>, opts?: {
    apiKey?: string;
    timeoutMs?: number;
}): Promise<ParallelResult<T>[]>;
//# sourceMappingURL=developer_api.d.ts.map