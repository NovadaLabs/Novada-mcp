/**
 * Gateway status footer placement.
 *
 * The footer ("---\ngateway: ...") is human/agent-facing metadata. Concatenating it onto a
 * tool result whose text is JSON (format=json outputs) makes JSON.parse(result) fail for
 * every client. So: JSON result text -> footer goes in its own second text content block;
 * anything else (markdown etc.) keeps the historical single-block concatenation.
 *
 * Pure, dependency-free module so a plain `node --test` file can import it
 * (mcp.ts itself is never imported by tests — module-load side effects).
 */

export interface TextBlock {
  type: "text";
  text: string;
}

/** True when `text` (trimmed) starts with { or [ and parses as JSON. */
export function isJsonText(text: string): boolean {
  const t = text.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns a new content array with `footerText` attached. Only the FIRST block (the tool
 * result) is inspected; later blocks (e.g. first-run notice) are preserved in order after
 * the footer block.
 */
export function appendGatewayFooter(content: TextBlock[], footerText: string): TextBlock[] {
  if (content.length === 0) return [{ type: "text", text: footerText.replace(/^\s+/, "") }];
  const [first, ...rest] = content;
  if (isJsonText(first.text)) {
    return [first, { type: "text", text: footerText.replace(/^\s+/, "") }, ...rest];
  }
  return [{ type: "text", text: first.text + footerText }, ...rest];
}
