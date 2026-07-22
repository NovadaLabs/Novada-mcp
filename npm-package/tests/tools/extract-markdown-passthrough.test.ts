import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaExtract } from "../../src/tools/extract.js";
import { clearCache } from "../../src/_core/session-cache.js";

/**
 * TOW2-307: extract.ts branched on content-type — PDF, then `application/json`,
 * then treated EVERYTHING ELSE (including `text/markdown` and `text/plain`) as
 * HTML and ran it through Turndown (src/utils/html.ts). Turndown assumes HTML
 * input: its text-node escaping pass escapes markdown-significant characters
 * (`*`, `_`, `[`, `]`, backtick, ...) and its whitespace-collapsing pass flattens
 * every newline in a non-`<pre>` text node to a single space. Fed a real markdown
 * document, the result is unusable — headings, bold text, and tables all get
 * mangled and the body becomes one run-on line.
 *
 * PROVE-THE-TESTER: this test was run against the pre-fix extract.ts (content-type
 * gate not yet added) and FAILED both assertions below — the returned content had
 * `\*\*bold\*\*` (escaped asterisks) instead of `**bold**`, and the table/paragraph
 * newlines were collapsed to spaces (no literal `\n` between the heading and the
 * table). After adding the text/markdown|text/plain gate ahead of the HTML default
 * in both extract.ts response branches, the body is returned verbatim and both
 * assertions pass.
 */

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-123";

const MARKDOWN_BODY = [
  `# Sample Doc`,
  ``,
  `This is **bold** text with real structure that Turndown must never touch.`,
  ``,
  `## Table`,
  ``,
  `| Name | Value |`,
  `| --- | --- |`,
  `| Alpha | 1 |`,
  `| Beta | 2 |`,
  ``,
  `See [the docs](https://example.com/docs) for more.`,
].join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
});

describe("TOW2-307: text/markdown and text/plain passthrough (no Turndown)", () => {
  it("returns a text/markdown body verbatim — real newlines, unescaped markdown", async () => {
    mockedAxios.get.mockResolvedValue({
      data: MARKDOWN_BODY,
      headers: { "content-type": "text/markdown; charset=utf-8" },
      status: 200,
    } as never);

    const result = await novadaExtract(
      { url: "https://example.com/doc.md", format: "markdown", render: "static" },
      API_KEY
    );

    // The body must be embedded byte-for-byte: real newlines between the heading,
    // the paragraph, and the table — never collapsed to a single space/line by
    // Turndown's whitespace-collapsing pass.
    expect(result).toContain(MARKDOWN_BODY);
    // Bold markers must survive unescaped (Turndown's escape() would produce
    // "\*\*bold\*\*").
    expect(result).toContain("**bold**");
    expect(result).not.toContain("\\*\\*bold\\*\\*");
    // Table pipes must survive unescaped and the row must remain on its own line.
    expect(result).toMatch(/\| Alpha \| 1 \|/);
    // Title derived from the first ATX H1.
    expect(result).toContain("title: Sample Doc");
    // Markdown link parsed out for the header/links section.
    expect(result).toContain("https://example.com/docs");
  });

  it("returns a markdown-like text/plain body verbatim too", async () => {
    mockedAxios.get.mockResolvedValue({
      data: MARKDOWN_BODY,
      headers: { "content-type": "text/plain; charset=utf-8" },
      status: 200,
    } as never);

    const result = await novadaExtract(
      { url: "https://example.com/doc.txt", format: "markdown", render: "static" },
      API_KEY
    );

    expect(result).toContain(MARKDOWN_BODY);
    expect(result).toContain("**bold**");
    expect(result).not.toContain("\\*\\*bold\\*\\*");
  });

  it("returns a non-markdown text/plain body verbatim as clean text (no title-from-heading)", async () => {
    const plainBody = "Just a short status message with no heading and no markdown structure.";
    mockedAxios.get.mockResolvedValue({
      data: plainBody,
      headers: { "content-type": "text/plain; charset=utf-8" },
      status: 200,
    } as never);

    const result = await novadaExtract(
      { url: "https://example.com/status.txt", format: "markdown", render: "static" },
      API_KEY
    );

    expect(result).toContain(plainBody);
    expect(result).toContain("content_type: text/plain");
  });

  it("still Turndown-converts real HTML (regression guard)", async () => {
    mockedAxios.get.mockResolvedValue({
      data: "<html><body><h1>Real Page</h1><p>Some **not-literal** prose.</p></body></html>",
      headers: { "content-type": "text/html; charset=utf-8" },
      status: 200,
    } as never);

    const result = await novadaExtract(
      { url: "https://example.com/page", format: "markdown", render: "static" },
      API_KEY
    );

    expect(result).toContain("Real Page");
    expect(result).toContain("title: Real Page");
  });

  /**
   * Review HIGH (2026-07-22): an origin (raw CDN, misconfigured server) that serves
   * HTML with a `text/plain` content-type must NOT be treated as markdown passthrough
   * — otherwise raw `<...>` tags leak into the output verbatim and, in site_copy, the
   * JS-render escalation is short-circuited. The body below scores
   * looksLikeMarkdown()===true (≥40 words), so WITHOUT the bodyLooksLikeHtml guard it
   * would passthrough; WITH the guard it falls through to real HTML extraction.
   * PROVE-THE-TESTER: run against the pre-guard build → this FAILS (output contains
   * "<p>" and the "passthrough" agent-hint). With the guard it passes.
   */
  it("does NOT passthrough HTML mislabeled as text/plain — extracts it instead", async () => {
    const htmlAsPlain =
      "<!DOCTYPE html><html><head><title>Mislabeled Page</title></head><body>" +
      "<h1>Mislabeled Heading</h1>" +
      "<p>This is a genuine HTML document that a misconfigured origin served with a " +
      "text plain content type header, which previously would have been returned " +
      "verbatim with raw angle bracket tags intact and would also have short " +
      "circuited the site copy render escalation path entirely.</p>" +
      "</body></html>";
    mockedAxios.get.mockResolvedValue({
      data: htmlAsPlain,
      headers: { "content-type": "text/plain; charset=utf-8" },
      status: 200,
    } as never);

    const result = await novadaExtract(
      { url: "https://raw.example.com/page.txt", format: "markdown", render: "static" },
      API_KEY
    );

    // Took the HTML-extraction path: heading text present in the body, and the title
    // was derived by the HTML extractor from <title> (not returned verbatim).
    expect(result).toContain("Mislabeled Heading");
    expect(result).toContain("title: Mislabeled Page");
    // Raw tags must NOT leak (would happen if returned verbatim as passthrough).
    expect(result).not.toContain("<p>");
    expect(result).not.toContain("<!DOCTYPE");
    // The passthrough formatter's agent-hint must be absent — proves HTML path taken.
    expect(result).not.toContain("passthrough");
  });

  /**
   * Second-review MEDIUM (2026-07-22): the passthrough gate is duplicated in both the
   * render branch (extract.ts ~889-918) and the static/auto branch (~1018-1027), but
   * only the static/auto branch had test coverage. This exercises the RENDER branch so
   * a future edit to one branch without the other is caught. fetchWithRender (http.ts)
   * returns `{ ...unblockerResp, data: html }`, so the mocked axios.post envelope's
   * content-type header is what extract's render branch reads.
   */
  it("passes a text/markdown body through verbatim on the RENDER branch too", async () => {
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "test-unblocker-key";
    try {
      // Web Unblocker envelope shape: { code: 0, data: { code: 200, html } }.
      mockedAxios.post.mockResolvedValue({
        data: { code: 0, data: { code: 200, html: MARKDOWN_BODY } },
        headers: { "content-type": "text/markdown; charset=utf-8" },
        status: 200,
      } as never);

      const result = await novadaExtract(
        { url: "https://example.com/doc.md", format: "markdown", render: "render" },
        API_KEY
      );

      expect(result).toContain(MARKDOWN_BODY);
      expect(result).toContain("**bold**");
      expect(result).not.toContain("\\*\\*bold\\*\\*");
      expect(result).toContain("mode: render");
    } finally {
      delete process.env.NOVADA_WEB_UNBLOCKER_KEY;
    }
  });
});
