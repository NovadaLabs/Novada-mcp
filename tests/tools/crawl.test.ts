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

  it("returns error message when site is unreachable", async () => {
    mockedAxios.get.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await novadaCrawl(
      { url: "https://unreachable.example.com", max_pages: 1, strategy: "bfs", render: "static" },
      "test-key"
    );

    expect(result).toContain("Failed to crawl");
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
