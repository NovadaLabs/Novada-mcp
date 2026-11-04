/**
 * search-goto-links-2026-11-04: integration coverage for the Google "goto"
 * redirect bug (reproduced live against production 2026-11-04 — a 5-result
 * novada_search returned 9 `/goto?url=CAES...` occurrences). Proves that
 * NEITHER novada_search's markdown NOR its json output ever contains a
 * relative "/goto?url=" path once this fix is applied — regardless of
 * output format — and that an unresolvable goto link is dropped (never
 * surfaced as a dead relative path) with the drop count reported.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaSearch, resolveSearchResults, type SubmitSearchResult } from "../../src/tools/search.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-goto";

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Mocks the full 2-step scraper flow (submit -> task_id -> poll) AND the
 * goto-resolution hop, routing each axios.get call by URL so the test can
 * assert on BOTH legs independently.
 */
function mockSearchWithGotoLinks(organic: Record<string, unknown>[], resolvable: Record<string, string>) {
  mockedAxios.post.mockResolvedValue({
    data: { code: 0, data: { task_id: "task-goto-1" } },
  });
  mockedAxios.get.mockImplementation(async (url: string) => {
    if (url.includes("scraper_download")) {
      return { data: { organic_results: organic } };
    }
    if (url.startsWith("https://www.google.com/goto")) {
      const token = new URL(url).searchParams.get("url") ?? "";
      const dest = resolvable[token];
      if (dest) return { status: 302, headers: { location: dest }, data: "" };
      return { status: 200, headers: {}, data: "<html>no location here</html>" }; // unresolvable
    }
    throw new Error(`unexpected axios.get(${url})`);
  });
}

describe("novada_search — Google goto-link resolution", () => {
  it("resolves a relative /goto?url= link to the real URL in markdown output", async () => {
    mockSearchWithGotoLinks(
      [{ title: "Wrapped Result", link: "/goto?url=TOK1", description: "a result" }],
      { TOK1: "https://real-destination.example.com/article" },
    );

    const result = await novadaSearch({ query: "test query markdown resolve", engine: "google", num: 10, country: "", language: "" }, API_KEY);

    expect(result).not.toContain("/goto?url=");
    expect(result).toContain("https://real-destination.example.com/article");
  });

  it("resolves a relative /goto?url= link to the real URL in json output", async () => {
    mockSearchWithGotoLinks(
      [{ title: "Wrapped Result", link: "/goto?url=TOK2", description: "a result" }],
      { TOK2: "https://real-destination-json.example.com/article" },
    );

    const result = await novadaSearch({ query: "test query json plain resolve", engine: "google", num: 10, country: "", language: "", format: "json" }, API_KEY);

    expect(result).not.toContain("/goto?url=");
    const parsed = JSON.parse(result);
    expect(parsed.results[0].url).toBe("https://real-destination-json.example.com/article");
  });

  it("an already-absolute organic link passes through unchanged (no goto wrapper present)", async () => {
    mockSearchWithGotoLinks(
      [{ title: "Plain Result", link: "https://plain.example.com/page", description: "d" }],
      {},
    );
    const result = await novadaSearch({ query: "test query plain absolute", engine: "google", num: 10, country: "", language: "" }, API_KEY);
    expect(result).toContain("https://plain.example.com/page");
  });

  it("drops a result whose goto link cannot be resolved, and reports the drop count (json)", async () => {
    mockSearchWithGotoLinks(
      [
        { title: "Resolvable", link: "/goto?url=TOK3", description: "d1" },
        { title: "Unresolvable", link: "/goto?url=TOKBAD", description: "d2" },
      ],
      { TOK3: "https://resolvable.example.com/" },
    );

    const result = await novadaSearch({ query: "test query drop json", engine: "google", num: 10, country: "", language: "", format: "json" }, API_KEY);
    const parsed = JSON.parse(result);

    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].url).toBe("https://resolvable.example.com/");
    expect(parsed.results.some((r: { url: string }) => r.url.startsWith("/goto"))).toBe(false);
    expect(parsed.goto_links_dropped).toBe(1);
  });

  it("drops a result whose goto link cannot be resolved, and reports the drop count (markdown)", async () => {
    mockSearchWithGotoLinks(
      [{ title: "Unresolvable", link: "/goto?url=TOKBAD2", description: "d" }],
      {},
    );
    const result = await novadaSearch({ query: "test query drop markdown", engine: "google", num: 10, country: "", language: "" }, API_KEY);
    expect(result).not.toContain("/goto?url=");
    expect(result).toContain("goto_links_dropped:1");
  });

  it("all results unresolvable -> clean 'no results' response (never a relative path leaks through)", async () => {
    mockSearchWithGotoLinks(
      [{ title: "Unresolvable", link: "/goto?url=TOKBAD3", description: "d" }],
      {},
    );
    const result = await novadaSearch({ query: "test query all unresolvable", engine: "google", num: 10, country: "", language: "", format: "json" }, API_KEY);
    const parsed = JSON.parse(result);
    expect(parsed.result_count).toBe(0);
    expect(parsed.goto_links_dropped).toBe(1);
  });
});

describe("resolveSearchResults (used by novada_research) — same goto-link fix", () => {
  it("resolves goto links for the inline-results path", async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      const token = new URL(url).searchParams.get("url") ?? "";
      if (token === "TOK4") return { status: 302, headers: { location: "https://research-resolved.example.com/" }, data: "" };
      return { status: 200, headers: {}, data: "" };
    });

    const submitted: SubmitSearchResult = {
      inlineResults: { organic_results: [{ title: "R", link: "/goto?url=TOK4", description: "d" }] },
    };
    const results = await resolveSearchResults(API_KEY, submitted);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://research-resolved.example.com/");
    expect(results[0].url).not.toMatch(/^\/goto/);
  });

  it("drops unresolvable goto links for the inline-results path (never hands research.ts a relative URL to extract)", async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, headers: {}, data: "" });
    const submitted: SubmitSearchResult = {
      inlineResults: { organic_results: [{ title: "R", link: "/goto?url=TOKBAD4", description: "d" }] },
    };
    const results = await resolveSearchResults(API_KEY, submitted);
    expect(results).toHaveLength(0);
  });
});
