const PDF_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
/**
 * Extract text content from a PDF buffer.
 * Returns plain text with page breaks preserved.
 * Rejects PDFs larger than 10 MB to guard against malicious/huge files.
 */
export async function extractPdf(buffer) {
    if (buffer.length > PDF_MAX_BYTES) {
        throw new Error(`PDF too large: ${(buffer.length / 1024 / 1024).toFixed(1)} MB (max 10 MB). Try a more specific page URL.`);
    }
    // NOV-577 cold-start: load pdf-parse lazily so importing this module (pulled in eagerly via
    // the utils barrel) doesn't pay the dep cost on every process start — only when a PDF is parsed.
    const { PDFParse } = (await import("pdf-parse"));
    const parser = new PDFParse({ data: buffer });
    const [textResult, infoResult] = await Promise.all([
        parser.getText(),
        parser.getInfo().catch(() => null),
    ]);
    const info = infoResult?.info;
    const title = typeof info?.Title === "string" && info.Title ? info.Title : undefined;
    const author = typeof info?.Author === "string" && info.Author ? info.Author : undefined;
    await parser.destroy();
    return {
        text: textResult.text,
        pages: textResult.total,
        ...(title ? { title } : {}),
        ...(author ? { author } : {}),
    };
}
/** Detect if a URL or Content-Type header indicates a PDF */
export function isPdfResponse(url, contentType) {
    if (contentType && contentType.toLowerCase().includes("application/pdf"))
        return true;
    const urlLower = url.toLowerCase().split("?")[0]; // strip query string for extension check
    return urlLower.endsWith(".pdf");
}
//# sourceMappingURL=pdf.js.map