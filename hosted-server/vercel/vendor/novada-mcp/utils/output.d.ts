/** Absolute root every Novada output must live under. Hard SSRF/path-traversal boundary. */
export declare const DOWNLOADS_ROOT: string;
export interface OutputOptions {
    tool: string;
    hint?: string;
    format: "json" | "csv" | "md" | "html";
    data: unknown;
    cosUrl?: string;
    project?: string;
}
export interface OutputResult {
    filePath: string;
    cosUrl?: string;
    recordCount?: number;
    summary: string;
}
/**
 * Public alias of {@link sanitize} for callers (e.g. site_copy) that build their
 * own per-page filenames. Always returns a single safe path segment.
 */
export declare function sanitizeSlug(s: string, maxLen?: number): string;
/**
 * Resolve (and create) a site-copy output directory, hard-constrained to live
 * under {@link DOWNLOADS_ROOT}. Arbitrary absolute output paths are NOT accepted:
 * `project` and `domain` are sanitized to single segments before joining, and the
 * resolved path is re-checked to be inside the root (defence-in-depth SSRF/path-
 * traversal guard). Throws if anything would escape the root.
 *
 * Structure: ~/Downloads/novada-mcp/YYYY-MM-DD/<project|domain>/site-copy/
 */
export declare function resolveSiteCopyDir(domain: string, project?: string): Promise<string>;
/**
 * Join a sanitized per-page filename onto an already-resolved site-copy dir, and
 * re-verify the final file path stays inside {@link DOWNLOADS_ROOT}. Returns the
 * safe absolute path. Throws on escape.
 *
 * `slug` is sanitized to a single safe segment; `ext` (default "md") is whitelisted
 * to alphanumerics so it can never inject a path separator.
 */
export declare function safeSiteCopyFilePath(dir: string, slug: string, ext?: string): string;
/**
 * Convert an array of records to CSV string.
 */
export declare function toCsv(records: Record<string, unknown>[]): string;
/**
 * Save output to file. Returns metadata about the saved file.
 *
 * Directory structure:
 *   ~/Downloads/novada-mcp/YYYY-MM-DD/{topic}/
 *
 * Filename convention:
 *   {YYYY-MM-DD}_{HHmmss}_{source_hint}.{format}
 *
 * Throws if the serialized content would be empty (0 bytes).
 */
export declare function saveOutput(options: OutputOptions): Promise<OutputResult>;
//# sourceMappingURL=output.d.ts.map