import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

/**
 * TOW2-307 extension: novada_site_copy's fetchSitePage() had the SAME bug that
 * extract.ts's TOW2-307 fix addressed (see tests/tools/extract-markdown-passthrough.test.ts)
 * — it fetched a page's body and handed it straight to extractMainContent (utils/html.ts),
 * with zero content-type awareness. extractMainContent assumes HTML: it runs the body
 * through cheerio.load() + Turndown, whose text-node escaping pass escapes
 * markdown-significant characters (`*`, `_`, `[`, `]`, backtick, ...) and whose
 * whitespace-collapsing pass flattens every real newline in a non-`<pre>` text node
 * into a single space. Fed a genuine `text/markdown` docs page, the .md file written
 * to disk ends up corrupted before an agent ever reads it.
 *
 * PROVE-THE-TESTER (manually verified against the pre-fix code path, same method as
 * extract-markdown-passthrough.test.ts): calling extractMainContent() directly on
 * MARKDOWN_BODY below — exactly what pre-fix fetchSitePage's caller did unconditionally,
 * with no content-type gate — produces:
 *   "\\# Sample Doc This is \\*\\*bold\\*\\* text ... ## Table | Name | Value | ..."
 * i.e. EVERY newline collapsed to a space (heading and paragraph merged onto one line)
 * AND "**bold**" escaped to "\\*\\*bold\\*\\*". Both assertions below would FAIL against
 * that pre-fix path. After adding the content-type gate to fetchSitePage (mirrors
 * extract.ts's formatMarkdownExtract gate via the exported looksLikeMarkdown /
 * deriveTitleFromMarkdown helpers), a text/markdown response is written verbatim and
 * both assertions PASS.
 */

// ── Mock the filesystem so tests never touch real disk (same convention as site_copy.test.ts) ──
vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

import { writeFile } from "fs/promises";
import { novadaSiteCopy } from "../../src/tools/site_copy.js";
import { SiteCopyParamsSchema } from "../../src/tools/types.js";

const mockedWriteFile = vi.mocked(writeFile);

beforeEach(() => {
  vi.clearAllMocks();
  // Ensure no proxy env leaks into fetchViaProxy → forces plain axios.get path.
  delete process.env.NOVADA_PROXY_ENDPOINT;
  delete process.env.NOVADA_PROXY_USER;
  delete process.env.NOVADA_PROXY_PASS;
});

const ok = (data: string, contentType: string) =>
  ({ data, status: 200, headers: { "content-type": contentType }, config: {} as never, statusText: "OK" });
const fail = () => Promise.reject(new Error("404"));

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
].join("\n");

/** Find the writeFile call whose path is the one page .md (not manifest.json). */
function pageWriteContent(): string {
  const call = mockedWriteFile.mock.calls.find(
    (c) => String(c[0]).endsWith(".md") && !String(c[0]).endsWith("manifest.json"),
  );
  if (!call) throw new Error("page .md was not written");
  return String(call[1]);
}

describe("novadaSiteCopy — text/markdown passthrough (TOW2-307 extension)", () => {
  it("writes a text/markdown page verbatim — real newlines, unescaped markdown", async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.endsWith("/llms.txt")) {
        // Single-link llms.txt so discovery yields exactly one page and skips sitemap/BFS.
        return Promise.resolve(ok("# Docs\n- [Doc](https://example.com/doc.md)", "text/markdown; charset=utf-8"));
      }
      if (url === "https://example.com/doc.md") {
        return Promise.resolve(ok(MARKDOWN_BODY, "text/markdown; charset=utf-8"));
      }
      return fail();
    });

    const result = await novadaSiteCopy({ ...SiteCopyParamsSchema.parse({ url: "https://example.com" }) });

    expect(result).toContain("Site Copy Complete");
    expect(result).toContain("pages_written: 1");

    const written = pageWriteContent();
    // The body must be embedded byte-for-byte: real newlines between the heading, the
    // paragraph, and the table — never collapsed to a single space/line by Turndown's
    // whitespace-collapsing pass.
    expect(written).toContain(MARKDOWN_BODY);
    // Bold markers must survive unescaped (Turndown's escape() would produce "\*\*bold\*\*").
    expect(written).toContain("**bold**");
    expect(written).not.toContain("\\*\\*bold\\*\\*");
    // Table row must remain intact and on its own line.
    expect(written).toMatch(/\| Alpha \| 1 \|/);
    // Title derived from the body's own H1 (deriveTitleFromMarkdown), same as extract.ts.
    expect(written).toContain("# Sample Doc");
  });

  /**
   * Review HIGH (2026-07-22): a page served as HTML but labeled `text/plain` (raw CDN /
   * misconfigured origin) must NOT be treated as passthrough — otherwise raw `<...>` tags
   * are written to the .md file verbatim AND the JS-render escalation is short-circuited.
   * The HTML body below scores looksLikeMarkdown()===true (≥40 words), so without the
   * bodyLooksLikeHtml guard in isMarkdownPassthroughContentType it would passthrough;
   * with the guard it is Turndown-extracted like any other HTML page.
   */
  it("does NOT write HTML-mislabeled-as-text/plain verbatim — extracts it", async () => {
    const htmlAsPlain =
      "<!DOCTYPE html><html><head><title>Mislabeled</title></head><body>" +
      "<h1>Mislabeled Heading</h1>" +
      "<p>This is a genuine HTML document that a misconfigured origin served with a " +
      "text plain content type header, which without the guard would be written to " +
      "disk with its raw angle bracket tags intact instead of being cleanly extracted.</p>" +
      "</body></html>";
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.endsWith("/llms.txt")) {
        return Promise.resolve(ok("# Docs\n- [Doc](https://example.com/page)", "text/markdown; charset=utf-8"));
      }
      if (url === "https://example.com/page") {
        return Promise.resolve(ok(htmlAsPlain, "text/plain; charset=utf-8"));
      }
      return fail();
    });

    const result = await novadaSiteCopy({ ...SiteCopyParamsSchema.parse({ url: "https://example.com" }) });
    expect(result).toContain("pages_written: 1");

    const written = pageWriteContent();
    // Extracted, not verbatim: heading text present, raw tags absent.
    expect(written).toContain("Mislabeled Heading");
    expect(written).not.toContain("<p>");
    expect(written).not.toContain("<!DOCTYPE");
  });

  /**
   * Second-review HIGH (2026-07-22): site_copy's gate USED to also require
   * looksLikeMarkdown(body) for text/plain — so a SHORT (<40 words, no heading)
   * text/plain page fell through to Turndown and got corrupted, the exact TOW2-307
   * bug, still open for site_copy while extract.ts had already fixed it. The gate now
   * matches extract.ts exactly (text/plain passes through whenever it isn't HTML), so
   * a short plain body with markdown-significant characters + real newlines is written
   * verbatim. PROVE-THE-TESTER: against the pre-fix gate (with `&& looksLikeMarkdown`)
   * this body is Turndown'd — backticks/asterisks escaped, the two lines merged — and
   * the verbatim assertion FAILS.
   */
  it("writes a SHORT non-heading text/plain page verbatim (no Turndown) — matches extract.ts", async () => {
    const shortPlain = "Deploy note: run `npm run x`, not the *old* script.\nSee line two for the rollback step.";
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.endsWith("/llms.txt")) {
        return Promise.resolve(ok("# Docs\n- [Note](https://example.com/note)", "text/markdown; charset=utf-8"));
      }
      if (url === "https://example.com/note") {
        return Promise.resolve(ok(shortPlain, "text/plain; charset=utf-8"));
      }
      return fail();
    });

    const result = await novadaSiteCopy({ ...SiteCopyParamsSchema.parse({ url: "https://example.com" }) });
    expect(result).toContain("pages_written: 1");

    const written = pageWriteContent();
    // Byte-for-byte verbatim: backticks + *old* unescaped, the newline preserved.
    expect(written).toContain(shortPlain);
    expect(written).not.toContain("\\*old\\*");
    expect(written).not.toContain("\\`npm run x\\`");
  });
});
