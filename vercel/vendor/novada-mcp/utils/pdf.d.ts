export interface PdfExtractResult {
    text: string;
    pages: number;
    title?: string;
    author?: string;
}
/**
 * Extract text content from a PDF buffer.
 * Returns plain text with page breaks preserved.
 * Rejects PDFs larger than 10 MB to guard against malicious/huge files.
 */
export declare function extractPdf(buffer: Buffer): Promise<PdfExtractResult>;
/** Detect if a URL or Content-Type header indicates a PDF */
export declare function isPdfResponse(url: string, contentType?: string): boolean;
//# sourceMappingURL=pdf.d.ts.map