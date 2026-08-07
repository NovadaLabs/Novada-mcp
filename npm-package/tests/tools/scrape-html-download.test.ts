import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { NovadaError, NovadaErrorCode } from "../../src/_core/errors.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

// Must come after mock setup
const { novadaScrape } = await import("../../src/tools/scrape.js");

// Submit response: { code:0, data: { code:200, data: { task_id:"..." } } }
// (matches scrape.test.ts's SUBMIT_OK convention exactly)
const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "test-task-123" }, msg: "success" }, msg: "success" },
  status: 200,
  headers: {},
  config: {} as never,
  statusText: "OK",
};

function mockDownloadBody(body: unknown) {
  mockedAxios.post.mockResolvedValue(SUBMIT_OK);
  mockedAxios.get.mockResolvedValue({
    data: body,
    status: 200,
    headers: {},
    config: {} as never,
    statusText: "OK",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// TOW2-382 / Sentry NOVADA-MCP-HOSTED-4 (live in prod 0.9.34, 141x since
// 2026-07-03): pollForResult's final catch-all threw a bare `Error` when the
// download endpoint returned {filename, html} — a raw HTML page (challenge/
// consent/interstitial page, e.g. Perplexity) instead of structured records.
// A bare Error skips makeNovadaError, so the hosted dispatch logged it as an
// error-level Sentry ALERT instead of retryable upstream weather (a
// breadcrumb), and the agent received a raw-HTML dump instead of an
// actionable message.
describe("novadaScrape — pollForResult HTML-page download response (TOW2-382)", () => {
  // Real captured shape from the Sentry event (HTML body truncated/synthetic
  // here, but the {filename, html} envelope shape matches exactly).
  const HTML_PAGE_BODY = {
    filename: "novada_1785988137659_opxg39",
    html:
      '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title></head>' +
      "<body>Please complete the challenge to continue.</body></html>",
  };

  it("throws a NovadaError with code API_DOWN (not a bare Error)", async () => {
    mockDownloadBody(HTML_PAGE_BODY);
    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
        "test-key"
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NovadaError);
    const err = thrown as NovadaError;
    expect(err.code).toBe(NovadaErrorCode.API_DOWN);
    expect(err.detail).toBe("download_html_page");
  });

  it("does not leak the raw HTML into the error message", async () => {
    mockDownloadBody(HTML_PAGE_BODY);
    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
        "test-key"
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const msg = (thrown as Error).message;
    expect(msg).not.toContain("<!DOCTYPE");
    expect(msg).not.toContain("<html");
    expect(msg).not.toContain("Just a moment");
  });

  it("message is actionable — mentions retry, and that it's not the caller's request/params", async () => {
    mockDownloadBody(HTML_PAGE_BODY);
    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
        "test-key"
      );
    } catch (e) {
      thrown = e;
    }
    const msg = (thrown as Error).message.toLowerCase();
    expect(msg).toContain("retry");
    expect(msg).toContain("not your request or parameters");
  });

  // Class fix (not a perplexity-specific patch): the branch triggers on the
  // response SHAPE, so a different platform/operation hitting the same shape
  // must be classified identically.
  it("is tool-agnostic — triggers on the response shape for a different platform/operation too", async () => {
    mockDownloadBody({
      filename: "novada_other_task",
      html: "<!DOCTYPE html><html><body>Please accept cookies to continue.</body></html>",
    });
    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "google.com", operation: "google_search", params: { q: "test query" }, format: "markdown", limit: 20 },
        "test-key"
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NovadaError);
    expect((thrown as NovadaError).code).toBe(NovadaErrorCode.API_DOWN);
  });

  // Negative control: a genuinely-unrecognized body shape must still hit the
  // ORIGINAL bare-Error fallback unchanged — the new branch must not swallow
  // shapes it wasn't meant to handle.
  it("still throws a bare Error for a genuinely-unrecognized body shape (unchanged fallback)", async () => {
    mockDownloadBody({ weird: 1 });
    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
        "test-key"
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(NovadaError);
    expect((thrown as Error).message).toContain("Unexpected download response");
  });

  // ─── Fix-round-2 (review: APPROVE-with-required-changes) ───────────────────
  // HIGH#1: caller explicitly asked for an HTML-inclusive response (json=2
  // "JSON+HTML" or json=3 "HTML" on the submit params) — a {filename,html}
  // download body is then NOT the TOW2-382 bug, it's exactly what the caller
  // requested. The new branch must NOT fire in that case; it must preserve
  // today's exact prior behavior (fall through to the existing bare-Error
  // catch-all). A proper json=2/3 HTML-return path is a separate follow-up.
  it("does NOT throw download_html_page when the caller explicitly requested HTML (json=3)", async () => {
    mockDownloadBody(HTML_PAGE_BODY);
    let thrown: unknown;
    try {
      await novadaScrape(
        {
          platform: "amazon.com",
          operation: "amazon_product_by-keywords",
          params: { keyword: "iphone", json: 3 },
          format: "markdown",
          limit: 20,
        },
        "test-key"
      );
    } catch (e) {
      thrown = e;
    }
    // Must NOT be the new API_DOWN/download_html_page classification...
    const isDownloadHtmlPageError =
      thrown instanceof NovadaError &&
      thrown.code === NovadaErrorCode.API_DOWN &&
      thrown.detail === "download_html_page";
    expect(isDownloadHtmlPageError).toBe(false);
    // ...it must instead hit the unchanged bare-Error fallback.
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(NovadaError);
    expect((thrown as Error).message).toContain("Unexpected download response");
  });

  // HIGH#2: records present under ANY key extractRecords() recognizes (not
  // just `data`) must count as "has usable records" and suppress the new
  // branch — the guard must reuse extractRecords' key list as the single
  // source of truth, never a second divergent hardcoded list.
  it("does NOT throw download_html_page when records are present under a non-`data` key (e.g. `results`)", async () => {
    mockDownloadBody({
      ...HTML_PAGE_BODY,
      results: [{ title: "a real record" }],
    });
    let thrown: unknown;
    try {
      await novadaScrape(
        {
          platform: "amazon.com",
          operation: "amazon_product_by-keywords",
          params: { keyword: "iphone", json: 1 },
          format: "markdown",
          limit: 20,
        },
        "test-key"
      );
    } catch (e) {
      thrown = e;
    }
    const isDownloadHtmlPageError =
      thrown instanceof NovadaError &&
      thrown.code === NovadaErrorCode.API_DOWN &&
      thrown.detail === "download_html_page";
    expect(isDownloadHtmlPageError).toBe(false);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(NovadaError);
  });

  // LOW (folded into HIGH#2): an EMPTY array under a known key is not a
  // "usable record" — the new branch must still fire.
  it("DOES throw download_html_page when the only 'records' key present is an empty array", async () => {
    mockDownloadBody({
      ...HTML_PAGE_BODY,
      data: [],
    });
    let thrown: unknown;
    try {
      await novadaScrape(
        {
          platform: "amazon.com",
          operation: "amazon_product_by-keywords",
          params: { keyword: "iphone", json: 1 },
          format: "markdown",
          limit: 20,
        },
        "test-key"
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NovadaError);
    const err = thrown as NovadaError;
    expect(err.code).toBe(NovadaErrorCode.API_DOWN);
    expect(err.detail).toBe("download_html_page");
  });
});
