export type FetchMethod = "static" | "render" | "browser";
/** Known anti-bot provider protecting a domain */
export type AntiBotProvider = "cloudflare" | "datadome" | "kasada" | "perimeterx" | "akamai" | "incapsula" | "meta" | "tiktok" | "linkedin" | "google" | "amazon" | null;
export interface DomainEntry {
    method: FetchMethod;
    note: string;
    /** Anti-bot provider protecting this domain (null = unknown/none) */
    provider?: AntiBotProvider;
}
/** Registry of known domains and their optimal fetch method.
 *  Used to skip the auto-detection probe and go straight to the best strategy.
 */
export declare const DOMAIN_REGISTRY: Record<string, DomainEntry>;
/** Look up optimal fetch method for a URL. Returns null if domain unknown. */
export declare function lookupDomain(url: string): DomainEntry | null;
//# sourceMappingURL=domains.d.ts.map