import { fetchViaProxy, extractLinks, normalizeUrl, isContentLink } from "../utils/index.js";
import type { MapParams } from "./types.js";
import { TIMEOUTS } from "../config.js";
import { makeNovadaError, NovadaError, NovadaErrorCode } from "../_core/errors.js";

/**
 * Map a website to discover all URLs on the site.
 * Strategy:
 * 1. Try sitemap.xml / sitemap_index.xml / robots.txt → fast, complete coverage
 * 2. Fall back to parallel BFS crawl if no sitemap found
 */
export async function novadaMap(params: MapParams, apiKey?: string): Promise<string> {
  const maxUrls = Math.min(params.limit || 50, 100);

  let baseHostname: string;
  let origin: string;
  try {
    const parsed = new URL(params.url);
    baseHostname = parsed.hostname.replace(/^www\./, "");
    origin = parsed.origin;
  } catch {
    throw makeNovadaError(
      NovadaErrorCode.INVALID_PARAMS,
      `Invalid URL: "${params.url}". URL must start with http:// or https://.`,
      `url:${params.url} failed URL parsing`
    );
  }

  try {
    return await novadaMapInner(params, apiKey, maxUrls, baseHostname, origin);
  } catch (err) {
    // SPA_NO_URLS_FOUND is surfaced as a friendly agent message (not an error block)
    // so the tool always returns a successful string response.
    if (err instanceof NovadaError && err.code === NovadaErrorCode.SPA_NO_URLS_FOUND) {
      const hostname = new URL(params.url).hostname;
      const lines = [
        `## Site Map`,
        `root: ${params.url}`,
        `urls:0`,
        ``,
        `---`,
        ``,
        `⚠ Only the root URL found on ${params.url}.`,
        `Possible causes: (1) single-page site with no internal links, (2) JavaScript SPA, (3) sitemap not available.`,
        ``,
        `## Agent Hints`,
        `- Try \`novada_extract\` on ${params.url} to read the page content directly.`,
        `- Use \`novada_crawl\` with render="render" for JavaScript-rendered sites.`,
        `- Use \`novada_unblock\` with method="render" to fetch rendered HTML directly.`,
        `- Use \`novada_search\` with \`site:${hostname}\` to find indexed subpages.`,
        ``,
        `## Agent Notice — Under-delivery`,
        `requested: ${maxUrls} | returned: 0 | shortfall: ${maxUrls}`,
        `reason: No additional URLs found — site may have no internal links, be a JavaScript SPA, or have no sitemap.`,
        `next_steps: Use novada_extract to read the page, or novada_crawl with render="render" for JS sites.`,
      ];
      return lines.join("\n");
    }
    throw err;
  }
}

/** Inner implementation — throws SPA_NO_URLS_FOUND on SPA detection. */
async function novadaMapInner(
  params: MapParams,
  apiKey: string | undefined,
  maxUrls: number,
  baseHostname: string,
  origin: string,
): Promise<string> {
  // --- Binary content detection: PDF, ZIP, images — these have no HTML links ---
  const urlPath = new URL(params.url).pathname.toLowerCase();
  const binaryExtensions = ['.pdf', '.zip', '.tar', '.gz', '.exe', '.dmg', '.pkg', '.deb', '.rpm', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.mp4', '.mp3', '.png', '.jpg', '.jpeg', '.gif', '.svg'];
  if (binaryExtensions.some(ext => urlPath.endsWith(ext))) {
    const ext = urlPath.split('.').pop() ?? 'binary';
    return [
      `## Site Map`,
      `root: ${params.url}`,
      `urls:0`,
      ``,
      `---`,
      ``,
      `⚠ Binary content detected: this URL serves a .${ext} file, not an HTML page.`,
      ``,
      `## Agent Hints`,
      `- novada_map only works with HTML web pages that contain links.`,
      `- For PDF content, use novada_extract to get the text content of the document.`,
      `- For binary files (images, archives), download them directly.`,
      ``,
      `## Agent Notice — Under-delivery`,
      `requested: ${maxUrls} | returned: 0 | shortfall: ${maxUrls}`,
      `reason: URL points to a .${ext} binary file — no HTML links to discover.`,
      `next_steps: Use novada_extract to read the document content.`,
    ].join("\n");
  }

  // --- Phase 1: Try sitemap discovery ---
  const sitemapUrls = await discoverViaSitemap(origin, apiKey, maxUrls);

  let discovered: string[];

  if (sitemapUrls.length > 0) {
    // Filter to same domain
    discovered = sitemapUrls.filter(u => {
      try {
        const h = new URL(u).hostname.replace(/^www\./, "");
        return h === baseHostname || (params.include_subdomains && h.endsWith(`.${baseHostname}`));
      } catch { return false; }
    });
  } else {
    // --- Phase 2: Parallel BFS crawl ---
    discovered = await parallelBfsCrawl(params, apiKey, maxUrls, baseHostname);
  }

  // SPA detection — check BEFORE search filter (search should not hide SPA failures)
  const isSpaLikely = discovered.length <= 1 &&
    (discovered.length === 0 || discovered[0] === normalizeUrl(params.url));
  if (isSpaLikely) {
    // Throw a machine-readable SPA_NO_URLS_FOUND error; catch block below formats
    // it as a friendly agent message so the tool always returns a string (not an error block).
    throw makeNovadaError(
      NovadaErrorCode.SPA_NO_URLS_FOUND,
      `Only ${discovered.length === 0 ? "0 URLs" : "the root URL"} found on ${params.url} — likely a JavaScript SPA.`,
    );
  }

  // Filter by search term if provided
  let filtered = discovered;
  if (params.search) {
    const searchLower = params.search.toLowerCase();
    filtered = discovered.filter(u => u.toLowerCase().includes(searchLower));
  }

  if (filtered.length === 0) {
    return [
      `## Site Map`,
      `root: ${params.url}`,
      `urls:0`,
      ``,
      `---`,
      ``,
      `No URLs found matching "${params.search ?? ""}" on ${params.url}.`,
      ``,
      `## Agent Hints`,
      `- Remove the 'search' filter to see all ${discovered.length} discovered URLs.`,
      `- Try a broader search term or check the URL spelling.`,
      `- Use \`novada_search\` with \`site:${new URL(params.url).hostname} ${params.search ?? ""}\` to find indexed pages.`,
    ].join("\n");
  }

  const discoveryMethod = sitemapUrls.length > 0 ? "sitemap" : "crawl";

  const lines: string[] = [
    `## Site Map`,
    `root: ${params.url}`,
    `urls:${filtered.length}${params.search ? ` (filtered by "${params.search}" from ${discovered.length} total)` : ""}`,
    `discovery:${discoveryMethod}`,
    ``,
    `---`,
    ``,
    ...filtered.slice(0, maxUrls).map((u, i) => `${i + 1}. ${u}`),
    ``,
    `---`,
    `## Agent Hints`,
    `- Use \`novada_extract\` to read any of these pages.`,
    `- Use \`novada_extract\` with url=[url1,url2,...] for batch extraction.`,
    `- Use \`novada_crawl\` to extract content from multiple pages at once.`,
  ];

  if (params.search) {
    lines.push(`- Remove 'search' param to see all ${discovered.length} discovered URLs.`);
  }

  if (filtered.length < maxUrls) {
    lines.push(``, `## Agent Notice — Under-delivery`);
    lines.push(`requested: ${maxUrls} | returned: ${filtered.length} | shortfall: ${maxUrls - filtered.length}`);
    lines.push(`reason: Site has fewer crawlable links${params.search ? ` matching "${params.search}"` : ""} than requested.`);
    lines.push(`next_steps: ${params.search ? `Remove 'search' filter to see all ${discovered.length} URLs, or t` : "T"}ry max_depth=3 or increase limit.`);
  }

  return lines.join("\n");
}

/** Attempt to discover URLs via sitemap.xml. Returns empty array if not available. */
async function discoverViaSitemap(
  origin: string,
  apiKey: string | undefined,
  maxUrls: number
): Promise<string[]> {
  const urls: string[] = [];

  // Find sitemap URL — check robots.txt first, then common paths
  const sitemapCandidates: string[] = [];

  try {
    const robotsResp = await fetchViaProxy(`${origin}/robots.txt`, apiKey, { timeout: TIMEOUTS.SITEMAP });
    if (typeof robotsResp.data === "string") {
      const sitemapMatches = robotsResp.data.match(/^Sitemap:\s*(.+)$/gim);
      if (sitemapMatches) {
        for (const m of sitemapMatches) {
          const u = m.replace(/^Sitemap:\s*/i, "").trim();
          if (u.startsWith("http")) sitemapCandidates.unshift(u); // prefer robots.txt sitemap
        }
      }
    }
  } catch { /* robots.txt not available */ }

  // Fallback candidates
  sitemapCandidates.push(`${origin}/sitemap.xml`);
  sitemapCandidates.push(`${origin}/sitemap_index.xml`);

  for (const sitemapUrl of sitemapCandidates.slice(0, 3)) {
    if (urls.length >= maxUrls) break;
    try {
      const resp = await fetchViaProxy(sitemapUrl, apiKey, { timeout: TIMEOUTS.CRAWL_STATIC });
      if (typeof resp.data !== "string") continue;
      const xml = resp.data;
      if (!xml.includes("<urlset") && !xml.includes("<sitemapindex")) continue;

      // Sitemap index → recurse into child sitemaps
      if (xml.includes("<sitemapindex")) {
        const childSitemaps = [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gs)]
          .map(m => m[1].trim())
          .filter(u => u.startsWith("http"));
        for (const childUrl of childSitemaps.slice(0, 5)) {
          if (urls.length >= maxUrls) break;
          try {
            const childResp = await fetchViaProxy(childUrl, apiKey, { timeout: TIMEOUTS.SITEMAP });
            if (typeof childResp.data === "string") {
              extractSitemapUrls(childResp.data, urls, maxUrls);
            }
          } catch { /* skip */ }
        }
      } else {
        extractSitemapUrls(xml, urls, maxUrls);
      }

      if (urls.length > 0) break; // found sitemap, no need to try more
    } catch { /* not found */ }
  }

  return urls;
}

function extractSitemapUrls(xml: string, out: string[], max: number): void {
  const matches = [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gs)];
  for (const m of matches) {
    if (out.length >= max) break;
    const u = m[1].trim();
    if (u.startsWith("http")) out.push(u);
  }
}

/** Parallel BFS crawl — fetches up to CONCURRENCY pages at once */
async function parallelBfsCrawl(
  params: MapParams,
  apiKey: string | undefined,
  maxUrls: number,
  baseHostname: string
): Promise<string[]> {
  const CONCURRENCY = 5;
  const maxDepth = Math.min(params.max_depth ?? 2, 5);
  const visited = new Set<string>();
  const discovered = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: params.url, depth: 0 }];

  const prefixCounts = new Map<string, number>();
  const MAX_PER_PREFIX = Math.max(3, Math.floor(maxUrls / 5));

  discovered.add(normalizeUrl(params.url));

  while (queue.length > 0 && discovered.size < maxUrls) {
    // Take up to CONCURRENCY items from queue
    const batch = queue.splice(0, CONCURRENCY);
    const unvisited = batch.filter(item => {
      const n = normalizeUrl(item.url);
      if (visited.has(n)) return false;
      visited.add(n);
      return true;
    });

    if (unvisited.length === 0) continue;

    // Fetch all in parallel
    const results = await Promise.allSettled(
      unvisited.map(async ({ url, depth }) => {
        if (depth >= maxDepth) return { links: [] };
        const response = await fetchViaProxy(url, apiKey, { timeout: TIMEOUTS.CRAWL_STATIC });
        if (typeof response.data !== "string") return { links: [] };
        return { links: extractLinks(response.data, url), depth };
      })
    );

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { links, depth = 0 } = result.value;
      for (const link of links) {
        if (discovered.size >= maxUrls) break;
        try {
          const linkUrl = new URL(link);
          const linkHostname = linkUrl.hostname.replace(/^www\./, "");
          const isSameDomain = linkHostname === baseHostname;
          const isSubdomain = linkHostname.endsWith(`.${baseHostname}`);

          if ((isSameDomain || (params.include_subdomains && isSubdomain)) && isContentLink(link)) {
            const normalizedLink = normalizeUrl(link);
            if (!discovered.has(normalizedLink) && !visited.has(normalizedLink)) {
              const pathParts = linkUrl.pathname.split("/").filter(Boolean);
              const prefix = pathParts.length > 0 ? `/${pathParts[0]}` : "/";
              const count = prefixCounts.get(prefix) || 0;

              if (count < MAX_PER_PREFIX) {
                prefixCounts.set(prefix, count + 1);
                discovered.add(normalizedLink);
                if (depth + 1 < maxDepth) {
                  queue.push({ url: link, depth: depth + 1 });
                }
              }
            }
          }
        } catch { /* invalid URL */ }
      }
    }
  }

  return [...discovered];
}
