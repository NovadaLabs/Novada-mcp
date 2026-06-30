import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaCrawl, compilePatterns, shouldCrawlUrl } from "../../src/tools/crawl.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

beforeEach(() => { vi.clearAllMocks(); });

describe("novadaCrawl", () => {
  it("crawls multiple pages and returns content", async () => {
    mockedAxios.get.mockResolvedValue({
      data: `<html><body>
        <h1>Page Title</h1>
        <p>${"word ".repeat(30)}</p>
        <a href="https://example.com/page2">Page 2</a>
      </body></html>`,
      status: 200,
      headers: {},
      config: {} as never,
      statusText: "OK",
    });

    const result = await novadaCrawl(
      { url: "https://example.com", max_pages: 2, strategy: "bfs", render: "static" },
      "test-key"
    );

    expect(result).toContain("Crawl Results");
    expect(result).toContain("https://example.com");
    expect(mockedAxios.get).toHaveBeenCalled();
  });

  it("throws a URL_UNREACHABLE error when site is unreachable", async () => {
    mockedAxios.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      novadaCrawl(
        { url: "https://unreachable.example.com", max_pages: 1, strategy: "bfs", render: "static" },
        "test-key"
      )
    ).rejects.toThrow("Failed to crawl");
  });

  it("escalates to render mode when auto-detecting JS-heavy content", async () => {
    // First call: returns JS-heavy content (Cloudflare-like)
    // Subsequent calls: return good content
    let callCount = 0;
    mockedAxios.get.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First fetch: JS-heavy
        return Promise.resolve({
          data: '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>',
          status: 200, headers: {}, config: {} as never, statusText: "OK",
        });
      }
      // Re-fetch with render: good content
      return Promise.resolve({
        data: `<html><body><h1>Real Content</h1><p>${"word ".repeat(30)}</p></body></html>`,
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });
    });

    const result = await novadaCrawl(
      { url: "https://example.com", max_pages: 1, strategy: "bfs", render: "auto" },
      "test-key"
    );

    // Should have been called at least twice (once static, once render re-fetch)
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(result).toContain("Real Content");
  });

  it("respects max_pages limit", async () => {
    const links = Array.from({ length: 20 }, (_, i) => `<a href="https://example.com/page${i}">p${i}</a>`).join("");
    mockedAxios.get.mockResolvedValue({
      data: `<html><body><p>${"text ".repeat(50)}</p>${links}</body></html>`,
      status: 200,
      headers: {},
      config: {} as never,
      statusText: "OK",
    });

    const result = await novadaCrawl(
      { url: "https://example.com", max_pages: 3, strategy: "bfs", render: "static" },
      "test-key"
    );

    const pageCount = (result.match(/###/g) || []).length;
    expect(pageCount).toBeLessThanOrEqual(3);
  });

  it("crawls the seed and discovers children even when select_paths doesn't match the seed (#7)", async () => {
    // Seed "/" does NOT match select_paths ["/docs/**"], but the seed must still be fetched
    // and its links discovered. A child under /docs must then be crawled, and an off-path
    // child (/blog) must be filtered out. Previously the unmatched seed aborted the whole
    // crawl with a fake URL_UNREACHABLE.
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === "https://example.com" || url === "https://example.com/") {
        return Promise.resolve({
          data: `<html><body><h1>Home</h1><p>${"word ".repeat(30)}</p>
            <a href="https://example.com/docs/intro">Docs</a>
            <a href="https://example.com/blog/post">Blog</a></body></html>`,
          status: 200, headers: {}, config: {} as never, statusText: "OK",
        });
      }
      return Promise.resolve({
        data: `<html><body><h1>Docs Intro</h1><p>${"doc ".repeat(30)}</p></body></html>`,
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });
    });

    // Use JSON output so we assert on the structured crawled-page list, not body text
    // (a discovered link is echoed inside the seed's rendered content otherwise).
    const result = await novadaCrawl(
      { url: "https://example.com", max_pages: 5, strategy: "bfs", render: "static", format: "json", select_paths: ["/docs/**"] },
      "test-key"
    );
    const parsed = JSON.parse(result) as { status: string; pages: { url: string }[] };
    const crawledUrls = parsed.pages.map(p => p.url);

    // Did NOT abort — the seed was crawled and the in-path child discovered.
    expect(parsed.status).toBe("ok");
    expect(crawledUrls).toContain("https://example.com");
    expect(crawledUrls).toContain("https://example.com/docs/intro");
    // Off-path child filtered out by select_paths — never crawled.
    expect(crawledUrls).not.toContain("https://example.com/blog/post");
  });

  it("still filters off-path children via exclude_paths while always fetching the seed (#7)", async () => {
    // exclude_paths still filters discovered children; the seed is always fetched.
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === "https://example.com" || url === "https://example.com/") {
        return Promise.resolve({
          data: `<html><body><h1>Home</h1><p>${"word ".repeat(30)}</p>
            <a href="https://example.com/blog/post">Blog</a>
            <a href="https://example.com/docs/intro">Docs</a></body></html>`,
          status: 200, headers: {}, config: {} as never, statusText: "OK",
        });
      }
      return Promise.resolve({
        data: `<html><body><h1>Page</h1><p>${"page ".repeat(30)}</p></body></html>`,
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });
    });

    const result = await novadaCrawl(
      { url: "https://example.com", max_pages: 5, strategy: "bfs", render: "static", format: "json", exclude_paths: ["/blog/**"] },
      "test-key"
    );
    const parsed = JSON.parse(result) as { status: string; pages: { url: string }[] };
    const crawledUrls = parsed.pages.map(p => p.url);

    expect(crawledUrls).toContain("https://example.com");
    expect(crawledUrls).toContain("https://example.com/docs/intro");
    expect(crawledUrls).not.toContain("https://example.com/blog/post");
  });
});

describe("compilePatterns ReDoS hardening (NOV-570)", () => {
  it("does not catastrophically backtrack on `*a*a*a…` against a failing run", () => {
    // The glob→regex rewrite previously compiled `('*a')×N` to `^([^/]*a){N}$`, which
    // backtracks exponentially against a long run of the literal char ending in a
    // non-matching char (the overall match must FAIL). N=18 froze the event loop for
    // ~100s. With the linear matcher this must finish in well under 50ms.
    const matchers = compilePatterns(["*a".repeat(60)]);
    expect(matchers).toHaveLength(1);

    const input = "/" + "a".repeat(120) + "/"; // forces a failing match
    const start = Date.now();
    const matched = matchers[0](input);
    const elapsed = Date.now() - start;

    expect(matched).toBe(false);
    expect(elapsed).toBeLessThan(50);
  });

  it("does not freeze when the same payload reaches shouldCrawlUrl via the seed URL", () => {
    // shouldCrawlUrl runs the compiled matcher against the SEED pathname at depth 0,
    // before any network fetch — this is the remote-DoS entry point in the finding.
    const selectPatterns = compilePatterns(["*a".repeat(60)]);
    const seedUrl = "https://x.test/" + "a".repeat(120) + "/";

    const start = Date.now();
    const allowed = shouldCrawlUrl(seedUrl, selectPatterns, []);
    const elapsed = Date.now() - start;

    expect(allowed).toBe(false); // run ends in a non-matching char → excluded
    expect(elapsed).toBeLessThan(50);
  });

  it("preserves glob semantics (`**`, `*`, `?`) equivalent to the prior anchored regex", () => {
    const matches = (pattern: string, path: string): boolean => compilePatterns([pattern])[0](path);

    // `*` matches within one segment only (does not cross `/`)
    expect(matches("/docs/*", "/docs/api")).toBe(true);
    expect(matches("/docs/*", "/docs/api/users")).toBe(false);
    expect(matches("/docs/*", "/docs/")).toBe(true); // empty segment, like `[^/]*`
    // `**` crosses segments
    expect(matches("/docs/**", "/docs/api/users")).toBe(true);
    expect(matches("/**/*.json", "/x/y/z.json")).toBe(true);
    // `?` is exactly one non-`/` char
    expect(matches("/a/?/b", "/a/x/b")).toBe(true);
    expect(matches("/a/?/b", "/a/xy/b")).toBe(false);
    // literal-only and suffix globs
    expect(matches("*.html", "page.html")).toBe(true);
    expect(matches("*.html", "page.htm")).toBe(false);
  });

  it("skips over-long patterns (>1000 chars) instead of compiling them", () => {
    expect(compilePatterns(["a".repeat(1001)])).toHaveLength(0);
    expect(compilePatterns(["a".repeat(1000)])).toHaveLength(1);
  });
});
