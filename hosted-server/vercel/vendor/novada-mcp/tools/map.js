import { fetchViaProxy, extractLinks, normalizeUrl, isContentLink, discoverViaSitemap } from "../utils/index.js";
import { TIMEOUTS, HOSTED_SAFE_CEILING_MS } from "../config.js";
import { makeNovadaError, NovadaError, NovadaErrorCode } from "../_core/errors.js";
// Internal deadline for the BFS fallback path: stop crawling and return whatever
// was found so far rather than letting the hosted 56s wall-clock kill the tool.
// 45s keeps us well under the 50s HOSTED_SAFE_CEILING_MS, leaving ~5s for
// serialization and transport. The sitemap fast-path is unaffected — this guard
// is only entered when no sitemap is found and BFS is used.
const MAP_BFS_DEADLINE_MS = Math.min(45_000, HOSTED_SAFE_CEILING_MS);
/** Split a URL pathname into lowercase non-empty segments. */
function pathSegments(pathname) {
    return pathname.split("/").map(s => s.toLowerCase()).filter(Boolean);
}
/** Tokenize a free-text search query: lowercase, split on whitespace AND on the
 *  hyphen/underscore separators so "user guide", "user-guide" and "user_guide" all
 *  yield the same tokens. Used to match against URL path segments (finding #17). */
function tokenizeSearch(query) {
    return query.toLowerCase().split(/[\s\-_]+/).filter(Boolean);
}
/** Match a URL against tokenized search: every token must appear inside some path
 *  segment of the URL, where each segment is normalized so hyphen/underscore split
 *  into sub-tokens (so token "guide" matches segment "user-guide"). Falls back to
 *  matching against the raw segment string too, so a token like "v2" still matches a
 *  segment "api-v2". Replaces the old literal full-URL substring match (finding #17). */
function matchesSearchTokens(url, tokens) {
    if (tokens.length === 0)
        return true;
    let segments;
    try {
        segments = pathSegments(new URL(url).pathname);
    }
    catch {
        return false;
    }
    // Build the searchable token pool: each segment plus its hyphen/underscore sub-parts.
    const haystack = [];
    for (const seg of segments) {
        haystack.push(seg);
        for (const part of seg.split(/[\-_]+/).filter(Boolean))
            haystack.push(part);
    }
    return tokens.every(tok => haystack.some(h => h.includes(tok)));
}
function inScope(url, scope) {
    let segments;
    try {
        segments = pathSegments(new URL(url).pathname);
    }
    catch {
        return false;
    }
    const { basePath, maxDepth } = scope;
    if (segments.length < basePath.length)
        return false;
    for (let i = 0; i < basePath.length; i++) {
        if (segments[i] !== basePath[i])
            return false;
    }
    // Depth = how many segments deeper than the rooted sub-path this URL sits.
    return segments.length - basePath.length <= maxDepth;
}
/**
 * Map a website to discover all URLs on the site.
 * Strategy:
 * 1. Try sitemap.xml / sitemap_index.xml / robots.txt → fast, complete coverage
 * 2. Fall back to parallel BFS crawl if no sitemap found
 */
export async function novadaMap(params, apiKey) {
    const maxUrls = Math.min(params.limit || 50, 100);
    let baseHostname;
    let origin;
    try {
        const parsed = new URL(params.url);
        baseHostname = parsed.hostname.replace(/^www\./, "");
        origin = parsed.origin;
    }
    catch {
        throw makeNovadaError(NovadaErrorCode.INVALID_PARAMS, `Invalid URL: "${params.url}". URL must start with http:// or https://.`, `url:${params.url} failed URL parsing`);
    }
    try {
        return await novadaMapInner(params, apiKey, maxUrls, baseHostname, origin);
    }
    catch (err) {
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
                `- Use \`novada_extract\` with render="render" to fetch JS-rendered content directly.`,
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
async function novadaMapInner(params, apiKey, maxUrls, baseHostname, origin) {
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
    // Rooted sub-path + depth scope derived from the seed. A seed like
    // https://host/docs scopes the map to /docs/**, bounded by max_depth segments below
    // the sub-path. Root seed ("/") with default depth ⇒ effectively whole-site (finding #17).
    const scope = {
        basePath: pathSegments(new URL(params.url).pathname),
        maxDepth: Math.min(params.max_depth ?? 2, 5),
    };
    // Scope for sitemap branch: same sub-path prefix, but depth is only applied
    // when the seed has a non-root sub-path.
    //
    // Rationale: when the seed is the site root (basePath = []), applying max_depth
    // to sitemap URLs is wrong — a sitemap is an authoritative index listing ALL
    // site pages, so /api-reference/endpoint/x (depth 3) must be returned even with
    // the default max_depth=2. max_depth as a BFS hop count makes no sense for sitemaps
    // when the seed is the root.
    //
    // When the seed is a sub-path (basePath = ["docs"]), max_depth still usefully
    // scopes the result to within N segments of that sub-tree — e.g. max_depth=1
    // with /docs keeps /docs/guide but drops /docs/api/reference. (F3 fix)
    const sitemapScope = {
        basePath: scope.basePath,
        maxDepth: scope.basePath.length === 0 ? Infinity : scope.maxDepth,
    };
    // --- Phase 1: Try sitemap discovery ---
    // Fetch enough raw URLs to fill the caller limit AFTER sub-path filtering.
    // A sub-path seed (e.g. /docs) may discard many sitemap URLs that are outside
    // the scoped prefix — over-fetch by a generous multiple so the result list is full.
    const sitemapFetchBudget = maxUrls * 10;
    // ONE overall deadline for ALL network work in this tool (sitemap probe + BFS).
    // The sitemap phase (discoverViaSitemap) is a network call that can itself hang under
    // concurrency/slow-proxy — guarding only the BFS loop left this phase able to blow the
    // hosted 56s wall-clock (observed: map OK isolated, 58s TOOL_ERR under a concurrent sweep).
    // Racing both phases against a single deadline makes the whole tool bounded. (0.9.6 fix.)
    const mapDeadline = Date.now() + MAP_BFS_DEADLINE_MS;
    const DEADLINE = Symbol("map-deadline");
    const sitemapUrls = await (async () => {
        let t;
        const raced = await Promise.race([
            discoverViaSitemap(origin, apiKey, sitemapFetchBudget),
            new Promise((r) => { t = setTimeout(() => r(DEADLINE), Math.max(0, mapDeadline - Date.now())); }),
        ]);
        if (t)
            clearTimeout(t);
        // On sitemap-phase timeout, fall through to BFS (which shares mapDeadline) with an empty set.
        return raced === DEADLINE ? [] : raced;
    })();
    // When discoverViaSitemap returns exactly sitemapFetchBudget URLs, the true sitemap
    // count is unknown — the budget was the binding constraint, not the sitemap's actual size.
    // This flag is used downstream to emit ">=" floor notation in discovered counts so agents
    // are never told a precise-but-false total. (C6 fix)
    const sitemapFetchCapped = sitemapUrls.length >= sitemapFetchBudget;
    let discovered;
    // Total URLs in the sitemap's scoped set before the caller limit is applied.
    // Used to produce honest under-delivery messages: "returned X of Y sitemap entries"
    // vs "site has fewer links than requested." (F3 fix)
    let sitemapScopedTotal = 0;
    // Set to true when the BFS fallback path hit the internal deadline and returned
    // a partial result rather than a complete crawl. Used downstream to annotate
    // the output so the caller knows the result is partial.
    let bfsHitDeadline = false;
    if (sitemapUrls.length > 0) {
        // Filter to same domain, then to the rooted sub-path (no depth limit on sitemap branch).
        const scoped = sitemapUrls.filter(u => {
            try {
                const h = new URL(u).hostname.replace(/^www\./, "");
                const sameHost = h === baseHostname || (params.include_subdomains && h.endsWith(`.${baseHostname}`));
                return sameHost && inScope(u, sitemapScope);
            }
            catch {
                return false;
            }
        });
        sitemapScopedTotal = scoped.length;
        // Apply caller limit after scope filtering so the output count matches the request.
        discovered = scoped.slice(0, maxUrls);
    }
    else {
        // --- Phase 2: Parallel BFS crawl ---
        // BFS respects max_depth (each hop = one depth level) — depth IS meaningful here.
        // Share the ONE overall map deadline (already partly consumed by the sitemap phase)
        // so sitemap-probe + BFS together never exceed the hosted wall-clock.
        const bfsResult = await parallelBfsCrawl(params, apiKey, maxUrls, baseHostname, mapDeadline);
        discovered = bfsResult.urls.filter(u => inScope(u, scope));
        bfsHitDeadline = bfsResult.hitDeadline;
    }
    // SPA detection — check BEFORE search filter (search should not hide SPA failures).
    // Skip SPA detection when the BFS hit the internal deadline: a sparse result is due
    // to the time budget, NOT an SPA — the caller gets a partial result, not an error.
    const isSpaLikely = !bfsHitDeadline &&
        discovered.length <= 1 &&
        (discovered.length === 0 || discovered[0] === normalizeUrl(params.url));
    if (isSpaLikely) {
        // Throw a machine-readable SPA_NO_URLS_FOUND error; catch block below formats
        // it as a friendly agent message so the tool always returns a string (not an error block).
        throw makeNovadaError(NovadaErrorCode.SPA_NO_URLS_FOUND, `Only ${discovered.length === 0 ? "0 URLs" : "the root URL"} found on ${params.url} — likely a JavaScript SPA.`);
    }
    // Filter by search term if provided. Tokenize the query and match tokens against URL
    // path segments (hyphen/space/underscore normalized) instead of a literal full-URL
    // substring match, so "user guide" matches /docs/user-guide (finding #17).
    let filtered = discovered;
    if (params.search) {
        const tokens = tokenizeSearch(params.search);
        filtered = discovered.filter(u => matchesSearchTokens(u, tokens));
    }
    if (filtered.length === 0) {
        // BFS hit the deadline before finding any URLs (or before any survived the scope
        // filter). Return a clean "no URLs discovered" result — NOT an error — with a note
        // that the crawl was partial. The caller can retry with a shallower max_depth.
        if (bfsHitDeadline) {
            return [
                `## Site Map`,
                `root: ${params.url}`,
                `urls:0`,
                `discovery:crawl:partial`,
                ``,
                `---`,
                ``,
                `partial: deadline reached, 0 URLs found — BFS crawl stopped at ${MAP_BFS_DEADLINE_MS / 1000}s to avoid timeout.`,
                ``,
                `## Agent Hints`,
                `- The site may be slow or have very few crawlable HTML links.`,
                `- Try \`novada_extract\` on ${params.url} to read the page content directly.`,
                `- Try \`novada_map\` with max_depth=1 for a shallower crawl.`,
                `- Use \`novada_search\` with \`site:${new URL(params.url).hostname}\` to find indexed pages.`,
                ``,
                `## Agent Notice — Under-delivery`,
                `requested: ${maxUrls} | returned: 0 | shortfall: ${maxUrls}`,
                `reason: BFS crawl stopped at ${MAP_BFS_DEADLINE_MS / 1000}s internal deadline — 0 URLs discovered in time.`,
                `next_steps: Use novada_extract to read the page, or novada_search with site: operator.`,
            ].join("\n");
        }
        // When the underlying discovery pool is suspiciously small (< 10 URLs) AND we came
        // from sitemap discovery, the lack of search matches may be due to incomplete sitemap
        // parsing rather than the site having no matching pages. Warn accordingly. (F9 fix)
        // Key on sitemapScopedTotal (pre-limit) rather than discovered.length (post-limit).
        // discovered.length may be < 10 because caller set a low limit, not because the
        // sitemap is sparse — sitemapScopedTotal reflects the actual sitemap pool size. (F9 fix)
        const discoveryLikelyIncomplete = sitemapUrls.length > 0 && sitemapScopedTotal < 10;
        const hints = [
            `- Remove the 'search' filter to see all ${discovered.length} discovered URLs.`,
            `- Try a broader search term or check the URL spelling.`,
            `- Use \`novada_search\` with \`site:${new URL(params.url).hostname} ${params.search ?? ""}\` to find indexed pages.`,
        ];
        if (discoveryLikelyIncomplete) {
            hints.push(`- Note: discovery may be incomplete — only ${discovered.length} URL${discovered.length === 1 ? "" : "s"} found in sitemap. The site may have more pages not listed in the sitemap, or the sitemap may not have loaded completely.`);
        }
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
            ...hints,
        ].join("\n");
    }
    const discoveryMethod = sitemapUrls.length > 0 ? "sitemap" : (bfsHitDeadline ? "crawl:partial" : "crawl");
    const lines = [
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
        // Determine whether we are genuinely limit-capping from a larger sitemap pool, or whether
        // the site itself has fewer pages than requested.
        // sitemapScopedTotal > maxUrls means we had more sitemap entries but truncated to caller limit.
        const limitCappedFromSitemap = sitemapScopedTotal > maxUrls;
        lines.push(``, `## Agent Notice — Under-delivery`);
        lines.push(`requested: ${maxUrls} | returned: ${filtered.length} | shortfall: ${maxUrls - filtered.length}`);
        if (bfsHitDeadline) {
            lines.push(`reason: BFS crawl stopped at ${MAP_BFS_DEADLINE_MS / 1000}s internal deadline — partial result, ${filtered.length} URL${filtered.length === 1 ? "" : "s"} found before deadline.`);
            lines.push(`next_steps: Use novada_crawl for deeper extraction, or novada_search with site: operator.`);
        }
        else if (limitCappedFromSitemap) {
            // D2 fix: when sitemapFetchCapped=true, sitemapScopedTotal is bounded by the fetch budget,
            // not the true sitemap size. Use ">=" floor notation consistent with agent_instruction.
            const sitemapScopedStr = sitemapFetchCapped ? `>=${sitemapScopedTotal}` : `${sitemapScopedTotal}`;
            lines.push(`reason: Results capped at the requested limit (${maxUrls}); sitemap has ${sitemapScopedStr} URLs in scope (${params.search ? `${filtered.length} match the search filter "${params.search}"` : "all in scope"}).`);
            lines.push(`next_steps: ${params.search ? `Remove 'search' filter or i` : "I"}ncrease the \`limit\` parameter to retrieve more URLs.`);
        }
        else {
            lines.push(`reason: Site has fewer crawlable links${params.search ? ` matching "${params.search}"` : ""} than requested.`);
            lines.push(`next_steps: ${params.search ? `Remove 'search' filter to see all ${discovered.length} URLs, or t` : "T"}ry max_depth=3 or increase limit.`);
        }
    }
    lines.push(``);
    lines.push(`## Agent Action`);
    // F3 spec: only emit map_complete when the returned set is NOT a limit-capped subset of a
    // larger discovered pool. If sitemapScopedTotal > maxUrls, we truncated; omit map_complete
    // so agents do not incorrectly assume the full site has been enumerated.
    //
    // Round-3f fix: also gate on !sitemapFetchCapped. When the sitemap fetch hit the budget,
    // the true site total is unknown (>=budget), so map_complete must never be claimed even
    // if scope-filtering narrows the in-scope set to a number <= maxUrls (e.g. a deep sub-path
    // on a large site returns 3 in-scope URLs from 500 fetched, with 100s more un-fetched).
    //
    // BFS deadline: when bfsHitDeadline=true the crawl was cut short — always emit map_partial.
    const limitCappedFromSitemap = sitemapScopedTotal > maxUrls;
    if (bfsHitDeadline) {
        lines.push(`agent_instruction: map_partial urls:${filtered.length} reason:deadline_reached | BFS crawl stopped at ${MAP_BFS_DEADLINE_MS / 1000}s internal limit to avoid timeout — ${filtered.length} URL${filtered.length === 1 ? "" : "s"} found | next: novada_extract to read pages | next: novada_crawl for deeper coverage`);
    }
    else if (!limitCappedFromSitemap && !sitemapFetchCapped) {
        lines.push(`agent_instruction: map_complete urls:${filtered.length} | next: novada_extract to read pages | next: novada_crawl for bulk extraction`);
    }
    else {
        // C6 fix: when the sitemap fetch hit the budget (sitemapFetchCapped), sitemapScopedTotal
        // is bounded by the fetch budget (maxUrls*10), not the true sitemap size. Use ">=" floor
        // notation so agents are never told a precise-but-false total. When not fetch-capped, the
        // count is the true scoped total and can be reported exactly.
        const discoveredStr = sitemapFetchCapped ? `>=${sitemapScopedTotal}` : `${sitemapScopedTotal}`;
        lines.push(`agent_instruction: map_partial urls:${filtered.length} discovered:${discoveredStr} | increase \`limit\` to retrieve more URLs | next: novada_extract to read pages`);
    }
    return lines.join("\n");
}
/**
 * Parallel BFS crawl — fetches up to CONCURRENCY pages at once.
 *
 * `deadline` is an absolute timestamp (Date.now() + MAP_BFS_DEADLINE_MS). Before
 * dispatching each batch the function checks the clock: if the deadline has passed,
 * crawling stops immediately and whatever was discovered so far is returned with
 * hitDeadline=true. This prevents the hosted 56s wall-clock from killing the tool
 * mid-flight and producing an isError TOOL_ERR instead of a clean partial result.
 */
async function parallelBfsCrawl(params, apiKey, maxUrls, baseHostname, deadline) {
    const CONCURRENCY = 5;
    const maxDepth = Math.min(params.max_depth ?? 2, 5);
    const visited = new Set();
    const discovered = new Set();
    const queue = [{ url: params.url, depth: 0 }];
    const prefixCounts = new Map();
    const MAX_PER_PREFIX = Math.max(3, Math.floor(maxUrls / 5));
    discovered.add(normalizeUrl(params.url));
    while (queue.length > 0 && discovered.size < maxUrls) {
        // Deadline check: if we are at or past the deadline, stop immediately and
        // return whatever we have as a graceful partial result (never throw).
        if (Date.now() >= deadline) {
            return { urls: [...discovered], hitDeadline: true };
        }
        // Take up to CONCURRENCY items from queue
        const batch = queue.splice(0, CONCURRENCY);
        const unvisited = batch.filter(item => {
            const n = normalizeUrl(item.url);
            if (visited.has(n))
                return false;
            visited.add(n);
            return true;
        });
        if (unvisited.length === 0)
            continue;
        // Fetch all in parallel — but RACE the batch against the remaining deadline budget.
        // A between-batches deadline check is NOT enough: a single batch whose fetches hang
        // (slow proxy, retries) can itself run ~30s, so a batch dispatched just under the
        // deadline could overshoot the hosted wall-clock and produce a 504/TOOL_ERR. Racing
        // guarantees we abandon an in-flight hanging batch the instant the deadline passes and
        // return whatever was discovered so far — never a hard timeout. (Loop-3 fix, 0.9.6.)
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
            return { urls: [...discovered], hitDeadline: true };
        }
        const batchWork = Promise.allSettled(unvisited.map(async ({ url, depth }) => {
            if (depth >= maxDepth)
                return { links: [] };
            const response = await fetchViaProxy(url, apiKey, { tool: "map", timeout: TIMEOUTS.CRAWL_STATIC });
            if (typeof response.data !== "string")
                return { links: [] };
            return { links: extractLinks(response.data, url), depth };
        }));
        const DEADLINE_SENTINEL = Symbol("deadline");
        let deadlineTimer;
        const raced = await Promise.race([
            batchWork,
            new Promise((resolve) => {
                deadlineTimer = setTimeout(() => resolve(DEADLINE_SENTINEL), remainingMs);
            }),
        ]);
        if (deadlineTimer)
            clearTimeout(deadlineTimer);
        if (raced === DEADLINE_SENTINEL) {
            // Deadline fired mid-batch — abandon the in-flight fetches, return graceful partial.
            return { urls: [...discovered], hitDeadline: true };
        }
        const results = raced;
        for (const result of results) {
            if (result.status !== "fulfilled")
                continue;
            const { links, depth = 0 } = result.value;
            for (const link of links) {
                if (discovered.size >= maxUrls)
                    break;
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
                }
                catch { /* invalid URL */ }
            }
        }
    }
    return { urls: [...discovered], hitDeadline: false };
}
//# sourceMappingURL=map.js.map