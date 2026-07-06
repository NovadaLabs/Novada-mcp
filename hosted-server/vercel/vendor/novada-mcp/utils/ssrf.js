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
import net from "net";
import dns from "dns";
/** Parse a dotted-quad IPv4 string into 4 octets, or null if malformed. */
function ipv4Octets(ip) {
    const parts = ip.split(".");
    if (parts.length !== 4)
        return null;
    const nums = [];
    for (const p of parts) {
        if (!/^\d{1,3}$/.test(p))
            return null;
        const n = Number(p);
        if (n > 255)
            return null;
        nums.push(n);
    }
    return [nums[0], nums[1], nums[2], nums[3]];
}
/**
 * True if a dotted-quad IPv4 is in a private / loopback / link-local / unspecified /
 * carrier-grade-NAT range. Numeric ranges (not string alternation) so dotted forms that
 * slip past a regex — e.g. 0.0.0.1 (0.0.0.0/8 routes to loopback on Linux) or 100.64.0.1
 * (CGNAT) — are caught.
 */
function isBlockedIpv4(ip) {
    const o = ipv4Octets(ip);
    if (!o)
        return false;
    const [a, b] = o;
    if (a === 0)
        return true; // 0.0.0.0/8  "this host" — routes to loopback
    if (a === 10)
        return true; // 10.0.0.0/8 private
    if (a === 127)
        return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254)
        return true; // 169.254.0.0/16 link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31)
        return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168)
        return true; // 192.168.0.0/16 private
    if (a === 100 && b >= 64 && b <= 127)
        return true; // 100.64.0.0/10 CGNAT
    return false;
}
/** Expand an IPv6 address (already validated by net.isIP===6) to 8 16-bit hextets. */
function ipv6Hextets(ip) {
    // Strip a zone id (fe80::1%eth0) if present.
    let addr = ip.split("%")[0];
    // An embedded IPv4 tail (::ffff:127.0.0.1) — handle by extraction below, but for the
    // hextet expansion convert the IPv4 tail to two hextets so prefix checks still work.
    const v4Match = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (v4Match) {
        const o = ipv4Octets(v4Match[1]);
        if (!o)
            return null;
        const hi = (o[0] << 8) | o[1];
        const lo = (o[2] << 8) | o[3];
        addr = addr.slice(0, v4Match.index) + hi.toString(16) + ":" + lo.toString(16);
    }
    const halves = addr.split("::");
    if (halves.length > 2)
        return null;
    const head = halves[0] ? halves[0].split(":") : [];
    const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;
    let groups;
    if (tail === null) {
        groups = head;
    }
    else {
        const missing = 8 - head.length - tail.length;
        if (missing < 0)
            return null;
        groups = [...head, ...Array(missing).fill("0"), ...tail];
    }
    if (groups.length !== 8)
        return null;
    const hextets = [];
    for (const g of groups) {
        if (g === "") {
            hextets.push(0);
            continue;
        }
        if (!/^[0-9a-f]{1,4}$/i.test(g))
            return null;
        hextets.push(parseInt(g, 16));
    }
    return hextets;
}
/**
 * True if an IPv6 address is loopback / unspecified / link-local / unique-local, or an
 * IPv4-mapped/-compatible address whose embedded IPv4 is itself blocked. Covers the forms
 * a string blocklist misses: fc00::/7 (ULA, k8s/internal), [::127.0.0.1] (IPv4-compatible
 * loopback), and IPv4-mapped private/metadata addresses.
 */
function isBlockedIpv6(ip) {
    const h = ipv6Hextets(ip);
    if (!h)
        return false;
    // ::1 loopback and :: unspecified
    if (h.every((x) => x === 0))
        return true; // :: unspecified
    if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1)
        return true; // ::1 loopback
    // fc00::/7 unique-local (fc00.. and fd00..)
    if ((h[0] & 0xfe00) === 0xfc00)
        return true;
    // fe80::/10 link-local
    if ((h[0] & 0xffc0) === 0xfe80)
        return true;
    // IPv4-mapped ::ffff:0:0/96 and IPv4-compatible ::/96 — re-check the embedded v4.
    const isV4Mapped = h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff;
    const isV4Compat = h.slice(0, 6).every((x) => x === 0) && (h[6] !== 0 || h[7] !== 0);
    if (isV4Mapped || isV4Compat) {
        const a = (h[6] >> 8) & 0xff, b = h[6] & 0xff, c = (h[7] >> 8) & 0xff, d = h[7] & 0xff;
        if (isBlockedIpv4(`${a}.${b}.${c}.${d}`))
            return true;
    }
    return false;
}
/**
 * Single source of truth: is this LITERAL IP address (v4 or v6) in a blocked range?
 * Shared by the URL string check and the DNS-resolution check.
 */
export function isBlockedIp(ip) {
    const kind = net.isIP(ip);
    if (kind === 4)
        return isBlockedIpv4(ip);
    if (kind === 6)
        return isBlockedIpv6(ip);
    return false; // not a literal IP
}
/**
 * Is this URL host (the string in the URL) one we must refuse? Handles bracketed IPv6,
 * `localhost`, decimal/hex IP notations, and literal IPv4/IPv6 in any blocked range.
 * Does NOT resolve DNS — that is `safeLookup`'s job (rebinding defense).
 */
export function isBlockedHost(rawHost) {
    if (!rawHost)
        return true;
    let host = rawHost;
    // Node wraps IPv6 in brackets (e.g. "[::1]") — strip before classification.
    if (host.startsWith("[") && host.endsWith("]"))
        host = host.slice(1, -1);
    host = host.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost"))
        return true;
    // Block decimal (http://2130706433/) and hex (http://0x7f000001/) IP notations —
    // legitimate URLs never use these and they bypass dotted-quad checks.
    if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host))
        return true;
    return isBlockedIp(host);
}
/**
 * Return true if `url` is safe to fetch (public http/https host), false otherwise.
 * Never throws. Used for filtering candidate lists (e.g. discovered sitemap URLs).
 */
export function isUrlSafe(url) {
    if (typeof url !== "string" || url.includes("\n") || url.includes("\r"))
        return false;
    if (!/^https?:\/\//i.test(url))
        return false;
    let host;
    try {
        host = new URL(url).hostname;
    }
    catch {
        return false;
    }
    return !isBlockedHost(host);
}
/**
 * Throw if `url` points to a private/loopback/link-local host or uses a non-http(s)
 * scheme. Call at the top of every fetch entry point and inside axios `beforeRedirect`.
 *
 * `context` is appended to the error so logs show which channel issued the unsafe URL
 * (e.g. "redirect target", "sitemap <loc>").
 */
export function assertUrlSafe(url, context = "fetch target") {
    if (!isUrlSafe(url)) {
        throw new Error(`Blocked ${context}: "${url}" resolves to a private/loopback/link-local host or a ` +
            `non-HTTP(S) scheme. SSRF guard refused the request.`);
    }
}
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
export function safeLookup(hostname, options, cb) {
    const opts = (options ?? {});
    // A literal-IP hostname never hits DNS, but axios still calls lookup — short-circuit and
    // re-apply the same numeric check (defense in depth; the string check ran earlier too).
    if (net.isIP(hostname)) {
        if (isBlockedIp(hostname)) {
            cb(new Error(`SSRF guard: refused connection to private/loopback address ${hostname}`), "");
            return;
        }
    }
    dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
        if (err) {
            cb(err, "");
            return;
        }
        const list = addresses;
        for (const a of list) {
            if (isBlockedIp(a.address)) {
                cb(new Error(`SSRF guard: "${hostname}" resolved to private/loopback/link-local address ${a.address} ` +
                    `(possible DNS rebinding). Connection refused.`), "");
                return;
            }
        }
        // Honor the caller's `all` expectation: callback shape differs when all !== true.
        if (opts.all) {
            cb(null, list);
        }
        else {
            const first = list[0];
            if (!first) {
                cb(new Error(`SSRF guard: no address resolved for ${hostname}`), "");
                return;
            }
            cb(null, first.address, first.family);
        }
    });
}
//# sourceMappingURL=ssrf.js.map