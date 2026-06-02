import type { StructuredData } from "./html.js";
export interface FieldResult {
    field: string;
    value: string;
    source: "structured_data" | "pattern" | "heading" | "not_found";
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
export type DiagnosticMethod = "heading-match" | "pattern-match" | "meta-tag";
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
}
/**
 * Extract requested fields from structured data + markdown fallback.
 */
export declare function extractFields(fields: string[], structuredData: StructuredData | null, markdown: string): FieldResult[];
/**
 * Like extractFields but also returns per-field diagnostics explaining why each null occurred.
 */
export declare function extractFieldsWithDiagnostics(fields: string[], structuredData: StructuredData | null, markdown: string, htmlLength: number): {
    results: FieldResult[];
    diagnostics: FieldDiagnostic[];
};
//# sourceMappingURL=fields.d.ts.map