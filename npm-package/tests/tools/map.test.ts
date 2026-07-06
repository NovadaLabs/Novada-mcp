import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaMap } from "../../src/tools/map.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

beforeEach(() => { vi.clearAllMocks(); });

/** Minimal HTML with N links to the same domain */
function makeHtml(links: string[]): string {
  return `<html><body><p>${"word ".repeat(30)}</p>${links.map(u => `<a href="${u}">link</a>`).join("")}</body></html>`;
}

const SITEMAP_XML = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/about</loc></url>
  <url><loc>https://example.com/blog</loc></url>
  <url><loc>https://example.com/contact</loc></url>
</urlset>`;

const SITEMAP_INDEX_XML = `<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`;

describe("novadaMap — sitemap discovery", () => {
  it("returns URLs from sitemap.xml", async () => {
    mockedAxios.get
      .mockRejectedValueOnce(new Error("404")) // robots.txt
      .mockResolvedValueOnce({ data: SITEMAP_XML, status: 200, headers: {}, config: {} as never, statusText: "OK" }) // sitemap.xml
      .mockRejectedValue(new Error("404")); // sitemap_index.xml (never reached)

    const result = await novadaMap({ url: "https://example.com", limit: 50 });
    expect(result).toContain("## Site Map");
    expect(result).toContain("discovery:sitemap");
    expect(result).toContain("https://example.com/about");
    expect(result).toContain("https://example.com/blog");
    expect(result).toContain("https://example.com/contact");
  });

  it("reads sitemap URL from robots.txt when present", async () => {
    const robotsTxt = "User-agent: *\nDisallow: /private\nSitemap: https://example.com/custom-sitemap.xml";
    mockedAxios.get
      .mockResolvedValueOnce({ data: robotsTxt, status: 200, headers: {}, config: {} as never, statusText: "OK" }) // robots.txt
      .mockResolvedValueOnce({ data: SITEMAP_XML, status: 200, headers: {}, config: {} as never, statusText: "OK" }); // custom-sitemap.xml

    const result = await novadaMap({ url: "https://example.com", limit: 50 });
    // Should call custom-sitemap.xml first
    const calls = mockedAxios.get.mock.calls.map(c => c[0]);
    expect(calls.some((u: unknown) => (u as string).includes("custom-sitemap.xml"))).toBe(true);
    expect(result).toContain("discovery:sitemap");
  });

  it("recurses into sitemap index child sitemaps", async () => {
    const childSitemap = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/child-page</loc></url>
</urlset>`;
    mockedAxios.get
      .mockRejectedValueOnce(new Error("404")) // robots.txt
      .mockResolvedValueOnce({ data: SITEMAP_INDEX_XML, status: 200, headers: {}, config: {} as never, statusText: "OK" }) // sitemap.xml (is index)
      .mockResolvedValueOnce({ data: childSitemap, status: 200, headers: {}, config: {} as never, statusText: "OK" }); // child sitemap

    const result = await novadaMap({ url: "https://example.com", limit: 50 });
    expect(result).toContain("https://example.com/child-page");
  });

  it("filters sitemap URLs by search term", async () => {
    mockedAxios.get
      .mockRejectedValueOnce(new Error("404")) // robots.txt
      .mockResolvedValueOnce({ data: SITEMAP_XML, status: 200, headers: {}, config: {} as never, statusText: "OK" });

    const result = await novadaMap({ url: "https://example.com", limit: 50, search: "blog" });
    expect(result).toContain("https://example.com/blog");
    expect(result).not.toContain("https://example.com/about");
    expect(result).toContain('filtered by "blog"');
  });

  it("respects limit parameter", async () => {
    // Build a large sitemap with 20 URLs
    const bigSitemap = `<?xml version="1.0"?><urlset>
      ${Array.from({ length: 20 }, (_, i) => `<url><loc>https://example.com/page${i}</loc></url>`).join("")}
    </urlset>`;
    mockedAxios.get
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({ data: bigSitemap, status: 200, headers: {}, config: {} as never, statusText: "OK" });

    const result = await novadaMap({ url: "https://example.com", limit: 5 });
    // Should show at most 5 numbered items
    const numbered = result.match(/^\d+\. /gm) ?? [];
    expect(numbered.length).toBeLessThanOrEqual(5);
  });
});

describe("novadaMap — BFS crawl fallback", () => {
  it("falls back to BFS crawl when no sitemap exists", async () => {
    const html = makeHtml(["https://example.com/page1", "https://example.com/page2"]);
    mockedAxios.get
      .mockRejectedValueOnce(new Error("404")) // robots.txt
      .mockRejectedValueOnce(new Error("404")) // sitemap.xml
      .mockRejectedValueOnce(new Error("404")) // sitemap_index.xml
      .mockResolvedValue({ data: html, status: 200, headers: {}, config: {} as never, statusText: "OK" }); // BFS pages

    const result = await novadaMap({ url: "https://example.com", limit: 20, max_depth: 1 });
    expect(result).toContain("## Site Map");
    expect(result).toContain("discovery:crawl");
  });

  it("only includes same-domain links during BFS crawl", async () => {
    const html = makeHtml([
      "https://example.com/internal",
      "https://other.com/external",
      "https://evil.com/external",
    ]);
    mockedAxios.get
      .mockRejectedValueOnce(new Error("404"))
      .mockRejectedValueOnce(new Error("404"))
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValue({ data: html, status: 200, headers: {}, config: {} as never, statusText: "OK" });

    const result = await novadaMap({ url: "https://example.com", limit: 20, max_depth: 1 });
    expect(result).not.toContain("other.com");
    expect(result).not.toContain("evil.com");
  });

  it("includes subdomains when include_subdomains=true", async () => {
    const html = makeHtml([
      "https://example.com/internal",
      "https://sub.example.com/page",
    ]);
    mockedAxios.get
      .mockRejectedValueOnce(new Error("404"))
      .mockRejectedValueOnce(new Error("404"))
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValue({ data: html, status: 200, headers: {}, config: {} as never, statusText: "OK" });

    const result = await novadaMap({ url: "https://example.com", limit: 20, include_subdomains: true, max_depth: 1 });
    expect(result).toContain("sub.example.com");
  });
});

describe("novadaMap — SPA detection", () => {
  it("warns when only root URL found (SPA-like)", async () => {
    // No sitemap, BFS returns no meaningful links
    mockedAxios.get
      .mockRejectedValueOnce(new Error("404"))
      .mockRejectedValueOnce(new Error("404"))
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({
        data: "<html><body><div id='app'></div></body></html>",
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });

    const result = await novadaMap({ url: "https://example.com", limit: 50 });
    expect(result).toContain("JavaScript SPA");
    expect(result).toContain("novada_extract");
  });
});

describe("novadaMap — tokenized search + sub-path/depth scope (#17)", () => {
  const TOKEN_SITEMAP = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/docs/user-guide</loc></url>
  <url><loc>https://example.com/docs/admin_guide</loc></url>
  <url><loc>https://example.com/docs/api/reference</loc></url>
  <url><loc>https://example.com/blog/release-notes</loc></url>
</urlset>`;

  it("matches multi-word search against hyphenated path segments", async () => {
    mockedAxios.get
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({ data: TOKEN_SITEMAP, status: 200, headers: {}, config: {} as never, statusText: "OK" });

    // "user guide" (space) must match /docs/user-guide (hyphen) — old literal substring
    // match would have failed because the URL never contains the literal "user guide".
    const result = await novadaMap({ url: "https://example.com", limit: 50, search: "user guide" });
    expect(result).toContain("https://example.com/docs/user-guide");
    expect(result).not.toContain("https://example.com/docs/admin_guide");
    expect(result).not.toContain("https://example.com/blog/release-notes");
  });

  it("normalizes underscore separators in search tokens", async () => {
    mockedAxios.get
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({ data: TOKEN_SITEMAP, status: 200, headers: {}, config: {} as never, statusText: "OK" });

    // "admin-guide" (hyphen query) matches "/docs/admin_guide" (underscore path).
    const result = await novadaMap({ url: "https://example.com", limit: 50, search: "admin-guide" });
    expect(result).toContain("https://example.com/docs/admin_guide");
    expect(result).not.toContain("https://example.com/docs/user-guide");
  });

  it("scopes discovered URLs to the seed's rooted sub-path", async () => {
    mockedAxios.get
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({ data: TOKEN_SITEMAP, status: 200, headers: {}, config: {} as never, statusText: "OK" });

    // Seed at /docs ⇒ /blog/* must be excluded entirely (sub-path scope respected).
    const result = await novadaMap({ url: "https://example.com/docs", limit: 50 });
    expect(result).toContain("https://example.com/docs/user-guide");
    expect(result).toContain("https://example.com/docs/api/reference");
    expect(result).not.toContain("https://example.com/blog/release-notes");
  });

  it("respects max_depth below the rooted sub-path", async () => {
    mockedAxios.get
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({ data: TOKEN_SITEMAP, status: 200, headers: {}, config: {} as never, statusText: "OK" });

    // Seed /docs with max_depth=1 ⇒ /docs/user-guide (1 below) kept, but
    // /docs/api/reference (2 below) dropped.
    const result = await novadaMap({ url: "https://example.com/docs", limit: 50, max_depth: 1 });
    expect(result).toContain("https://example.com/docs/user-guide");
    expect(result).not.toContain("https://example.com/docs/api/reference");
  });
});

describe("novadaMap — output format", () => {
  it("includes agent hints in output", async () => {
    mockedAxios.get
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({ data: SITEMAP_XML, status: 200, headers: {}, config: {} as never, statusText: "OK" });

    const result = await novadaMap({ url: "https://example.com", limit: 50 });
    expect(result).toContain("## Agent Hints");
    expect(result).toContain("novada_extract");
    expect(result).toContain("novada_crawl");
  });

  it("returns 'No URLs found' when search filter matches nothing", async () => {
    mockedAxios.get
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({ data: SITEMAP_XML, status: 200, headers: {}, config: {} as never, statusText: "OK" });

    const result = await novadaMap({ url: "https://example.com", limit: 50, search: "nomatch12345" });
    expect(result).toContain("No URLs found");
  });
});
