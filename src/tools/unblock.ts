import { routeFetch } from "../utils/router.js";
import type { UnblockParams } from "./types.js";

/**
 * Force JS rendering on a URL and return raw HTML.
 * Unlike extract (which returns cleaned markdown), unblock returns the full DOM —
 * useful when agents need to parse specific elements, inspect structure, or
 * when extract's auto-router hints suggest retrying with render.
 */
export async function novadaUnblock(params: UnblockParams, apiKey?: string): Promise<string> {
  const { url, method, country: _country, wait_for, timeout } = params;

  const renderMode = method === "browser" ? "browser" as const : "render" as const;

  const result = await routeFetch(url, {
    render: renderMode,
    apiKey,
    timeout,
    waitForSelector: wait_for,
  });

  const htmlLength = result.html.length;
  const maxChars = 50000;
  const truncated = htmlLength > maxChars;
  const html = truncated ? result.html.slice(0, maxChars) : result.html;

  const lines: string[] = [
    `## Unblocked Content`,
    `url: ${url}`,
    `method: ${result.mode} | cost: ${result.cost} | chars: ${htmlLength}${truncated ? ` (truncated to ${maxChars})` : ""}`,
    ``,
    `---`,
    ``,
    html,
  ];

  if (truncated) {
    lines.push(``, `<!-- Content truncated at ${maxChars} characters -->`);
  }

  lines.push(``, `---`, `## Agent Hints`);
  lines.push(`- This is raw HTML, not cleaned text. Parse with CSS selectors or regex.`);
  lines.push(`- For cleaned text content, use novada_extract instead.`);
  if (result.mode === "render") {
    lines.push(`- Rendered via Web Unblocker (JS execution enabled).`);
  } else if (result.mode === "browser") {
    lines.push(`- Rendered via Browser API (full Chromium, highest fidelity).`);
  }

  return lines.join("\n");
}
