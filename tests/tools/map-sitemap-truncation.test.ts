/**
 * Tests for F3 + F9: sitemap truncation + misleading search-filter hint.
 *
 * F3: sitemap-discovered URLs at path depth > max_depth were being filtered by
 *     inScope() causing the tool to return only a handful of shallow URLs even
 *     when the sitemap contains hundreds.
 *
 * F9: when the sitemap pool is small (< 10) and search returns 0 matches, the
 *     hint must warn about potential discovery truncation, not imply the site
 *     has no matching pages.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaMap } from "../../src/tools/map.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

beforeEach(() => { vi.clearAllMocks(); });

// Simulates a sitemapindex with ONE child sitemap that contains
// 50 deep URLs (path depth 3, like /api-reference/endpoint/<name>).
// Default max_depth=2 must NOT filter these out when discovered via sitemap.
function makeSitemapIndex(childUrl: string): string {
  return `<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${childUrl}</loc></sitemap>
</sitemapindex>`;
}

function makeDeepUrlset(baseUrl: string, count: number): string {
  const urls = Array.from({ length: count }, (_, i) =>
    `<url><loc>${baseUrl}/api-reference/endpoint/op${i}</loc></url>`
  ).join("\n");
  return `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

// ---- F3 tests ---------------------------------------------------------------

describe("F3: sitemap — deep URLs not truncated by max_depth on sitemap branch", () => {
  it("returns limit-capped URLs from sitemap even when path depth > max_depth=2", async () => {
    // 50 URLs at /api-reference/endpoint/opN (depth 3) in child sitemap
    const childSitemap = makeDeepUrlset("https://docs.example.com", 50);
    const sitemapIndex = makeSitemapIndex("https://docs.example.com/sitemap-api.xml");

    mockedAxios.get
      .mockRejectedValueOnce(new Error("404")) // robots.txt
      .mockResolvedValueOnce({ data: sitemapIndex, status: 200, headers: {}, config: {} as never, statusText: "OK" }) // sitemap.xml → is index
      .mockResolvedValueOnce({ data: childSitemap, status: 200, headers: {}, config: {} as never, statusText: "OK" }); // child sitemap

    const result = await novadaMap({ url: "https://docs.example.com", limit: 30, max_depth: 2 });

    // Must find ~30 URLs (limit-capped), NOT only 0-3 shallow ones
    const numbered = result.match(/^\d+\. /gm) ?? [];
    expect(numbered.length).toBe(30);
    expect(result).toContain("discovery:sitemap");
  });

  it("returns all available URLs when sitemap has fewer than limit", async () => {
    // Only 5 URLs in the sitemap (all deep)
    const childSitemap = makeDeepUrlset("https://docs.example.com", 5);
    const sitemapIndex = makeSitemapIndex("https://docs.example.com/sitemap-api.xml");

    mockedAxios.get
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({ data: sitemapIndex, status: 200, headers: {}, config: {} as never, statusText: "OK" })
      .mockResolvedValueOnce({ data: childSitemap, status: 200, headers: {}, config: {} as never, statusText: "OK" });

    const result = await novadaMap({ url: "https://docs.example.com", limit: 30, max_depth: 2 });

    const numbered = result.match(/^\d+\. /gm) ?? [];
    expect(numbered.length).toBe(5);
    // Must NOT claim "map_complete" with count=5 when we know discovered < limit
    // but this case IS honest: discovered=5, returned=5 (genuine site has 5)
    expect(result).toContain("discovery:sitemap");
  });

  it("still applies limit: returns at most `limit` URLs even when sitemap has many more", async () => {
    // 100 deep URLs, limit=10
    const childSitemap = makeDeepUrlset("https://docs.example.com", 100);
    const sitemapIndex = makeSitemapIndex("https://docs.example.com/sitemap-api.xml");

    mockedAxios.get
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({ data: sitemapIndex, status: 200, headers: {}, config: {} as never, statusText: "OK" })
      .mockResolvedValueOnce({ data: childSitemap, status: 200, headers: {}, config: {} as never, statusText: "OK" });

    const result = await novadaMap({ url: "https://docs.example.com", limit: 10, max_depth: 2 });

    const numbered = result.match(/^\d+\. /gm) ?? [];
    expect(numbered.length).toBe(10);
  });

  it("flat single sitemap.xml — unchanged behavior: returns URLs regardless of depth", async () => {
    const flat = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/a</loc></url>
  <url><loc>https://example.com/a/b/c/d/e</loc></url>
</urlset>`;

    mockedAxios.get
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({ data: flat, status: 200, headers: {}, config: {} as never, statusText: "OK" });

    const result = await novadaMap({ url: "https://example.com", limit: 50, max_depth: 2 });

    // All 3 URLs must be returned including the very deep one
    expect(result).toContain("https://example.com/a/b/c/d/e");
    expect(result).toContain("discovery:sitemap");
  });

  it("nested sitemapindex with 2 child sitemaps — all children parsed", async () => {
    const child1 = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a/b/page1</loc></url>
  <url><loc>https://example.com/a/b/page2</loc></url>
</urlset>`;
    const child2 = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/c/d/page3</loc></url>
  <url><loc>https://example.com/c/d/page4</loc></url>
</urlset>`;
    const index = `<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-child1.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-child2.xml</loc></sitemap>
</sitemapindex>`;

    mockedAxios.get
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({ data: index, status: 200, headers: {}, config: {} as never, statusText: "OK" })
      .mockResolvedValueOnce({ data: child1, status: 200, headers: {}, config: {} as never, statusText: "OK" })
      .mockResolvedValueOnce({ data: child2, status: 200, headers: {}, config: {} as never, statusText: "OK" });

    const result = await novadaMap({ url: "https://example.com", limit: 50, max_depth: 2 });

    // URLs from BOTH children must appear
    expect(result).toContain("https://example.com/a/b/page1");
    expect(result).toContain("https://example.com/c/d/page3");
    expect(result).toContain("discovery:sitemap");
  });

  it("no sitemap — BFS fallback path still works (no regression)", async () => {
    const html = `<html><body>
      <a href="https://example.com/page1">link</a>
      <a href="https://example.com/page2">link</a>
      ${"word ".repeat(30)}
    </body></html>`;

    mockedAxios.get
      .mockRejectedValueOnce(new Error("404")) // robots.txt
      .mockRejectedValueOnce(new Error("404")) // sitemap.xml
      .mockRejectedValueOnce(new Error("404")) // sitemap_index.xml
      .mockResolvedValue({ data: html, status: 200, headers: {}, config: {} as never, statusText: "OK" });

    const result = await novadaMap({ url: "https://example.com", limit: 20, max_depth: 1 });

    expect(result).toContain("discovery:crawl");
    expect(result).toContain("https://example.com/page1");
  });

  it("does not claim map_complete when returned < discovered_total (discovery truncated)", async () => {
    // 100 deep URLs in sitemap, but limit=10 means we only return 10
    // The sitemap has 100 entries, so this is a genuine limit truncation — not "site has fewer"
    const childSitemap = makeDeepUrlset("https://docs.example.com", 100);
    const sitemapIndex = makeSitemapIndex("https://docs.example.com/sitemap-api.xml");

    mockedAxios.get
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({ data: sitemapIndex, status: 200, headers: {}, config: {} as never, statusText: "OK" })
      .mockResolvedValueOnce({ data: childSitemap, status: 200, headers: {}, config: {} as never, statusText: "OK" });

    const result = await novadaMap({ url: "https://docs.example.com", limit: 10, max_depth: 2 });

    const numbered = result.match(/^\d+\. /gm) ?? [];
    expect(numbered.length).toBe(10);

    // Should NOT say "Site has fewer crawlable links than requested" (that implies site only has 10)
    expect(result).not.toContain("Site has fewer crawlable links than requested");
  });
});

// ---- F9 tests ---------------------------------------------------------------

describe("F9: search filter with suspiciously small discovered pool — honest hint", () => {
  it("when search yields 0 matches AND pool is tiny (<10) from a sitemap site, hints about discovery incompleteness", async () => {
    // Pool of 3 URLs (suspiciously small for a real site)
    const smallSitemap = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/about</loc></url>
  <url><loc>https://example.com/contact</loc></url>
</urlset>`;

    mockedAxios.get
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({ data: smallSitemap, status: 200, headers: {}, config: {} as never, statusText: "OK" });

    const result = await novadaMap({ url: "https://example.com", limit: 30, search: "api" });

    // Should hint that discovery may be incomplete, not just "remove filter"
    expect(result).toMatch(/discovery.*incomplete|incomplete.*discovery|sitemap.*truncat|truncat.*sitemap|may not have found all|discovery may be limited/i);
  });

  it("when search yields 0 matches AND pool is large (>=10), uses standard 'remove filter' hint", async () => {
    // Large pool (12 URLs) with no 'api' match — standard hint is appropriate
    const bigSitemap = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${Array.from({ length: 12 }, (_, i) => `<url><loc>https://example.com/page${i}</loc></url>`).join("\n")}
</urlset>`;

    mockedAxios.get
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({ data: bigSitemap, status: 200, headers: {}, config: {} as never, statusText: "OK" });

    const result = await novadaMap({ url: "https://example.com", limit: 30, search: "api" });

    expect(result).toContain("Remove");
    expect(result).toContain("12");
  });
});
