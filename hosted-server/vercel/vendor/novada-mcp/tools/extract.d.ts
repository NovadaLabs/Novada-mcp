import type { ExtractParams } from "./types.js";
export { detectJsHeavyContent } from "../utils/index.js";
/**
 * Cross-tool hint map: base domain → the best novada_scrape operation for structured data.
 * Used by both the JSON and markdown output paths, and by getSuggestedFix's error-path
 * hint, to suggest novada_scrape when extraction quality is poor (P2-3). Single source
 * of truth so all three hint sites can never drift from each other.
 *
 * FIX-2 (2026-07-30): Only list ops that are NOT backend_broken in the catalog. When the
 * best op for a platform is broken, either point at the next working op (shein) or
 * suppress the hint entirely (chatgpt — all ops broken).
 *
 * FIX-3 (2026-09-02, audit): FIX-2 validated STATUS but not EXISTENCE — isCatalogOpUsable
 * (below) used to be isCatalogOpBroken, which returned false (= "not broken, hint is
 * safe") for any domain/op pair ABSENT from the catalog entirely, not just ones marked
 * backend_broken. That's fail-OPEN: a typo'd or stale entry here silently passed the
 * gate and emitted a phantom `novada_scrape(platform=..., operation=...)` suggestion the
 * backend would reject with 11006/11008. Full audit against scraper_catalog.ts (16
 * platforms, ~87 ops) found three bad entries, now fixed:
 *   - "reddit.com"    → removed. reddit.com is not a catalog domain at all (confirmed by
 *                       resources/index.ts's own "NOT AVAILABLE — use novada_extract
 *                       instead" list, and tests/data/scraper_catalog.test.ts's
 *                       "unknown domain returns undefined" case). Also currently
 *                       unreachable via extractSingleInner's own hint sites because
 *                       rewriteRedditUrl() rewrites reddit.com/www.reddit.com to
 *                       old.reddit.com BEFORE baseDomain is computed — but the map entry
 *                       was wrong regardless of that incidental shadowing, and
 *                       getSuggestedFix's error-path hint (below) reads the ORIGINAL
 *                       (pre-rewrite) url, so a fetch-throws case there was reachable.
 *   - "glassdoor.com" → removed. Same as reddit.com: not one of the 16 active catalog
 *                       domains (also explicitly listed as "NOT AVAILABLE" in
 *                       resources/index.ts) — genuinely reachable via the hint sites
 *                       below (glassdoor.com has no compensating URL-rewrite).
 *   - "instagram.com" → corrected "instagram_profile_url" (never existed in the catalog)
 *                       to "ins_profiles_profileurl" (real, status:"ok", takes the same
 *                       `profileurl` shape an agent already has). Live-reachable bug —
 *                       verified by driving novadaExtract() end-to-end against a mocked
 *                       low-quality instagram.com response.
 * "twitter.com" is intentionally kept pointing at the x.com-only op "twitter_profile_username":
 * scrape.ts's own PLATFORM_ALIASES resolves platform:"twitter.com" → "x.com" at call time,
 * so the hint is genuinely actionable even though CATALOG_BY_DOMAIN has no "twitter.com"
 * key — isCatalogOpUsable applies the same alias before checking the catalog (HINT_DOMAIN_ALIASES).
 */
export declare const SCRAPER_PLATFORMS: Record<string, string>;
/**
 * FAIL-CLOSED (FIX-3): true only when `op` is a real, non-backend_broken operation for
 * `domain` (after alias resolution) in scraper_catalog.ts — the single source of truth
 * for what novada_scrape can actually execute. A domain or op ABSENT from the catalog now
 * returns false (suppress the hint) instead of the old isCatalogOpBroken's fail-open
 * default of true-means-broken/false-means-safe, which treated "not found" the same as
 * "confirmed working" (root cause of the reddit.com/instagram.com/glassdoor.com phantom
 * hints — see the SCRAPER_PLATFORMS doc comment above).
 */
export declare function isCatalogOpUsable(domain: string, op: string): boolean;
/**
 * Resolve the single-source-of-truth novada_scrape hint text for a domain, or null when
 * SCRAPER_PLATFORMS has no entry or the catalog can't confirm it's usable. Shared by the
 * two quality-hint emission sites and getSuggestedFix's error-path hint so there is
 * exactly one place that decides "is this domain's scrape hint safe to show" — no more
 * hand-duplicated per-domain override tables that can drift from SCRAPER_PLATFORMS
 * (getSuggestedFix used to hardcode its own instagram.com/x.com/amazon.com/linkedin.com
 * strings independently, which is how the instagram_profile_url phantom op survived in
 * TWO places at once).
 */
export declare function getScrapeHint(domain: string): string | null;
/**
 * Extract readable/structured content from a URL.
 * Returns cleaned markdown, JSON fields, or summaries — content processed for agent consumption.
 *
 * Format guide:
 *   - novada_extract(format="markdown") → readable/structured content (default).
 *                       Best for: articles, docs, product pages, any page where you want processed text.
 *   - novada_extract(format="html")  → raw HTML (full DOM source) for custom parsing or inspecting page structure.
 *                       Best for: when you need the actual source, CSS-selector workflows, or debugging DOM.
 *
 * Handles Cloudflare, DataDome, JS-heavy SPAs automatically via auto-escalation.
 */
export declare function novadaExtract(params: ExtractParams, apiKey?: string): Promise<string>;
/**
 * Derive a suggested_fix hint from a URL + error message.
 *
 * F14 ASSERT_INVARIANT (2026-09-10 audit): the suggested fix must NEVER recommend the
 * render mode that just failed. `attemptedRender` carries the caller's render param —
 * when the failed request was itself render/js, ANY branch below that resolves to a
 * positive render="render" recommendation is intercepted and replaced with an honest
 * alternative. Enforced at the wrapper so no current or future branch can violate it.
 */
export declare function getSuggestedFix(url: string, errorMsg: string, attemptedRender?: string): string;
/**
 * FIX-B (2026-07-30): pmc.ncbi.nlm.nih.gov hard-blocks automated extraction
 * (reCAPTCHA on the static fetch; the Web Unblocker render tier 503s on this host).
 * PMC full texts are freely available via two official mirrors that are NOT blocked
 * the same way: europepmc.org (same PMCID, different host) and NCBI E-utilities
 * efetch. This is a HINT ONLY — no auto-reroute this round (owner decision,
 * 2026-07-30) — so a blocked/failed extraction can tell the agent where the free
 * mirror lives instead of leaving it to guess "可能是限流" again.
 *
 * Matches both the modern host (pmc.ncbi.nlm.nih.gov) and the legacy path
 * (www.ncbi.nlm.nih.gov/pmc/...). The PMCID regex is a fixed literal run against
 * the URL string — never constructed from caller input — so no additional
 * MCP-param RegExp hardening is needed.
 *
 * @returns null for non-PMC hosts or unparsable URLs (never throws).
 */
export declare function getPmcMirrorHint(url: string): string | null;
/**
 * TOW2-307: True when a text body reads as markdown-structured content — it has at
 * least one ATX heading (`# Heading`), or is long enough to be document-like
 * (>=40 words). Used to decide whether a `text/plain` response should be treated
 * the same way as an explicit `text/markdown` response (title-from-heading +
 * markdown-link parsing) versus returned as plain, unstructured text. Deliberately
 * independent of attemptGitBookMdFallback's own `looksLikeDocs` check above (same
 * shape, different call site — kept separate per scope: do not touch the GitBook
 * fast-path).
 *
 * Exported (with deriveTitleFromMarkdown below) so site_copy.ts can apply the SAME
 * text/markdown | text/plain passthrough gate to fetchSitePage — it had the identical
 * Turndown-corruption bug (see site_copy.ts's fetchSitePage doc comment). site_copy.ts
 * already imports detectJsHeavyContent from this module, so re-exporting these two is
 * the established, cycle-free way to share extract.ts's leaf logic (extract.ts imports
 * nothing from site_copy.ts).
 */
export declare function looksLikeMarkdown(body: string): boolean;
/**
 * A body whose first non-whitespace char is `<` is HTML/XML, even when the server
 * mislabels its content-type as `text/plain` (common on raw CDNs like
 * raw.githubusercontent.com, S3, and misconfigured origins). Mirrors the guard the
 * `application/json` branch already applies (`body.trimStart().startsWith("<")`) so
 * mislabeled HTML falls through to real HTML extraction instead of being returned
 * verbatim as "markdown" — which would both leak raw tags AND short-circuit
 * site_copy's JS-render escalation. Scoped to `text/plain` only: a `text/markdown`
 * response is explicitly declared and trusted (valid markdown may legitimately open
 * with an inline `<div>`/`<!-- -->`). Review HIGH 2026-07-22, TOW2-307.
 * Exported so site_copy.ts applies the identical guard on its passthrough gate.
 */
export declare function bodyLooksLikeHtml(body: string): boolean;
/** Derive a title from the body's first ATX H1 (`# Heading`). Null when none is found. */
export declare function deriveTitleFromMarkdown(body: string): string | null;
//# sourceMappingURL=extract.d.ts.map