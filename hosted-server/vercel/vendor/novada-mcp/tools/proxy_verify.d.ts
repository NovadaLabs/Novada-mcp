export interface ProxyVerifyTarget {
    host: string;
    port: number;
    username: string;
    password: string;
}
export interface ProxyVerifySuccess {
    verified: true;
    exit_ip: string;
    org?: string;
    asn?: string;
    country?: string;
    country_code?: string;
    latency_ms: number;
}
export type VerifyFailureClass = "payment_required" | "auth_failed" | "timeout" | "network_error" | "bad_response";
export interface ProxyVerifyFailure {
    verified: false;
    failure_class: VerifyFailureClass;
    detail: string;
    http_status?: number;
    latency_ms: number;
}
export type ProxyVerifyResult = ProxyVerifySuccess | ProxyVerifyFailure;
export declare const DEFAULT_ECHO_TIMEOUT_MS = 5000;
export declare const ECHO_URL = "http://ipinfo.io/json";
/**
 * Verify is local-stdio-only: hosted runtimes (Vercel serverless, AWS Lambda)
 * and the Edge runtime may not permit raw proxied sockets, and a false
 * negative there would smear a working proxy. Callers skip the probe and
 * disclose the skip instead.
 *
 * Class-not-instance (review MEDIUM-3): hosted detection reuses the ONE
 * canonical predicate (config.ts isHostedEnvironment — VERCEL / VERCEL_ENV /
 * AWS_LAMBDA_FUNCTION_NAME) instead of a parallel hand-rolled list; the Edge
 * runtime is the only verify-specific member.
 */
export declare function isVerifySupportedRuntime(): boolean;
declare const ECHO_FIELD_RULES: {
    /** IPv4/IPv6 literal — hex digits, dots, colons; 45 = max IPv6 length. */
    readonly ip: {
        readonly strip: RegExp;
        readonly maxLen: 45;
    };
    /** Human text (org/ASN/country) — printable ASCII subset; no newlines,
     *  backticks, angle brackets, quotes or control chars survive. */
    readonly text: {
        readonly strip: RegExp;
        readonly maxLen: 128;
    };
};
/**
 * Reduce an untrusted echoed value to its allowlisted charset and cap its
 * length. Returns undefined for non-strings and values with no legal chars.
 */
export declare function sanitizeEchoField(value: unknown, kind?: keyof typeof ECHO_FIELD_RULES): string | undefined;
/**
 * Perform ONE IP-echo request through the proxy at `target`. Resolves (never
 * rejects) with either the exit-node evidence or a classified failure. The
 * caller must not retry — one probe per issued config.
 */
export declare function verifyProxyExit(target: ProxyVerifyTarget, timeoutMs?: number): Promise<ProxyVerifyResult>;
/**
 * First usable entry of an `IP:PORT:USER:PASS`-per-line proxy list (the
 * NOVADA_STATIC_PROXY_LIST / NOVADA_DEDICATED_PROXY_LIST format). Mirrors the
 * entry the static/dedicated handlers themselves surface (both take the first
 * valid line), so the probe verifies the SAME credentials the tool returned.
 * Password may contain ":" — everything after the third colon is the password.
 */
export declare function pickProxyListEntry(envValue: string | undefined): ProxyVerifyTarget | null;
export {};
//# sourceMappingURL=proxy_verify.d.ts.map