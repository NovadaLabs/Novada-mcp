/** Normalize a URL for deduplication: strip trailing slash, www, fragment, sort params */
export function normalizeUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    u.hash = "";
    u.hostname = u.hostname.replace(/^www\./, "");
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    u.searchParams.sort();
    return u.toString();
  } catch {
    return urlStr;
  }
}

const ASSET_EXTENSIONS = new Set([
  "css", "js", "png", "jpg", "jpeg", "gif", "svg", "ico", "woff", "woff2",
  "ttf", "eot", "map", "xml", "rss", "atom", "json",
]);

const BOILERPLATE_HOSTS = [
  "fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com", "unpkg.com", "ajax.googleapis.com",
  "github.githubassets.com", "avatars.githubusercontent.com",
  "collector.github.com", "api.github.com",
  "googletagmanager.com", "google-analytics.com", "facebook.com",
  "twitter.com", "linkedin.com",
];

const SKIP_PATHS = ["/login", "/signup", "/auth", "/oauth", "/settings"];

/** Filter out boilerplate links (assets, tracking, auth, etc.) */
export function isContentLink(href: string): boolean {
  try {
    const u = new URL(href);
    const ext = u.pathname.split(".").pop()?.toLowerCase() || "";
    if (ASSET_EXTENSIONS.has(ext)) return false;
    if (BOILERPLATE_HOSTS.some((h) => u.hostname.includes(h))) return false;
    if (SKIP_PATHS.some((p) => u.pathname.startsWith(p))) return false;
    return true;
  } catch {
    return false;
  }
}
