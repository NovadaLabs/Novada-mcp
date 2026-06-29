/**
 * Centralised SSRF guard for the fetch layer.
 *
 * The Zod `safeUrl` refine (src/tools/types.ts) validates the literal input string
 * ONCE at the MCP parameter boundary. That does NOT protect:
 *   - URLs discovered at runtime (sitemap <loc>, robots Sitemap:, llms.txt links, BFS links);
 *   - redirect targets (axios silently follows 3xx to any host);
 *   - DNS rebinding — a PUBLIC hostname whose A/AAAA record resolves to a private IP
 *     (e.g. rebind.evil.com → 169.254.169.254). The string-level host check passes; only
 *     re-validating the RESOLVED address before connect can stop it.
 *
 * `assertUrlSafe` is the string-level chokepoint invoked inside every http.ts fetch entry
 * point (and in axios `beforeRedirect`). `safeLookup` is the dns.lookup hook wired into
 * every axios request so the resolved IP is re-checked at connect time — this is the only
 * defense against DNS rebinding and is applied on the direct-fetch fallback too.
 *
 * Keep this module dependency-free of project code (only node builtins) so http.ts and
 * types.ts can both import it without creating an import cycle. types.ts shares the same
 * `isBlockedHost` helper so the Zod boundary and the runtime chokepoint can never drift.
 */
import dns from "dns";
/**
 * Single source of truth: is this LITERAL IP address (v4 or v6) in a blocked range?
 * Shared by the URL string check and the DNS-resolution check.
 */
export declare function isBlockedIp(ip: string): boolean;
/**
 * Is this URL host (the string in the URL) one we must refuse? Handles bracketed IPv6,
 * `localhost`, decimal/hex IP notations, and literal IPv4/IPv6 in any blocked range.
 * Does NOT resolve DNS — that is `safeLookup`'s job (rebinding defense).
 */
export declare function isBlockedHost(rawHost: string): boolean;
/**
 * Return true if `url` is safe to fetch (public http/https host), false otherwise.
 * Never throws. Used for filtering candidate lists (e.g. discovered sitemap URLs).
 */
export declare function isUrlSafe(url: string): boolean;
/**
 * Throw if `url` points to a private/loopback/link-local host or uses a non-http(s)
 * scheme. Call at the top of every fetch entry point and inside axios `beforeRedirect`.
 *
 * `context` is appended to the error so logs show which channel issued the unsafe URL
 * (e.g. "redirect target", "sitemap <loc>").
 */
export declare function assertUrlSafe(url: string, context?: string): void;
/** Callback shape axios uses for its `lookup` option. */
type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;
/**
 * dns.lookup replacement wired into axios's `lookup` option on every direct fetch.
 * Resolves the hostname normally, then refuses any result whose address is in a blocked
 * range. This is the ONLY defense against DNS rebinding: a public hostname whose A/AAAA
 * record points at 127.0.0.1 / 169.254.169.254 / an internal IP passes the string-level
 * host check but is rejected here before the socket connects. Applied on the direct-fetch
 * fallback path too, so no fetch path can be rebound.
 *
 * axios always invokes lookup as (hostname, options, cb); the signature matches its
 * `LookupFunction` type so it can be assigned to AxiosRequestConfig.lookup directly.
 */
export declare function safeLookup(hostname: string, options: object, cb: LookupCallback): void;
export {};
//# sourceMappingURL=ssrf.d.ts.map