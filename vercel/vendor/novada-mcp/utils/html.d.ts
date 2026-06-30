import type { CheerioAPI } from "cheerio";
/**
 * Extract main content from HTML using cheerio.
 * Tries semantic selectors first, then density scoring, then falls back to boilerplate removal.
 */
export declare function extractMainContent(html: string, baseUrl?: string, maxChars?: number): string;
/**
 * Extract full page content from HTML — keeps nav, header, footer, aside, form.
 * Only removes non-renderable tags: script, style, noscript, iframe, svg, canvas.
 * Uses Turndown + GFM plugin for HTML-to-markdown conversion.
 * Target output: 50,000–100,000 chars.
 */
export declare function extractFullPageContent(html: string, baseUrl?: string): string;
export interface StructuredData {
    type: string;
    fields: Record<string, string>;
    raw?: string;
}
/**
 * Extract the highest-priority schema.org JSON-LD structured data block from HTML.
 * Returns null if no valid JSON-LD is found.
 */
export declare function extractStructuredData(html: string): StructuredData | null;
/**
 * $-accepting variant of extractStructuredData (NOV-577): read-only, so extract.ts can share
 * one parsed document across the title/description/links/structured-data readers instead of
 * calling cheerio.load four separate times per request.
 */
export declare function extractStructuredDataFrom($: CheerioAPI): StructuredData | null;
export interface ExtractionQuality {
    /** 0-100 display score: the floored/mutated value (presence floor + caller quality floors applied). Prefer content_present + cleanliness_score for orthogonal signals. */
    score: number;
    /** True when the page carries substantive prose/content (not a shell, wall, or boilerplate-only page). */
    content_present: boolean;
    /** 0-100 raw additive markup-quality score, captured BEFORE the presence floor (and untouched by caller quality floors). May be lower than `score` when a floor lifts the display value. */
    cleanliness_score: number;
    /** Human-readable reasons explaining content_present + cleanliness (agent-facing). */
    quality_reasons: string[];
    signals: string[];
}
/**
 * Strip docs-site boilerplate from cleaned markdown before running quality signals.
 * Removes empty / zero-width anchor links (e.g. `[​](#anchor)`, `[](#section)`)
 * and known no-content chrome phrases. Returns markdown safe to length/word-count.
 */
export declare function stripBoilerplate(markdown: string): string;
/**
 * Heuristic: does the CLEANED markdown carry substantive content?
 * Substantive = cleaned length >= 200 chars AND word count >= 50.
 * Boilerplate (empty anchors, docs chrome) is stripped before measuring,
 * so a shell/wall page that only renders nav + "Copy page" reads as not-present.
 */
export declare function hasSubstantiveContent(cleanedMarkdown: string): boolean;
/**
 * Score the quality of an extraction result.
 *
 * NOV-565: splits the historical single `score` into two orthogonal signals so
 * docs pages with full text are no longer mislabelled "poor" just because their
 * markup is link-heavy or sparsely structured:
 *   - content_present  — is there real content here? (drives content_ok / escalation)
 *   - cleanliness_score — how clean is the markup? (the raw additive 0-100 score, pre-floor)
 * `score` is the display value: cleanliness_score after the presence floor (and any caller
 * quality floors) are applied, so `score` >= `cleanliness_score` whenever a floor lifts it.
 *
 * All length/link/heading signals run on the CLEANED markdown (boilerplate removed).
 */
export declare function scoreExtraction(html: string, markdown: string, usedMode: string, hasStructuredData: boolean): ExtractionQuality;
export declare function qualityLabel(score: number): string;
/** Extract page title from HTML */
export declare function extractTitle(html: string): string;
/** $-accepting variant of extractTitle (NOV-577): read-only, shareable across readers. */
export declare function extractTitleFrom($: CheerioAPI): string;
/** Extract meta description from HTML */
export declare function extractDescription(html: string): string;
/** $-accepting variant of extractDescription (NOV-577): read-only, shareable across readers. */
export declare function extractDescriptionFrom($: CheerioAPI): string;
/**
 * Extract all meaningful links from HTML.
 * Navigation links (from <nav>, <header>) are returned first for better site mapping.
 */
export declare function extractLinks(html: string, baseUrl?: string): string[];
/** $-accepting variant of extractLinks (NOV-577): read-only, shareable across readers. */
export declare function extractLinksFrom($: CheerioAPI, baseUrl?: string): string[];
//# sourceMappingURL=html.d.ts.map