import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import { NovadaClient } from "../../src/sdk/index.js";
import * as toolsIndex from "../../src/tools/index.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

// NOV-852 follow-up: partial-mock the tools module so search()'s two new
// guards (the JSON.parse try/catch and the Array.isArray(results) check) can
// be pinned directly against a raw novadaSearch return value. Driving these
// through the real submitSearchScrapeTask → axios → rerank → JSON.stringify
// pipeline can never actually produce a malformed or truncated JSON string,
// so that path could never discriminate whether these guards exist.
// `vi.fn(actual.novadaSearch)` calls through to the real implementation by
// default — every other search() test below (and extract/crawl/research/etc.)
// still exercises the REAL tool via axios mocking, unaffected by this wrap.
vi.mock("../../src/tools/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tools/index.js")>();
  return { ...actual, novadaSearch: vi.fn(actual.novadaSearch) };
});
const mockedNovadaSearch = vi.mocked(toolsIndex.novadaSearch);

beforeEach(() => { vi.clearAllMocks(); });

const client = new NovadaClient({ scraperApiKey: "test-key" });

describe("NovadaClient", () => {
  describe("search()", () => {
    // NOV-852: was a genuine SOURCE BUG in src/sdk/index.ts's search(): it
    // asked novadaSearch for format:"markdown" and then parsed the markdown
    // output with `raw.split(/\n### \d+\./)`, looking for separate `url:` /
    // `snippet:` lines per block. novadaSearch (src/tools/search.ts, the
    // markdown branch ~line 937) actually renders each result as
    // `## <N>. [title](url)` followed directly by the snippet text — there is
    // no `### ` header, no `url:` line, no `snippet:` line anywhere in the
    // output. The regex therefore never matched, blocks.length === 0, and
    // NovadaClient.search() silently returned an empty array for every query
    // in production. Fixed by requesting format:"json" from novadaSearch and
    // reading its typed `results[]` field directly instead of re-parsing
    // rendered markdown (see search() in src/sdk/index.ts).
    it("returns typed SearchResult array", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            data: {
              json: [
                { rest: { organic_results: [
                  { title: "Result 1", url: "https://example.com", description: "Desc 1" },
                ] } },
              ],
            },
          },
        },
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });

      const results = await client.search("test query");
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toMatchObject({ title: "Result 1", url: "https://example.com", snippet: "Desc 1" });
    });

    it("returns [] cleanly when the backend returns an empty result set", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { code: 0, data: { data: { json: [{ rest: { organic_results: [] } }] } } },
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });

      const results = await client.search("no such query will ever match");
      expect(results).toEqual([]);
    });

    it("returns [] cleanly when novadaSearch emits a non-JSON message (malformed/entitlement response)", async () => {
      // Some tool-level branches (e.g. invalid `engine` param, SERP entitlement
      // failure) emit a markdown message regardless of the requested format,
      // and return BEFORE any HTTP call is made — no axios mock needed here.
      // The SDK must degrade to [] rather than throwing on JSON.parse.
      const results = await client.search("test query", { engine: "not-a-real-engine" as never });
      expect(results).toEqual([]);
    });

    it("returns [] when novadaSearch's JSON has `results` present but not an array (pins the Array.isArray guard)", async () => {
      // Deliberately NOT the `{"results":"oops"}` (string) shape: a string is
      // iterable char-by-char in JS, so `for (const item of "oops")` yields
      // "o","o","p","s" — each has no .url property, so the loop harmlessly
      // no-ops and produces [] *even with the Array.isArray guard removed*.
      // That payload would pass either way and prove nothing. A plain object
      // is NOT iterable: without the guard, `for...of` over it throws
      // "is not iterable", so this payload actually discriminates whether the
      // guard exists (traced by temporarily removing the guard — see report).
      mockedNovadaSearch.mockResolvedValueOnce(JSON.stringify({ results: { unexpected: "shape" } }));

      const results = await client.search("test query");
      expect(results).toEqual([]);
    });

    it("returns [] when novadaSearch's output is truncated/invalid JSON (pins the JSON.parse try/catch)", async () => {
      mockedNovadaSearch.mockResolvedValueOnce('{"results":[{"title":');

      const results = await client.search("test query");
      expect(results).toEqual([]);
    });
  });

  describe("extract()", () => {
    it("returns typed ExtractResult", async () => {
      mockedAxios.get.mockResolvedValue({
        data: `<html><body><h1>Test Title</h1><p>${"content ".repeat(50)}</p></body></html>`,
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });

      const result = await client.extract("https://example.com");
      expect(result.url).toBe("https://example.com");
      expect(result.title).toBeTruthy();
      expect(typeof result.content).toBe("string");
      expect(typeof result.chars).toBe("number");
    });
  });

  describe("scrape()", () => {
    it("returns ScrapeResult with records and formatted string", async () => {
      // Step 1: submit → task_id
      mockedAxios.post.mockResolvedValue({
        data: { code: 0, data: { code: 200, data: { task_id: "sdk-task-123" }, msg: "success" }, msg: "success" },
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });
      // Step 2: poll → result array
      mockedAxios.get.mockResolvedValue({
        data: [{ spider_code: 200, rest: { results: [
          { title: "iPhone 16 Pro", price: "$999", asin: "B09X" },
          { title: "iPhone 16", price: "$799", asin: "B09Y" },
        ] } }],
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });

      const result = await client.scrape("amazon.com", "amazon_product_by-keywords", { keyword: "iphone" }, { format: "json" });
      expect(result.platform).toBe("amazon.com");
      expect(result.operation).toBe("amazon_product_by-keywords");
      expect(result.records).toHaveLength(2);
      expect(result.records[0]).toMatchObject({ title: "iPhone 16 Pro" });
      expect(typeof result.formatted).toBe("string");
      expect(result.formatted).toContain("```json");
    });
  });

  describe("crawl()", () => {
    it("returns typed CrawlPage array", async () => {
      mockedAxios.get.mockResolvedValue({
        data: `<html><body>
          <h1>Crawl Title</h1>
          <p>${"word ".repeat(30)}</p>
          <a href="https://example.com/sub">Sub</a>
        </body></html>`,
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });

      const pages = await client.crawl("https://example.com", { maxPages: 1, render: "static" });
      expect(Array.isArray(pages)).toBe(true);
      expect(pages.length).toBeGreaterThan(0);
      expect(pages[0]).toMatchObject({ url: expect.any(String), title: expect.any(String), content: expect.any(String) });
    });
  });

  describe("map()", () => {
    it("returns typed MapResult", async () => {
      const sitemap = `<?xml version="1.0"?><urlset>
        <url><loc>https://example.com/</loc></url>
        <url><loc>https://example.com/about</loc></url>
      </urlset>`;
      mockedAxios.get
        .mockRejectedValueOnce(new Error("404")) // robots.txt
        .mockResolvedValueOnce({ data: sitemap, status: 200, headers: {}, config: {} as never, statusText: "OK" });

      const result = await client.map("https://example.com");
      expect(result.root).toBe("https://example.com");
      expect(Array.isArray(result.urls)).toBe(true);
      expect(result.urls.length).toBeGreaterThan(0);
    });
  });

  describe("research()", () => {
    it("returns ResearchResult with sources and queries", async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          code: 200,
          data: {
            organic_results: [
              { title: "Research Source", url: "https://source.example.com", description: "Key info about topic" },
            ],
          },
        },
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });

      const result = await client.research("What is AI?", { depth: "quick" });
      expect(result.question).toBe("What is AI?");
      expect(typeof result.depth).toBe("string");
      expect(Array.isArray(result.sources)).toBe(true);
      expect(Array.isArray(result.extracted)).toBe(true);
      expect(Array.isArray(result.queriesUsed)).toBe(true);
    });
  });

  describe("proxy()", () => {
    it("throws when proxy not configured", () => {
      const c = new NovadaClient({ scraperApiKey: "key" });
      expect(() => c.proxy({ type: "residential" })).toThrow("Proxy credentials not configured");
    });

    it("returns ProxyConfig when credentials provided", () => {
      const c = new NovadaClient({
        scraperApiKey: "key",
        proxy: { user: "user_ABC", pass: "pass", endpoint: "proxy.example.com:7777" },
      });

      const config = c.proxy({ type: "residential", country: "us" });
      expect(config.proxyUrl).toContain("proxy.example.com:7777");
      expect(config.username).toContain("country-us");
    });
  });

  describe("verify()", () => {
    it("returns VerifyResult with parsed verdict and confidence", async () => {
      // Investigated (not a live network call — fully mocked via vi.mock("axios")):
      // this fixture had TWO stale-contract bugs, both deterministic and fixable:
      //  1. Envelope shape: verify.ts's runSearchQuery -> submitSearchScrapeTask
      //     requires body.code === 0 and unwraps results from
      //     body.data.data.json[0].rest.organic_results, not the flat
      //     {code:200, data:{organic_results}} this fixture sent. Every one of the
      //     3 queries threw "Scraper search submit error (code 200)"; runSearchQuery
      //     swallows that per-query (returns {results:[], failed:true}), so verify()
      //     silently fell through to verdict:"insufficient_data" instead of throwing
      //     — that's why the failure was an assertion mismatch, not a thrown error.
      //  2. Relevance gate (FIX #3(a) in verify.ts): a source only counts as
      //     evidence if its title/description actually mentions one of the claim's
      //     key terms (isRelevant). The old "Supporting snippet 1"-style filler text
      //     mentioned none of "eiffel"/"tower"/"located"/"paris", so even with the
      //     envelope fixed, every source would still be filtered out.
      // Mock 3 search calls: query 1 (supporting) returns 4 relevant, non-refuting
      // sources; query 2 (skeptical) returns 1 relevant source that does NOT match
      // any DISPUTE_MARKERS term, so it contributes 0 to contradictCount; query 3
      // (neutral/fact-check) returns a real empty result set (not a failure).
      mockedAxios.post
        .mockResolvedValueOnce({
          data: {
            code: 0,
            data: {
              data: {
                json: [{ rest: { organic_results: [
                  { title: "Eiffel Tower Facts", url: "https://example.com/1", description: "The Eiffel Tower is a wrought-iron lattice tower located in Paris, France." },
                  { title: "Visiting the Eiffel Tower", url: "https://example.com/2", description: "The Eiffel Tower is one of the most visited monuments in Paris." },
                  { title: "History of the Tower", url: "https://example.com/3", description: "The tower was built in 1889 and remains a landmark of Paris today." },
                  { title: "Paris Landmarks Guide", url: "https://example.com/4", description: "The Eiffel Tower is located near the Champ de Mars in Paris." },
                ] } }],
              },
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            code: 0,
            data: {
              data: {
                json: [{ rest: { organic_results: [
                  { title: "Eiffel Tower discussion", url: "https://contra.com/1", description: "A forum thread discussing the Eiffel Tower and its location in Paris." },
                ] } }],
              },
            },
          },
        })
        .mockResolvedValueOnce({
          data: { code: 0, data: { data: { json: [{ rest: { organic_results: [] } }] } } },
        });

      const result = await client.verify("The Eiffel Tower is located in Paris");

      expect(result.claim).toBe("The Eiffel Tower is located in Paris");
      expect(result.verdict).toBe("supported");
      expect(result.confidence).toBeGreaterThan(0);
      expect(typeof result.raw).toBe("string");
      expect(result.raw).toContain("## Claim Verification");
    });
  });
});
