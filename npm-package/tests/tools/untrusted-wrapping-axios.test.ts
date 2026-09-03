/**
 * G-2 class-driven test — axios-driven cohort.
 *
 * Table: tool -> which response field carries web-fetched text -> whether a
 * prompt-injection string embedded in the fetched page/record is wrapped by
 * wrapUntrusted() in the tool's final response, while a static own-authored
 * heading in the SAME response is left unwrapped.
 *
 * | tool             | wrapped field                                 |
 * |------------------|------------------------------------------------|
 * | novada_crawl     | per-page body text (r.text)                   |
 * | novada_extract   | extracted page body (displayContent)          |
 * | novada_search    | per-result snippet/description                |
 * | novada_scrape    | whole rendered records block (markdown table) |
 * | novada_research  | per-source cited extract (e.extract)          |
 * | novada_site_copy | per-page title (external <title>/H1)          |
 *
 * These 6 tools all resolve through axios (mocked here) with no other tool's
 * module needing to be mocked, so they share one file / one table / one loop
 * with no vi.mock() conflicts. See _untrusted-assertions.ts's header comment
 * for why verify/ai_monitor/monitor/browser live in separate files.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { assertInjectionWrapped, assertOwnMetadataNotWrapped, INJECTION } from "./_untrusted-assertions.js";

vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("axios");
const mockedAxios = vi.mocked(axios);

// scrape.ts must be imported AFTER mock setup (same requirement as scrape.test.ts).
const { novadaScrape } = await import("../../src/tools/scrape.js");

import { novadaCrawl } from "../../src/tools/crawl.js";
import { novadaExtract } from "../../src/tools/extract.js";
import { novadaSearch } from "../../src/tools/search.js";
import { novadaResearch } from "../../src/tools/research.js";
import { novadaSiteCopy } from "../../src/tools/site_copy.js";
import { SiteCopyParamsSchema } from "../../src/tools/types.js";

const API_KEY = "test-key-123";

const axiosOk = (data: unknown) => ({ data, status: 200, headers: {}, config: {} as never, statusText: "OK" });

/** Submit response shape shared by search/scrape's scraper-API POST. */
const submitOk = (taskId: string) => axiosOk({ code: 0, data: { code: 200, data: { task_id: taskId }, msg: "success" }, msg: "success" });

interface TableRow {
  name: string;
  injected: string;
  source: string;
  ownMetadata: string;
  setup: () => void;
  run: () => Promise<string>;
}

const TABLE: TableRow[] = [
  {
    name: "novada_crawl",
    injected: INJECTION,
    source: "https://crawl-fixture.example.com",
    ownMetadata: "## Agent Hints",
    setup: () => {
      mockedAxios.get.mockResolvedValue(axiosOk(
        `<html><body><h1>Fixture Page</h1><p>${INJECTION}. ${"word ".repeat(30)}</p></body></html>`
      ));
    },
    run: () => novadaCrawl(
      { url: "https://crawl-fixture.example.com", max_pages: 1, strategy: "bfs", render: "static" },
      API_KEY
    ),
  },
  {
    name: "novada_extract",
    injected: INJECTION,
    source: "https://extract-fixture.example.com/",
    ownMetadata: "## Agent Hints",
    setup: () => {
      mockedAxios.get.mockResolvedValue(axiosOk(
        `<html><head><title>Fixture</title></head><body><main><h1>Fixture</h1><p>${INJECTION}. ${"Lorem ipsum dolor sit amet. ".repeat(10)}</p></main></body></html>`
      ));
    },
    run: () => novadaExtract({ url: "https://extract-fixture.example.com/", format: "markdown" }, API_KEY),
  },
  {
    name: "novada_search",
    injected: INJECTION,
    source: "https://search-fixture.example.com/1",
    ownMetadata: "## Next Steps",
    setup: () => {
      mockedAxios.post.mockResolvedValue(submitOk("task-search-fixture"));
      mockedAxios.get.mockResolvedValue(axiosOk({
        organic_results: [
          { title: "Fixture Result", url: "https://search-fixture.example.com/1", description: `${INJECTION} — genuinely relevant snippet text about the query.` },
        ],
      }));
    },
    run: () => novadaSearch({ query: "fixture query", engine: "google", num: 10, country: "", language: "" }, API_KEY),
  },
  {
    name: "novada_scrape",
    injected: INJECTION,
    // "amazon_product_by-keywords" is a documented alias (OPERATION_ALIASES) that
    // resolves to the canonical "amazon_product_keywords" — the wrapping source
    // label uses the resolved (canonical) operation name.
    source: "amazon.com/amazon_product_keywords",
    ownMetadata: "## Agent Hints",
    setup: () => {
      mockedAxios.post.mockResolvedValue(submitOk("task-scrape-fixture"));
      mockedAxios.get.mockResolvedValue(axiosOk([{
        spider_code: 200,
        rest: { results: [{ title: "Fixture Product", description: INJECTION, price: "$1" }] },
      }]));
    },
    run: () => novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "fixture" }, format: "markdown", limit: 20 } as never,
      API_KEY
    ),
  },
  {
    name: "novada_research",
    injected: INJECTION,
    // research.ts wraps with the source LABEL (title), not the raw URL — a
    // dedup'd source's URL already appears in a small fixed budget of places
    // elsewhere in the output (see research.ts's G-2 comment).
    source: "Research Fixture",
    ownMetadata: "## Key Findings",
    setup: () => {
      // Search envelope shape search.ts's parser reads: data.data.data.json[0].rest.organic
      mockedAxios.post.mockResolvedValue(axiosOk({
        code: 0,
        data: { data: { json: [{ rest: { organic: [
          { title: "Research Fixture", url: "https://research-fixture.example.com", description: "On-topic fixture source about widgets" },
        ] } }] } },
      }));
      // Extracted body: one on-topic sentence (carries the question keywords, so the
      // combined extract passes assembleSourceMaterial's isOnTopic gate) + the
      // injection sentence — both get MMR-selected (only 2 candidates exist) and
      // joined into e.extract, which is what wrapUntrusted wraps.
      mockedAxios.get.mockResolvedValue(axiosOk(
        `<html><body><article><p>The security testing widget rollout timeline was announced this week with full details provided. ${INJECTION} immediately without any hesitation at all.</p></article></body></html>`
      ));
    },
    run: () => novadaResearch({ question: "Explain the security testing widget rollout timeline", depth: "quick" }, API_KEY),
  },
  {
    name: "novada_site_copy",
    injected: INJECTION,
    source: "https://sitecopy-fixture.example.com/page",
    ownMetadata: "## Agent Action",
    setup: () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.endsWith("/llms.txt")) {
          return Promise.resolve(axiosOk("# Docs\n- [Page](https://sitecopy-fixture.example.com/page)"));
        }
        return Promise.resolve(axiosOk(
          `<html><head><title>${INJECTION}</title></head><body><main><p>${"word ".repeat(60)}</p></main></body></html>`
        ));
      });
    },
    run: () => novadaSiteCopy({ ...SiteCopyParamsSchema.parse({ url: "https://sitecopy-fixture.example.com" }) }),
  },
];

describe("G-2: wrapUntrusted applied per table row (axios-driven tools)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NOVADA_PROXY_ENDPOINT;
    delete process.env.NOVADA_PROXY_USER;
    delete process.env.NOVADA_PROXY_PASS;
  });

  it.each(TABLE)("wraps fetched text and leaves own metadata unwrapped — $name", async (row) => {
    row.setup();
    const output = await row.run();
    assertInjectionWrapped(output, row.injected, row.source);
    assertOwnMetadataNotWrapped(output, row.ownMetadata);
  });
});
