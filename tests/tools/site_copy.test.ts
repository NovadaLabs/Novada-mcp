import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

// ── Mock the filesystem so tests never touch real disk ──────────────────────
vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

import { writeFile, mkdir } from "fs/promises";
import { novadaSiteCopy } from "../../src/tools/site_copy.js";
import { SiteCopyParamsSchema, SITE_COPY_HARD_MAX } from "../../src/tools/types.js";
import { DOWNLOADS_ROOT } from "../../src/utils/output.js";

const mockedWriteFile = vi.mocked(writeFile);
const mockedMkdir = vi.mocked(mkdir);

beforeEach(() => {
  vi.clearAllMocks();
  // Ensure no proxy env leaks into fetchViaProxy → forces plain axios.get path.
  delete process.env.NOVADA_PROXY_ENDPOINT;
  delete process.env.NOVADA_PROXY_USER;
  delete process.env.NOVADA_PROXY_PASS;
});

const ok = (data: string) =>
  ({ data, status: 200, headers: {}, config: {} as never, statusText: "OK" });
const fail = () => Promise.reject(new Error("404"));

/** A content page with N same-host links and enough words to pass extraction. */
function page(links: string[] = []): string {
  return `<html><head><title>Page</title></head><body><main><h1>Heading</h1><p>${"word ".repeat(60)}</p>${links
    .map((u) => `<a href="${u}">l</a>`)
    .join("")}</main></body></html>`;
}

/** Count only the per-page .md writes (exclude manifest.json). */
function mdWriteCount(): number {
  return mockedWriteFile.mock.calls.filter((c) => String(c[0]).endsWith(".md")).length;
}

/** Return the manifest object parsed from the manifest.json writeFile call. */
function readManifest(): Record<string, unknown> {
  const call = mockedWriteFile.mock.calls.find((c) => String(c[0]).endsWith("manifest.json"));
  if (!call) throw new Error("manifest.json was not written");
  return JSON.parse(String(call[1]));
}

describe("novadaSiteCopy — discovery precedence", () => {
  it("llms.txt wins over sitemap and BFS", async () => {
    const llmsTxt = [
      "# Docs",
      "- [Intro](https://example.com/docs/intro)",
      "- [Guide](https://example.com/docs/guide)",
      "- [API](https://example.com/docs/api)",
    ].join("\n");

    mockedAxios.get.mockImplementation((url: string) => {
      if (url.endsWith("/llms.txt")) return Promise.resolve(ok(llmsTxt));
      // sitemap / robots / any page fetch
      return Promise.resolve(ok(page()));
    });

    const result = await novadaSiteCopy({ ...SiteCopyParamsSchema.parse({ url: "https://example.com" }) });

    expect(result).toContain("discovery: llms.txt");
    expect(result).toContain("Site Copy Complete");
    // 3 llms.txt links → 3 page .md writes
    expect(mdWriteCount()).toBe(3);
    // never tried sitemap.xml because llms.txt already produced a set
    const calls = mockedAxios.get.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.endsWith("/sitemap.xml"))).toBe(false);
  });

  it("falls back to sitemap when llms.txt is absent", async () => {
    const sitemap = `<?xml version="1.0"?><urlset>
      <url><loc>https://example.com/a</loc></url>
      <url><loc>https://example.com/b</loc></url>
    </urlset>`;

    mockedAxios.get.mockImplementation((url: string) => {
      if (url.endsWith("/llms.txt")) return fail();
      if (url.endsWith("/llms-full.txt")) return fail();
      if (url.endsWith("/robots.txt")) return fail();
      if (url.endsWith("/sitemap.xml")) return Promise.resolve(ok(sitemap));
      if (url.endsWith("/sitemap_index.xml")) return fail();
      return Promise.resolve(ok(page()));
    });

    const result = await novadaSiteCopy({ ...SiteCopyParamsSchema.parse({ url: "https://example.com" }) });
    expect(result).toContain("discovery: sitemap");
    expect(mdWriteCount()).toBe(2);
  });

  it("falls back to scoped BFS when neither llms.txt nor sitemap exist", async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.endsWith("/llms.txt") || url.endsWith("/llms-full.txt")) return fail();
      if (url.endsWith("/robots.txt") || url.endsWith("/sitemap.xml") || url.endsWith("/sitemap_index.xml")) return fail();
      if (url === "https://example.com/" || url === "https://example.com")
        return Promise.resolve(ok(page(["https://example.com/p1", "https://example.com/p2"])));
      return Promise.resolve(ok(page()));
    });

    const result = await novadaSiteCopy({ ...SiteCopyParamsSchema.parse({ url: "https://example.com", max_depth: 2 }) });
    expect(result).toContain("discovery: bfs");
    // root + p1 + p2 = 3 pages
    expect(mdWriteCount()).toBe(3);
  });
});

describe("novadaSiteCopy — cap above 20 (site_copy only)", () => {
  it("writes more than 20 pages when discovery yields more", async () => {
    const links = Array.from({ length: 25 }, (_, i) => `- [P${i}](https://example.com/docs/p${i})`);
    const llmsTxt = ["# Docs", ...links].join("\n");

    mockedAxios.get.mockImplementation((url: string) => {
      if (url.endsWith("/llms.txt")) return Promise.resolve(ok(llmsTxt));
      return Promise.resolve(ok(page()));
    });

    const result = await novadaSiteCopy({ ...SiteCopyParamsSchema.parse({ url: "https://example.com", max_pages: 50 }) });
    expect(mdWriteCount()).toBe(25);
    expect(result).toContain("pages_written: 25");
  });

  it("schema accepts max_pages above the crawl cap of 20 (up to hard max)", () => {
    expect(() => SiteCopyParamsSchema.parse({ url: "https://example.com", max_pages: 500 })).not.toThrow();
    expect(SiteCopyParamsSchema.parse({ url: "https://example.com", max_pages: 500 }).max_pages).toBe(500);
    // hard max enforced
    expect(() => SiteCopyParamsSchema.parse({ url: "https://example.com", max_pages: SITE_COPY_HARD_MAX + 1 })).toThrow();
  });
});

describe("novadaSiteCopy — path scope drains queue", () => {
  it("BFS drains all in-scope pages and excludes off-scope + cross-host", async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.endsWith("/llms.txt") || url.endsWith("/llms-full.txt")) return fail();
      if (url.endsWith("/robots.txt") || url.endsWith("/sitemap.xml") || url.endsWith("/sitemap_index.xml")) return fail();
      if (url === "https://example.com/docs/" || url === "https://example.com/docs") {
        // seed (/docs/) links to 2 in-scope docs pages, 1 off-scope /blog page, 1 cross-host
        return Promise.resolve(
          ok(page([
            "https://example.com/docs/a",
            "https://example.com/docs/b",
            "https://example.com/blog/x",
            "https://other.com/docs/z",
          ])),
        );
      }
      // /docs/a links onward to /docs/c — drain must follow it
      if (url === "https://example.com/docs/a") return Promise.resolve(ok(page(["https://example.com/docs/c"])));
      return Promise.resolve(ok(page()));
    });

    const result = await novadaSiteCopy({
      ...SiteCopyParamsSchema.parse({
        url: "https://example.com/docs/",
        select_paths: ["/docs/**"],
        max_depth: 5,
      }),
    });

    expect(result).toContain("discovery: bfs");
    const manifest = readManifest();
    const urls = (manifest.pages as Array<{ url: string }>).map((p) => p.url);
    // a, b, and the deeper c must all be present (queue drained past first batch)
    expect(urls).toContain("https://example.com/docs/a");
    expect(urls).toContain("https://example.com/docs/b");
    expect(urls).toContain("https://example.com/docs/c");
    // off-scope /blog and cross-host excluded
    expect(urls.some((u) => u.includes("/blog/"))).toBe(false);
    expect(urls.some((u) => u.includes("other.com"))).toBe(false);
  });
});

describe("novadaSiteCopy — streaming + manifest", () => {
  it("streams one writeFile per page (not a single bulk write)", async () => {
    const llmsTxt = [
      "- [A](https://example.com/a)",
      "- [B](https://example.com/b)",
      "- [C](https://example.com/c)",
    ].join("\n");
    mockedAxios.get.mockImplementation((url: string) =>
      url.endsWith("/llms.txt") ? Promise.resolve(ok(llmsTxt)) : Promise.resolve(ok(page())),
    );

    await novadaSiteCopy({ ...SiteCopyParamsSchema.parse({ url: "https://example.com" }) });

    // 3 page .md writes + 1 manifest.json write = 4 total (per-page, not one bulk dump)
    expect(mdWriteCount()).toBe(3);
    expect(mockedWriteFile).toHaveBeenCalledTimes(4);
    expect(mockedMkdir).toHaveBeenCalled();
  });

  it("manifest.json has per-page shape + run meta", async () => {
    const llmsTxt = ["- [A](https://example.com/a)", "- [B](https://example.com/b)"].join("\n");
    mockedAxios.get.mockImplementation((url: string) =>
      url.endsWith("/llms.txt") ? Promise.resolve(ok(llmsTxt)) : Promise.resolve(ok(page())),
    );

    await novadaSiteCopy({ ...SiteCopyParamsSchema.parse({ url: "https://example.com" }) });

    const manifest = readManifest();
    expect(manifest.root).toBe("https://example.com");
    expect(manifest.discovery).toBe("llms.txt");
    expect(manifest.pages_total).toBe(2);
    expect(manifest.pages_failed).toBe(0);
    const pages = manifest.pages as Array<Record<string, unknown>>;
    expect(pages).toHaveLength(2);
    for (const p of pages) {
      expect(p).toHaveProperty("url");
      expect(p).toHaveProperty("file");
      expect(p).toHaveProperty("title");
      expect(p).toHaveProperty("word_count");
      expect(p).toHaveProperty("depth");
      expect(p).toHaveProperty("bytes");
      expect(p).toHaveProperty("status");
    }
  });

  it("records failed pages without aborting the run", async () => {
    const llmsTxt = ["- [A](https://example.com/a)", "- [B](https://example.com/b)"].join("\n");
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.endsWith("/llms.txt")) return Promise.resolve(ok(llmsTxt));
      if (url === "https://example.com/a") return Promise.reject(new Error("ECONNRESET"));
      return Promise.resolve(ok(page()));
    });

    const result = await novadaSiteCopy({ ...SiteCopyParamsSchema.parse({ url: "https://example.com" }) });
    const manifest = readManifest();
    expect(manifest.pages_failed).toBe(1);
    // one good page still written
    expect(mdWriteCount()).toBe(1);
    expect(result).toContain("pages_failed: 1");
  });
});

describe("novadaSiteCopy — SSRF / path-traversal guard", () => {
  it("constrains output files under the Downloads root and sanitizes traversal slugs", async () => {
    // A page URL whose path contains traversal sequences — must collapse to a safe slug.
    const llmsTxt = ["- [evil](https://example.com/../../etc/passwd)"].join("\n");
    mockedAxios.get.mockImplementation((url: string) =>
      url.endsWith("/llms.txt") ? Promise.resolve(ok(llmsTxt)) : Promise.resolve(ok(page())),
    );

    await novadaSiteCopy({ ...SiteCopyParamsSchema.parse({ url: "https://example.com" }) });

    for (const call of mockedWriteFile.mock.calls) {
      const p = String(call[0]);
      expect(p.startsWith(DOWNLOADS_ROOT)).toBe(true);
      expect(p).not.toContain("/etc/passwd");
      expect(p).not.toContain("..");
    }
  });

  it("returns an empty-copy message when nothing is in scope", async () => {
    // No llms.txt/sitemap. select_paths excludes the root (path "/"), and the root's
    // only link is cross-host → genuinely nothing in scope.
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.endsWith("/llms.txt") || url.endsWith("/llms-full.txt") || url.endsWith("/robots.txt") || url.endsWith("/sitemap.xml") || url.endsWith("/sitemap_index.xml")) return fail();
      return Promise.resolve(ok(page(["https://other.com/z"])));
    });

    const result = await novadaSiteCopy({
      ...SiteCopyParamsSchema.parse({ url: "https://example.com", select_paths: ["/docs/**"] }),
    });
    expect(result).toContain("pages: 0");
    expect(result).toContain("site_copy_empty");
    expect(mdWriteCount()).toBe(0);
  });
});

describe("novadaSiteCopy — sitemap discovery SSRF guard", () => {
  it("never fetches a cross-host/metadata URL declared in robots.txt Sitemap:", async () => {
    // A target whose robots.txt points the sitemap at the AWS metadata endpoint and a
    // <sitemapindex> child on an internal host. Neither must ever be fetched: the
    // same-host filter rejects them before any request is issued.
    const robots = [
      "User-agent: *",
      "Sitemap: http://169.254.169.254/latest/meta-data/sitemap.xml",
      "Sitemap: https://example.com/sitemap.xml",
    ].join("\n");
    const indexXml = `<?xml version="1.0"?><sitemapindex>
      <sitemap><loc>http://127.0.0.1:9000/internal-sitemap.xml</loc></sitemap>
      <sitemap><loc>https://example.com/child-sitemap.xml</loc></sitemap>
    </sitemapindex>`;
    const childXml = `<?xml version="1.0"?><urlset>
      <url><loc>https://example.com/a</loc></url>
    </urlset>`;

    mockedAxios.get.mockImplementation((url: string) => {
      if (url.endsWith("/llms.txt") || url.endsWith("/llms-full.txt")) return fail();
      if (url.endsWith("/robots.txt")) return Promise.resolve(ok(robots));
      if (url === "https://example.com/sitemap.xml") return Promise.resolve(ok(indexXml));
      if (url === "https://example.com/child-sitemap.xml") return Promise.resolve(ok(childXml));
      if (url.endsWith("/sitemap_index.xml")) return fail();
      return Promise.resolve(ok(page()));
    });

    const result = await novadaSiteCopy({ ...SiteCopyParamsSchema.parse({ url: "https://example.com" }) });

    const fetched = mockedAxios.get.mock.calls.map((c) => String(c[0]));
    // The SSRF targets must NEVER have been requested.
    expect(fetched.some((u) => u.includes("169.254.169.254"))).toBe(false);
    expect(fetched.some((u) => u.includes("127.0.0.1"))).toBe(false);
    // Same-host discovery still works.
    expect(result).toContain("discovery: sitemap");
    expect(result).toContain("https://example.com/a");
  });
});

describe("novadaSiteCopy — slug de-dup on sanitized filename (no overwrite / data loss)", () => {
  it("two paths that sanitize-fold to the same slug get distinct files", async () => {
    // "/api/v1.0/users" and "/api/v1-0/users" produce DIFFERENT raw path slugs
    // (api-v1.0-users vs api-v1-0-users) but sanitizeSlug folds '.'→'-', so both
    // map to "api-v1-0-users.md". De-duping on the raw slug would let the second
    // page silently overwrite the first. The fix dedupes on the sanitized filename.
    const llmsTxt = [
      "# Docs",
      "- [A](https://example.com/api/v1.0/users)",
      "- [B](https://example.com/api/v1-0/users)",
    ].join("\n");

    mockedAxios.get.mockImplementation((url: string) =>
      url.endsWith("/llms.txt") ? Promise.resolve(ok(llmsTxt)) : Promise.resolve(ok(page())),
    );

    const result = await novadaSiteCopy({ ...SiteCopyParamsSchema.parse({ url: "https://example.com" }) });

    // Both pages must be written to DISTINCT files — no silent overwrite.
    expect(mdWriteCount()).toBe(2);
    const mdPaths = mockedWriteFile.mock.calls
      .map((c) => String(c[0]))
      .filter((p) => p.endsWith(".md"));
    expect(new Set(mdPaths).size).toBe(2);

    // Manifest lists 2 pages, each pointing at its OWN file (not one shared file).
    const manifest = readManifest();
    const pages = manifest.pages as Array<{ url: string; file: string; status: string }>;
    expect(pages).toHaveLength(2);
    const files = pages.filter((p) => p.status === "ok").map((p) => p.file);
    expect(new Set(files).size).toBe(files.length);
    expect(result).toContain("pages_written: 2");
  });
});
