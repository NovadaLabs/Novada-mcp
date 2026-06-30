import type { CheerioAPI } from "cheerio";
import type { StructuredData } from "./html.js";
/**
 * Where a field value was resolved from, in chain order.
 * - jsonld      → JSON-LD / meta structured data (was "structured_data")
 * - infobox     → Wikipedia-style infobox table
 * - table       → table column-header match (was "table_header")
 * - microdata   → Schema.org itemprop attribute
 * - pattern     → known/generic regex pattern in markdown
 * - heading     → "## Field\nvalue" markdown section fallback
 * - llm         → reserved for the (currently disabled) LLM extraction layer
 * - unresolved  → not found by any layer (was "not_found"); value is null
 */
export type FieldSource = "jsonld" | "infobox" | "table" | "microdata" | "pattern" | "heading" | "llm" | "unresolved";
export interface FieldResult {
    field: string;
    /** Resolved value, or null when source === "unresolved". */
    value: string | null;
    source: FieldSource;
    /** Heuristic 0–1 confidence; jsonld/microdata high, proximity/heading lower. */
    confidence: number;
    /** Layers attempted (in order) before resolving/giving up. Diagnostics use this. */
    attempted?: string[];
    /** Non-silent guidance set only when source === "unresolved". */
    agent_instruction?: string;
}
export interface HeadingSectionResult {
    value: string | null;
    reason: "matched" | "no_heading_match" | "section_empty";
}
/**
 * Like matchHeadingSection but returns a reason alongside the value.
 * Zero impact on existing callers of matchHeadingSection.
 */
export declare function matchHeadingSectionWithReason(text: string, field: string): HeadingSectionResult;
export declare function isStatValue(v: string): boolean;
/**
 * Extract requested fields from structured data + HTML layers + markdown fallback.
 *
 * Chain order (per field):
 *   jsonld → infobox → table-header → label-rows/dl → microdata → adjacent (hero) →
 *   known patterns → generic colon pattern → tolerant labelled-value → number-near-label →
 *   heading section → (llm stub, off) → unresolved
 *
 * cheerio is loaded once per call AND the DOM is walked once up front (NOV-577): every
 * label→value candidate the HTML layers need is harvested by collectDomCandidates, then each
 * field resolves against those in-memory arrays — O(DOM + fields × candidates) instead of the
 * old O(fields × DOM) where each layer re-queried `$` per requested field.
 * Unresolved fields are NON-SILENT: value=null + agent_instruction explaining the miss.
 */
export declare function extractFields(fields: string[], structuredData: StructuredData | null, markdown: string, html?: string, 
/**
 * NOV-577: optional pre-parsed document. When the caller (extract.ts) already loaded the
 * same `html` into cheerio for its title/description/links/structured-data readers, it passes
 * that `$` here so this function skips a redundant cheerio.load. When omitted, `html` is parsed
 * as before, so the public signature and every existing caller stay unchanged.
 */
preloaded$?: CheerioAPI | null): FieldResult[];
export type DiagnosticMethod = "heading-match" | "pattern-match" | "meta-tag" | "infobox" | "table-header" | "microdata";
export type DiagnosticReasonCode = "no_heading_match" | "section_empty" | "no_pattern_match" | "page_too_short";
export interface FieldDiagnostic {
    field: string;
    matched: boolean;
    /** Only set when matched === true */
    method?: DiagnosticMethod;
    /** Only set when matched === false */
    reasonCode?: DiagnosticReasonCode;
    /** Human-readable explanation for reasonCode */
    reasonText?: string;
    /** Layers attempted (mirrors FieldResult.attempted) — diagnostics surface this. */
    attempted?: string[];
}
/**
 * Like extractFields but also returns per-field diagnostics explaining why each null occurred.
 * Reuses the unified extractFields chain so the two code paths can never drift, then derives
 * diagnostics from each FieldResult's source + attempted list.
 */
export declare function extractFieldsWithDiagnostics(fields: string[], structuredData: StructuredData | null, markdown: string, htmlLength: number, html?: string, 
/** NOV-577: forward the caller's pre-parsed document so extractFields skips a redundant
 *  cheerio.load (mirrors extractFields' own preloaded$ param). */
preloaded$?: CheerioAPI | null): {
    results: FieldResult[];
    diagnostics: FieldDiagnostic[];
};
//# sourceMappingURL=fields.d.ts.map