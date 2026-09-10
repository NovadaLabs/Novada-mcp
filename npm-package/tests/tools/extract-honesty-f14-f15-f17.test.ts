/**
 * Regression tests for the extract-honesty cluster confirmed by the 2026-09-10
 * 0.9.38 release audit (novada-test-engineering/ledger/novada-mcp/release-blockers.md):
 *
 *  F14 — false-success on a failed render escalation. With the render tier 401-dead,
 *        quotes.toscrape.com/js/ came back as the empty JS shell yet the response said
 *        status:success + content_ok:true; the truth ([ESCALATION FAILED] … 401) was
 *        buried in a hints line, and the suggested fix circularly recommended the very
 *        render mode that had just failed. The lie fired via the R4 "short-but-complete"
 *        rescue: an empty JS shell has just enough chrome text (12+ words / 80+ chars)
 *        to pass the rescue gate. Fix: a failed escalation FETCH blocks the rescue and
 *        surfaces an honest, front-and-center failure that never re-recommends render.
 *
 *  F15 — parser crash surfaced raw. amazon.com/dp/B0CX23V2ZK on a funded key returned
 *        a bare `TypeError: Cannot read properties of undefined (reading 'parentNode')`
 *        to the agent. The crash lives in the readability/Turndown parse path, not in
 *        upstream access. Fix: classify parse crashes (Content parse failed + a
 *        suggested_fix that bypasses the parser via format="html"), and make
 *        pickBetterHtml's candidate scoring crash-safe.
 *
 *  F17 — silent ~25K truncation. extractMainContent's INTERNAL 25000-char cap (and the
 *        PDF pre-slice) fired BELOW the display-truncation check, so the schema-promised
 *        content_truncated:true + total_chars flags were never emitted. Fix: the flagged
 *        display truncation is the single truncation authority.
 *
 * All upstreams are mocked (vi.mock("axios") / module spies) — zero live network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaExtract } from "../../src/tools/extract.js";
import { clearCache } from "../../src/_core/session-cache.js";
import { clearRouteMemory } from "../../src/_core/route-memory.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-123";

beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
  clearRouteMemory();
});

// An empty JS shell in the exact quotes.toscrape.com/js/ shape: enough nav/footer chrome
// to pass the short-but-complete rescue gate (12+ words, 80+ chars, >200 bytes html, no
// bot-challenge / JS-heavy markers), but zero actual content — content_present:false and
// a quality score low enough to trigger the auto render escalation.
const JS_SHELL_HTML = `<html><head><title>Quotes to Scrape</title></head><body>
  <div class="container">
    <h1><a href="/">Quotes to Scrape</a></h1>
    <p><a href="/login">Login</a></p>
    <div class="quotes"></div>
    <footer>Quotes by GoodReads.com. Made with love by Scrapinghub. All the quote texts on this listing page load dynamically from client scripts.</footer>
  </div>
</body></html>`;

/** Web Unblocker envelope whose inner code=401 makes fetchWithRender throw immediately
 *  with `Web Unblocker error (401): …` — the exact F14 repro failure. */
const UNBLOCKER_401_ENVELOPE = {
  data: { code: 0, data: { code: 401, html: "", msg: "Unauthorized", msg_detail: "" } },
  status: 200,
  headers: {},
  config: {} as never,
  statusText: "OK",
};

// ─── F14: honest failure on escalation-fail ────────────────────────────────────

describe("F14: failed render escalation must be an honest failure (markdown)", () => {
  it("JS shell + 401 render escalation → content_ok:false, status:failed, escalation front-and-center, no render re-recommendation", async () => {
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "test-unblocker-key";
    try {
      mockedAxios.get.mockResolvedValue({ data: JS_SHELL_HTML, headers: { "content-type": "text/html" } });
      mockedAxios.post.mockResolvedValue(UNBLOCKER_401_ENVELOPE as never);

      const result = await novadaExtract(
        { url: "https://f14-shell-md.example/js/", format: "markdown", render: "auto" },
        API_KEY
      );

      // The lie: the empty shell must NOT be reported as a success.
      expect(result).toContain("content_ok:false");
      expect(result).not.toContain("quality:ok");
      expect(result).not.toMatch(/agent_instruction: status:success/);

      // The truth goes front-and-center: an escalation_failed header line (not only a
      // buried hint) plus a failed status in the agent instruction, carrying the 401.
      expect(result).toContain("escalation_failed: true");
      expect(result).toMatch(/agent_instruction: status:failed/);
      expect(result).toContain("401");

      // ASSERT_INVARIANT: suggested_fix / hints must NEVER recommend the mode that just
      // failed — in any of the phrasings the codebase uses for a render retry.
      expect(result).not.toMatch(/retry with render="render"/i);
      expect(result).not.toMatch(/retry render="render"/i);
      expect(result).not.toMatch(/try render="render"/i);
    } finally {
      delete process.env.NOVADA_WEB_UNBLOCKER_KEY;
    }
  });
});

describe("F14: failed render escalation must be an honest failure (JSON)", () => {
  it("JS shell + 401 render escalation → quality.content_ok:false + escalation_failed:true + failed agent_instruction", async () => {
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "test-unblocker-key";
    try {
      mockedAxios.get.mockResolvedValue({ data: JS_SHELL_HTML, headers: { "content-type": "text/html" } });
      mockedAxios.post.mockResolvedValue(UNBLOCKER_401_ENVELOPE as never);

      const result = await novadaExtract(
        { url: "https://f14-shell-json.example/js/", format: "json", render: "auto" },
        API_KEY
      );

      const parsed = JSON.parse(result);
      expect(parsed.quality.content_ok).toBe(false);
      expect(parsed.quality.content_present).toBe(false);
      expect(parsed.escalation_failed).toBe(true);
      expect(String(parsed.escalation_error)).toContain("401");
      expect(String(parsed.agent_instruction)).toContain("status:failed");
      expect(String(parsed.agent_instruction)).not.toMatch(/retry with render="render"/i);
    } finally {
      delete process.env.NOVADA_WEB_UNBLOCKER_KEY;
    }
  });
});

describe("F14 boundary: a genuinely short-but-complete page is still a success (R4 preserved)", () => {
  it("short page whose render escalation SUCCEEDS but adds nothing → still content_ok:true + status:success", async () => {
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "test-unblocker-key";
    try {
      const shortHtml = `<html><head><title>Tiny Docs</title></head><body><main><p>This tiny documentation page is complete and correct even though it only contains a couple of short sentences about the API.</p></main></body></html>`;
      mockedAxios.get.mockResolvedValue({ data: shortHtml, headers: { "content-type": "text/html" } });
      // Render escalation succeeds (transport + content), returns the SAME short page —
      // the page has been VERIFIED via render; it really is just short. No lie to fix.
      mockedAxios.post.mockResolvedValue({
        data: { code: 0, data: { code: 200, html: shortHtml, msg: "", msg_detail: "" } },
        status: 200,
        headers: {},
        config: {} as never,
        statusText: "OK",
      } as never);

      const result = await novadaExtract(
        { url: "https://f14-benign-short.example/tiny", format: "markdown", render: "auto" },
        API_KEY
      );

      expect(result).toContain("content_ok:true");
      expect(result).toMatch(/agent_instruction: status:success/);
      expect(result).not.toContain("status:failed");
      // But even here the escalation already ran — never recommend re-running it.
      expect(result).not.toMatch(/retry with render="render"/i);
    } finally {
      delete process.env.NOVADA_WEB_UNBLOCKER_KEY;
    }
  });
});

// ─── F15: parse-crash guard ─────────────────────────────────────────────────────

describe("F15: readability/parse crash returns a classified failure, never a raw TypeError", () => {
  const RICH_HTML = `<html><head><title>Product Page</title></head><body><main>${"<p>Real product prose content that passes every fetch-quality gate. </p>".repeat(30)}</main></body></html>`;

  it("parser crash on a neutral domain → classified 'Content parse failed' + format=\"html\" bypass, no render retry", async () => {
    mockedAxios.get.mockResolvedValue({ data: RICH_HTML, headers: { "content-type": "text/html" } });

    const utilsMod = await import("../../src/utils/index.js");
    const spy = vi.spyOn(utilsMod, "extractFullPageContent").mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'parentNode')");
    });
    try {
      const result = await novadaExtract(
        { url: "https://f15-parse-crash.example/page", format: "markdown" },
        API_KEY
      );

      expect(result).toContain("## Extract Failed");
      // Classified — not a bare TypeError with a generic fix.
      expect(result).toContain("Content parse failed");
      // The underlying detail is preserved for debugging…
      expect(result).toContain("parentNode");
      // …and the fix bypasses the crashing parser instead of re-running it via render.
      expect(result).toContain('format="html"');
      expect(result).not.toMatch(/retry with render="render"/i);
    } finally {
      spy.mockRestore();
    }
  });

  it("parser crash on amazon.com (the F15 repro target) → classified failure + novada_scrape structured-data alternative", async () => {
    mockedAxios.get.mockResolvedValue({ data: RICH_HTML, headers: { "content-type": "text/html" } });

    const utilsMod = await import("../../src/utils/index.js");
    const spy = vi.spyOn(utilsMod, "extractFullPageContent").mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'parentNode')");
    });
    try {
      const result = await novadaExtract(
        { url: "https://www.amazon.com/dp/B0CX23V2ZK", format: "markdown" },
        API_KEY
      );

      expect(result).toContain("## Extract Failed");
      expect(result).toContain("Content parse failed");
      expect(result).toContain('format="html"');
      // amazon.com has a working catalog op — the classified fix must point at it.
      expect(result).toContain("novada_scrape");
      expect(result).toContain('platform="amazon.com"');
    } finally {
      spy.mockRestore();
    }
  });

  it("a crashing ESCALATION candidate never crashes the whole request (pickBetterHtml is crash-safe)", async () => {
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "test-unblocker-key";
    process.env.NOVADA_BROWSER_WS = "wss://fake-browser.example.com";

    // render=render returns a bot-challenge page → browser escalation kicks in; the
    // browser candidate's HTML crashes the parser. The request must degrade to an
    // honest error (bot challenge / no better content), never a raw parentNode TypeError.
    const cfInterstitial = `<html><head><title>Just a moment...</title></head><body>
      <div id="challenge-stage">Checking your browser before allowing you access to this site.
        Cloudflare Ray ID: abc123def456 &bull; Your IP: 1.2.3.4
      </div>
    </body></html>`.padEnd(4000, "<!-- cloudflare padding -->");
    const CRASH_MARKER = "f15-crash-marker-browser-candidate";
    const browserHtml = `<html><head><title>${CRASH_MARKER}</title></head><body><main><p>candidate that crashes the parser</p></main></body></html>`;

    mockedAxios.post.mockResolvedValue({
      data: { code: 0, data: { code: 200, html: cfInterstitial, msg: "", msg_detail: "" } },
      status: 200,
      headers: { "content-type": "text/html" },
      config: {} as never,
      statusText: "OK",
    } as never);

    const utilsMod = await import("../../src/utils/index.js");
    const browserSpy = vi.spyOn(utilsMod, "fetchViaBrowser").mockResolvedValue(browserHtml);
    const realExtract = utilsMod.extractFullPageContent;
    const extractSpy = vi.spyOn(utilsMod, "extractFullPageContent").mockImplementation((html: string, baseUrl?: string) => {
      if (String(html).includes(CRASH_MARKER)) {
        throw new TypeError("Cannot read properties of undefined (reading 'parentNode')");
      }
      return realExtract(html, baseUrl);
    });
    try {
      const result = await novadaExtract(
        { url: "https://f15-crash-candidate.example/page", format: "markdown", render: "render" },
        API_KEY
      );

      // Degrades to the honest bot-challenge error path — no raw parser crash leaks.
      expect(result).not.toContain("parentNode");
      expect(result).toContain("## Extract Failed");
    } finally {
      extractSpy.mockRestore();
      browserSpy.mockRestore();
      delete process.env.NOVADA_WEB_UNBLOCKER_KEY;
      delete process.env.NOVADA_BROWSER_WS;
    }
  });
});

// ─── F17: content_truncated must fire on the ~25K internal cap ─────────────────

describe("F17: the schema-promised content_truncated flag fires on EVERY truncation path", () => {
  // >45K chars of clean <main> prose so extractMainContent's old internal 25000 cap
  // fired silently (clean=true path) while the display check (`> max_chars`) saw a
  // pre-capped string and never set the flag.
  const LONG_MAIN_HTML = `<html><head><title>Long Article</title></head><body><main><h1>Long Article</h1>${
    `<p>${"This paragraph provides substantive prose content for the truncation regression test. ".repeat(12)}</p>`.repeat(60)
  }</main></body></html>`;

  it("clean=true on a >25K page (markdown) → content_truncated:true + total_chars above the cap", async () => {
    mockedAxios.get.mockResolvedValue({ data: LONG_MAIN_HTML, headers: { "content-type": "text/html" } });

    const result = await novadaExtract(
      { url: "https://f17-clean-md.example/long", format: "markdown", clean: true },
      API_KEY
    );

    const m = result.match(/content_truncated:true \| total_chars:(\d+)/);
    expect(m).not.toBeNull();
    expect(parseInt(m![1], 10)).toBeGreaterThan(25000);
    expect(result).toContain("[Content may be truncated");
  });

  it("clean=true on a >25K page (JSON) → content_truncated:true + honest total_chars", async () => {
    mockedAxios.get.mockResolvedValue({ data: LONG_MAIN_HTML, headers: { "content-type": "text/html" } });

    const result = await novadaExtract(
      { url: "https://f17-clean-json.example/long", format: "json", clean: true },
      API_KEY
    );

    const parsed = JSON.parse(result);
    expect(parsed.content_truncated).toBe(true);
    expect(parsed.total_chars).toBeGreaterThan(25000);
    expect(parsed.returned_chars).toBeLessThan(parsed.total_chars);
  });

  it("PDF text over 25K → content_truncated:true + total_chars instead of the old silent pre-slice", async () => {
    // The PDF branch used to do html.slice(0, 25000) BEFORE the flagged display
    // truncation could ever see the full length — a second member of the same
    // silent-internal-cap class.
    const longPdfText = `${"PDF paragraph text for the truncation flag regression. ".repeat(20)}\n\n`.repeat(45);
    expect(longPdfText.length).toBeGreaterThan(25000);

    mockedAxios.get.mockResolvedValue({
      data: "%PDF-1.4 fake-bytes",
      headers: { "content-type": "application/pdf" },
    });

    const utilsMod = await import("../../src/utils/index.js");
    const pdfSpy = vi.spyOn(utilsMod, "extractPdf").mockResolvedValue({
      pages: 3,
      title: "Big PDF",
      text: longPdfText,
    } as never);
    try {
      const result = await novadaExtract(
        { url: "https://f17-pdf.example/big.pdf", format: "markdown" },
        API_KEY
      );

      const m = result.match(/content_truncated:true \| total_chars:(\d+)/);
      expect(m).not.toBeNull();
      expect(parseInt(m![1], 10)).toBeGreaterThan(25000);
      expect(result).toContain("pdf:true");
    } finally {
      pdfSpy.mockRestore();
    }
  });
});
