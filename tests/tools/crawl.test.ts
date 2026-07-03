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

// ─────────────────────────────────────────────────────────────────────────────
// F4: glob "/introduction/**" must match "/introduction" (no trailing slash)
//     + suppress JS-SPA diagnostic when path filters are active + frontier non-empty
// F8: duplicate pages (redirect aliases) must not count as distinct results
// ─────────────────────────────────────────────────────────────────────────────

describe("F4: glob double-star matches parent path (no trailing slash)", () => {
  it("/introduction/** matches /introduction (exact — no trailing slash)", () => {
    const [match] = compilePatterns(["/introduction/**"]);
    expect(match("/introduction")).toBe(true);
  });

  it("/introduction/** matches /introduction/ (trailing slash)", () => {
    const [match] = compilePatterns(["/introduction/**"]);
    expect(match("/introduction/")).toBe(true);
  });

  it("/introduction/** matches /introduction/quickstart (one level deep)", () => {
    const [match] = compilePatterns(["/introduction/**"]);
    expect(match("/introduction/quickstart")).toBe(true);
  });

  it("/introduction/** does NOT match / (root)", () => {
    const [match] = compilePatterns(["/introduction/**"]);
    expect(match("/")).toBe(false);
  });

  it("/introduction/** does NOT match /introductionX (suffix extension, no slash)", () => {
    const [match] = compilePatterns(["/introduction/**"]);
    expect(match("/introductionX")).toBe(false);
  });

  it("/**  matches / (root is the base of /**)", () => {
    const [match] = compilePatterns(["/**"]);
    expect(match("/")).toBe(true);
  });

  it("/** matches /anything/nested", () => {
    const [match] = compilePatterns(["/**"]);
    expect(match("/anything/nested")).toBe(true);
  });

  it("/docs/** matches /docs (no trailing slash) — same semantics as /introduction/**", () => {
    const [match] = compilePatterns(["/docs/**"]);
    expect(match("/docs")).toBe(true);
  });
});

describe("F4: crawl with select_paths=['/introduction/**'] returns /introduction* pages", () => {
  it("seed '/' with select_paths=['/introduction/**'] — discovers /introduction page and includes it in results", async () => {
    // Reproduces: novadaCrawl(url=https://docs.firecrawl.dev, select_paths=["/introduction/**"])
    // should return pages on /introduction*, not just the bare root.
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === "https://docs.example.com" || url === "https://docs.example.com/") {
        return Promise.resolve({
          data: `<html><body><h1>Docs Home</h1><p>${"word ".repeat(30)}</p>
            <a href="https://docs.example.com/introduction">Introduction</a>
            <a href="https://docs.example.com/introduction/quickstart">Quickstart</a>
            <a href="https://docs.example.com/api/reference">API</a>
          </body></html>`,
          status: 200, headers: {}, config: {} as never, statusText: "OK",
        });
      }
      if (url === "https://docs.example.com/introduction") {
        return Promise.resolve({
          data: `<html><body><h1>Introduction</h1><p>${"intro overview ".repeat(25)}</p></body></html>`,
          status: 200, headers: {}, config: {} as never, statusText: "OK",
        });
      }
      // Distinct content per URL to avoid content-hash dedup collapsing them
      const slug = new URL(url).pathname.replace(/\//g, "-").slice(1);
      return Promise.resolve({
        data: `<html><body><h1>${slug}</h1><p>${slug + " page content ".repeat(10) + "extra ".repeat(15)}</p></body></html>`,
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });
    });

    const result = await novadaCrawl(
      {
        url: "https://docs.example.com",
        max_pages: 5,
        strategy: "bfs",
        render: "static",
        format: "json",
        select_paths: ["/introduction/**"],
      },
      "test-key"
    );
    const parsed = JSON.parse(result) as { status: string; pages: { url: string }[] };
    const crawledUrls = parsed.pages.map(p => p.url);

    // /introduction must appear — it matches /introduction/**
    expect(crawledUrls).toContain("https://docs.example.com/introduction");
    // /introduction/quickstart also matches
    expect(crawledUrls).toContain("https://docs.example.com/introduction/quickstart");
    // /api/reference should be filtered out by select_paths
    expect(crawledUrls).not.toContain("https://docs.example.com/api/reference");
  });

  it("when all links are rejected by select_paths, reports rejected count — not JS-SPA blame", async () => {
    // When select_paths=["/nomatch/**"] rejects all discovered links, the error or early-stop
    // note must say something about path filters, NOT blame a "JavaScript SPA".
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === "https://docs.example.com" || url === "https://docs.example.com/") {
        return Promise.resolve({
          data: `<html><body><h1>Docs Home</h1><p>${"word ".repeat(30)}</p>
            <a href="https://docs.example.com/api/reference">API</a>
            <a href="https://docs.example.com/guide/intro">Guide</a>
          </body></html>`,
          status: 200, headers: {}, config: {} as never, statusText: "OK",
        });
      }
      return Promise.resolve({
        data: `<html><body><h1>Page</h1><p>${"word ".repeat(30)}</p></body></html>`,
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });
    });

    const result = await novadaCrawl(
      {
        url: "https://docs.example.com",
        max_pages: 5,
        strategy: "bfs",
        render: "static",
        select_paths: ["/nomatch/**"],
      },
      "test-key"
    );

    // Should NOT blame JavaScript SPA when select_paths filtered the links
    expect(result).not.toContain("JavaScript SPA");
    // Should mention path filters or select_paths
    expect(result.toLowerCase()).toMatch(/filter|select_path|path rule/);
  });
});

describe("F8: URL deduplication — redirect aliases must not count as distinct pages", () => {
  it("root URL and its trailing-slash alias produce a single result, not two", async () => {
    // Simulates: https://docs.firecrawl.dev (root) and https://docs.firecrawl.dev/
    // resolving to byte-identical content. normalizeUrl strips trailing slash, so
    // both must map to the same visited-set key → only one result.
    const htmlContent = `<html><body><h1>Root Page</h1><p>${"word ".repeat(40)}</p>
      <a href="https://docs.example.com/">Home alias</a>
      <a href="https://docs.example.com/introduction">Introduction</a>
    </body></html>`;

    mockedAxios.get.mockImplementation((url: string) => {
      if (url === "https://docs.example.com/introduction") {
        return Promise.resolve({
          data: `<html><body><h1>Introduction</h1><p>${"intro ".repeat(40)}</p></body></html>`,
          status: 200, headers: {}, config: {} as never, statusText: "OK",
        });
      }
      // Both root and trailing-slash alias return identical content
      return Promise.resolve({
        data: htmlContent,
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });
    });

    const result = await novadaCrawl(
      {
        url: "https://docs.example.com",
        max_pages: 5,
        strategy: "bfs",
        render: "static",
        format: "json",
      },
      "test-key"
    );
    const parsed = JSON.parse(result) as { status: string; pages: { url: string }[] };

    // Root URL and trailing-slash alias must not both appear as separate pages
    const rootCount = parsed.pages.filter(
      p => p.url === "https://docs.example.com" || p.url === "https://docs.example.com/"
    ).length;
    expect(rootCount).toBeLessThanOrEqual(1);
  });

  it("byte-identical pages from two different URLs are collapsed — only one result plus duplicates_collapsed field (F8)", async () => {
    // Simulates root "/" and "/introduction" returning the same HTML (redirect alias).
    // The crawl must NOT count both as distinct results. Either one is suppressed
    // (collapsed) OR a duplicates_collapsed field is emitted in json output.
    const sharedHtml = `<html><body><h1>Introduction</h1><p>${"intro ".repeat(40)}</p>
      <a href="https://docs.example.com/introduction">Introduction</a>
      <a href="https://docs.example.com/page2">Page 2</a>
    </body></html>`;

    mockedAxios.get.mockImplementation((url: string) => {
      if (url === "https://docs.example.com/page2") {
        return Promise.resolve({
          data: `<html><body><h1>Page 2</h1><p>${"page2 ".repeat(40)}</p></body></html>`,
          status: 200, headers: {}, config: {} as never, statusText: "OK",
        });
      }
      // Root AND /introduction return identical HTML — redirect alias simulation
      return Promise.resolve({
        data: sharedHtml,
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });
    });

    const result = await novadaCrawl(
      {
        url: "https://docs.example.com",
        max_pages: 5,
        strategy: "bfs",
        render: "static",
        format: "json",
      },
      "test-key"
    );
    const parsed = JSON.parse(result) as {
      status: string;
      pages: { url: string }[];
      duplicates_collapsed?: number;
    };

    // The two byte-identical pages must NOT both appear as distinct results.
    // Either: (a) only one is in pages[], OR (b) duplicates_collapsed is set > 0
    const hasIntroRoot = parsed.pages.some(p =>
      p.url === "https://docs.example.com" || p.url === "https://docs.example.com/"
    );
    const hasIntroDirect = parsed.pages.some(
      p => p.url === "https://docs.example.com/introduction"
    );
    const deduped = !(hasIntroRoot && hasIntroDirect);
    const hasDuplicatesField = typeof parsed.duplicates_collapsed === "number" && parsed.duplicates_collapsed > 0;

    expect(deduped || hasDuplicatesField).toBe(true);
  });

  it("genuinely distinct pages are never collapsed (dedup must not over-collapse)", async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      const slug = new URL(url).pathname.replace(/\//g, "") || "root";
      return Promise.resolve({
        data: `<html><body><h1>${slug}</h1><p>${slug + " ".repeat(1) + "word ".repeat(35)}</p>
          <a href="https://docs.example.com/page1">p1</a>
          <a href="https://docs.example.com/page2">p2</a>
          <a href="https://docs.example.com/page3">p3</a>
        </body></html>`,
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });
    });

    const result = await novadaCrawl(
      {
        url: "https://docs.example.com",
        max_pages: 4,
        strategy: "bfs",
        render: "static",
        format: "json",
      },
      "test-key"
    );
    const parsed = JSON.parse(result) as { status: string; pages: { url: string }[] };

    // 4 genuinely distinct pages must all appear
    expect(parsed.pages.length).toBe(4);
    // All URLs must be unique
    const urls = parsed.pages.map(p => p.url);
    expect(new Set(urls).size).toBe(4);
  });
});

describe("novadaCrawl progress notifications (NOV-319)", () => {
  const page = (n: number) => ({
    data: `<html><body><h1>Page ${n}</h1><p>${"word ".repeat(40)}</p>
      <a href="https://example.com/p${n + 1}">next</a></body></html>`,
    status: 200,
    headers: {},
    config: {} as never,
    statusText: "OK",
  });

  it("emits one progress update per crawled page with progress<=total", async () => {
    let n = 0;
    mockedAxios.get.mockImplementation(async () => page(n++));

    const updates: { progress: number; total?: number; message?: string }[] = [];
    await novadaCrawl(
      { url: "https://example.com", max_pages: 3, strategy: "bfs", render: "static" },
      "test-key",
      (info) => { updates.push(info); }
    );

    // One per page (sparse/failed pages don't count — these are all dense).
    expect(updates).toHaveLength(3);
    expect(updates.map(u => u.progress)).toEqual([1, 2, 3]);
    expect(updates.every(u => u.total === 3)).toBe(true);
    expect(updates.every(u => u.progress <= (u.total ?? 0))).toBe(true);
    expect(updates[0].message).toContain("https://example.com");
  });

  it("is a no-op when no progress callback is supplied", async () => {
    let n = 0;
    mockedAxios.get.mockImplementation(async () => page(n++));
    const result = await novadaCrawl(
      { url: "https://example.com", max_pages: 2, strategy: "bfs", render: "static" },
      "test-key"
    );
    expect(result).toContain("Crawl Results");
  });

  it("swallows reporter errors — a throwing callback never breaks the crawl", async () => {
    let n = 0;
    mockedAxios.get.mockImplementation(async () => page(n++));
    const result = await novadaCrawl(
      { url: "https://example.com", max_pages: 2, strategy: "bfs", render: "static" },
      "test-key",
      () => { throw new Error("reporter blew up"); }
    );
    expect(result).toContain("Crawl Results");
  });
});
