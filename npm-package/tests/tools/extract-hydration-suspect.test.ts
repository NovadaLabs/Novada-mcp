/**
 * B4 (wave B/C, 2026-11-18, issue #46) — JS-gated table/widget empty under a static
 * fetch, while the surrounding page (nav/FAQ/footer) is substantial enough that the
 * existing whole-page score/content_present gate never fires.
 *
 * Part 1: pure unit tests of detectHydrationSuspect() against table shapes — fast,
 * deterministic, no HTTP mocking.
 * Part 2: end-to-end novadaExtract wiring — confirms the gate actually escalates in
 * auto mode, and the two required mirrors (explicit render="static" never escalates;
 * a genuinely-empty-by-design table is not flagged).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cheerio from "cheerio";
import axios from "axios";
import { novadaExtract, detectHydrationSuspect } from "../../src/tools/extract.js";
import { clearCache } from "../../src/_core/session-cache.js";

function doc(html: string) {
  return cheerio.load(html);
}

describe("detectHydrationSuspect — table shape unit tests", () => {
  it("header populated, body rows present but value cells empty → suspect", () => {
    const html = `<table>
      <thead><tr><th>Tier</th><th>Price</th><th>Seats</th></tr></thead>
      <tbody>
        <tr><td>Starter</td><td></td><td></td></tr>
        <tr><td>Pro</td><td></td><td></td></tr>
      </tbody>
    </table>`;
    expect(detectHydrationSuspect(doc(html))).toBe(true);
  });

  it("header populated, value cells are literal placeholder dashes → suspect", () => {
    const html = `<table>
      <thead><tr><th>Tier</th><th>Price</th></tr></thead>
      <tbody><tr><td>Starter</td><td>-</td></tr><tr><td>Pro</td><td>—</td></tr></tbody>
    </table>`;
    expect(detectHydrationSuspect(doc(html))).toBe(true);
  });

  it("header populated, zero body rows at all, but a loading/skeleton marker INSIDE the table → suspect", () => {
    const html = `<table class="pricing-table">
      <thead><tr><th>Tier</th><th>Price</th></tr></thead>
      <tbody class="skeleton-loader"></tbody>
    </table>`;
    expect(detectHydrationSuspect(doc(html))).toBe(true);
  });

  it("MIRROR: header populated, zero body rows, NO loading marker → not suspect (ambiguous, could be legitimately empty)", () => {
    const html = `<table>
      <thead><tr><th>Tier</th><th>Price</th></tr></thead>
      <tbody></tbody>
    </table>`;
    expect(detectHydrationSuspect(doc(html))).toBe(false);
  });

  it("MIRROR: header populated, body row is a real 'No results found' message (non-empty, non-placeholder text) → not suspect", () => {
    const html = `<table>
      <thead><tr><th>Tier</th><th>Price</th></tr></thead>
      <tbody><tr><td colspan="2">No pricing tiers are currently available for your region.</td></tr></tbody>
    </table>`;
    expect(detectHydrationSuspect(doc(html))).toBe(false);
  });

  it("MIRROR: header populated, body rows fully populated with real data → not suspect", () => {
    const html = `<table>
      <thead><tr><th>Tier</th><th>Price</th><th>Seats</th></tr></thead>
      <tbody><tr><td>Starter</td><td>$9/mo</td><td>5</td></tr><tr><td>Pro</td><td>$29/mo</td><td>20</td></tr></tbody>
    </table>`;
    expect(detectHydrationSuspect(doc(html))).toBe(false);
  });

  it("MIRROR: a decorative single-column table/list (< 2 header cells) is never this signature", () => {
    const html = `<table><thead><tr><th>Item</th></tr></thead><tbody><tr><td></td></tr></tbody></table>`;
    expect(detectHydrationSuspect(doc(html))).toBe(false);
  });

  it("MIRROR: a page with no tables at all → not suspect", () => {
    expect(detectHydrationSuspect(doc("<html><body><p>Just a normal page.</p></body></html>"))).toBe(false);
  });
});

vi.mock("axios");
const mockedAxios = vi.mocked(axios);
const API_KEY = "test-key-123";

/** A realistic page: substantial nav/FAQ/footer prose (clears the whole-page
 *  score/content_present floor on its own) + a pricing table whose data cells never
 *  hydrated under a static fetch — issue #46's own 3rd occurrence shape. */
const HYDRATION_SUSPECT_PAGE = `
  <html><head><title>Pricing</title></head><body>
    <nav>${"<a href=\"/x\">Link</a> ".repeat(10)}</nav>
    <main>
      <h1>Pricing</h1>
      <table id="pricing-table">
        <thead><tr><th>Tier</th><th>Price</th><th>Seats</th></tr></thead>
        <tbody><tr><td>Starter</td><td></td><td></td></tr><tr><td>Pro</td><td></td><td></td></tr></tbody>
      </table>
      <h2>Frequently Asked Questions</h2>
      ${"<p>This is a substantial FAQ answer with enough real prose to clear the whole-page content-present floor on its own, well before the pricing table is even considered.</p>".repeat(6)}
    </main>
    <footer>${"<p>Footer link text.</p>".repeat(3)}</footer>
  </body></html>
`;

/** The same page, but the table rows are genuinely absent-by-design (real "no
 *  results" text) — must NOT trigger escalation. */
const LEGITIMATELY_EMPTY_TABLE_PAGE = HYDRATION_SUSPECT_PAGE.replace(
  `<tbody><tr><td>Starter</td><td></td><td></td></tr><tr><td>Pro</td><td></td><td></td></tr></tbody>`,
  `<tbody><tr><td colspan="3">No pricing tiers are currently available for your region.</td></tr></tbody>`
);

beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
  delete process.env.NOVADA_WEB_UNBLOCKER_KEY;
});

describe("novadaExtract wiring — hydration_suspect escalates in auto mode only", () => {
  it("auto mode: a hydration-suspect table escalates to render (fetchWithRender/axios.post is invoked) even though the whole page clears the score/content_present floor", async () => {
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "test-unblocker-key";
    mockedAxios.get.mockResolvedValue({ data: HYDRATION_SUSPECT_PAGE, headers: {}, status: 200 });
    mockedAxios.post.mockResolvedValue({
      data: { code: 0, data: { code: 200, html: HYDRATION_SUSPECT_PAGE, msg: "", msg_detail: "" } },
      status: 200,
      headers: {},
      config: {} as never,
      statusText: "OK",
    });

    await novadaExtract({ url: "https://pricing-escalation-test.example/pricing", format: "markdown" }, API_KEY);

    expect(mockedAxios.post).toHaveBeenCalled(); // render tier was actually attempted
  });

  it("MIRROR: explicit render=\"static\" on the SAME hydration-suspect page never escalates (axios.post is never invoked)", async () => {
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "test-unblocker-key";
    mockedAxios.get.mockResolvedValue({ data: HYDRATION_SUSPECT_PAGE, headers: {}, status: 200 });

    const result = await novadaExtract(
      { url: "https://pricing-static-mirror-test.example/pricing", format: "markdown", render: "static" },
      API_KEY
    );

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(result).toContain("## Extracted Content"); // static mode's own result still returned normally
  });

  it("MIRROR: a genuinely-empty-by-design table (real 'no results' text, not a hydration gap) never escalates", async () => {
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "test-unblocker-key";
    mockedAxios.get.mockResolvedValue({ data: LEGITIMATELY_EMPTY_TABLE_PAGE, headers: {}, status: 200 });

    await novadaExtract({ url: "https://pricing-legit-empty-test.example/pricing", format: "markdown" }, API_KEY);

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
