/**
 * search-goto-links-2026-11-04: integration coverage for the Google "goto"
 * redirect bug (reproduced live against production 2026-11-04 — a 5-result
 * novada_search returned 9 `/goto?url=CAES...` occurrences). Proves that
 * NEITHER novada_search's markdown NOR its json output ever contains a
 * relative "/goto?url=" path once this fix is applied — regardless of
 * output format — and that an unresolvable goto link is kept without a url
 * (never surfaced as a dead relative path) with the count reported.
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

  // 2026-11-04 follow-up: unresolvable results are RETAINED (title/snippet kept,
  // url cleared, url_unavailable:true) instead of dropped — dropping 7 of 8
  // results under Google rate-limiting made search useless. Never a /goto link.
  it("keeps a result whose goto link cannot be resolved without a url, and reports the count (json)", async () => {
    mockSearchWithGotoLinks(
      [
        { title: "Resolvable", link: "/goto?url=TOK3", description: "d1" },
        { title: "Unresolvable", link: "/goto?url=TOKBAD", description: "d2" },
      ],
      { TOK3: "https://resolvable.example.com/" },
    );

    const result = await novadaSearch({ query: "test query drop json", engine: "google", num: 10, country: "", language: "", format: "json" }, API_KEY);
    const parsed = JSON.parse(result);

    expect(parsed.results).toHaveLength(2);
    const resolvable = parsed.results.find((r: { title: string }) => r.title === "Resolvable");
    const unresolvable = parsed.results.find((r: { title: string }) => r.title === "Unresolvable");
    expect(resolvable.url).toBe("https://resolvable.example.com/");
    expect(unresolvable.url_unavailable).toBe(true);
    expect(unresolvable.url ?? "").toBe("");
    expect(JSON.stringify(parsed)).not.toContain("/goto?url=");
    expect(parsed.goto_links_unresolved).toBe(1);
    expect(parsed.url_resolution_warning).toBeUndefined(); // not ALL unresolvable
  });

  it("unresolvable goto link renders without a link in markdown and reports the count", async () => {
    mockSearchWithGotoLinks(
      [{ title: "Unresolvable", link: "/goto?url=TOKBAD2", description: "d" }],
      {},
    );
    const result = await novadaSearch({ query: "test query drop markdown", engine: "google", num: 10, country: "", language: "" }, API_KEY);
    expect(result).not.toContain("/goto?url=");
    expect(result).toContain("goto_links_unresolved:1");
    expect(result).toContain("## 1. Unresolvable");
    expect(result).toContain("url: unavailable");
    expect(result).not.toMatch(/\]\(\)/); // never an empty markdown link
  });

  it("all results unresolvable -> results kept without urls plus an explicit warning (never a relative path)", async () => {
    mockSearchWithGotoLinks(
      [{ title: "Unresolvable", link: "/goto?url=TOKBAD3", description: "d" }],
      {},
    );
    const result = await novadaSearch({ query: "test query all unresolvable", engine: "google", num: 10, country: "", language: "", format: "json" }, API_KEY);
    const parsed = JSON.parse(result);
    expect(parsed.result_count).toBe(1);
    expect(parsed.results[0].url_unavailable).toBe(true);
    expect(parsed.goto_links_unresolved).toBe(1);
    expect(parsed.url_resolution_warning).toMatch(/could not be resolved to a real URL/);
    expect(JSON.stringify(parsed)).not.toContain("/goto?url=");
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

  it("inline-results path: unresolvable goto link is kept with an empty url (research's normalizeUrl skips it; never a relative URL)", async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, headers: {}, data: "" });
    const submitted: SubmitSearchResult = {
      inlineResults: { organic_results: [{ title: "R", link: "/goto?url=TOKBAD4", description: "d" }] },
    };
    const results = await resolveSearchResults(API_KEY, submitted);
    expect(results).toHaveLength(1);
    expect((results[0] as { url_unavailable?: boolean }).url_unavailable).toBe(true);
    expect(results[0].url || results[0].link || "").toBe("");
  });
});

// 2026-11-05: live shape — the download payload uses `organic` (not
// `organic_results`), every wrapped result carries `redirect_link`, and fresh
// tokens get Google's bot-check interstitial from /goto instead of a 302.
describe("live 2026-11-05 shape — /goto bot-check, resolved via redirect_link replay", () => {
  const LIVE_QUERY = "sa=t&source=web&rct=j&opi=89978449&url=LIVETOK&ved=2ahUKEwjX9&usg=AOvVaw3x";
  const organic = [
    {
      title: "Async Rust Gridlock",
      link: "/goto?url=LIVETOK",
      redirect_link: `https://www.google.com/url?${LIVE_QUERY}`,
      snippet: "runtimes",
    },
  ];

  function mockLive() {
    mockedAxios.post.mockResolvedValue({ data: { code: 0, data: { task_id: "task-live-1" } } });
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes("scraper_download")) return { data: { organic } };
      if (url === `https://www.google.com/url?${LIVE_QUERY}`) {
        return { status: 200, headers: {}, data: "<script>var redirectUrl='https://medium.com/rustaceans/async-rust-gridlock';</script>" };
      }
      if (url.startsWith("https://www.google.com/goto")) {
        return { status: 200, headers: {}, data: "<title>Google</title>Anfrage wird verifiziert" };
      }
      throw new Error(`unexpected axios.get(${url})`);
    });
  }

  it("novada_search json resolves via the replay and never exposes redirect_link", async () => {
    mockLive();
    const result = await novadaSearch({ query: "live shape replay json", engine: "google", num: 10, country: "", language: "", format: "json" }, API_KEY);
    const parsed = JSON.parse(result);
    expect(parsed.results[0].url).toBe("https://medium.com/rustaceans/async-rust-gridlock");
    expect(parsed.results[0].url_unavailable).toBeUndefined();
    expect(result).not.toContain("redirect_link");
    expect(result).not.toContain("google.com/url?");
    expect(result).not.toContain("/goto?url=");
  });

  it("novada_search markdown resolves via the replay and never exposes redirect_link", async () => {
    mockLive();
    const result = await novadaSearch({ query: "live shape replay markdown", engine: "google", num: 10, country: "", language: "" }, API_KEY);
    expect(result).toContain("https://medium.com/rustaceans/async-rust-gridlock");
    expect(result).not.toContain("google.com/url?");
    expect(result).not.toContain("/goto?url=");
  });

  it("resolveSearchResults (research path) resolves and strips redirect_link from every result object", async () => {
    mockLive();
    const submitted: SubmitSearchResult = { inlineResults: { organic } };
    const results = await resolveSearchResults(API_KEY, submitted);
    expect(results[0].url).toBe("https://medium.com/rustaceans/async-rust-gridlock");
    for (const r of results) expect(Object.keys(r)).not.toContain("redirect_link");
  });
});
