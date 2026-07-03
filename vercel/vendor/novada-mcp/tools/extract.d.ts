import type { ExtractParams } from "./types.js";
export { detectJsHeavyContent } from "../utils/index.js";
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
export declare function novadaExtract(params: ExtractParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=extract.d.ts.map