/** Registry of known domains and their optimal fetch method.
 *  Used to skip the auto-detection probe and go straight to the best strategy.
 */
export const DOMAIN_REGISTRY = {
    // === STATIC — SSR, no JS rendering needed ===
    "github.com": { method: "static", note: "SSR, minimal JS" },
    "gitlab.com": { method: "static", note: "SSR" },
    "wikipedia.org": { method: "static", note: "SSR" },
    "en.wikipedia.org": { method: "static", note: "SSR" },
    "stackoverflow.com": { method: "static", note: "SSR" },
    "stackexchange.com": { method: "static", note: "SSR" },
    "news.ycombinator.com": { method: "static", note: "SSR table layout" },
    "reddit.com": { method: "static", note: "SSR (avoid www, use old.reddit.com)" },
    "old.reddit.com": { method: "static", note: "Classic Reddit, SSR" },
    "medium.com": { method: "render", note: "CF + metered paywall", provider: "cloudflare", proxyTier: "residential" },
    "substack.com": { method: "static", note: "SSR" },
    "dev.to": { method: "static", note: "SSR" },
    "hashnode.com": { method: "static", note: "SSR" },
    "docs.python.org": { method: "static", note: "SSR docs" },
    "developer.mozilla.org": { method: "static", note: "SSR docs" },
    "docs.anthropic.com": { method: "static", note: "SSR docs" },
    "docs.github.com": { method: "static", note: "SSR docs" },
    "python.org": { method: "static", note: "SSR" },
    "pypi.org": { method: "static", note: "SSR" },
    "npmjs.com": { method: "render", note: "React SPA" },
    "crates.io": { method: "static", note: "SSR" },
    "pkg.go.dev": { method: "static", note: "SSR" },
    "httpbin.org": { method: "static", note: "Test utility" },
    "example.com": { method: "static", note: "Test domain" },
    "iana.org": { method: "static", note: "SSR" },
    "archive.org": { method: "static", note: "SSR" },
    "arxiv.org": { method: "static", note: "SSR academic" },
    "pubmed.ncbi.nlm.nih.gov": { method: "static", note: "SSR medical" },
    "techcrunch.com": { method: "static", note: "SSR news" },
    "theverge.com": { method: "static", note: "SSR news" },
    "arstechnica.com": { method: "static", note: "SSR news" },
    "wired.com": { method: "static", note: "SSR news" },
    "reuters.com": { method: "render", note: "CF + soft paywall, render required", provider: "cloudflare", proxyTier: "residential" },
    "apnews.com": { method: "static", note: "SSR news" },
    "trends24.in": { method: "static", note: "Third-party X/Twitter trending aggregator — not official X data; no auth required, SSR" },
    // === RENDER — Needs JS execution / Web Unblocker ===
    "amazon.com": { method: "render", note: "JS prices, anti-bot", provider: "datadome", proxyTier: "residential" },
    "amazon.de": { method: "render", note: "JS prices, anti-bot", provider: "datadome", proxyTier: "residential" },
    "amazon.co.uk": { method: "render", note: "JS prices, anti-bot", provider: "datadome", proxyTier: "residential" },
    "amazon.co.jp": { method: "render", note: "JS prices, anti-bot", provider: "datadome", proxyTier: "residential" },
    "amazon.fr": { method: "render", note: "JS prices, anti-bot", provider: "datadome", proxyTier: "residential" },
    "amazon.es": { method: "render", note: "JS prices, anti-bot", provider: "datadome", proxyTier: "residential" },
    "amazon.it": { method: "render", note: "JS prices, anti-bot", provider: "datadome", proxyTier: "residential" },
    "amazon.ca": { method: "render", note: "JS prices, anti-bot", provider: "datadome", proxyTier: "residential" },
    "ebay.com": { method: "render", note: "JS SPA" },
    "twitter.com": { method: "render", note: "JS SPA — Web Unblocker returns 403; use trends24.in for trending data instead" },
    "x.com": { method: "render", note: "JS SPA — Web Unblocker returns 403; use trends24.in for trending data instead" },
    "youtube.com": { method: "render", note: "JS SPA", provider: "google" },
    "instagram.com": { method: "render", note: "JS SPA", provider: "meta" },
    "tiktok.com": { method: "render", note: "JS SPA, anti-bot", provider: "tiktok" },
    "linkedin.com": { method: "render", note: "JS SPA, auth-gated", provider: "linkedin" },
    "facebook.com": { method: "render", note: "JS SPA", provider: "meta" },
    "steampowered.com": { method: "render", note: "Anti-bot, JS", provider: "akamai", proxyTier: "residential" },
    "store.steampowered.com": { method: "render", note: "Anti-bot, JS", provider: "akamai", proxyTier: "residential" },
    "walmart.com": { method: "render", note: "Anti-bot", provider: "perimeterx", proxyTier: "residential" },
    "target.com": { method: "render", note: "Anti-bot", provider: "akamai", proxyTier: "residential" },
    "bestbuy.com": { method: "render", note: "Anti-bot", provider: "akamai", proxyTier: "residential" },
    "etsy.com": { method: "render", note: "JS SPA" },
    "aliexpress.com": { method: "render", note: "JS SPA, anti-bot" },
    "zillow.com": { method: "render", note: "Anti-bot", provider: "cloudflare" },
    "realtor.com": { method: "render", note: "JS SPA" },
    "airbnb.com": { method: "render", note: "JS SPA", provider: "perimeterx", proxyTier: "residential" },
    "yelp.com": { method: "render", note: "Anti-bot" },
    "tripadvisor.com": { method: "render", note: "Anti-bot", provider: "perimeterx", proxyTier: "residential" },
    "imdb.com": { method: "render", note: "JS SPA", provider: "amazon" },
    "spotify.com": { method: "render", note: "JS SPA" },
    "google.com": { method: "render", note: "Anti-bot for search", provider: "google" },
    "indeed.com": { method: "render", note: "Anti-bot", provider: "cloudflare" },
    "ziprecruiter.com": { method: "render", note: "JS SPA" },
    "shein.com": { method: "render", note: "Anti-bot, JS SPA", provider: "datadome", proxyTier: "residential" },
    "wayfair.com": { method: "render", note: "Anti-bot", provider: "perimeterx", proxyTier: "residential" },
    "homedepot.com": { method: "render", note: "Anti-bot", provider: "akamai", proxyTier: "residential" },
    "lowes.com": { method: "render", note: "Anti-bot", provider: "akamai", proxyTier: "residential" },
    "nike.com": { method: "render", note: "Anti-bot, JS SPA", provider: "akamai", proxyTier: "residential" },
    // === RENDER — CF-protected / soft-paywalled content sites ===
    "netflixtechblog.com": { method: "render", note: "CF-protected tech blog", provider: "cloudflare", proxyTier: "residential" },
    "openai.com": { method: "render", note: "CF + JS-heavy", provider: "cloudflare", proxyTier: "residential" },
    "martinfowler.com": { method: "render", note: "lightweight bot challenge", provider: "cloudflare", proxyTier: "residential" },
    "gatesnotes.com": { method: "render", note: "CF-protected", provider: "cloudflare", proxyTier: "residential" },
    "economist.com": { method: "render", note: "metered paywall + CF", provider: "cloudflare", proxyTier: "residential" },
    // === RENDER — JS-heavy SPA docs / dev-tool sites ===
    "react.dev": { method: "render", note: "JS SPA docs" },
    "nextjs.org": { method: "render", note: "JS SPA docs" },
    "vitejs.dev": { method: "render", note: "JS SPA docs, sometimes slow" },
    "svelte.dev": { method: "render", note: "JS SPA docs" },
    "angular.dev": { method: "render", note: "JS SPA docs" },
    "tailwindcss.com": { method: "render", note: "JS SPA docs" },
    "vercel.com": { method: "render", note: "JS SPA" },
    "supabase.com": { method: "render", note: "JS SPA" },
    "linear.app": { method: "render", note: "JS SPA" },
    "notion.so": { method: "render", note: "JS SPA" },
    "figma.com": { method: "render", note: "JS SPA", provider: "cloudflare", proxyTier: "residential" },
    "replit.com": { method: "render", note: "slow-loading SPA" },
    "codesandbox.io": { method: "render", note: "JS SPA" },
    // === RENDER — Chinese content platforms ===
    "zhihu.com": { method: "render", provider: "cloudflare", proxyTier: "residential", note: "Major CN Q&A, CF + JS-heavy" },
    "weibo.com": { method: "render", provider: "cloudflare", proxyTier: "residential", note: "CN social, JS SPA" },
    "bilibili.com": { method: "render", note: "CN video platform, JS-heavy" },
    "douban.com": { method: "render", note: "CN reviews/social" },
    "juejin.cn": { method: "render", note: "CN dev community" },
    "csdn.net": { method: "render", note: "CN dev blog platform" },
    "cnblogs.com": { method: "static", note: "CN blog, mostly static" },
    "51cto.com": { method: "render", note: "CN tech platform" },
    "sspai.com": { method: "render", note: "CN productivity media" },
    "36kr.com": { method: "render", note: "CN startup news" },
    "baidu.com": { method: "render", note: "Baidu search" },
    "baike.baidu.com": { method: "render", note: "Baidu encyclopedia" },
    // === BROWSER — Full CDP required (heavy anti-bot / fingerprinting) ===
    "booking.com": { method: "browser", note: "JS fingerprinting challenge", provider: "perimeterx", proxyTier: "residential" },
    "glassdoor.com": { method: "browser", note: "Aggressive anti-bot", provider: "cloudflare" },
    "g2.com": { method: "browser", note: "Anti-bot, review platform", provider: "kasada", proxyTier: "residential" },
    "ticketmaster.com": { method: "browser", note: "Anti-bot", provider: "datadome", proxyTier: "residential" },
    "stubhub.com": { method: "browser", note: "Anti-bot", provider: "datadome", proxyTier: "residential" },
    "cloudflare.com": { method: "browser", note: "Fingerprinting", provider: "cloudflare" },
    "blog.cloudflare.com": { method: "browser", note: "CF self-hosted, blocks unblocker, browser only", provider: "cloudflare" },
    "discord.com": { method: "browser", note: "TLS fingerprinting required", provider: "cloudflare" },
};
/** Look up optimal fetch method for a URL. Returns null if domain unknown. */
export function lookupDomain(url) {
    let hostname;
    try {
        hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    }
    catch {
        return null;
    }
    // Exact match
    if (DOMAIN_REGISTRY[hostname])
        return DOMAIN_REGISTRY[hostname];
    // Subdomain match: try stripping subdomains
    const parts = hostname.split(".");
    for (let i = 1; i < parts.length - 1; i++) {
        const parent = parts.slice(i).join(".");
        if (DOMAIN_REGISTRY[parent])
            return DOMAIN_REGISTRY[parent];
    }
    return null;
}
/**
 * Warn at startup if DOMAIN_REGISTRY contains residential-tier domains but the
 * residential proxy env vars are not configured. In that case,
 * getResidentialProxyCredentials() silently falls back to datacenter credentials,
 * making proxyTier="residential" entries a silent no-op.
 *
 * Prints to stderr so the warning is visible in MCP server logs without
 * polluting stdout (which carries the MCP JSON-RPC stream).
 */
export function checkProxyConfiguration() {
    const residentialDomains = Object.keys(DOMAIN_REGISTRY).filter((domain) => DOMAIN_REGISTRY[domain].proxyTier === "residential");
    if (residentialDomains.length === 0)
        return;
    const hasResidentialCreds = !!process.env.NOVADA_RESIDENTIAL_PROXY_USER &&
        !!process.env.NOVADA_RESIDENTIAL_PROXY_PASS &&
        !!process.env.NOVADA_RESIDENTIAL_PROXY_ENDPOINT;
    if (!hasResidentialCreds) {
        process.stderr.write(`[novada] WARNING: ${residentialDomains.length} domains in DOMAIN_REGISTRY have proxyTier="residential" ` +
            `(e.g. ${residentialDomains.slice(0, 3).join(", ")}...) but residential proxy env vars are not set.\n` +
            `[novada] Fetches to these domains will silently fall back to datacenter credentials.\n` +
            `[novada] To enable residential proxies, set:\n` +
            `[novada]   NOVADA_RESIDENTIAL_PROXY_USER\n` +
            `[novada]   NOVADA_RESIDENTIAL_PROXY_PASS\n` +
            `[novada]   NOVADA_RESIDENTIAL_PROXY_ENDPOINT\n`);
    }
}
//# sourceMappingURL=domains.js.map