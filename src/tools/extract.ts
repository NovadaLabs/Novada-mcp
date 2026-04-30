import { fetchViaProxy, fetchWithRender, extractMainContent, extractTitle, extractDescription, extractLinks, detectJsHeavyContent, detectBotChallenge, fetchViaBrowser, isBrowserConfigured, extractStructuredData, scoreExtraction, lookupDomain, extractFields, isPdfResponse, extractPdf } from "../utils/index.js";
import type { FieldResult } from "../utils/index.js";
import type { ExtractParams } from "./types.js";

export async function novadaExtract(params: ExtractParams, apiKey?: string): Promise<string> {
  // P1-6: Normalize url/urls into a list
  const urlList: string[] = params.urls
    ? params.urls
    : Array.isArray(params.url)
      ? params.url
      : [params.url as string];
  if (urlList.length > 10) {
    throw new Error(`Batch extract accepts at most 10 URLs per call. Received ${urlList.length}. Split into multiple calls.`);
  }

  const isBatch = urlList.length > 1 || params.urls !== undefined;

  // Batch mode: array of URLs (via urls param or url array)
  if (isBatch) {
    const urls = urlList;
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
  try {
    return await extractSingle({ ...params, url: urlList[0] }, apiKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [
      `## Extract Failed`,
      `url: ${urlList[0]}`,
      ``,
      `Error: ${message}`,
      ``,
      `## Agent Hints`,
      `- If the URL returns JSON or binary data, it cannot be extracted as HTML.`,
      `- If the URL is unreachable, check the domain and try novada_map first.`,
      `- For JS-heavy pages returning empty content, try with render="render".`,
    ].join("\n");
  }
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

  // P0-5: max_chars truncation — applies to ALL formats (text, markdown, html handled separately)
  const MAX_CHARS_DEFAULT = 25000;
  const maxChars = params.max_chars ?? MAX_CHARS_DEFAULT;

  if (params.format === "text") {
    let plainContent = mainContent
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\- /gm, "  * ")
      .replace(/\*\*([^*]+)\*\*/g, "$1");
    const totalCharsText = plainContent.length;
    if (plainContent.length > maxChars) {
      const suggestedHigher = Math.min(maxChars * 2, 100000);
      plainContent = plainContent.slice(0, maxChars) +
        `\n\n[Content may be truncated — showing first ${maxChars} of ${totalCharsText} total characters. Pass max_chars=${suggestedHigher} to get more.]`;
    }
    const linksText = sameDomainLinks.length > 0
      ? `\nSame-domain links:\n${sameDomainLinks.map(l => `  ${l}`).join("\n")}`
      : "";
    return `${title}\n${description ? description + "\n" : ""}\n${plainContent}${linksText}`;
  }

  // Quality scoring (skip structured data extraction for PDFs — no HTML schema)
  const structuredData = pdfPages !== null ? null : extractStructuredData(html);
  const hasStructuredData = structuredData !== null;
  const quality = scoreExtraction(html, mainContent, usedMode, hasStructuredData);

  // P0-1: Quality floor — never return quality:0 for non-empty content
  if (mainContent && mainContent.length > 0 && quality.score === 0) {
    quality.score = 1;
  }

  // max_chars truncation for markdown format
  const totalChars = mainContent.length;
  let displayContent = mainContent;
  let contentTruncated = false;
  if (displayContent.length > maxChars) {
    displayContent = displayContent.slice(0, maxChars);
    const suggestedHigher = Math.min(maxChars * 2, 100000);
    displayContent += `\n\n[Content may be truncated — showing first ${maxChars} of ${totalChars} total characters. Pass max_chars=${suggestedHigher} to get more.]`;
    contentTruncated = true;
  }

  const contentLen = totalChars;
  const isTruncated = contentTruncated;

  // Field extraction
  let fieldResults: FieldResult[] | null = null;
  if (params.fields && params.fields.length > 0) {
    fieldResults = extractFields(params.fields, structuredData, displayContent);
  }

  const metaExtra = contentTruncated
    ? ` | content_truncated:true | total_chars:${totalChars}`
    : "";

  const lines: string[] = [
    `## Extracted Content`,
    `url: ${params.url}`,
    `title: ${title}`,
    ...(description ? [`description: ${description}`] : []),
    `format: ${params.format || "markdown"} | chars:${contentLen}${isTruncated ? " (truncated)" : ""} | links:${allLinks.length} | mode:${usedMode} | quality:${quality.score}${pdfPages !== null ? ` | pdf:true | pages:${pdfPages}` : ""}${metaExtra}`,
    ``,
    `---`,
    ``,
  ];

  // Requested Fields block (before Structured Data)
  if (fieldResults && fieldResults.length > 0) {
    lines.push(`## Requested Fields`);
    for (const r of fieldResults) {
      const sourceTag = r.source === "not_found" ? " *(not found)*" : r.source === "structured_data" ? " *(from schema)*" : " *(pattern)*";
      if (r.source === "not_found") {
        lines.push(`${r.field}: —`);
      } else {
        // P0-3: Strip *(pattern)* annotation from the field value itself
        const cleanValue = typeof r.value === "string"
          ? r.value.replace(/ \*\(pattern\)\*/g, "").trimEnd()
          : r.value;
        lines.push(`${r.field}: ${cleanValue}${sourceTag}`);
      }
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

  lines.push(displayContent);

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
    lines.push(`- Content was truncated at ${maxChars} chars (full: ${totalChars}). Pass max_chars=${Math.min(maxChars * 2, 100000)} to get more, or use novada_map to find specific subpages.`);
  }
  try {
    lines.push(`- To discover more pages: novada_map with url="${new URL(params.url).origin}"`);
  } catch { /* ignore */ }
  if (params.query) {
    lines.push(`- Query context: "${params.query}". Focus analysis on this topic.`);
  }

  return lines.join("\n");
}
