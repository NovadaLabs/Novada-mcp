/**
 * Extract main content from HTML using cheerio.
 * Tries semantic selectors first, then density scoring, then falls back to boilerplate removal.
 */
export declare function extractMainContent(html: string, baseUrl?: string, maxChars?: number): string;
/**
 * Extract full page content from HTML — keeps nav, header, footer, aside, form.
 * Only removes non-renderable tags: script, style, noscript, iframe, svg, canvas.
 * Uses the same inlineMarkdown walker as extractMainContent.
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
export interface ExtractionQuality {
    score: number;
    signals: string[];
}
/**
 * Score the quality of an extraction result on a 0-100 scale.
 * Additive signals, clamped to [0, 100].
 */
export declare function scoreExtraction(html: string, markdown: string, usedMode: string, hasStructuredData: boolean): ExtractionQuality;
export declare function qualityLabel(score: number): string;
/** Extract page title from HTML */
export declare function extractTitle(html: string): string;
/** Extract meta description from HTML */
export declare function extractDescription(html: string): string;
/**
 * Extract all meaningful links from HTML.
 * Navigation links (from <nav>, <header>) are returned first for better site mapping.
 */
export declare function extractLinks(html: string, baseUrl?: string): string[];
//# sourceMappingURL=html.d.ts.map