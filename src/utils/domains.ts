export type FetchMethod = "static" | "render" | "browser";

/** Known anti-bot provider protecting a domain */
export type AntiBotProvider =
  | "cloudflare" | "datadome" | "kasada" | "perimeterx"
  | "akamai" | "incapsula" | "meta" | "tiktok"
  | "linkedin" | "google" | "amazon" | null;

export interface DomainEntry {
  method: FetchMethod;
  note: string;
  /** Anti-bot provider protecting this domain (null = unknown/none) */
  provider?: AntiBotProvider;
}

/** Registry of known domains and their optimal fetch method.
 *  Used to skip the auto-detection probe and go straight to the best strategy.
 */
export const DOMAIN_REGISTRY: Record<string, DomainEntry> = {
  // === STATIC — SSR, no JS rendering needed ===
  "github.com":           { method: "static", note: "SSR, minimal JS" },
  "gitlab.com":           { method: "static", note: "SSR" },
  "wikipedia.org":        { method: "static", note: "SSR" },
  "en.wikipedia.org":     { method: "static", note: "SSR" },
  "stackoverflow.com":    { method: "static", note: "SSR" },
  "stackexchange.com":    { method: "static", note: "SSR" },
  "news.ycombinator.com": { method: "static", note: "SSR table layout" },
  "reddit.com":           { method: "static", note: "SSR (avoid www, use old.reddit.com)" },
  "old.reddit.com":       { method: "static", note: "Classic Reddit, SSR" },
  "medium.com":           { method: "static", note: "SSR" },
  "substack.com":         { method: "static", note: "SSR" },
  "dev.to":               { method: "static", note: "SSR" },
  "hashnode.com":         { method: "static", note: "SSR" },
  "docs.python.org":      { method: "static", note: "SSR docs" },
  "developer.mozilla.org":{ method: "static", note: "SSR docs" },
  "docs.anthropic.com":   { method: "static", note: "SSR docs" },
  "docs.github.com":      { method: "static", note: "SSR docs" },
  "python.org":           { method: "static", note: "SSR" },
  "pypi.org":             { method: "static", note: "SSR" },
  "npmjs.com":            { method: "render", note: "React SPA" },
  "crates.io":            { method: "static", note: "SSR" },
  "pkg.go.dev":           { method: "static", note: "SSR" },
  "httpbin.org":          { method: "static", note: "Test utility" },
  "example.com":          { method: "static", note: "Test domain" },
  "iana.org":             { method: "static", note: "SSR" },
  "archive.org":          { method: "static", note: "SSR" },
  "arxiv.org":            { method: "static", note: "SSR academic" },
  "pubmed.ncbi.nlm.nih.gov": { method: "static", note: "SSR medical" },
  "techcrunch.com":       { method: "static", note: "SSR news" },
  "theverge.com":         { method: "static", note: "SSR news" },
  "arstechnica.com":      { method: "static", note: "SSR news" },
  "wired.com":            { method: "static", note: "SSR news" },
  "reuters.com":          { method: "static", note: "SSR news" },
  "apnews.com":           { method: "static", note: "SSR news" },
  "trends24.in":          { method: "static", note: "Third-party X/Twitter trending aggregator — not official X data; no auth required, SSR" },

  // === RENDER — Needs JS execution / Web Unblocker ===
  "amazon.com":           { method: "render", note: "JS prices, anti-bot", provider: "datadome" },
  "amazon.de":            { method: "render", note: "JS prices, anti-bot", provider: "datadome" },
  "amazon.co.uk":         { method: "render", note: "JS prices, anti-bot", provider: "datadome" },
  "amazon.co.jp":         { method: "render", note: "JS prices, anti-bot", provider: "datadome" },
  "amazon.fr":            { method: "render", note: "JS prices, anti-bot", provider: "datadome" },
  "amazon.es":            { method: "render", note: "JS prices, anti-bot", provider: "datadome" },
  "amazon.it":            { method: "render", note: "JS prices, anti-bot", provider: "datadome" },
  "amazon.ca":            { method: "render", note: "JS prices, anti-bot", provider: "datadome" },
  "ebay.com":             { method: "render", note: "JS SPA" },
  "twitter.com":          { method: "render", note: "JS SPA — Web Unblocker returns 403; use trends24.in for trending data instead" },
  "x.com":                { method: "render", note: "JS SPA — Web Unblocker returns 403; use trends24.in for trending data instead" },
  "youtube.com":          { method: "render", note: "JS SPA", provider: "google" },
  "instagram.com":        { method: "render", note: "JS SPA", provider: "meta" },
  "tiktok.com":           { method: "render", note: "JS SPA, anti-bot", provider: "tiktok" },
  "linkedin.com":         { method: "render", note: "JS SPA, auth-gated", provider: "linkedin" },
  "facebook.com":         { method: "render", note: "JS SPA", provider: "meta" },
  "steampowered.com":     { method: "render", note: "Anti-bot, JS", provider: "akamai" },
  "store.steampowered.com":{ method: "render", note: "Anti-bot, JS", provider: "akamai" },
  "walmart.com":          { method: "render", note: "Anti-bot", provider: "perimeterx" },
  "target.com":           { method: "render", note: "Anti-bot", provider: "akamai" },
  "bestbuy.com":          { method: "render", note: "Anti-bot", provider: "akamai" },
  "etsy.com":             { method: "render", note: "JS SPA" },
  "aliexpress.com":       { method: "render", note: "JS SPA, anti-bot" },
  "zillow.com":           { method: "render", note: "Anti-bot", provider: "cloudflare" },
  "realtor.com":          { method: "render", note: "JS SPA" },
  "airbnb.com":           { method: "render", note: "JS SPA", provider: "perimeterx" },
  "yelp.com":             { method: "render", note: "Anti-bot" },
  "tripadvisor.com":      { method: "render", note: "Anti-bot", provider: "perimeterx" },
  "imdb.com":             { method: "render", note: "JS SPA", provider: "amazon" },
  "spotify.com":          { method: "render", note: "JS SPA" },
  "google.com":           { method: "render", note: "Anti-bot for search", provider: "google" },
  "indeed.com":           { method: "render", note: "Anti-bot", provider: "cloudflare" },
  "ziprecruiter.com":     { method: "render", note: "JS SPA" },
  "shein.com":            { method: "render", note: "Anti-bot, JS SPA", provider: "datadome" },
  "wayfair.com":          { method: "render", note: "Anti-bot", provider: "perimeterx" },
  "homedepot.com":        { method: "render", note: "Anti-bot", provider: "akamai" },
  "lowes.com":            { method: "render", note: "Anti-bot", provider: "akamai" },
  "nike.com":             { method: "render", note: "Anti-bot, JS SPA", provider: "akamai" },

  // === BROWSER — Full CDP required (heavy anti-bot / fingerprinting) ===
  "booking.com":          { method: "browser", note: "JS fingerprinting challenge", provider: "perimeterx" },
  "glassdoor.com":        { method: "browser", note: "Aggressive anti-bot", provider: "cloudflare" },
  "g2.com":               { method: "browser", note: "Anti-bot, review platform", provider: "kasada" },
  "ticketmaster.com":     { method: "browser", note: "Anti-bot", provider: "datadome" },
  "stubhub.com":          { method: "browser", note: "Anti-bot", provider: "datadome" },
  "cloudflare.com":       { method: "browser", note: "Fingerprinting", provider: "cloudflare" },
};

/** Look up optimal fetch method for a URL. Returns null if domain unknown. */
export function lookupDomain(url: string): DomainEntry | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  // Exact match
  if (DOMAIN_REGISTRY[hostname]) return DOMAIN_REGISTRY[hostname];
  // Subdomain match: try stripping subdomains
  const parts = hostname.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join(".");
    if (DOMAIN_REGISTRY[parent]) return DOMAIN_REGISTRY[parent];
  }
  return null;
}
