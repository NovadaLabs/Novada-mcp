export type OutputFormat = "markdown" | "json" | "csv" | "html" | "xlsx";
/** Convert records to CSV string */
export declare function formatAsCsv(records: Record<string, unknown>[]): string;
/** Convert records to HTML table */
export declare function formatAsHtml(records: Record<string, unknown>[], title?: string): string;
/** Convert records to XLSX buffer */
export declare function formatAsXlsx(records: Record<string, unknown>[], sheetName?: string): Promise<Buffer>;
/** Convert records to markdown table */
export declare function formatAsMarkdown(records: Record<string, unknown>[], maxCellLen?: number): string;
/**
 * Format structured records into the requested output format.
 * Returns { content: string | Buffer, mimeType: string }
 */
export declare function formatRecords(records: Record<string, unknown>[], format: OutputFormat, options?: {
    title?: string;
    sheetName?: string;
}): Promise<{
    content: string | Buffer;
    mimeType: string;
    ext: string;
}>;
//# sourceMappingURL=format.d.ts.map