import type { ExtractParams } from "./types.js";
export { detectJsHeavyContent } from "../utils/index.js";
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