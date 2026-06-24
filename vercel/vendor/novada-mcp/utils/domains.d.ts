export type FetchMethod = "static" | "render" | "browser";
/** Known anti-bot provider protecting a domain */
export type AntiBotProvider = "cloudflare" | "datadome" | "kasada" | "perimeterx" | "akamai" | "incapsula" | "meta" | "tiktok" | "linkedin" | "google" | "amazon" | null;
export interface DomainEntry {
    method: FetchMethod;
    note: string;
    /** Anti-bot provider protecting this domain (null = unknown/none) */
    provider?: AntiBotProvider;
    /** Proxy tier to use when fetching this domain. "residential" bypasses IP-reputation-based blocks. */
    proxyTier?: "residential" | "datacenter";
}
/** Registry of known domains and their optimal fetch method.
 *  Used to skip the auto-detection probe and go straight to the best strategy.
 */
export declare const DOMAIN_REGISTRY: Record<string, DomainEntry>;
/** Look up optimal fetch method for a URL. Returns null if domain unknown. */
export declare function lookupDomain(url: string): DomainEntry | null;
/**
 * Warn at startup if DOMAIN_REGISTRY contains residential-tier domains but the
 * residential proxy env vars are not configured. In that case,
 * getResidentialProxyCredentials() silently falls back to datacenter credentials,
 * making proxyTier="residential" entries a silent no-op.
 *
 * Prints to stderr so the warning is visible in MCP server logs without
 * polluting stdout (which carries the MCP JSON-RPC stream).
 */
export declare function checkProxyConfiguration(): void;
//# sourceMappingURL=domains.d.ts.map