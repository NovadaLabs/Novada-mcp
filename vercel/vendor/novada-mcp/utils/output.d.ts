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