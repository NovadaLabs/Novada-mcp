import { fetchViaProxy, extractLinks, normalizeUrl, isContentLink } from "../utils/index.js";
import type { MapParams } from "./types.js";

/**
 * Map a website to discover all URLs on the site.
 * Strategy:
 * 1. Try sitemap.xml / sitemap_index.xml / robots.txt → fast, complete coverage
 * 2. Fall back to parallel BFS crawl if no sitemap found
 */
export async function novadaMap(params: MapParams, apiKey?: string): Promise<string> {
  const maxUrls = Math.min(params.limit || 50, 100);
  const baseHostname = new URL(params.url).hostname.replace(/^www\./, "");
  const origin = new URL(params.url).origin;

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

  // Filter by search term if provided
  let filtered = discovered;
  if (params.search) {
    const searchLower = params.search.toLowerCase();
    filtered = discovered.filter(u => u.toLowerCase().includes(searchLower));
  }

  // SPA detection
  if (filtered.length <= 1 && !params.search) {
    const isSpaLikely = filtered.length === 0 || (filtered.length === 1 && filtered[0] === normalizeUrl(params.url));
    if (isSpaLikely) {
      return [
        `## Site Map`,
        `root: ${params.url}`,
        `urls:${filtered.length}`,
        ``,
        `---`,
        ``,
        `⚠ Only ${filtered.length === 0 ? "0 URLs" : "the root URL"} found. This site is likely a JavaScript SPA.`,
        `Static crawling cannot discover JS-rendered links.`,
        ``,
        `## Agent Hints`,
        `- Try \`novada_extract\` on ${params.url} to get the page content directly.`,
        `- If content is dynamically loaded, the extract may also be limited.`,
        `- Use \`novada_search\` with \`site:${new URL(params.url).hostname}\` to find indexed subpages.`,
      ].join("\n");
    }
  }

  if (filtered.length === 0) {
    return `No URLs found on ${params.url}${params.search ? ` matching "${params.search}"` : ""}.`;
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
    const robotsResp = await fetchViaProxy(`${origin}/robots.txt`, apiKey, { timeout: 8000 });
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
      const resp = await fetchViaProxy(sitemapUrl, apiKey, { timeout: 10000 });
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
            const childResp = await fetchViaProxy(childUrl, apiKey, { timeout: 8000 });
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
        const response = await fetchViaProxy(url, apiKey, { timeout: 10000 });
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
