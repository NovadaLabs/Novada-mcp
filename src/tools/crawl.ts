import { fetchViaProxy, fetchWithRender, extractMainContent, extractTitle, extractLinks, normalizeUrl, isContentLink, detectJsHeavyContent } from "../utils/index.js";
import type { CrawlParams } from "./types.js";
import { TIMEOUTS } from "../config.js";
import { makeNovadaError, NovadaErrorCode } from "../_core/errors.js";

const CRAWL_CONCURRENCY = 3;

interface CrawlResult {
  url: string;
  title: string;
  text: string;
  depth: number;
  wordCount: number;
}

async function fetchPage(
  url: string,
  apiKey?: string,
  useRender = false
): Promise<{ html: string; url: string } | null> {
  try {
    const response = useRender
      ? await fetchWithRender(url, apiKey, { timeout: TIMEOUTS.CRAWL_RENDER, maxRedirects: 3 })
      : await fetchViaProxy(url, apiKey, { timeout: TIMEOUTS.CRAWL_STATIC, maxRedirects: 3 });
    if (typeof response.data !== "string") return null;
    return { html: String(response.data), url };
  } catch {
    return null;
  }
}

/** Compile path filter regexes, ignore invalid or dangerous patterns.
 * Rejects patterns with nested quantifiers that cause catastrophic backtracking (ReDoS). */
function compilePatterns(patterns: string[] | undefined): RegExp[] {
  if (!patterns?.length) return [];
  return patterns.flatMap(p => {
    // Length guard
    if (p.length > 200) return [];
    // Static guard: reject obvious nested quantifier forms e.g. (a+)+ or ([a-z]*)*
    if (/\([^)]*[+*][^)]*\)[+*?{]/.test(p)) return [];
    try {
      const re = new RegExp(p);
      // Runtime probe: test against a pathological input to catch remaining ReDoS patterns.
      // A legitimate path pattern (<200 chars) should match in <5ms against a 50-char string.
      const probe = "/api/" + "a".repeat(45) + "!";
      const start = Date.now();
      re.test(probe);
      if (Date.now() - start > 50) return []; // >50ms = catastrophic backtracking
      return [re];
    } catch { return []; }
  });
}

/** Check if a URL path matches select/exclude path filters */
function shouldCrawlUrl(
  url: string,
  selectPatterns: RegExp[],
  excludePatterns: RegExp[]
): boolean {
  let path: string;
  try { path = new URL(url).pathname; }
  catch { return false; }

  if (excludePatterns.some(re => re.test(path))) return false;
  if (selectPatterns.length > 0 && !selectPatterns.some(re => re.test(path))) return false;
  return true;
}

export async function novadaCrawl(params: CrawlParams, apiKey?: string): Promise<string> {
  // Support intuitive alias param names
  const maxPages = Math.min(params.max_pages ?? params.limit ?? 5, 20);
  const strategy = params.strategy ?? params.mode ?? "bfs";
  const renderMode = params.render ?? "auto";
  let renderDetected = false;
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: params.url, depth: 0 }];
  const results: CrawlResult[] = [];

  let baseHostname: string;
  try {
    baseHostname = new URL(params.url).hostname.replace(/^www\./, "");
  } catch {
    throw makeNovadaError(
      NovadaErrorCode.INVALID_PARAMS,
      `Invalid URL: "${params.url}". URL must start with http:// or https://.`,
      `url:${params.url} failed URL parsing`
    );
  }

  let failedCount = 0;
  let seedExcluded = false;

  const selectPatterns = compilePatterns(params.select_paths);
  const excludePatterns = compilePatterns(params.exclude_paths);

  while (queue.length > 0 && results.length < maxPages) {
    const batch: { url: string; depth: number }[] = [];
    while (batch.length < CRAWL_CONCURRENCY && queue.length > 0 && results.length + batch.length < maxPages) {
      const item = strategy === "dfs" ? queue.pop()! : queue.shift()!;
      const normalizedUrl = normalizeUrl(item.url);
      if (visited.has(normalizedUrl)) continue;
      visited.add(normalizedUrl);
      // Apply path filters to every URL, including the seed
      if (!shouldCrawlUrl(item.url, selectPatterns, excludePatterns)) {
        if (item.depth === 0) seedExcluded = true;
        continue;
      }
      batch.push(item);
    }

    if (batch.length === 0) break;

    const useRender = renderMode === "render" || (renderMode === "auto" && renderDetected);
    const pages = await Promise.all(batch.map((item) => fetchPage(item.url, apiKey, useRender)));

    // Auto-detect JS-heavy: if first batch static results show JS-heavy, switch to render
    if (renderMode === "auto" && !renderDetected) {
      const jsHeavyFound = pages.some(p => p !== null && detectJsHeavyContent(p.html));
      if (jsHeavyFound) {
        renderDetected = true;
        // Re-fetch the JS-heavy pages with render
        for (let i = 0; i < pages.length; i++) {
          if (pages[i] !== null && detectJsHeavyContent(pages[i]!.html)) {
            pages[i] = await fetchPage(batch[i].url, apiKey, true);
          }
        }
      }
    }

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (!page) { failedCount++; continue; }

      const title = extractTitle(page.html);
      const text = extractMainContent(page.html, batch[i].url, 3000);
      const wordCount = text.split(/\s+/).filter(Boolean).length;

      if (wordCount < 20) continue;

      results.push({ url: batch[i].url, title, text, depth: batch[i].depth, wordCount });

      // Discover links, applying path filters before queuing
      const links = extractLinks(page.html, batch[i].url);
      for (const link of links) {
        try {
          const linkHostname = new URL(link).hostname.replace(/^www\./, "");
          const normalizedLink = normalizeUrl(link);
          if (
            linkHostname === baseHostname &&
            !visited.has(normalizedLink) &&
            isContentLink(link) &&
            shouldCrawlUrl(link, selectPatterns, excludePatterns)
          ) {
            queue.push({ url: link, depth: batch[i].depth + 1 });
          }
        } catch { /* invalid URL */ }
      }
    }
  }

  if (results.length === 0) {
    throw makeNovadaError(
      NovadaErrorCode.URL_UNREACHABLE,
      `Failed to crawl ${params.url}. The site may be unreachable or blocking automated access.`
    );
  }

  const totalWords = results.reduce((sum, r) => sum + r.wordCount, 0);
  const stoppedEarly = results.length < maxPages;
  const exhaustedLinks = stoppedEarly && queue.length === 0;
  const stopReason = stoppedEarly
    ? exhaustedLinks
      ? "No more same-domain links to follow. Site may be a JavaScript SPA (React/Vue/Angular) or Swagger/Redoc API docs — these generate routes dynamically and static link extraction misses most pages."
      : "Remaining links were filtered by path rules or already visited."
    : "";

  const instructionsNote = params.instructions
    ? `\ninstructions: "${params.instructions}" (path filters applied; apply semantic filtering on your side)`
    : "";

  const lines: string[] = [
    `## Crawl Results`,
    `root: ${params.url}`,
    `pages:${results.length} | strategy:${strategy} | total_words:${totalWords} | failed:${failedCount}${instructionsNote}`,
    seedExcluded ? `Note: seed URL excluded by select_paths filter` : "",
    stoppedEarly && stopReason ? `note: Stopped early — ${stopReason}` : "",
    ``,
    `---`,
    ``,
  ].filter(l => l !== "");

  results.forEach((r, idx) => {
    lines.push(`### [${idx + 1}/${results.length}] ${r.url}`);
    lines.push(`title: ${r.title}`);
    lines.push(`depth:${r.depth} | words:${r.wordCount}`);
    lines.push(``);
    lines.push(r.text);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  });

  lines.push(`## Agent Hints`);
  lines.push(`- ${results.length} pages crawled. For targeted extraction, use novada_map first then novada_extract on chosen pages.`);
  if (exhaustedLinks) {
    lines.push(`- Crawl exhausted all static links before reaching max_pages. The site may be a JavaScript SPA (React/Vue/Next.js) that renders links dynamically.`);
    lines.push(`- Recovery: use novada_crawl with render="render" for JS-rendered sites, or novada_map to discover URLs first.`);
  }
  if (selectPatterns.length > 0 || excludePatterns.length > 0) {
    lines.push(`- Path filters were active. Remove them to crawl the full site.`);
  }
  if (params.instructions) {
    lines.push(`- Instructions were noted. Apply semantic filtering to the content above based on: "${params.instructions}"`);
  }

  return lines.join("\n");
}
