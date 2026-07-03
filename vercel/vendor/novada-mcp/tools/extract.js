import * as cheerio from "cheerio";
import { fetchWithRetry, fetchViaProxy, fetchWithRender, extractMainContent, extractFullPageContent, extractTitleFrom, extractDescriptionFrom, extractLinksFrom, detectJsHeavyContent, detectBotChallenge, identifyAntiBot, fetchViaBrowser, isBrowserConfigured, extractStructuredDataFrom, scoreExtraction, qualityLabel, lookupDomain, extractFields, isPdfResponse, extractPdf, USER_AGENT, detectKuferAvailability, truncatePreservingTable } from "../utils/index.js";
import { matchHeadingSectionWithReason } from "../utils/fields.js";
import { saveOutput } from "../utils/output.js";
import { makeNovadaError, NovadaErrorCode, redactSecrets } from "../_core/errors.js";
import { getCached, setCached } from "../_core/session-cache.js";
import { getRouteHint, recordRouteSuccess } from "../_core/route-memory.js";
import { TIMEOUTS } from "../config.js";
import { isBrowserAvailableOnRuntime, getBrowserUnavailableError } from "../utils/runtime.js";
export { detectJsHeavyContent } from "../utils/index.js";
/**
 * Default character ceiling applied to extracted content when the caller does not
 * pass max_chars. Matches docs (novada-mcp-documentation.md) and the extract test
 * suite, and aligns with extractMainContent's internal 25000 cap so a default
 * extraction never double-truncates. Hoisted to module scope so the single-URL
 * path, the PDF slice, and any future call site share one source of truth.
 */
const MAX_CHARS_DEFAULT = 25000;
/**
 * Cross-tool hint map: base domain → the best novada_scrape operation for structured data.
 * Used by both the JSON and markdown output paths to suggest novada_scrape when extraction
 * quality is poor (P2-3). Single source of truth so the two hint sites can never drift.
 */
const SCRAPER_PLATFORMS = {
    "amazon.com": "amazon_product_keywords", "reddit.com": "reddit_subreddit_posts",
    "github.com": "github_repository_repo-url", "tiktok.com": "tiktok_posts_url",
    "linkedin.com": "linkedin_company_information_url", "youtube.com": "youtube_video_search_label",
    "instagram.com": "instagram_profile_url", "twitter.com": "twitter_profile_username",
    "x.com": "twitter_profile_username", "glassdoor.com": "glassdoor_company_reviews_url",
};
/** Markdown annotation for a resolved field's source (used in the Requested Fields block). */
function sourceAnnotation(source) {
    switch (source) {
        case "jsonld":
            return " *(from schema)*";
        case "microdata":
            return " *(microdata)*";
        case "infobox":
            return " *(infobox)*";
        case "table":
            return " *(table)*";
        case "heading":
            return " *(from heading)*";
        case "llm":
            return " *(llm)*";
        default:
            return " *(pattern)*";
    }
}
/**
 * Parse the per-page returned/total char counts and truncation flag out of a single
 * extractSingle markdown/JSON result so the batch wrapper can surface consistent
 * per-item flags without re-truncating. Best-effort: an error/timeout block (no
 * recognizable content meta) is reported as not-truncated rather than crashing.
 */
function parseItemStats(content) {
    const returnedChars = content.length;
    // NOV-578 #4: match ONLY the extractor's own meta emission, never arbitrary page body.
    // extractSingle emits truncation exactly two ways:
    //   - markdown meta line:  `... | content_truncated:true | total_chars:N`  (pipe-separated)
    //   - JSON field:          `"content_truncated": true, ... "total_chars": N`  (quoted key)
    // The old loose regex (/content_truncated"?[:=]\s*true/i over the whole body, `=` allowed)
    // also fired when a SCRAPED PAGE contained the string — e.g. a doc page about this very API,
    // or a JSON sample — reporting phantom truncation and a wrong total_chars. Anchoring to the
    // pipe-prefixed markdown token or the quoted-key JSON form decouples it from page content.
    const truncated = /\|\s*content_truncated:true\b/.test(content) || // markdown meta line
        /"content_truncated"\s*:\s*true\b/.test(content); // JSON field
    let totalChars = null;
    const totalMatch = content.match(/\|\s*total_chars:(\d+)/) || // markdown meta line
        content.match(/"total_chars"\s*:\s*(\d+)/); // JSON field
    if (totalMatch)
        totalChars = parseInt(totalMatch[1], 10);
    return { returnedChars, truncated, totalChars };
}
/**
 * Extract readable/structured content from a URL.
 * Returns cleaned markdown, JSON fields, or summaries — content processed for agent consumption.
 *
 * Distinction from novada_unblock:
 *   - novada_extract  → readable/structured content (markdown, JSON, fields, summaries).
 *                       Best for: articles, docs, product pages, any page where you want processed text.
 *   - novada_unblock  → raw HTML (full DOM source) for custom parsing or inspecting page structure.
 *                       Best for: when you need the actual source, CSS-selector workflows, or debugging DOM.
 *
 * Handles Cloudflare, DataDome, JS-heavy SPAs automatically via auto-escalation.
 */
export async function novadaExtract(params, apiKey) {
    // P1-6: Normalize url/urls into a list
    const urlList = params.urls
        ? params.urls
        : Array.isArray(params.url)
            ? params.url
            : [params.url];
    if (urlList.length > 10) {
        throw makeNovadaError(NovadaErrorCode.INVALID_PARAMS, `Batch extract accepts at most 10 URLs per call. Received ${urlList.length}. Split into multiple calls.`, `url_count:${urlList.length} exceeds max:10`);
    }
    const isBatch = urlList.length > 1;
    // Batch mode: array of URLs (via urls param or url array)
    if (isBatch) {
        const urls = urlList;
        const results = await Promise.all(urls.map((url, i) => extractSingle({ ...params, url }, apiKey)
            .then(content => ({ i, url, content, ok: true }))
            .catch(err => {
            const rawMessage = err instanceof Error ? err.message : String(err);
            const message = redactSecrets(rawMessage);
            const fix = getSuggestedFix(url, rawMessage);
            return { i, url, content: `Error: ${message}\n${fix}`, ok: false };
        })));
        const successful = results.filter(r => r.ok).length;
        const failed = results.length - successful;
        // NOV-670: Return a COMPACT inline summary so agents don't drown in 62k+ tokens
        // from concatenated full pages. Each item gets: url, ok/failed, title (extracted),
        // availability_status (if present), and a short snippet (~max_chars/N chars).
        // The full per-page content is still written to disk for recovery.
        //
        // NOV-563/568: Each extractSingle already honors max_chars (default MAX_CHARS_DEFAULT).
        // We no longer re-truncate per page — instead we emit compact summaries inline and
        // save full content to disk.
        // Per-item snippet budget: divide max_chars across all URLs (min 500 chars per item)
        const perItemBudget = Math.max(500, Math.floor((params.max_chars ?? MAX_CHARS_DEFAULT) / urls.length));
        // Build compact summary table
        const summaryLines = [
            `## Batch Extract Results`,
            `urls:${urls.length} | successful:${successful} | failed:${failed}`,
            ``,
        ];
        // Extract title from content block (best-effort)
        function extractTitleFromBlock(content) {
            const m = content.match(/^title:\s*(.+)$/m);
            return m ? m[1].trim() : "(no title)";
        }
        // Extract availability_status from Kufer block (if present)
        function extractAvailabilityFromBlock(content) {
            const m = content.match(/^availability_status:\s*(.+)$/m);
            return m ? m[1].trim() : null;
        }
        // Build compact per-item rows
        for (const r of results) {
            const stats = parseItemStats(r.content);
            const itemTitle = r.ok ? extractTitleFromBlock(r.content) : "FAILED";
            const availability = r.ok ? extractAvailabilityFromBlock(r.content) : null;
            const totalPart = stats.totalChars !== null ? ` | total_chars:${stats.totalChars}` : "";
            const availPart = availability ? ` | availability:${availability}` : "";
            const statusPart = r.ok ? "ok" : "failed";
            summaryLines.push(`### [${r.i + 1}/${urls.length}] ${statusPart.toUpperCase()}: ${r.url}`);
            summaryLines.push(`title: ${itemTitle}`);
            summaryLines.push(`chars:${stats.returnedChars} | content_truncated:${stats.truncated}${totalPart}${availPart}`);
            // Short snippet — strip the header block, take first perItemBudget chars of content
            if (r.ok) {
                const contentStart = r.content.indexOf("---\n");
                const snippetSource = contentStart !== -1 ? r.content.slice(contentStart + 4) : r.content;
                const snippet = snippetSource.slice(0, perItemBudget).trim();
                if (snippet) {
                    summaryLines.push(``);
                    summaryLines.push(snippet + (snippetSource.length > perItemBudget ? "\n…" : ""));
                }
            }
            else {
                summaryLines.push(``);
                summaryLines.push(r.content.slice(0, 500));
            }
            summaryLines.push(``);
            summaryLines.push(`---`);
            summaryLines.push(``);
        }
        summaryLines.push(`## Agent Hints`);
        if (failed > 0) {
            summaryLines.push(`- ${failed} URL(s) failed. Re-run failed URLs individually for details.`);
        }
        summaryLines.push(`- Inline content is a compact snippet (${perItemBudget} chars/item). Full content per page is saved to disk — see path: line below.`);
        summaryLines.push(`- To get full content for a specific URL, call novada_extract with that single URL.`);
        summaryLines.push(`- Use novada_map to discover additional pages on any of these domains.`);
        // Build the full output for disk (the original full concatenation)
        const fullLines = [
            `## Batch Extract Results (Full)`,
            `urls:${urls.length} | successful:${successful} | failed:${failed}`,
            ``,
            `---`,
            ``,
        ];
        for (const r of results) {
            fullLines.push(`### [${r.i + 1}/${urls.length}] ${r.url}`);
            if (!r.ok)
                fullLines.push(`status: FAILED`);
            const stats = parseItemStats(r.content);
            const totalPart = stats.totalChars !== null ? ` | total_chars:${stats.totalChars}` : "";
            fullLines.push(`returned_chars:${stats.returnedChars} | content_truncated:${stats.truncated}${totalPart}`);
            fullLines.push(``);
            fullLines.push(r.content);
            fullLines.push(``);
            fullLines.push(`---`);
            fullLines.push(``);
        }
        const batchOutput = fullLines.join("\n");
        // Best-effort: persist the FULL batch to disk; return compact summary inline.
        // Agents that truncate long responses still see where the full result landed.
        let batchPrefix = "";
        try {
            const firstUrl = urls[0];
            const hint = (() => {
                try {
                    return `batch-${new URL(firstUrl).hostname.replace(/^www\./, "")}`;
                }
                catch {
                    return "batch";
                }
            })();
            const outputResult = await saveOutput({
                tool: "extract",
                hint,
                format: "md",
                data: batchOutput,
                project: params.project,
            });
            // FIX-1: Redact absolute path so home dir doesn't leak to hosted consumers.
            batchPrefix = `path: ${redactSecrets(outputResult.filePath)}\n\n`;
        }
        catch { /* best-effort */ }
        // Return compact inline summary (NOV-670); full content is on disk at batchPrefix path
        return batchPrefix + summaryLines.join("\n");
    }
    // Single URL mode
    try {
        return await extractSingle({ ...params, url: urlList[0] }, apiKey);
    }
    catch (err) {
        const rawMessage = err instanceof Error ? err.message : String(err);
        const message = redactSecrets(rawMessage);
        const suggestedFix = getSuggestedFix(urlList[0], rawMessage);
        return [
            `## Extract Failed`,
            `url: ${urlList[0]}`,
            ``,
            `Error: ${message}`,
            ``,
            `## Agent Hints`,
            `- If the URL returns JSON or binary data, it cannot be extracted as HTML.`,
            `- If the URL is unreachable, check the domain and try novada_map first.`,
            `- For JS-heavy pages returning empty content, try with render="render".`,
            ``,
            `## Agent Action`,
            `agent_instruction: status:failed | ${suggestedFix}`,
        ].join("\n");
    }
}
/**
 * NOV-672: Build a context-aware agent_instruction from the actual extraction outcome.
 *
 * Priority order (first matching rule wins):
 * 1. fields requested & ≥half null → suggest render="render" for JS-rendered values
 * 2. content_truncated → suggest raising max_chars
 * 3. listing page (many rows/links, low prose) → suggest drilling into per-item URLs
 * 4. success with content_ok → minimal success note
 * 5. low quality → suggest render escalation
 */
function buildContextualAgentInstruction(ctx) {
    const { contentOk, qualityScore, contentPresent, shortButComplete, usedMode, renderMode, fieldResults, contentTruncated, maxChars, totalChars, mainContent, params } = ctx;
    // 1. Fields requested with ≥ half null → JS-rendered values likely missing
    if (fieldResults && fieldResults.length > 0) {
        const unresolvedCount = fieldResults.filter(r => r.source === "unresolved").length;
        if (unresolvedCount >= fieldResults.length / 2) {
            return `status:partial_fields | ${unresolvedCount}/${fieldResults.length} fields null — values may be JS-rendered; retry with render="render" to fetch dynamic content`;
        }
    }
    // 2. Content truncated → suggest raising max_chars
    if (contentTruncated) {
        const suggestedHigher = Math.min(maxChars * 2, 100000);
        return `status:truncated | showing ${maxChars} of ${totalChars} chars — pass max_chars=${suggestedHigher} to retrieve more content`;
    }
    // 3. Listing page detection: many markdown table rows or many list items, short avg line
    if (contentOk) {
        const tableRowCount = (mainContent.match(/^\|/gm) ?? []).length;
        const listItemCount = (mainContent.match(/^- /gm) ?? []).length;
        const isListingPage = tableRowCount >= 10 || listItemCount >= 15;
        if (isListingPage) {
            return `status:success | listing page detected — extract individual item URLs for detailed data on each entry`;
        }
    }
    // 4. Success with good content. R4: a short-but-complete page is a success, not
    // a low-quality verdict — emit an informational note, never a "retry render" fix.
    if (contentOk) {
        if (shortButComplete) {
            return `status:success | note: short page (${mainContent.trim() ? mainContent.trim().split(/\s+/).length : 0} words) — complete but brief; retry render="render" only if you expected more`;
        }
        return `status:success`;
    }
    // 5. Content genuinely absent (empty / bot-challenge / JS-empty) → escalation helps.
    // R4: only reached when content is NOT present, so "retry render" is honest here.
    if (!contentPresent && usedMode === "static" && renderMode === "auto") {
        return `status:no_content | page returned no usable content — retry with render="render" for JS-heavy or bot-protected pages`;
    }
    // 6. Generic no-content on static.
    if (!contentPresent && usedMode === "static") {
        return `status:no_content | retry with render="render"`;
    }
    return `status:no_content quality:${qualityScore}/100`;
}
/** Derive a suggested_fix hint from a URL + error message */
function getSuggestedFix(url, errorMsg) {
    const lower = errorMsg.toLowerCase();
    // P0: 5001 / PRODUCT_UNAVAILABLE — Web Unblocker not activated.
    // Must be checked FIRST: the 5001 message contains "render/JS modes" which would
    // otherwise match the generic "js" branch below and incorrectly suggest re-using
    // render="render" — the very mode that just triggered the 5001.
    if (lower.includes("5001") || lower.includes("retrying will not help")) {
        return `suggested_fix: Web Unblocker not activated on this account. Activate at https://dashboard.novada.com/overview/web-unblocker/ or retry with render="static" (no unblocker needed)`;
    }
    // P1: render mode itself returned a bot-challenge page — do NOT suggest render="render"
    // again (it was just tried and returned the challenge). Escalate to browser or unblock.
    if (lower.includes("render returned a bot challenge") || lower.includes("bot challenge page")) {
        return `suggested_fix: render mode returned a bot-challenge page — do not retry with render="render". Try: render="browser" with NOVADA_BROWSER_WS configured, or novada_unblock(url="${url}") for raw HTML via stealth browser`;
    }
    // Known anti-bot / access-denial patterns
    if (lower.includes("bot") || lower.includes("challenge") || lower.includes("captcha") ||
        lower.includes("cloudflare") || lower.includes("403") || lower.includes("forbidden") ||
        lower.includes("access denied") || lower.includes("blocked")) {
        return `suggested_fix: retry with render="render" (JS rendering + anti-bot bypass). If that also fails: novada_unblock(url="${url}") returns raw HTML via stealth browser — parse the response body manually`;
    }
    if (lower.includes("all promises were rejected") || lower.includes("eai_again") ||
        lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("timeout")) {
        return `suggested_fix: domain may be unreachable or rate-limiting. Verify URL is correct, then retry with render="render". Run novada_health_all() to check API status`;
    }
    if (lower.includes("js") || lower.includes("javascript") || lower.includes("js-heavy")) {
        return `suggested_fix: retry with render="render" for JavaScript-rendered pages`;
    }
    // Domain-specific overrides
    try {
        const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
        if (host === "zhihu.com")
            return `suggested_fix: zhihu.com blocks automated access. Use render="render" first; if blocked, novada_unblock returns raw HTML. Alternatively search via novada_search`;
        if (host === "amazon.com")
            return `suggested_fix: try novada_scrape(platform="amazon.com", operation="amazon_product_keywords") for structured product data`;
        if (host === "x.com" || host === "twitter.com")
            return `suggested_fix: try novada_scrape(platform="x.com", operation="twitter_profile_username") for Twitter/X data`;
        if (host === "instagram.com")
            return `suggested_fix: try novada_scrape(platform="instagram.com", operation="instagram_profile_url")`;
        if (host === "linkedin.com")
            return `suggested_fix: try novada_scrape(platform="linkedin.com", operation="linkedin_company_information_url")`;
    }
    catch { /* ignore */ }
    return `suggested_fix: retry with render="render" for JS-heavy pages. If blocked: novada_unblock(url="${url}") returns raw HTML via stealth browser`;
}
function rewriteRedditUrl(url) {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        if ((host === "reddit.com" || host === "www.reddit.com") && !url.includes("old.reddit.com")) {
            parsed.hostname = "old.reddit.com";
            return parsed.toString();
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * #1/#12: Keep the best result across escalation attempts.
 *
 * In render="auto" the static fetch can already hold real content; escalating to the
 * browser/CDP tier then unconditionally overwrote `html` with the browser response.
 * When that response is empty or a JS-challenge stub, the good static content was lost
 * and the request returned near-empty (quality ~1/100, content_present:false).
 *
 * This compares the candidate (browser) HTML against the current best by the SAME
 * extracted-content quality score the formatter uses, and only adopts the candidate
 * when it is genuinely better. A blank/whitespace candidate is never adopted, so a
 * non-empty static attempt always survives a failed escalation.
 *
 * Returns the winning html + which mode produced it, so callers set usedMode to match
 * the content they actually kept (not the tier they merely attempted).
 */
function pickBetterHtml(current, candidate, url, useFullPage) {
    // A blank/near-blank candidate can never beat a fetched current result.
    if (!candidate.html || candidate.html.trim().length === 0) {
        return { ...current, adopted: false };
    }
    const extract = (h) => useFullPage ? extractFullPageContent(h, url) : extractMainContent(h, url);
    const currentMain = extract(current.html);
    const candidateMain = extract(candidate.html);
    const currentScore = scoreExtraction(current.html, currentMain, current.mode, false).score;
    const candidateScore = scoreExtraction(candidate.html, candidateMain, candidate.mode, false).score;
    // Strictly-greater: ties keep the cheaper/earlier attempt (mode bonus already favors static).
    if (candidateScore > currentScore) {
        return { html: candidate.html, mode: candidate.mode, adopted: true };
    }
    return { ...current, adopted: false };
}
/** Core extraction logic — called via extractSingle which enforces the total request ceiling. */
async function extractSingleInner(params, apiKey) {
    // Normalize render="js" → "render" (js is the agent-friendly alias)
    if (params.render === "js") {
        params = { ...params, render: "render" };
    }
    // Phase 3: Session dedup cache — skip fetch if same URL+mode+format+fields was extracted recently
    const cacheRenderMode = params.render ?? "auto";
    const cacheFormat = params.format ?? "markdown";
    const cached = getCached(params.url, cacheRenderMode, cacheFormat, params.fields);
    if (cached) {
        // Inject source: cache into the cached result so agents know it's from cache
        return cached.replace(/source: live/, "source: cache");
    }
    // Reddit rewrite: new reddit.com blocks all scrapers; old.reddit.com works with static fetch
    const redditUrl = rewriteRedditUrl(params.url);
    if (redditUrl) {
        params = { ...params, url: redditUrl, render: "static" };
    }
    const renderMode = params.render ?? "auto";
    const fetchedAt = new Date().toISOString();
    let html;
    let usedMode = "static";
    let renderError = null;
    /** Anti-bot provider detected during fetch (null = none detected) */
    let detectedAntiBot = null;
    /** Whether anti-bot was resolved via escalation */
    let antiBotResolved = false;
    // clean=true → main-content only; clean=false (default) → full page for maximum coverage.
    // Hoisted above the escalation block so pickBetterHtml (#1/#12) can score candidates
    // with the same extractor the formatter uses below.
    const useFullPage = params.clean !== true;
    // Domain registry: skip auto-detection probe for known sites
    const domainHint = renderMode === "auto" ? lookupDomain(params.url) : null;
    // NOV-330: session routing memory. Only consulted for "auto" when the hand-curated
    // DOMAIN_REGISTRY has no entry (registry is authoritative and always wins). If a prior
    // request this session already found the winning mode for this host, start there and
    // skip the static→render→browser ladder. Advisory: the escalation/quality checks below
    // still run, so a stale hint self-corrects (and recordRouteSuccess re-pins the new mode).
    const routeHint = renderMode === "auto" && !domainHint ? getRouteHint(params.url) : null;
    const effectiveMode = domainHint ? domainHint.method : (routeHint ?? renderMode);
    // Pre-populate anti-bot provider from domain registry if known
    if (domainHint?.provider) {
        detectedAntiBot = domainHint.provider;
    }
    // Force modes (or registry-resolved modes) skip escalation logic
    if (effectiveMode === "browser") {
        // Bug1/Bug3 fix: pre-check runtime capability before attempting CDP connection.
        // On serverless (Vercel/Lambda), connectOverCDP cannot hold the WS and fails with a raw
        // "AuthorizationError" that looks like a credentials problem but is actually a transport
        // limitation. Fail fast with a structured, actionable error instead.
        // isBrowserAvailableOnRuntime() checks: isHostedEnvironment() (false on Vercel unless
        // DEPLOYMENT_SUPPORTS_WS=true override) AND whether NOVADA_BROWSER_WS creds are set.
        if (!isBrowserAvailableOnRuntime()) {
            return getBrowserUnavailableError("browser");
        }
        html = await fetchViaBrowser(params.url, { waitForSelector: params.wait_for, wait_ms: params.wait_ms });
        usedMode = "browser";
    }
    else if (effectiveMode === "render") {
        const response = await fetchWithRender(params.url, apiKey, { tool: "extract", ...(domainHint?.proxyTier ? { proxyTier: domainHint.proxyTier } : {}) });
        const contentType = String(response.headers?.["content-type"] ?? "");
        if (isPdfResponse(params.url, contentType)) {
            const pdfBuffer = Buffer.isBuffer(response.data)
                ? response.data
                : Buffer.from(response.data, "binary");
            const pdf = await extractPdf(pdfBuffer);
            html = `pdf_pages:${pdf.pages}\n${pdf.title ? `title: ${pdf.title}\n` : ""}${pdf.text}`;
        }
        else if (contentType.includes("application/json")) {
            const body = typeof response.data === "string"
                ? response.data
                : JSON.stringify(response.data, null, 2);
            if (body.trimStart().startsWith("<")) {
                html = body;
            }
            else {
                return formatJsonExtract(params.url, "render", body, params.max_chars);
            }
        }
        else {
            if (typeof response.data !== "string") {
                throw makeNovadaError(NovadaErrorCode.INVALID_PARAMS, "Response is not HTML. The URL may return JSON or binary data.", `url:${params.url} returned non-string content-type`);
            }
            html = response.data;
        }
        // F2 / QW-4: Detect bot-challenge pages returned by the Web Unblocker (any size).
        // A full-size Cloudflare interstitial (e.g., "Attention Required! | Cloudflare", "Sorry,
        // you have been blocked") is several KB — the old html.length < 2000 guard missed it.
        // Fix: run detectBotChallenge unconditionally; attempt browser escalation when available,
        // otherwise surface a concrete error instead of silently returning interstitial text.
        if (typeof html === "string" && detectBotChallenge(html)) {
            if (isBrowserConfigured()) {
                const browserHtml = await fetchViaBrowser(params.url, { waitForSelector: params.wait_for, wait_ms: params.wait_ms }).catch(() => null);
                // F2/R3: Use pickBetterHtml (quality-score comparison) instead of raw byte
                // length to decide whether to accept the browser result. Raw length is
                // unreliable because a padded Cloudflare interstitial (several KB) can be
                // longer than a short-but-real page, causing good content to be discarded.
                const best = pickBetterHtml({ html, mode: "render" }, { html: browserHtml ?? "", mode: "browser" }, params.url, useFullPage);
                if (best.adopted) {
                    html = best.html;
                    usedMode = "browser";
                }
                else {
                    // Browser also returned challenge / nothing better — surface as error
                    throw makeNovadaError(NovadaErrorCode.URL_UNREACHABLE, "Render returned a bot challenge page", `url:${params.url} render=render returned a bot challenge page; browser escalation also failed`);
                }
            }
            else {
                // No browser configured — throw so the caller surfaces an honest error
                throw makeNovadaError(NovadaErrorCode.URL_UNREACHABLE, "Render returned a bot challenge page", `url:${params.url} render=render returned a bot challenge page (Cloudflare/anti-bot interstitial). ` +
                    `Use render=browser with NOVADA_BROWSER_WS configured, or try a different URL.`);
            }
        }
        else {
            usedMode = "render";
        }
    }
    else {
        // Auto or static:
        // P1-2: Race a direct HTTP fetch (no proxy) against the proxy for "auto" mode.
        // Open static sites (HN, TechCrunch, Wikipedia) respond in ~300ms direct vs ~3s via proxy.
        // Direct "wins" only if it returns clean HTML (no bot challenge, no JS-heavy indicators).
        // Bot-protected or JS-heavy: direct rejects, proxy result is used — no change in behavior.
        const domainProxyTier = domainHint?.proxyTier;
        const response = await (effectiveMode === "auto"
            ? Promise.any([
                fetchWithRetry(params.url, { tool: "extract", headers: { "User-Agent": USER_AGENT }, timeout: 3000 })
                    .then(r => {
                    const body = typeof r.data === "string" ? r.data : null;
                    if (body && !detectBotChallenge(body) && !detectJsHeavyContent(body))
                        return r;
                    throw new Error("not-static");
                }),
                fetchViaProxy(params.url, apiKey, { tool: "extract", ...(domainProxyTier ? { proxyTier: domainProxyTier } : {}) }),
            ])
            : fetchViaProxy(params.url, apiKey, { tool: "extract", ...(domainProxyTier ? { proxyTier: domainProxyTier } : {}) }));
        const contentType = String(response.headers?.["content-type"] ?? "");
        if (isPdfResponse(params.url, contentType)) {
            const pdfBuffer = Buffer.isBuffer(response.data)
                ? response.data
                : Buffer.from(response.data, "binary");
            const pdf = await extractPdf(pdfBuffer);
            html = `pdf_pages:${pdf.pages}\n${pdf.title ? `title: ${pdf.title}\n` : ""}${pdf.text}`;
        }
        else if (contentType.includes("application/json")) {
            const body = typeof response.data === "string"
                ? response.data
                : JSON.stringify(response.data, null, 2);
            if (body.trimStart().startsWith("<")) {
                html = body;
            }
            else {
                return formatJsonExtract(params.url, "static", body, params.max_chars);
            }
        }
        else {
            if (typeof response.data !== "string") {
                throw makeNovadaError(NovadaErrorCode.INVALID_PARAMS, "Response is not HTML. The URL may return JSON or binary data.", `url:${params.url} returned non-string content-type`);
            }
            html = response.data;
        }
        // Skip JS detection if we already have PDF content (no escalation needed).
        // Also skip if domainHint resolved this domain — DOMAIN_REGISTRY classification is
        // authoritative for known domains and overrides JS-heavy detection heuristics.
        if (renderMode === "auto" && !domainHint && !html.startsWith("pdf_pages:") && (detectJsHeavyContent(html) || detectBotChallenge(html))) {
            // Identify anti-bot provider from the static HTML before escalation
            detectedAntiBot = identifyAntiBot(html);
            // Escalate to render mode (JS-heavy OR bot challenge on static fetch)
            try {
                const renderResponse = await fetchWithRender(params.url, apiKey, { tool: "extract" });
                const renderHtml = String(renderResponse.data);
                if (detectBotChallenge(renderHtml)) {
                    // Re-check anti-bot on render result (may differ from static)
                    detectedAntiBot = detectedAntiBot ?? identifyAntiBot(renderHtml);
                    // Render returned a bot challenge page — escalate to browser if available
                    if (isBrowserConfigured()) {
                        // #1/#12: browser can throw or return an empty challenge stub. Keep the
                        // static html (still in `html`) when the browser result isn't better.
                        const browserHtml = await fetchViaBrowser(params.url, { waitForSelector: params.wait_for, wait_ms: params.wait_ms }).catch(() => "");
                        const best = pickBetterHtml({ html, mode: usedMode }, { html: browserHtml, mode: "browser" }, params.url, useFullPage);
                        html = best.html;
                        usedMode = best.mode;
                        antiBotResolved = best.adopted;
                        if (!best.adopted) {
                            usedMode = "render-failed";
                            renderError = "Render returned a bot challenge page; browser fallback returned no better content";
                        }
                    }
                    else {
                        // No browser available — keep static html, mark as failed
                        usedMode = "render-failed";
                        renderError = "Render returned a bot challenge page";
                    }
                }
                else if (!detectJsHeavyContent(renderHtml)) {
                    html = renderHtml;
                    usedMode = "render";
                    antiBotResolved = detectedAntiBot !== null;
                }
                else if (isBrowserConfigured()) {
                    // render also JS-heavy — try full browser
                    // #1/#12: keep the best of {static html, render html, browser html}.
                    const browserHtml = await fetchViaBrowser(params.url, { waitForSelector: params.wait_for, wait_ms: params.wait_ms }).catch(() => "");
                    // Compare browser against render (render is JS-heavy but still better than static here).
                    const best = pickBetterHtml({ html: renderHtml, mode: "render" }, { html: browserHtml, mode: "browser" }, params.url, useFullPage);
                    html = best.html;
                    usedMode = best.mode;
                    antiBotResolved = best.adopted;
                }
                else {
                    // render worked but still JS-heavy, use it (better than static)
                    html = renderHtml;
                    usedMode = "render";
                }
            }
            catch (err) {
                // Early exit for SSL/TLS certificate errors — escalation won't fix server-side cert issues
                const certMsg = err instanceof Error ? err.message : String(err);
                const isCertError = certMsg?.includes('CERT_') || certMsg?.includes('SSL') || certMsg?.includes('certificate');
                if (isCertError) {
                    throw new Error(`SSL certificate error for ${params.url}. The site has an invalid/expired certificate. agent_instruction: This is a server-side issue, not fixable by changing render mode.`);
                }
                // render threw — try Browser API if available
                renderError = err instanceof Error ? err.message : String(err);
                if (isBrowserConfigured()) {
                    // #1/#12: browser can also fail/return empty. Keep the static html (in `html`)
                    // when the browser result isn't better, instead of returning near-empty.
                    const browserHtml = await fetchViaBrowser(params.url, { waitForSelector: params.wait_for, wait_ms: params.wait_ms }).catch(() => "");
                    const best = pickBetterHtml({ html, mode: usedMode }, { html: browserHtml, mode: "browser" }, params.url, useFullPage);
                    html = best.html;
                    usedMode = best.adopted ? best.mode : "render-failed";
                    antiBotResolved = best.adopted;
                }
                else {
                    usedMode = "render-failed";
                }
            }
        }
    }
    // NOV-330: remember the winning mode for this host so the rest of the session can
    // start there. recordRouteSuccess ignores the "render-failed" pseudo-mode, so only a
    // genuine static/render/browser success is pinned. Cheap + best-effort.
    recordRouteSuccess(params.url, usedMode);
    // NOV-334: request logging now happens centrally in the fetch helpers (fetchViaProxy /
    // fetchWithRender / fetchWithRetry), so every tool — not just extract — emits one
    // structured stderr line per upstream request (silent unless NOVADA_LOG=debug). The
    // per-extract summary line was removed here to avoid double-logging.
    // Detect PDF output from router (prefixed with pdf_pages:N)
    const pdfPageMatch = html.match(/^pdf_pages:(\d+)\n/);
    let pdfPages = null;
    let pdfTitle;
    if (pdfPageMatch) {
        pdfPages = parseInt(pdfPageMatch[1], 10);
        // Extract optional title line before stripping prefix
        const titleLine = html.match(/^pdf_pages:\d+\ntitle: ([^\n]+)\n/);
        pdfTitle = titleLine?.[1];
        // Strip the pdf_pages prefix (and optional title line)
        html = html.replace(/^pdf_pages:\d+\n(?:title: [^\n]+\n)?/, "");
    }
    // NOV-577: parse the finalized HTML ONCE and share that read-only document across the
    // title/description/links/structured-data readers below, instead of each helper calling
    // cheerio.load(html) again (was 4 redundant parses per request). The content extractors
    // (extractMainContent/extractFullPageContent) mutate their DOM, so they still load their own.
    // PDFs have no HTML to parse — $doc stays null and the PDF branches supply values directly.
    let $doc = pdfPages !== null ? null : cheerio.load(html);
    let title = pdfPages !== null ? (pdfTitle ?? params.url) : extractTitleFrom($doc);
    let description = $doc ? extractDescriptionFrom($doc) : "";
    let stillJsHeavy = renderMode === "auto" && (usedMode === "static" || usedMode === "render-failed") && detectJsHeavyContent(html);
    // NOV-668: Kufer/webbasys availability detection — runs on the raw cheerio DOM
    // BEFORE markdown conversion strips inline styles and text nodes.
    const kuferResult = $doc ? detectKuferAvailability($doc, params.url) : null;
    if (params.format === "html") {
        let htmlOutput;
        if (html.length <= 10000) {
            htmlOutput = html;
        }
        else {
            const truncated = html.slice(0, 10000);
            const lastTagClose = truncated.lastIndexOf(">");
            htmlOutput = (lastTagClose > 9000 ? truncated.slice(0, lastTagClose + 1) : truncated) +
                "\n<!-- Content truncated at 10,000 characters -->";
        }
        // Save full (untruncated) HTML to file — best-effort, never breaks the tool
        try {
            const domain = new URL(params.url).hostname.replace("www.", "");
            const outputResult = await saveOutput({
                tool: "extract",
                hint: domain,
                format: "html",
                data: html,
                project: params.project,
            });
            // FIX-1: Redact absolute path.
            htmlOutput += `\n<!-- Output saved: ${redactSecrets(outputResult.filePath)} -->`;
        }
        catch { /* best-effort */ }
        return htmlOutput;
    }
    // For PDF content, use the text directly (no HTML parsing needed).
    // useFullPage is hoisted to the fetch section above (shared with pickBetterHtml).
    let mainContent = pdfPages !== null
        ? html.slice(0, MAX_CHARS_DEFAULT)
        : useFullPage
            ? extractFullPageContent(html, params.url)
            : extractMainContent(html, params.url);
    let allLinks = $doc ? extractLinksFrom($doc, params.url) : [];
    let baseDomain;
    try {
        baseDomain = new URL(params.url).hostname.replace(/^www\./, "");
    }
    catch {
        baseDomain = "";
    }
    let sameDomainLinks = allLinks
        .filter(link => {
        try {
            return new URL(link).hostname.replace(/^www\./, "") === baseDomain;
        }
        catch {
            return false;
        }
    })
        .slice(0, 15);
    // P0-5: max_chars truncation — applies to ALL formats (text, markdown, html handled separately)
    const maxChars = params.max_chars ?? MAX_CHARS_DEFAULT;
    if (params.format === "text") {
        let plainContent = mainContent
            .replace(/^#{1,6}\s+/gm, "")
            .replace(/^\- /gm, "  * ")
            .replace(/\*\*([^*]+)\*\*/g, "$1");
        const totalCharsText = plainContent.length;
        if (plainContent.length > maxChars) {
            const suggestedHigher = Math.min(maxChars * 2, 100000);
            plainContent = plainContent.slice(0, maxChars) +
                `\n\n[Content may be truncated — showing first ${maxChars} of ${totalCharsText} total characters. Pass max_chars=${suggestedHigher} to get more.]`;
        }
        const linksText = sameDomainLinks.length > 0
            ? `\nSame-domain links:\n${sameDomainLinks.map(l => `  ${l}`).join("\n")}`
            : "";
        return `${title}\n${description ? description + "\n" : ""}\n${plainContent}${linksText}`;
    }
    // Quality scoring (skip structured data extraction for PDFs — no HTML schema)
    let structuredData = $doc ? extractStructuredDataFrom($doc) : null;
    let hasStructuredData = structuredData !== null;
    let quality = scoreExtraction(html, mainContent, usedMode, hasStructuredData);
    // P0-1: Quality floor — never return quality:0 for non-empty content.
    // Only the display `score` is floored; `cleanliness_score` stays the raw markup value.
    if (mainContent && mainContent.length > 0 && quality.score === 0) {
        quality.score = 1;
    }
    // BUG-E1: Auto-escalation — retry with render when static quality is too low
    let autoEscalated = false;
    let autoEscalatedTo = null;
    // INC-199: Track failed escalation attempts so we can surface them instead of silent failure
    let escalationAttempted = false;
    let escalationFailed = false;
    let escalationError = null;
    // INC-202: Skip quality-score escalation when domain was resolved via DOMAIN_REGISTRY.
    // Registry entries are pre-classified — a low quality score on a "static" known domain
    // means the page is genuinely small (e.g. example.com), not that it needs JS rendering.
    // Without this guard, minimal static pages trigger fetchWithRender, adding 3–10s of latency.
    // NOV-565: also require !content_present — a page that already has substantive text
    // must not re-fetch via render/browser just because its cleanliness score is low.
    if (renderMode === "auto" && usedMode === "static" && quality.score < 40 && !quality.content_present && !html.startsWith("pdf_pages:") && !domainHint) {
        escalationAttempted = true;
        try {
            const renderResponse = await fetchWithRender(params.url, apiKey, { tool: "extract" });
            if (typeof renderResponse.data === "string" && !detectBotChallenge(renderResponse.data)) {
                const renderHtml = renderResponse.data;
                // NOV-577: one parse of the re-fetched HTML, shared across the readers in this branch.
                const $render = cheerio.load(renderHtml);
                const renderMain = useFullPage
                    ? extractFullPageContent(renderHtml, params.url)
                    : extractMainContent(renderHtml, params.url);
                const renderSD = extractStructuredDataFrom($render);
                const renderQuality = scoreExtraction(renderHtml, renderMain, "render", renderSD !== null);
                if (renderQuality.score > quality.score) {
                    html = renderHtml;
                    $doc = $render;
                    usedMode = "render";
                    mainContent = renderMain;
                    allLinks = extractLinksFrom($render, params.url);
                    sameDomainLinks = allLinks
                        .filter(link => {
                        try {
                            return new URL(link).hostname.replace(/^www\./, "") === baseDomain;
                        }
                        catch {
                            return false;
                        }
                    })
                        .slice(0, 15);
                    structuredData = renderSD;
                    hasStructuredData = renderSD !== null;
                    quality = renderQuality;
                    if (quality.score === 0 && mainContent.length > 0)
                        quality.score = 1;
                    title = extractTitleFrom($render);
                    description = extractDescriptionFrom($render);
                    stillJsHeavy = false;
                    autoEscalated = true;
                    autoEscalatedTo = "render";
                    detectedAntiBot = detectedAntiBot ?? identifyAntiBot(html);
                    antiBotResolved = detectedAntiBot !== null;
                }
            }
        }
        catch (e) {
            // INC-199: Track render escalation failure
            escalationError = e instanceof Error ? e.message : String(e);
        }
        // If render escalation didn't improve quality enough, try browser as final fallback
        // NOV-565: skip browser fallback when content is already present (full-text page).
        if (quality.score < 40 && !quality.content_present && isBrowserConfigured()) {
            try {
                const browserHtml = await fetchViaBrowser(params.url, { waitForSelector: params.wait_for, wait_ms: params.wait_ms });
                // NOV-577: one parse of the browser HTML, shared across the readers in this branch.
                const $browser = cheerio.load(browserHtml);
                const browserMain = useFullPage
                    ? extractFullPageContent(browserHtml, params.url)
                    : extractMainContent(browserHtml, params.url);
                const browserSD = extractStructuredDataFrom($browser);
                const browserQuality = scoreExtraction(browserHtml, browserMain, "browser", browserSD !== null);
                if (browserQuality.score > quality.score) {
                    html = browserHtml;
                    $doc = $browser;
                    usedMode = "browser";
                    mainContent = browserMain;
                    allLinks = extractLinksFrom($browser, params.url);
                    sameDomainLinks = allLinks
                        .filter(link => {
                        try {
                            return new URL(link).hostname.replace(/^www\./, "") === baseDomain;
                        }
                        catch {
                            return false;
                        }
                    })
                        .slice(0, 15);
                    structuredData = browserSD;
                    hasStructuredData = browserSD !== null;
                    quality = browserQuality;
                    if (quality.score === 0 && mainContent.length > 0)
                        quality.score = 1;
                    title = extractTitleFrom($browser);
                    description = extractDescriptionFrom($browser);
                    stillJsHeavy = false;
                    autoEscalated = true;
                    autoEscalatedTo = "browser";
                    detectedAntiBot = detectedAntiBot ?? identifyAntiBot(browserHtml);
                    antiBotResolved = true;
                }
            }
            catch { /* keep previous result */ }
        }
        // INC-199: If quality is still low after all escalation attempts, mark as failed
        // NOV-565: don't flag escalation_failed when the page actually has content.
        if (quality.score < 40 && !quality.content_present && !autoEscalated) {
            escalationFailed = true;
        }
    }
    // P2-1: Wayback Machine auto-fallback — when content is very poor, try archive.org
    let waybackFallback = false;
    if (mainContent.length < 100 && quality.score < 20 && !html.startsWith("pdf_pages:")) {
        try {
            const archiveUrl = `https://web.archive.org/web/2024/${params.url}`;
            const wbResponse = await fetchViaProxy(archiveUrl, apiKey, { tool: "extract" });
            if (typeof wbResponse.data === "string" && wbResponse.data.length > 500) {
                const wbHtml = wbResponse.data;
                const wbMain = useFullPage
                    ? extractFullPageContent(wbHtml, params.url)
                    : extractMainContent(wbHtml, params.url);
                if (wbMain.length > mainContent.length) {
                    // NOV-577: one parse of the Wayback HTML, shared across the readers in this branch.
                    const $wb = cheerio.load(wbHtml);
                    html = wbHtml;
                    $doc = $wb;
                    mainContent = wbMain;
                    title = extractTitleFrom($wb);
                    description = extractDescriptionFrom($wb);
                    allLinks = extractLinksFrom($wb, params.url);
                    sameDomainLinks = allLinks
                        .filter(link => {
                        try {
                            return new URL(link).hostname.replace(/^www\./, "") === baseDomain;
                        }
                        catch {
                            return false;
                        }
                    })
                        .slice(0, 15);
                    structuredData = extractStructuredDataFrom($wb);
                    hasStructuredData = structuredData !== null;
                    quality = scoreExtraction(wbHtml, wbMain, usedMode, hasStructuredData);
                    if (quality.score === 0 && wbMain.length > 0)
                        quality.score = 1;
                    waybackFallback = true;
                }
            }
        }
        catch { /* Wayback unavailable — keep original result */ }
    }
    // max_chars truncation for markdown format
    // NOV-671: use table-preserving truncation — when a table sits in the last ~30%
    // of content and would be cut, we trim boilerplate above and keep the table intact.
    const totalChars = mainContent.length;
    let displayContent = mainContent;
    let contentTruncated = false;
    if (displayContent.length > maxChars) {
        displayContent = truncatePreservingTable(displayContent, maxChars);
        const suggestedHigher = Math.min(maxChars * 2, 100000);
        displayContent += `\n\n[Content may be truncated — showing first ${maxChars} of ${totalChars} total characters. Pass max_chars=${suggestedHigher} to get more.]`;
        contentTruncated = true;
    }
    const contentLen = totalChars;
    const isTruncated = contentTruncated;
    // Field extraction
    // Use the FULL pre-truncation content (mainContent), not the display-capped slice.
    // displayContent is sliced to max_chars (default 25k) purely for inline rendering;
    // a field located past that cap on a long page must still resolve, so the markdown-text
    // layers (pattern/generic/tolerant/proximity/heading in fields.ts) get the uncapped text.
    let fieldResults = null;
    if (params.fields && params.fields.length > 0) {
        // NOV-577: reuse $doc (the single parse of the finalized html) so the field DOM layers
        // don't re-parse — $doc tracks every escalation re-fetch (render/browser/wayback) above.
        fieldResults = extractFields(params.fields, structuredData, mainContent, html, $doc);
    }
    const metaExtra = contentTruncated
        ? ` | content_truncated:true | total_chars:${totalChars}`
        : "";
    // R4: Quality signal, not quality verdict. A page that returned clean, real prose
    // is PRESENT even when it is short (example.com: 20 words, complete + correct).
    // `quality.content_present` (utils/html.ts) uses a 200char/50word "substantive"
    // threshold — good for ranking, wrong as a presence verdict: a short-but-complete
    // page fails it and used to render `content_present:false` next to the very text it
    // denies. Here we compute a display-level presence judgment that rescues the
    // short-but-complete case WITHOUT overclaiming on empty / bot-challenge / JS-empty
    // pages. Used only for FRAMING (header line, hints, agent_instruction) — the raw
    // numeric score is still reported for callers that want it.
    const fetchSucceeded = usedMode !== "render-failed" && !stillJsHeavy;
    const wordCount = mainContent.trim() ? mainContent.trim().split(/\s+/).length : 0;
    // A page whose returned HTML is a bot-challenge / anti-bot interstitial is NOT
    // "complete but short" — it is an absence dressed as content. Exclude it so the
    // rescue below never green-lights "Checking your browser…" style stubs.
    const isChallengePage = detectedAntiBot !== null || (typeof html === "string" && detectBotChallenge(html));
    // Short-but-complete: real prose returned on a successful, non-challenge fetch,
    // just under the "substantive" bar. Word floor (12) + length floor (80) keep
    // genuinely thin/challenge stubs (e.g. a 7-word "checking your browser" page) OUT,
    // while a complete brief page like example.com (~29 words) is correctly rescued.
    const isShortButComplete = fetchSucceeded &&
        !isChallengePage &&
        !quality.content_present &&
        wordCount >= 12 &&
        mainContent.trim().length >= 80;
    // Display-level presence: true whenever there is usable content in THIS payload.
    const contentPresentDisplay = quality.content_present || isShortButComplete;
    // NOV-565: content_ok is driven by content presence (substantive prose detected on the
    // CLEANED markdown), not the cleanliness score. Docs pages with full text but link-heavy
    // markup used to fail the old `score >= 40` gate; now a page with real content passes.
    // R4: a short-but-complete page (example.com) is also content_ok — it is not a failure.
    const contentOk = contentPresentDisplay && fetchSucceeded && mainContent.length > 0;
    // Compute extraction_quality label from fill-rate (resolved fields / requested fields)
    let extractionQuality = "n/a";
    if (fieldResults && fieldResults.length > 0) {
        const matched = fieldResults.filter(r => r.source !== "unresolved").length;
        const total = fieldResults.length;
        if (matched === total) {
            extractionQuality = "high";
        }
        else if (matched === 0) {
            extractionQuality = "none";
        }
        else {
            // Partial fill: "low" when under half the requested fields resolved, else "partial".
            // (Avoids labelling 1-of-2 as "low" — that is a genuine partial match.)
            extractionQuality = matched < total / 2 ? "low" : "partial";
        }
    }
    const qLabel = qualityLabel(quality.score);
    // R4: label used in agent-facing "remember" lines — reflects display-level presence
    // so a short-but-complete page is not memorised as "low quality".
    const displayQualityLabel = contentPresentDisplay ? (isShortButComplete ? "ok (brief)" : "ok") : qLabel;
    // R4: don't surface the raw "content_present:false … below threshold" reason next to
    // a page we are reporting as present — rewrite it to match the framing. Absent pages
    // keep the original diagnostic reasons untouched.
    const displayQualityReasons = isShortButComplete
        ? [`content_present:true (${contentLen} chars, ${wordCount} words — complete but below the 200char/50word "substantive" bar)`]
        : quality.quality_reasons;
    // JSON structured output — return early
    if (params.format === "json") {
        const jsonResult = {
            url: params.url,
            title,
            description: description || null,
            mode: usedMode,
            source: waybackFallback ? "wayback" : "live",
            fetched_at: fetchedAt,
            // R4/R7: quality is a signal, not a verdict. `content_present` is the
            // display-level presence (true whenever real content is in this payload,
            // including short-but-complete pages). The raw heuristic score + reasons are
            // kept for callers that want them, but never contradict a successful fetch.
            quality: {
                score: quality.score,
                cleanliness_score: quality.cleanliness_score,
                content_present: contentPresentDisplay,
                label: contentPresentDisplay ? "ok" : qLabel,
                content_ok: contentOk,
                ...(isShortButComplete ? { note: `short page (${contentLen} chars, ${wordCount} words) — complete but brief` } : {}),
                reasons: displayQualityReasons,
            },
            content: displayContent,
            content_truncated: contentTruncated,
            returned_chars: displayContent.length,
            total_chars: totalChars,
            structured_data: structuredData ?? null,
            fields: fieldResults
                ? Object.fromEntries(fieldResults.map(r => [
                    r.field,
                    {
                        value: r.source === "unresolved" ? null : r.value,
                        source: r.source,
                        confidence: r.confidence,
                        ...(r.source === "unresolved" && r.agent_instruction ? { agent_instruction: r.agent_instruction } : {}),
                        ...(r.warning ? { warning: r.warning } : {}),
                    },
                ]))
                : null,
            links: { same_domain: sameDomainLinks, total: allLinks.length },
            hints: [],
            ...(pdfPages !== null ? { pdf: { pages: pdfPages, title: pdfTitle ?? null } } : {}),
            ...(autoEscalated ? { auto_escalated: true, ...(autoEscalatedTo ? { escalated_to: autoEscalatedTo } : {}) } : {}),
            ...(escalationFailed ? { escalation_attempted: true, escalation_failed: true, ...(escalationError ? { escalation_error: escalationError } : {}) } : {}),
            ...(detectedAntiBot ? { anti_bot: detectedAntiBot, escalated: usedMode, resolved: antiBotResolved } : {}),
            ...(waybackFallback ? { wayback_fallback: true } : {}),
            // NOV-668: Kufer availability data
            ...(kuferResult ? {
                kufer_availability: {
                    is_overview_page: kuferResult.is_overview_page,
                    status: kuferResult.status,
                    raw_text: kuferResult.raw_text,
                    ...(kuferResult.is_overview_page ? {
                        agent_instruction: "Kufer overview page — availability here is NOT reliable (icon alt text is generic). Fetch the individual course detail page for the real status."
                    } : {}),
                }
            } : {}),
            remember: `${title} at ${params.url} — ${displayQualityLabel} quality, ${contentLen} chars`,
        };
        // Build hints array
        const hints = jsonResult.hints;
        if (redditUrl)
            hints.push("Reddit URL rewritten to old.reddit.com — new reddit.com blocks all scrapers.");
        if (waybackFallback)
            hints.push("Content retrieved from Wayback Machine (archive.org) — the live page returned empty/blocked content. Data may be outdated.");
        try {
            const extractedHost = new URL(params.url).hostname.replace(/^www\./, "");
            if (extractedHost === "trends24.in")
                hints.push("[THIRD-PARTY DATA] trends24.in is an independent aggregator, not an official X/Twitter source.");
        }
        catch { /* ignore */ }
        if (stillJsHeavy)
            hints.push("Page is JavaScript-rendered. Content may be incomplete. Try render='js' or render='browser'.");
        // INC-199: Surface escalation failure so agents know quality:0 is not silent
        if (escalationFailed) {
            hints.push(`Auto-escalation attempted (render${isBrowserConfigured() ? "+browser" : ""}) but quality remained low (${quality.score}/100). ${escalationError ? `Render error: ${escalationError}` : "The page may require a specialized approach."}`);
            if (!isBrowserConfigured())
                hints.push("Set NOVADA_BROWSER_WS to enable Browser API as a final fallback for JS-heavy pages.");
        }
        // P2-3: Cross-tool intelligence — suggest better tools when extraction quality is poor
        if (!contentOk && baseDomain) {
            const scraperOp = SCRAPER_PLATFORMS[baseDomain];
            if (scraperOp) {
                hints.push(`For structured ${baseDomain} data, try: novada_scrape(platform="${baseDomain}", operation="${scraperOp}")`);
            }
            // NOV-565: never show a bot-protection hint when the page already has full content.
            if (!quality.content_present && (usedMode === "render-failed" || (stillJsHeavy && !contentOk))) {
                hints.push(`Page is bot-protected. Try: novada_unblock(url="${params.url}") for raw HTML with anti-bot bypass.`);
            }
        }
        if (isTruncated)
            hints.push(`Content truncated at ${maxChars} chars (full: ${totalChars}). Pass max_chars=${Math.min(maxChars * 2, 100000)} to get more.`);
        try {
            hints.push(`Discover more pages: novada_map(url="${new URL(params.url).origin}")`);
        }
        catch { /* ignore */ }
        // Wire output save — best-effort, never breaks the tool.
        // Add save path INTO the JSON object (not after it) to keep output parseable.
        try {
            const domain = new URL(params.url).hostname.replace("www.", "");
            const outputResult = await saveOutput({
                tool: "extract",
                hint: domain,
                format: "json",
                data: jsonResult,
                project: params.project,
            });
            // FIX-1: Redact absolute path.
            jsonResult.output_saved = redactSecrets(outputResult.filePath);
        }
        catch { /* best-effort */ }
        const jsonOutput = JSON.stringify(jsonResult, null, 2);
        setCached(params.url, cacheRenderMode, "json", jsonOutput, params.fields);
        return jsonOutput;
    }
    // #22: header rows are single-line `key: value`. title/description come from <title>/<h1>
    // /meta and can carry embedded newlines or whitespace runs (wrapped nav, multi-line meta);
    // collapse them to a single line so nav-chrome can't split into fake header rows. JSON output
    // keeps the raw values untouched (proper JSON strings, no header contract to break).
    const headerLine = (s) => s.replace(/\s+/g, " ").trim();
    // R4: frame quality as a signal, not a verdict. When content is present, the
    // header reports `quality:ok` (with the numeric score kept as informational
    // detail) and never says `content_present:false` next to real content. Only a
    // genuine absence (empty / bot-challenge / JS-empty fetch) is labelled low.
    const qualityFraming = contentPresentDisplay
        ? `quality:ok (score:${quality.score}/100) | content_present:true | content_ok:${contentOk}`
        : `quality:low (score:${quality.score}/100) | content_present:false | content_ok:false`;
    // A present-but-short page gets ONE informational note instead of a "low"/reasons
    // line that contradicts the body. Absent pages keep the diagnostic reasons.
    const qualityDetailLine = contentPresentDisplay
        ? (isShortButComplete
            ? `note: short page (${contentLen} chars, ${wordCount} words) — complete but brief; retry render="render" only if you expected more`
            : null)
        : `quality_reasons: ${quality.quality_reasons.join("; ")}`;
    const lines = [
        `## Extracted Content`,
        `url: ${params.url}`,
        `mode: ${usedMode} | source: ${waybackFallback ? "wayback" : "live"} | ${qualityFraming}`,
        ...(qualityDetailLine ? [qualityDetailLine] : []),
        `fetched_at: ${fetchedAt}`,
        // #22: omit extraction_quality when no fields were requested (n/a is noise).
        ...(extractionQuality !== "n/a" ? [`extraction_quality: ${extractionQuality}`] : []),
        `title: ${headerLine(title)}`,
        ...(description ? [`description: ${headerLine(description)}`] : []),
        `chars:${contentLen}${isTruncated ? " (truncated)" : ""} | links:${allLinks.length}${autoEscalated ? ` | auto_escalated:true${autoEscalatedTo ? ` | escalated_to:${autoEscalatedTo}` : ""}` : ""}${detectedAntiBot ? ` | anti_bot:${detectedAntiBot} | resolved:${antiBotResolved}` : ""}${pdfPages !== null ? ` | pdf:true | pages:${pdfPages}` : ""}${metaExtra}`,
        ``,
        `---`,
        ``,
    ];
    // Requested Fields block (before Structured Data)
    if (fieldResults && fieldResults.length > 0) {
        const allUnresolved = fieldResults.every(r => r.source === "unresolved");
        if (allUnresolved && fieldResults.length > 0) {
            lines.push(`## Requested Fields (none resolved)`);
            lines.push(`Fields [${fieldResults.map(r => r.field).join(', ')}] could not be resolved from JSON-LD, tables, microdata, or page patterns.`);
            lines.push(`The data may be present in the page content above — read the markdown body directly.`);
            const firstInstruction = fieldResults.find(r => r.agent_instruction)?.agent_instruction;
            lines.push(`agent_instruction: ${firstInstruction ?? `For Wikipedia/wiki pages, parse the content body. For finance/e-commerce pages, retry with render="render" to fetch JS-rendered values.`}`);
        }
        else {
            lines.push(`## Requested Fields`);
            for (const r of fieldResults) {
                const sourceTag = sourceAnnotation(r.source);
                if (r.source === "unresolved") {
                    lines.push(`${r.field}: — *(unresolved)*${r.agent_instruction ? ` — ${r.agent_instruction}` : ""}`);
                }
                else {
                    // P0-3: Strip *(pattern)* annotation from the field value itself
                    const cleanValue = typeof r.value === "string"
                        ? r.value.replace(/ \*\(pattern\)\*/g, "").trimEnd()
                        : r.value;
                    const warningTag = r.warning ? ` *(warning: ${r.warning})*` : "";
                    lines.push(`${r.field}: ${cleanValue}${sourceTag} *(conf:${r.confidence.toFixed(2)})*${warningTag}`);
                }
            }
        }
        lines.push(``, `---`, ``);
    }
    // Prepend structured data block if available
    if (hasStructuredData && structuredData) {
        lines.push(`## Structured Data`);
        lines.push(`type: ${structuredData.type}`);
        for (const [key, value] of Object.entries(structuredData.fields)) {
            lines.push(`${key}: ${value}`);
        }
        lines.push(``, `---`, ``);
    }
    // NOV-668: inject Kufer availability block when detected
    if (kuferResult) {
        lines.push(kuferResult.markdown_block);
        lines.push(``, `---`, ``);
    }
    lines.push(displayContent);
    if (sameDomainLinks.length > 0) {
        lines.push(``, `---`, `## Same-Domain Links (${sameDomainLinks.length} of ${allLinks.length})`);
        for (const link of sameDomainLinks) {
            lines.push(`- ${link}`);
        }
    }
    // Extraction Diagnostics — emit only when fields were requested and at least one is null
    let hasNoHeadingMatchField = false;
    if (fieldResults && fieldResults.some(r => r.source === "unresolved")) {
        lines.push(``, `---`, `## Extraction Diagnostics`);
        for (const r of fieldResults) {
            if (r.source !== "unresolved") {
                lines.push(`- ${r.field}: matched ✓ (via ${r.source}, conf:${r.confidence.toFixed(2)})`);
            }
            else {
                const attemptedList = r.attempted && r.attempted.length > 0 ? r.attempted.join(" → ") : "none";
                // Heading reason adds color to the "why" but the authoritative trail is `attempted`.
                // Use full mainContent (not display-truncated) to match field extraction's input —
                // otherwise a heading past the truncation point yields a misleading no_heading hint.
                const headingResult = matchHeadingSectionWithReason(mainContent, r.field);
                if (headingResult.reason === "no_heading_match")
                    hasNoHeadingMatchField = true;
                lines.push(`- ${r.field}: null — attempted: ${attemptedList}`);
                if (r.agent_instruction)
                    lines.push(`  agent_instruction: ${r.agent_instruction}`);
            }
        }
    }
    lines.push(``);
    lines.push(`## Agent Memory`);
    lines.push(`remember: ${title} at ${params.url} — ${displayQualityLabel} quality, ${contentLen} chars`);
    lines.push(``, `---`, `## Agent Hints`);
    if (redditUrl) {
        lines.push(`- Reddit URL rewritten to old.reddit.com (static HTML) — new reddit.com blocks all scrapers.`);
    }
    if (waybackFallback) {
        lines.push(`- [WAYBACK] Content retrieved from Wayback Machine (archive.org) — the live page returned empty/blocked content. Data may be outdated.`);
    }
    // Warn when content is sourced from a known third-party aggregator
    try {
        const extractedHost = new URL(params.url).hostname.replace(/^www\./, "");
        if (extractedHost === "trends24.in") {
            lines.push(`- [THIRD-PARTY DATA] trends24.in is an independent aggregator, not an official X/Twitter source. Data may lag by minutes and coverage is limited to trending topics only.`);
        }
    }
    catch { /* ignore */ }
    if (autoEscalated) {
        lines.push(`- Auto-escalated to render mode (static quality score was < 40). Content above was fetched with JS rendering enabled.`);
    }
    // INC-199: Surface escalation failure in markdown output
    if (escalationFailed) {
        lines.push(`- [ESCALATION FAILED] Auto-escalation attempted (render${isBrowserConfigured() ? "+browser" : ""}) but quality remained low (${quality.score}/100).${escalationError ? ` Render error: ${escalationError}` : ""}`);
        if (!isBrowserConfigured()) {
            lines.push(`- Set NOVADA_BROWSER_WS to enable Browser API as final fallback for JS-heavy pages.`);
        }
    }
    if (hasNoHeadingMatchField) {
        lines.push(`- Some fields were not found via heading-match. For list or aggregated pages (bestseller lists, search results, news feeds), data is embedded as inline list items — parse the body markdown directly. Field extraction works best on single-entity pages (product detail pages, GitHub repos, articles).`);
    }
    if (pdfPages !== null) {
        lines.push(`- PDF extracted automatically: ${pdfPages} page(s). pdf_pages:${pdfPages} in metadata above.`);
        lines.push(`- PDF URLs are extracted automatically — use novada_extract the same way as HTML.`);
        lines.push(`- For large PDFs (>10MB), try a more specific page URL.`);
    }
    if (usedMode === "browser") {
        lines.push(`- Content fetched via Browser API (CDP). Cost: ~$3/GB — use only when static/render modes fail.`);
    }
    if (stillJsHeavy) {
        if (usedMode === "render-failed") {
            // Render was already attempted and failed — do NOT suggest retrying with render='render'
            lines.push(`- [WARNING] Page is JavaScript-rendered. Web Unblocker was attempted but failed.`);
            if (renderError)
                lines.push(`- Render error: ${renderError}`);
            lines.push(`- Do NOT retry with render="render" — it was already tried and failed.`);
            if (isBrowserConfigured()) {
                lines.push(`- Try render="browser" to use the Browser API instead. Note: Browser API costs ~$3/GB.`);
            }
            else {
                lines.push(`- To enable browser-level rendering: set NOVADA_BROWSER_WS env var (get credentials at https://dashboard.novada.com/overview/browser/), then retry with render="browser".`);
                lines.push(`- Also verify NOVADA_WEB_UNBLOCKER_KEY is set correctly.`);
                lines.push(`- Note: Browser API costs ~$3/GB — use sparingly.`);
            }
        }
        else if (usedMode === "static") {
            lines.push(`- [WARNING] Page appears JavaScript-rendered. Content above may be incomplete.`);
            lines.push(`- Retry with render="render" to use Novada Web Unblocker (JS rendering).`);
            if (!isBrowserConfigured()) {
                lines.push(`- For full browser rendering (costs ~$3/GB), set NOVADA_BROWSER_WS env var.`);
            }
        }
    }
    // P2-3: Cross-tool intelligence — suggest better tools when extraction quality is poor
    if (!contentOk && baseDomain) {
        const scraperOp = SCRAPER_PLATFORMS[baseDomain];
        if (scraperOp) {
            lines.push(`- For structured ${baseDomain} data, try: novada_scrape(platform="${baseDomain}", operation="${scraperOp}")`);
        }
        // NOV-565: never show a bot-protection hint when the page already has full content.
        if (!quality.content_present && (usedMode === "render-failed" || (stillJsHeavy && !contentOk))) {
            lines.push(`- Page is bot-protected. Try: novada_unblock(url="${params.url}") for raw HTML with anti-bot bypass.`);
        }
    }
    // R4: only suggest a render retry when content is genuinely ABSENT, not merely
    // short. A complete-but-brief page (example.com) must not trigger a slow render retry.
    if (!contentPresentDisplay && usedMode === "static" && renderMode === "auto") {
        lines.push(`- No usable content on static mode — try render="render" for JS-heavy or anti-bot protected pages.`);
    }
    if (isTruncated) {
        lines.push(`- Content was truncated at ${maxChars} chars (full: ${totalChars}). Pass max_chars=${Math.min(maxChars * 2, 100000)} to get more, or use novada_map to find specific subpages.`);
    }
    try {
        lines.push(`- To discover more pages: novada_map with url="${new URL(params.url).origin}"`);
    }
    catch { /* ignore */ }
    if (params.query) {
        lines.push(`- Query context: "${params.query}". Focus analysis on this topic.`);
    }
    // NOV-672: Context-aware agent_instruction — derive the next action from this call's
    // actual context rather than emitting a generic tool menu.
    const agentInstruction = buildContextualAgentInstruction({
        contentOk,
        qualityScore: quality.score,
        contentPresent: contentPresentDisplay,
        shortButComplete: isShortButComplete,
        usedMode,
        renderMode,
        fieldResults,
        contentTruncated,
        maxChars,
        totalChars,
        mainContent,
        params,
    });
    lines.push(``);
    lines.push(`## Agent Action`);
    lines.push(`agent_instruction: ${agentInstruction}`);
    const mdOutput = lines.join("\n");
    // Wire output save — best-effort, never breaks the tool.
    // Prepend the file path to the HEADER so agents that truncate long responses still see it.
    let savePrefix = "";
    try {
        const domain = new URL(params.url).hostname.replace("www.", "");
        const outputResult = await saveOutput({
            tool: "extract",
            hint: domain,
            format: "md",
            data: mdOutput,
            project: params.project,
        });
        // #22: drop the stray leading folder emoji; match the batch path's `path: ` prefix.
        // FIX-1: Redact absolute path before surfacing to agent.
        // R1: only emit the `path:` header when a file was ACTUALLY written. On hosted
        // (Vercel) saveOutput returns an empty filePath — a dangling `path: ` label was
        // the first thing every response opened with. No file → no prefix.
        if (outputResult.filePath) {
            savePrefix = `path: ${redactSecrets(outputResult.filePath)}\n\n`;
        }
    }
    catch { /* best-effort */ }
    const finalOutput = savePrefix + mdOutput;
    setCached(params.url, cacheRenderMode, cacheFormat, finalOutput, params.fields);
    return finalOutput;
}
/**
 * Per-URL entry point with a hard total-request ceiling (TIMEOUTS.TOTAL_REQUEST_CEILING).
 * Uses Promise.race to guarantee no single URL blocks for more than 45s regardless of
 * how many auto-escalation steps (static → render → browser) are attempted.
 * The ceiling is per-URL so batch requests each get their own independent timer.
 */
async function extractSingle(params, apiKey) {
    // Runtime SSRF guard for SDK direct callers (MCP path already has Zod validation)
    const blocked = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/i;
    if (blocked.test(params.url)) {
        throw new Error('Blocked: private/internal URLs are not allowed. agent_instruction: Use a public URL.');
    }
    let ceilingTimer = null;
    const ceiling = new Promise((_, reject) => {
        ceilingTimer = setTimeout(() => reject(new Error(`TOTAL_REQUEST_CEILING: extractSingle for ${params.url} exceeded ${TIMEOUTS.TOTAL_REQUEST_CEILING}ms`)), TIMEOUTS.TOTAL_REQUEST_CEILING);
    });
    try {
        const result = await Promise.race([
            extractSingleInner(params, apiKey),
            ceiling,
        ]);
        return result;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith("TOTAL_REQUEST_CEILING:")) {
            // Return a structured error string in the same format as other extraction errors
            // so callers (batch mode, novadaExtract) get usable output rather than a thrown exception.
            const ceiling_s = TIMEOUTS.TOTAL_REQUEST_CEILING / 1000;
            return [
                `## Extraction Error`,
                `url: ${params.url}`,
                `error: Request exceeded the ${ceiling_s}s total ceiling and was aborted.`,
                ``,
                `## Agent Action`,
                `agent_instruction: This URL took too long (>${ceiling_s}s). Try render="static" to skip escalation, or novada_scrape for platform-specific data.`,
            ].join("\n");
        }
        throw err;
    }
    finally {
        if (ceilingTimer !== null)
            clearTimeout(ceilingTimer);
    }
}
function formatJsonExtract(url, mode, jsonStr, maxChars) {
    const limit = maxChars ?? MAX_CHARS_DEFAULT;
    const truncated = jsonStr.length > limit
        ? jsonStr.slice(0, limit) + "\n\n[truncated]"
        : jsonStr;
    let origin = url;
    try {
        origin = new URL(url).origin;
    }
    catch { /* ignore */ }
    return [
        `## Extracted Content`,
        `url: ${url}`,
        `mode: ${mode}`,
        `format: json (raw)`,
        ``,
        `---`,
        ``,
        "```json",
        truncated,
        "```",
        ``,
        `---`,
        `## Agent Hints`,
        `- This URL returned JSON, not HTML. Showing raw JSON content.`,
        `- To discover more pages: novada_map with url="${origin}"`,
    ].join("\n");
}
//# sourceMappingURL=extract.js.map