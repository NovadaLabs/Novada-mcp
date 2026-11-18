/**
 * B2 (wave B/C, 2026-11-18) — "wrong page marked success" discriminators in
 * novadaExtract: a redirect landing on an unrelated homepage/archive snapshot, or a
 * body that IS a CDN error stub / cookie-consent wall rather than real content.
 *
 * Mirrors required by the brief are included inline next to each positive case so a
 * regression in either direction (over-flagging a legitimate page, or missing a real
 * wrong-page case) shows up in the same describe block.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaExtract } from "../../src/tools/extract.js";
import { clearCache } from "../../src/_core/session-cache.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-123";

beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
});

/** A real, content-rich page body — long enough that `quality.content_present` is
 *  true on its own, so the redirect-identity check (not a volume/quality heuristic)
 *  is what has to do the work in the redirect-to-homepage cases below. */
const REAL_HOMEPAGE_HTML = `
  <html><head><title>Example Site — Home</title></head>
  <body><main>
    <h1>Welcome to Example Site</h1>
    ${"<p>This is a real, substantial homepage with genuine editorial content, navigation links, and feature highlights spanning many paragraphs of prose.</p>".repeat(10)}
  </main></body></html>
`;

/** A real, substantial article that happens to mention "cookie"/"bad gateway" in
 *  passing — must never be mistaken for a boilerplate stub (mirror case). */
const REAL_ARTICLE_MENTIONING_PHRASES_HTML = `
  <html><head><title>How We Debugged a Production Incident</title></head>
  <body><main>
    <h1>How We Debugged a Production Incident</h1>
    <p>${"Last Tuesday our edge layer briefly returned a bad gateway error to a small fraction of users while we rolled out a new config. ".repeat(6)}</p>
    <p>${"Separately, our marketing site uses cookies to remember a visitor's language preference, which is a completely unrelated system. ".repeat(6)}</p>
  </main></body></html>
`;

function mockResponse(html: string, responseUrl?: string) {
  mockedAxios.get.mockResolvedValue({
    data: html,
    headers: {},
    status: 200,
    ...(responseUrl ? { request: { res: { responseUrl } } } : {}),
  });
}

async function extract(url: string) {
  return novadaExtract({ url, format: "markdown", render: "static" }, API_KEY);
}

describe("B2: redirected-to-homepage / archive-snapshot is an honest failure, not a false success", () => {
  it("deep path redirected to the site root ('/') → ## Extract Failed, wrong_page, even though the homepage has real content", async () => {
    mockResponse(REAL_HOMEPAGE_HTML, "https://example.com/");
    const result = await extract("https://example.com/2024/deleted-article");
    expect(result).toContain("## Extract Failed");
    expect(result).toMatch(/status:wrong_page/);
    expect(result).not.toContain("## Extracted Content");
  });

  it("deep path redirected to an UNEXPECTED web.archive.org snapshot → ## Extract Failed, wrong_page", async () => {
    mockResponse(REAL_HOMEPAGE_HTML, "https://web.archive.org/web/20200601000000/https://example.com/2024/deleted-article");
    const result = await extract("https://example.com/2024/deleted-article");
    expect(result).toContain("## Extract Failed");
    expect(result).toMatch(/status:wrong_page/);
  });

  it("MIRROR: a request that explicitly targets web.archive.org is unaffected (same rescue-host on both sides)", async () => {
    const wb = "https://web.archive.org/web/20200601000000/http://example.com/";
    mockResponse(REAL_HOMEPAGE_HTML, wb);
    const result = await extract(wb);
    expect(result).not.toContain("## Extract Failed");
    expect(result).toContain("## Extracted Content");
  });

  it("MIRROR: http→https on the SAME path stays a success", async () => {
    mockResponse(REAL_HOMEPAGE_HTML, "https://example.com/docs/guide");
    const result = await extract("http://example.com/docs/guide");
    expect(result).not.toContain("## Extract Failed");
    expect(result).toContain("## Extracted Content");
  });

  it("MIRROR: www<->apex on the SAME path stays a success", async () => {
    mockResponse(REAL_HOMEPAGE_HTML, "https://www.example.com/docs/guide");
    const result = await extract("https://example.com/docs/guide");
    expect(result).not.toContain("## Extract Failed");
  });

  it("MIRROR: trailing-slash-only difference stays a success", async () => {
    mockResponse(REAL_HOMEPAGE_HTML, "https://example.com/docs/guide/");
    const result = await extract("https://example.com/docs/guide");
    expect(result).not.toContain("## Extract Failed");
  });

  it("MIRROR: locale redirect FROM the root ('/' -> '/en/') stays a success — a root request has nowhere shallower to collapse to", async () => {
    mockResponse(REAL_HOMEPAGE_HTML, "https://example.com/en/");
    const result = await extract("https://example.com/");
    expect(result).not.toContain("## Extract Failed");
  });

  it("MIRROR: a deep path redirecting to ANOTHER deep path (not root) stays a success", async () => {
    mockResponse(REAL_HOMEPAGE_HTML, "https://example.com/docs/v2/guide");
    const result = await extract("https://example.com/docs/v1/guide");
    expect(result).not.toContain("## Extract Failed");
  });

  it("MIRROR: a request explicitly FOR the homepage ('/') that lands on '/' stays a success (nothing collapsed)", async () => {
    mockResponse(REAL_HOMEPAGE_HTML, "https://example.com/");
    const result = await extract("https://example.com/");
    expect(result).not.toContain("## Extract Failed");
  });

  it("MIRROR: finalUrl unknown (mocked transport without responseUrl) never guesses — treated as a normal success", async () => {
    mockResponse(REAL_HOMEPAGE_HTML); // no responseUrl at all
    const result = await extract("https://example.com/2024/deleted-article");
    expect(result).not.toContain("## Extract Failed");
  });
});

describe("B2: boilerplate-only pages (cookie wall / CDN error stub) are an honest failure", () => {
  it("cookie-consent-only wall (short, no real content) → ## Extract Failed, wrong_page", async () => {
    const html = `<html><body><div class="cookie-banner">We use cookies to improve your experience on this site. Accept All | Manage Preferences</div></body></html>`;
    mockResponse(html);
    const result = await extract("https://news.example/article/123");
    expect(result).toContain("## Extract Failed");
    expect(result).toMatch(/status:wrong_page/);
  });

  it("CDN 502 Bad Gateway stub (short) → ## Extract Failed, wrong_page", async () => {
    const html = `<html><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>`;
    mockResponse(html);
    const result = await extract("https://news.example/article/123");
    expect(result).toContain("## Extract Failed");
    expect(result).toMatch(/status:wrong_page/);
  });

  it("MIRROR: a long real article that merely MENTIONS 'bad gateway' and 'cookies' in passing stays a success", async () => {
    mockResponse(REAL_ARTICLE_MENTIONING_PHRASES_HTML);
    const result = await extract("https://news.example/article/123");
    expect(result).not.toContain("## Extract Failed");
    expect(result).toContain("## Extracted Content");
  });

  it("MIRROR: a legit short-but-complete page (example.com-style, ~29 words, no stub signature) stays a success", async () => {
    const html = `<html><head><title>Example Domain</title></head><body><main>
      <h1>Example Domain</h1>
      <p>This domain is for use in illustrative examples in documents. You may use this domain in literature without prior coordination or asking for permission.</p>
    </main></body></html>`;
    mockResponse(html);
    const result = await extract("https://example.com/");
    expect(result).not.toContain("## Extract Failed");
    expect(result).toContain("## Extracted Content");
  });
});
