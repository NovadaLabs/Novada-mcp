import { fetchViaProxy, fetchWithRender, extractMainContent, extractTitle, extractDescription, extractLinks, detectJsHeavyContent, detectBotChallenge, fetchViaBrowser, isBrowserConfigured, extractStructuredData, scoreExtraction, lookupDomain, extractFields, isPdfResponse, extractPdf } from "../utils/index.js";
import type { FieldResult } from "../utils/index.js";
import type { ExtractParams } from "./types.js";

export async function novadaExtract(params: ExtractParams, apiKey?: string): Promise<string> {
  // Batch mode: array of URLs
  if (Array.isArray(params.url)) {
    const urls = params.url;
    const results = await Promise.all(
      urls.map((url, i) =>
        extractSingle({ ...params, url }, apiKey)
          .then(content => ({ i, url, content, ok: true }))
          .catch(err => ({ i, url, content: `Error: ${err instanceof Error ? err.message : String(err)}`, ok: false }))
      )
    );

    const successful = results.filter(r => r.ok).length;
    const failed = results.length - successful;

    const lines: string[] = [
      `## Batch Extract Results`,
      `urls:${urls.length} | successful:${successful} | failed:${failed}`,
      ``,
      `---`,
      ``,
    ];

    for (const r of results) {
      lines.push(`### [${r.i + 1}/${urls.length}] ${r.url}`);
      if (!r.ok) lines.push(`status: FAILED`);
      lines.push(``);
      lines.push(r.content);
      lines.push(``);
      lines.push(`---`);
      lines.push(``);
    }

    lines.push(`## Agent Hints`);
    if (failed > 0) {
      lines.push(`- ${failed} URL(s) failed. Check if they require JavaScript rendering.`);
    }
    lines.push(`- Use novada_map to discover additional pages on any of these domains.`);

    return lines.join("\n");
  }

  // Single URL mode
  return extractSingle(params as ExtractParams & { url: string }, apiKey);
}

async function extractSingle(
  params: ExtractParams & { url: string },
  apiKey?: string
): Promise<string> {
  const renderMode = params.render ?? "auto";

  // Domain registry: skip auto-detection probe for known sites
  const domainHint = renderMode === "auto" ? lookupDomain(params.url) : null;
  const effectiveMode = domainHint ? domainHint.method : renderMode;

  let html: string;
  let usedMode: "static" | "render" | "browser" | "render-failed" = "static";
  let renderError: string | null = null;

  // Force modes (or registry-resolved modes) skip escalation logic
  if (effectiveMode === "browser") {
    html = await fetchViaBrowser(params.url);
    usedMode = "browser";
  } else if (effectiveMode === "render") {
    const response = await fetchWithRender(params.url, apiKey);
    const contentType = String((response.headers as Record<string, string>)?.["content-type"] ?? "");
    if (isPdfResponse(params.url, contentType)) {
      const pdfBuffer = Buffer.isBuffer(response.data)
        ? response.data
        : Buffer.from(response.data as string, "binary");
      const pdf = await extractPdf(pdfBuffer);
      html = `pdf_pages:${pdf.pages}\n${pdf.title ? `title: ${pdf.title}\n` : ""}${pdf.text}`;
    } else {
      if (typeof response.data !== "string") {
        throw new Error("Response is not HTML. The URL may return JSON or binary data.");
      }
      html = response.data;
    }
    usedMode = "render";
  } else {
    // Auto or static: start with static fetch
    const response = await fetchViaProxy(params.url, apiKey);
    const contentType = String((response.headers as Record<string, string>)?.["content-type"] ?? "");
    if (isPdfResponse(params.url, contentType)) {
      const pdfBuffer = Buffer.isBuffer(response.data)
        ? response.data
        : Buffer.from(response.data as string, "binary");
      const pdf = await extractPdf(pdfBuffer);
      html = `pdf_pages:${pdf.pages}\n${pdf.title ? `title: ${pdf.title}\n` : ""}${pdf.text}`;
    } else {
      if (typeof response.data !== "string") {
        throw new Error("Response is not HTML. The URL may return JSON or binary data.");
      }
      html = response.data;
    }

    // Skip JS detection if we already have PDF content (no escalation needed)
    if (renderMode === "auto" && !html.startsWith("pdf_pages:") && (detectJsHeavyContent(html) || detectBotChallenge(html))) {
      // Escalate to render mode (JS-heavy OR bot challenge on static fetch)
      try {
        const renderResponse = await fetchWithRender(params.url, apiKey);
        const renderHtml = String(renderResponse.data);
        if (detectBotChallenge(renderHtml)) {
          // Render returned a bot challenge page — escalate to browser if available
          if (isBrowserConfigured()) {
            html = await fetchViaBrowser(params.url);
            usedMode = "browser";
          } else {
            // No browser available — keep static html, mark as failed
            usedMode = "render-failed";
            renderError = "Render returned a bot challenge page";
          }
        } else if (!detectJsHeavyContent(renderHtml)) {
          html = renderHtml;
          usedMode = "render";
        } else if (isBrowserConfigured()) {
          // render also JS-heavy — try full browser
          html = await fetchViaBrowser(params.url);
          usedMode = "browser";
        } else {
          // render worked but still JS-heavy, use it (better than static)
          html = renderHtml;
          usedMode = "render";
        }
      } catch (err) {
        // render threw — try Browser API if available
        renderError = err instanceof Error ? err.message : String(err);
        if (isBrowserConfigured()) {
          html = await fetchViaBrowser(params.url);
          usedMode = "browser";
        } else {
          usedMode = "render-failed";
        }
      }
    }
  }

  // Detect PDF output from router (prefixed with pdf_pages:N)
  const pdfPageMatch = html.match(/^pdf_pages:(\d+)\n/);
  let pdfPages: number | null = null;
  let pdfTitle: string | undefined;
  if (pdfPageMatch) {
    pdfPages = parseInt(pdfPageMatch[1], 10);
    // Extract optional title line before stripping prefix
    const titleLine = html.match(/^pdf_pages:\d+\ntitle: ([^\n]+)\n/);
    pdfTitle = titleLine?.[1];
    // Strip the pdf_pages prefix (and optional title line)
    html = html.replace(/^pdf_pages:\d+\n(?:title: [^\n]+\n)?/, "");
  }

  const title = pdfPages !== null ? (pdfTitle ?? params.url) : extractTitle(html);
  const description = extractDescription(html);
  const stillJsHeavy = renderMode === "auto" && (usedMode === "static" || usedMode === "render-failed") && detectJsHeavyContent(html);

  if (params.format === "html") {
    if (html.length <= 10000) return html;
    const truncated = html.slice(0, 10000);
    const lastTagClose = truncated.lastIndexOf(">");
    return (lastTagClose > 9000 ? truncated.slice(0, lastTagClose + 1) : truncated) +
      "\n<!-- Content truncated at 10,000 characters -->";
  }

  // For PDF content, use the text directly (no HTML parsing needed)
  const mainContent = pdfPages !== null
    ? html.slice(0, 25000)
    : extractMainContent(html, params.url);

  const allLinks = pdfPages !== null ? [] : extractLinks(html, params.url);
  let baseDomain: string;
  try {
    baseDomain = new URL(params.url).hostname.replace(/^www\./, "");
  } catch {
    baseDomain = "";
  }
  const sameDomainLinks = allLinks
    .filter(link => {
      try {
        return new URL(link).hostname.replace(/^www\./, "") === baseDomain;
      } catch { return false; }
    })
    .slice(0, 15);

  if (params.format === "text") {
    const plainContent = mainContent
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\- /gm, "  * ")
      .replace(/\*\*([^*]+)\*\*/g, "$1");
    const linksText = sameDomainLinks.length > 0
      ? `\nSame-domain links:\n${sameDomainLinks.map(l => `  ${l}`).join("\n")}`
      : "";
    return `${title}\n${description ? description + "\n" : ""}\n${plainContent}${linksText}`;
  }

  const contentLen = mainContent.length;
  const isTruncated = contentLen > 25000;

  // Quality scoring (skip structured data extraction for PDFs — no HTML schema)
  const structuredData = pdfPages !== null ? null : extractStructuredData(html);
  const hasStructuredData = structuredData !== null;
  const quality = scoreExtraction(html, mainContent, usedMode, hasStructuredData);

  // Field extraction
  let fieldResults: FieldResult[] | null = null;
  if (params.fields && params.fields.length > 0) {
    fieldResults = extractFields(params.fields, structuredData, mainContent);
  }

  const lines: string[] = [
    `## Extracted Content`,
    `url: ${params.url}`,
    `title: ${title}`,
    ...(description ? [`description: ${description}`] : []),
    `format: ${params.format || "markdown"} | chars:${contentLen}${isTruncated ? " (may be truncated)" : ""} | links:${allLinks.length} | mode:${usedMode} | quality:${quality.score}${pdfPages !== null ? ` | pdf:true | pages:${pdfPages}` : ""}`,
    ``,
    `---`,
    ``,
  ];

  // Requested Fields block (before Structured Data)
  if (fieldResults && fieldResults.length > 0) {
    lines.push(`## Requested Fields`);
    for (const r of fieldResults) {
      const sourceTag = r.source === "not_found" ? " *(not found)*" : r.source === "structured_data" ? " *(from schema)*" : " *(pattern)*";
      lines.push(r.source === "not_found"
        ? `${r.field}: —`
        : `${r.field}: ${r.value}${sourceTag}`);
    }
    lines.push(``, `---`, ``);
  }

  // Prepend structured data block if available
  if (hasStructuredData && structuredData) {
    lines.push(`## Structured Data`);
    lines.push(`type: ${structuredData.type}`);
    for (const [key, value] of Object.entries(structuredData.fields)) {
      lines.push(`${key}: ${value}`);
    }
    lines.push(``, `---`, ``);
  }

  lines.push(mainContent);

  if (sameDomainLinks.length > 0) {
    lines.push(``, `---`, `## Same-Domain Links (${sameDomainLinks.length} of ${allLinks.length})`);
    for (const link of sameDomainLinks) {
      lines.push(`- ${link}`);
    }
  }

  lines.push(``, `---`, `## Agent Hints`);
  if (pdfPages !== null) {
    lines.push(`- PDF extracted automatically: ${pdfPages} page(s). pdf_pages:${pdfPages} in metadata above.`);
    lines.push(`- PDF URLs are extracted automatically — use novada_extract the same way as HTML.`);
    lines.push(`- For large PDFs (>10MB), try a more specific page URL.`);
  }
  if (usedMode === "browser") {
    lines.push(`- Content fetched via Browser API (CDP). Cost: ~$3/GB — use only when static/render modes fail.`);
  }
  if (stillJsHeavy) {
    if (usedMode === "render-failed") {
      // Render was already attempted and failed — do NOT suggest retrying with render='render'
      lines.push(`- [WARNING] Page is JavaScript-rendered. Web Unblocker was attempted but failed.`);
      if (renderError) lines.push(`- Render error: ${renderError}`);
      lines.push(`- Do NOT retry with render="render" — it was already tried and failed.`);
      if (isBrowserConfigured()) {
        lines.push(`- Try render="browser" to use the Browser API instead. Note: Browser API costs ~$3/GB.`);
      } else {
        lines.push(`- To enable browser-level rendering: set NOVADA_BROWSER_WS env var (get credentials at https://dashboard.novada.com/overview/browser/), then retry with render="browser".`);
        lines.push(`- Also verify NOVADA_WEB_UNBLOCKER_KEY is set correctly.`);
        lines.push(`- Note: Browser API costs ~$3/GB — use sparingly.`);
      }
    } else {
      lines.push(`- [WARNING] Page appears JavaScript-rendered. Content above may be incomplete.`);
      lines.push(`- Retry with render="render" to use Novada Web Unblocker (JS rendering).`);
      if (!isBrowserConfigured()) {
        lines.push(`- For full browser rendering (costs ~$3/GB), set NOVADA_BROWSER_WS env var.`);
      }
    }
  }
  if (isTruncated) {
    lines.push(`- Content may be truncated. Use novada_map to find specific subpages.`);
  }
  try {
    lines.push(`- To discover more pages: novada_map with url="${new URL(params.url).origin}"`);
  } catch { /* ignore */ }
  if (params.query) {
    lines.push(`- Query context: "${params.query}". Focus analysis on this topic.`);
  }

  return lines.join("\n");
}
