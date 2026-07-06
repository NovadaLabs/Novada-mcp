import { fetchViaProxy, fetchWithRender, extractMainContent, extractTitle, extractLinks, normalizeUrl, isContentLink } from "../utils/index.js";
import { detectJsHeavyContent } from "./extract.js";
import type { CrawlParams } from "./types.js";
import { TIMEOUTS } from "../config.js";
import { makeNovadaError, NovadaErrorCode } from "../_core/errors.js";

const CRAWL_CONCURRENCY = 3;

/** Best-effort progress callback (NOV-319). Wired to MCP `notifications/progress` at the
 *  call site only when the client supplied a progressToken; otherwise undefined (no-op).
 *  Implementations MUST NOT throw — callers swallow errors so progress never breaks a tool. */
export type ProgressReporter = (info: { progress: number; total?: number; message?: string }) => void | Promise<void>;

/** Invoke a progress reporter without ever letting it break the crawl. */
async function reportProgress(
  onProgress: ProgressReporter | undefined,
  info: { progress: number; total?: number; message?: string }
): Promise<void> {
  if (!onProgress) return;
  try {
    await onProgress(info);
  } catch { /* progress is best-effort — never surface reporter failures */ }
}

interface CrawlResult {
  url: string;
  title: string;
  text: string;
  depth: number;
  wordCount: number;
  jsContentMissing?: boolean;
}

async function fetchPage(
  url: string,
  apiKey?: string,
  useRender = false
): Promise<{ html: string; url: string } | null> {
  try {
    const response = useRender
      ? await fetchWithRender(url, apiKey, { tool: "crawl", timeout: TIMEOUTS.CRAWL_RENDER, maxRedirects: 3 })
      : await fetchViaProxy(url, apiKey, { tool: "crawl", timeout: TIMEOUTS.CRAWL_STATIC, maxRedirects: 3 });
    if (typeof response.data !== "string") return null;
    return { html: String(response.data), url };
  } catch {
    return null;
  }
}

/** Max characters per path pattern. Over-long patterns are skipped (ReDoS bound). */
const MAX_PATTERN_LENGTH = 1000;
/** Max number of path patterns honored per filter list. Excess are skipped. */
const MAX_PATTERN_COUNT = 50;

/** A compiled path-glob matcher: returns true iff the URL pathname matches the glob.
 *  Exported so site_copy can type its discovery helper with the same shape. */
export type PathMatcher = (path: string) => boolean;

type GlobToken =
  | { t: "lit"; c: string }   // literal character
  | { t: "star" }             // `*`  — any run of non-`/` chars (within one segment)
  | { t: "globstar" }         // `**` — any run of any chars (crosses `/`)
  | { t: "question" };        // `?`  — exactly one non-`/` char

/** Tokenize a glob pattern. `**` is one globstar token; `*`/`?` are single tokens; every
 *  other character (including regex metacharacters) is a plain literal — so user input can
 *  never inject quantifiers/groups. */
function tokenizeGlob(pattern: string): GlobToken[] {
  const toks: GlobToken[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") { toks.push({ t: "globstar" }); i++; }
      else toks.push({ t: "star" });
    } else if (ch === "?") {
      toks.push({ t: "question" });
    } else {
      toks.push({ t: "lit", c: ch });
    }
  }
  return toks;
}

/** Compile a glob pattern into a linear-time matcher. The matcher is a dynamic-programming
 *  whole-string match (O(tokens × pathLen) time, O(pathLen) space) — there is NO backtracking
 *  RegExp involved, so crafted patterns like `*a*a*a…` can NEVER cause catastrophic
 *  (exponential) backtracking that freezes the event loop (NOV-570).
 *
 *  Glob semantics follow standard path-glob conventions:
 *  - `**` matches zero or more path segments (including the parent path itself)
 *  - A literal "/" immediately preceding "**" is optional so that:
 *      - "/foo/**" matches "/foo" (trailing parent, no trailing slash) — F4
 *      - "/a/**\/b" matches "/a/b" (mid-pattern zero-segment) — C3
 *    In both cases the "/" before "**" collapses when the globstar contributes
 *    zero path characters. Boundary correctness is preserved: "/introductionX"
 *    never matches "/introduction/**".
 *  - `*` matches within one segment; `?` matches one non-`/` char */
function globToMatcher(pattern: string): PathMatcher {
  const toks = tokenizeGlob(pattern);
  const n = toks.length;
  return (s: string): boolean => {
    const m = s.length;
    // dp[si] === can toks[ti:] match s[si:]. Build bottom-up over tokens (ti = n .. 0),
    // each row depending only on the previous (ti+1) row. Two rolling rows = O(m) space.
    let next = new Array<boolean>(m + 1).fill(false);
    next[m] = true; // empty token list matches only the empty remainder

    // For each globstar token at index ti, we need to know whether the tokens AFTER the
    // globstar (i.e. toks[ti+1:]) can match from position si WITHOUT the globstar consuming
    // any characters. This is exactly the `next` row that exists just before the globstar
    // is processed (the row computed for toks[ti+1:]). We save it keyed by token index so
    // that the preceding `lit:/` token can use it for the zero-cost skip branch.
    //
    // This is safe with the DP's bottom-up order: globstar (ti=k) is processed before
    // lit:/ (ti=k-1), so when we reach lit:/ the saved row is already populated.
    //
    // Space: one array of (m+1) booleans per globstar token in the pattern. Since pattern
    // length is capped at 1000 chars (MAX_PATTERN_LENGTH), the number of globstars is at
    // most 500 (`**` is 2 chars), so worst-case is 500 x 1001 booleans ~ 500 KB. In
    // practice patterns are short.
    const afterGlobstarRow = new Map<number, boolean[]>();

    for (let ti = n - 1; ti >= 0; ti--) {
      const tok = toks[ti];
      const cur = new Array<boolean>(m + 1).fill(false);

      if (tok.t === "globstar") {
        // Save the row that was `next` BEFORE globstar consumed anything.
        // This row encodes "can toks[ti+1:] match s[si:] with zero globstar chars".
        afterGlobstarRow.set(ti, next.slice());
      }

      for (let si = m; si >= 0; si--) {
        switch (tok.t) {
          case "globstar":
            // match zero chars (next[si]) OR consume one char of any kind (cur[si+1])
            cur[si] = next[si] || (si < m && cur[si + 1]);
            break;
          case "star":
            // match zero chars OR consume one non-`/` char
            cur[si] = next[si] || (si < m && s[si] !== "/" && cur[si + 1]);
            break;
          case "question":
            cur[si] = si < m && s[si] !== "/" && next[si + 1];
            break;
          default: { // lit
            // Standard: literal char must match at position si.
            // Special case: a literal "/" immediately before "**" is optional — the "/"
            // can be "skipped" (not consumed from the path) when the globstar contributes
            // zero characters. This supports:
            //   (a) Trailing: "/foo/**" matches "/foo" (si === m, end of path)
            //   (b) Mid-pattern: "/a/**\/b" matches "/a/b" (globstar zero-segment)
            //
            // The skip is valid iff the tokens AFTER the globstar (toks[ti+2:]) can match
            // the path from position si without the globstar consuming anything. This is
            // exactly afterGlobstarRow.get(ti+1)[si] — the "zero-cost globstar" value.
            //
            // Boundary guard: for "/introductionX" vs "/introduction/**", when si is at 'X'
            // the afterGlobstarRow for a terminal "**" is all-false except si===m, so the
            // skip never fires at non-boundary positions. This preserves the F4 correctness.
            const nextTokIsGlobstar = ti + 1 < n && toks[ti + 1].t === "globstar";
            const consumeMatch = si < m && s[si] === tok.c && next[si + 1];
            let skipBranch = false;
            if (tok.c === "/" && nextTokIsGlobstar) {
              // zeroGlobstar[si]: can toks[ti+2:] match s[si:] with the globstar eating nothing?
              const zeroGlobstar = afterGlobstarRow.get(ti + 1)!;
              skipBranch = zeroGlobstar[si];
            }
            cur[si] = consumeMatch || skipBranch;
            break;
          }
        }
      }
      next = cur;
    }
    return next[0];
  };
}

/** Compile path filters into linear-time glob matchers — never compiles raw user input as a
 * backtracking regex, so crafted ReDoS patterns cannot freeze the event loop (NOV-570).
 * Patterns are treated as GLOBS (`**`, `*`, `?`); all other characters are literals.
 * Over-long (>1000 chars) patterns are skipped; at most 50 patterns are honored.
 * Exported so site_copy reuses the exact same ReDoS-hardened compilation. */
export function compilePatterns(patterns: string[] | undefined): PathMatcher[] {
  if (!patterns?.length) return [];
  return patterns.slice(0, MAX_PATTERN_COUNT).flatMap(p => {
    // Length guard: skip over-long patterns (defense in depth above the Zod cap).
    if (p.length > MAX_PATTERN_LENGTH) return [];
    try {
      return [globToMatcher(p)];
    } catch { return []; }
  });
}

/** Check if a URL path matches select/exclude path filters.
 *  Exported so site_copy applies identical path-scope semantics. */
export function shouldCrawlUrl(
  url: string,
  selectPatterns: PathMatcher[],
  excludePatterns: PathMatcher[]
): boolean {
  let path: string;
  try { path = new URL(url).pathname; }
  catch { return false; }

  if (excludePatterns.some(match => match(path))) return false;
  if (selectPatterns.length > 0 && !selectPatterns.some(match => match(path))) return false;
  return true;
}

export async function novadaCrawl(
  params: CrawlParams,
  apiKey?: string,
  onProgress?: ProgressReporter
): Promise<string> {
  // NOV-673 fix: remove dead alias fallbacks.
  //
  // CrawlParamsSchema gives max_pages a .default(5) and strategy a .default("bfs").
  // After Zod parsing both fields are ALWAYS present, so `params.max_pages ?? params.limit`
  // and `params.strategy ?? params.mode` never reach the alias side — the `??` is unreachable
  // dead code. Keeping it creates a false contract: callers passing `limit` or `mode` get
  // silently ignored values instead of the alias behavior they expect.
  //
  // Decision: DELETE the dead alias fallbacks here (they never fired). The aliases `limit` and
  // `mode` remain in CrawlParamsSchema (types.ts, not owned by this file) until a separate fix
  // removes them from the schema or wires them at the pre-parse layer. Any caller using `limit`
  // or `mode` today receives the silent-ignore behavior they already get — no regression.
  const pageCeiling = params._maxPagesCeiling ?? 20;
  const maxPages = Math.min(params.max_pages, pageCeiling);
  const strategy = params.strategy;
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
  let sparsePageCount = 0;
  // F4: track how many discovered links were rejected by path filters so we can
  // emit an accurate diagnostic instead of blaming "JavaScript SPA".
  let pathRejectedCount = 0;
  // F8: content-hash dedup — maps a normalized content fingerprint to the first URL
  // that produced it; prevents byte-identical pages (e.g. redirect aliases) from
  // appearing as distinct results without inflating the page count.
  const contentHashes = new Set<string>();
  let duplicatesCollapsed = 0;

  const selectPatterns = compilePatterns(params.select_paths);
  const excludePatterns = compilePatterns(params.exclude_paths);

  while (queue.length > 0 && results.length < maxPages) {
    const batch: { url: string; depth: number }[] = [];
    while (batch.length < CRAWL_CONCURRENCY && queue.length > 0 && results.length + batch.length < maxPages) {
      const item = strategy === "dfs" ? queue.pop()! : queue.shift()!;
      const normalizedUrl = normalizeUrl(item.url);
      if (visited.has(normalizedUrl)) continue;
      visited.add(normalizedUrl);
      // Path filters apply to DISCOVERED child links only — the seed (depth 0) is always
      // fetched and its links discovered. A select_paths pattern that doesn't match the seed
      // must NOT abort the whole crawl (was a fake URL_UNREACHABLE — finding #7).
      if (item.depth > 0 && !shouldCrawlUrl(item.url, selectPatterns, excludePatterns)) {
        continue;
      }
      batch.push(item);
    }

    if (batch.length === 0) break;

    const useRender = renderMode === "render" || (renderMode === "auto" && renderDetected);
    const pages = await Promise.all(batch.map((item) => fetchPage(item.url, apiKey, useRender)));
    // Track whether each page was ultimately fetched with render
    const pageRendered: boolean[] = batch.map(() => useRender);

    // Auto-detect JS-heavy: if first batch static results show JS-heavy, switch to render
    if (renderMode === "auto" && !renderDetected) {
      const jsHeavyFound = pages.some(p => p !== null && detectJsHeavyContent(p.html));
      if (jsHeavyFound) {
        renderDetected = true;
        // Re-fetch JS-heavy pages in parallel
        const jsHeavyIndexes = pages
          .map((p, i) => (p !== null && detectJsHeavyContent(p.html)) ? i : -1)
          .filter(i => i >= 0);
        if (jsHeavyIndexes.length > 0) {
          const refetched = await Promise.all(
            jsHeavyIndexes.map(i => fetchPage(batch[i].url, apiKey, true))
          );
          jsHeavyIndexes.forEach((origIdx, j) => {
            pages[origIdx] = refetched[j];
            pageRendered[origIdx] = true;
          });
        }
      }
    }

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (!page) { failedCount++; continue; }

      const title = extractTitle(page.html);
      const text = extractMainContent(page.html, batch[i].url, 3000);
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      const jsHeavy = detectJsHeavyContent(page.html);
      const jsRendered = pageRendered[i];
      const jsMissing = jsHeavy && !jsRendered;

      if (wordCount < 20) {
        sparsePageCount++;
        continue;
      }

      // F8: content-hash dedup — if two URLs return byte-identical extracted text
      // (e.g. root "/" redirects to "/introduction" on some doc sites), treat them as
      // the same page and skip the duplicate. A simple 32-char hash of the first 500 chars
      // of normalized text is sufficient; full MD5 would be overkill for content dedup.
      const contentFingerprint = text.slice(0, 500).replace(/\s+/g, " ").trim();
      if (contentHashes.has(contentFingerprint)) {
        duplicatesCollapsed++;
        continue; // duplicate content — skip, already counted via the first URL
      }
      contentHashes.add(contentFingerprint);

      const jsContentMissing = jsMissing ? true : undefined;
      results.push({ url: batch[i].url, title, text, depth: batch[i].depth, wordCount, jsContentMissing });

      // NOV-319: emit a per-page progress notification (no-op when no progressToken).
      await reportProgress(onProgress, {
        progress: results.length,
        total: maxPages,
        message: `Crawled ${results.length}/${maxPages}: ${batch[i].url}`,
      });

      // Discover links, applying path filters before queuing
      const links = extractLinks(page.html, batch[i].url);
      for (const link of links) {
        try {
          const linkHostname = new URL(link).hostname.replace(/^www\./, "");
          const normalizedLink = normalizeUrl(link);
          if (
            linkHostname === baseHostname &&
            !visited.has(normalizedLink) &&
            isContentLink(link)
          ) {
            if (shouldCrawlUrl(link, selectPatterns, excludePatterns)) {
              queue.push({ url: link, depth: batch[i].depth + 1 });
            } else {
              // F4: count links that exist but were rejected by path filters —
              // used to suppress the false JS-SPA diagnostic.
              pathRejectedCount++;
            }
          }
        } catch { /* invalid URL */ }
      }
    }
  }

  if (results.length === 0) {
    if (sparsePageCount > 0) {
      // Pages were fetched but all had sparse content — try a render diagnostic before throwing
      let renderHint = "";
      if (renderMode !== "render") {
        try {
          const renderPage = await fetchPage(params.url, apiKey, true);
          if (renderPage) {
            const renderText = extractMainContent(renderPage.html, params.url, 3000);
            const renderWordCount = renderText.split(/\s+/).filter(Boolean).length;
            if (renderWordCount >= 20) {
              renderHint = ` Re-try with render="render" parameter — rendered version has content (${renderWordCount} words detected).`;
            }
          }
        } catch { /* diagnostic only — swallow errors */ }
      }
      throw makeNovadaError(
        NovadaErrorCode.URL_UNREACHABLE,
        `crawl fetched ${sparsePageCount} page(s) from ${params.url} but all had sparse content (< 20 words). ` +
        `This usually means the site returns a bot challenge or requires JavaScript rendering. ` +
        `Try: (1) set render="render" to force JS rendering, (2) use novada_extract on individual pages, ` +
        `(3) use novada_extract with render="browser" for heavily protected sites.${renderHint}`,
        "sparse_content"
      );
    }
    throw makeNovadaError(
      NovadaErrorCode.URL_UNREACHABLE,
      `Failed to crawl ${params.url} — no pages could be fetched. Check the URL is accessible and try novada_extract on the URL directly to diagnose connectivity.`,
      "no_pages_fetched"
    );
  }

  const totalWords = results.reduce((sum, r) => sum + r.wordCount, 0);
  const jsMissingCount = results.filter(r => r.jsContentMissing).length;
  const stoppedEarly = results.length < maxPages;
  const exhaustedLinks = stoppedEarly && queue.length === 0;
  // F4: when select_paths/exclude_paths are active AND links were discovered but rejected,
  // do NOT blame JavaScript SPA — the empty queue is because of the path filter, not the site.
  const filtersActive = selectPatterns.length > 0 || excludePatterns.length > 0;
  const stopReason = stoppedEarly
    ? exhaustedLinks
      ? filtersActive && pathRejectedCount > 0
        ? `${pathRejectedCount} link(s) discovered but rejected by select_paths/exclude_paths filters. Remove or widen the filters to crawl more pages.`
        : "No more same-domain links to follow. Site may be a JavaScript SPA (React/Vue/Angular) or Swagger/Redoc API docs — these generate routes dynamically and static link extraction misses most pages."
      : "Remaining links were filtered by path rules or already visited."
    : "";

  // ── JSON output mode ──────────────────────────────────────────────────────
  if (params.format === "json") {
    const jsonResult = {
      status: "ok",
      root_url: params.url,
      pages_crawled: results.length,
      strategy,
      source: "live",
      total_words: totalWords,
      failed: failedCount,
      js_missing: jsMissingCount > 0 ? jsMissingCount : undefined,
      // F8: duplicates_collapsed is set when byte-identical pages were collapsed.
      // unique_pages equals pages_crawled (all results are content-distinct).
      duplicates_collapsed: duplicatesCollapsed > 0 ? duplicatesCollapsed : undefined,
      pages: results.map(r => ({
        url: r.url,
        title: r.title,
        depth: r.depth,
        word_count: r.wordCount,
        js_content_missing: r.jsContentMissing || false,
        text: r.text,
      })),
      agent_instruction: `Crawl complete. ${results.length} pages extracted. To read a specific page use novada_extract. To discover more pages use novada_map.`,
    };
    return JSON.stringify(jsonResult, null, 2);
  }

  const jsMissingSummary = ` | js_pages_missing_render:${jsMissingCount}`;
  const instructionsNote = params.instructions
    ? `\ninstructions: "${params.instructions}" (path filters applied; apply semantic filtering on your side)`
    : "";

  const lines: string[] = [
    `## Crawl Results`,
    `root: ${params.url}`,
    `pages:${results.length} | strategy:${strategy} | source: live | total_words:${totalWords} | failed:${failedCount}${jsMissingSummary}${instructionsNote}`,
    stoppedEarly && stopReason ? `note: Stopped early — ${stopReason}` : "",
    ``,
    `---`,
    ``,
  ].filter(l => l !== "");

  // Cap total crawl text to ~25K chars to prevent oversized output
  const MAX_CRAWL_TOTAL = 25000;
  const rawTextTotal = results.reduce((sum, r) => sum + r.text.length, 0);
  let crawlTruncated = false;
  if (rawTextTotal > MAX_CRAWL_TOTAL) {
    const perPageLimit = Math.max(200, Math.floor(MAX_CRAWL_TOTAL / results.length));
    for (const r of results) {
      if (r.text.length > perPageLimit) {
        r.text = r.text.slice(0, perPageLimit) +
          `\n[truncated — call novada_extract on this URL for full content]`;
        crawlTruncated = true;
      }
    }
  }

  lines.push(`## Agent Hints`);
  lines.push(`- ${results.length} pages crawled. For targeted extraction, use novada_map first then novada_extract on chosen pages.`);
  if (crawlTruncated) {
    lines.push(`- Crawl text capped at ~${MAX_CRAWL_TOTAL} chars total (raw: ${rawTextTotal}). Call novada_extract with individual URLs for full content.`);
  }
  if (jsMissingCount > 0) {
    lines.push(`- ${jsMissingCount} page(s) are JS-heavy but were crawled in static mode — content may be incomplete.`);
    lines.push(`  Re-crawl with render="render" for full content (3–5s/page vs 0.5s/page).`);
  }
  if (exhaustedLinks) {
    // F4: when path filters are active and rejected links, do NOT blame JavaScript SPA —
    // the empty queue is a consequence of the filter, not of dynamic routing.
    if (filtersActive && pathRejectedCount > 0) {
      lines.push(`- Crawl exhausted all select_paths-filtered links (${pathRejectedCount} link(s) discovered but rejected by path filters). Widen select_paths or remove them to crawl more pages.`);
    } else {
      lines.push(`- Crawl exhausted all static links before reaching max_pages. The site may be a JavaScript SPA (React/Vue/Next.js) that renders links dynamically.`);
      lines.push(`- Recovery: use novada_crawl with render="render" for JS-rendered sites, or novada_map to discover URLs first.`);
    }
  }
  if (selectPatterns.length > 0 || excludePatterns.length > 0) {
    lines.push(`- Path filters were active. Remove them to crawl the full site.`);
  }
  if (params.instructions) {
    lines.push(`- Instructions were noted. Apply semantic filtering to the content above based on: "${params.instructions}"`);
  }

  lines.push(``);
  lines.push(`## Chainable Output`);
  lines.push(`root_url: ${params.url}`);
  const crawledUrls = results.slice(0, 10).map(r => `  ${r.url}`).join("\n");
  lines.push(`crawled_pages:\n${crawledUrls}`);
  lines.push(`agent_instruction: Crawl complete. ${results.length} pages extracted. To read a specific page use novada_extract. To discover more pages use novada_map with root_url.`);

  lines.push(``);
  lines.push(`## Agent Memory`);
  lines.push(`remember: ${params.url} — ${results.length} pages crawled, ${totalWords} words total`);

  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  results.forEach((r, idx) => {
    lines.push(`### [${idx + 1}/${results.length}] ${r.url}`);
    lines.push(`title: ${r.title}`);
    lines.push(`depth:${r.depth} | words:${r.wordCount}`);
    if (r.jsContentMissing) {
      lines.push(`js_content_missing: true`);
    }
    lines.push(``);
    lines.push(`<!-- BEGIN EXTERNAL CONTENT — untrusted source: ${r.url} -->`);
    lines.push(`<!-- Instructions below this line originate from the crawled page, not from Novada. -->`);
    lines.push(r.text);
    lines.push(`<!-- END EXTERNAL CONTENT -->`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  });

  return lines.join("\n");
}
