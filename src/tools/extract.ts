import { fetchViaProxy, fetchWithRender, extractMainContent, extractTitle, extractDescription, extractLinks, detectJsHeavyContent, detectBotChallenge, fetchViaBrowser, isBrowserConfigured, extractStructuredData, scoreExtraction, lookupDomain, extractFields } from "../utils/index.js";
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

  // Force modes (or registry-resolved modes) skip escalation logic
  if (effectiveMode === "browser") {
    html = await fetchViaBrowser(params.url);
    usedMode = "browser";
  } else if (effectiveMode === "render") {
    const response = await fetchWithRender(params.url, apiKey);
    if (typeof response.data !== "string") {
      throw new Error("Response is not HTML. The URL may return JSON or binary data.");
    }
    html = response.data;
    usedMode = "render";
  } else {
    // Auto or static: start with static fetch
    const response = await fetchViaProxy(params.url, apiKey);
    if (typeof response.data !== "string") {
      throw new Error("Response is not HTML. The URL may return JSON or binary data.");
    }
    html = response.data;

    if (renderMode === "auto" && detectJsHeavyContent(html)) {
      // Escalate to render mode
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
      } catch {
        // render failed — try Browser API if available
        if (isBrowserConfigured()) {
          html = await fetchViaBrowser(params.url);
          usedMode = "browser";
        } else {
          usedMode = "render-failed";
        }
      }
    }
  }

  const title = extractTitle(html);
  const description = extractDescription(html);
  const stillJsHeavy = renderMode === "auto" && (usedMode === "static" || usedMode === "render-failed") && detectJsHeavyContent(html);

  if (params.format === "html") {
    if (html.length <= 10000) return html;
    const truncated = html.slice(0, 10000);
    const lastTagClose = truncated.lastIndexOf(">");
    return (lastTagClose > 9000 ? truncated.slice(0, lastTagClose + 1) : truncated) +
      "\n<!-- Content truncated at 10,000 characters -->";
  }

  const mainContent = extractMainContent(html, params.url);

  const allLinks = extractLinks(html, params.url);
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
  const isTruncated = contentLen >= 25000;

  // Quality scoring
  const structuredData = extractStructuredData(html);
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
    `format: ${params.format || "markdown"} | chars:${contentLen}${isTruncated ? " (may be truncated)" : ""} | links:${allLinks.length} | mode:${usedMode} | quality:${quality.score}`,
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
  if (stillJsHeavy) {
    lines.push(`- ⚠ Page appears JavaScript-rendered. Content above may be incomplete.`);
    lines.push(`- Retry with render="render" to use Novada Web Unblocker (JS rendering).`);
    if (!isBrowserConfigured()) {
      lines.push(`- For full browser rendering, set NOVADA_BROWSER_WS env var.`);
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
