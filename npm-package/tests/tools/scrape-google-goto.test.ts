/**
 * search-goto-links-2026-11-04: novada_scrape_google coverage for Google "goto"
 * redirect links — the generic scrape.ts engine renders raw records directly
 * (not through search.ts's parseScraperSearchResults), so this is a SEPARATE
 * call site that needs the SAME shared resolver (utils/google_redirect.ts)
 * wired in.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrapeGoogle, validateScrapeGoogleParams } = await import("../../src/tools/scrape_google.js");

const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "google-task-goto" }, msg: "success" }, msg: "success" },
  status: 200,
  headers: {},
  config: {} as never,
  statusText: "OK",
};

function mockDownloadAndGotoResolve(records: unknown[], resolvable: Record<string, string>) {
  mockedAxios.post.mockResolvedValue(SUBMIT_OK);
  mockedAxios.get.mockImplementation(async (url: string) => {
    if (url.startsWith("https://www.google.com/goto")) {
      const token = new URL(url).searchParams.get("url") ?? "";
      const dest = resolvable[token];
      if (dest) return { status: 302, headers: { location: dest }, data: "" };
      return { status: 200, headers: {}, data: "<html>no location</html>" };
    }
    // The scraper_download poll endpoint.
    return {
      data: [{ spider_code: 200, rest: { results: records } }],
      status: 200,
      headers: {},
      config: {} as never,
      statusText: "OK",
    };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("novada_scrape_google — Google goto-link resolution (generic scrape engine)", () => {
  it("resolves a relative /goto link in a raw record to the real URL (markdown)", async () => {
    mockDownloadAndGotoResolve(
      [{ title: "Wrapped", link: "/goto?url=SCRTOK1", source: "Example" }],
      { SCRTOK1: "https://scrape-resolved.example.com/article" },
    );

    const result = await novadaScrapeGoogle(
      validateScrapeGoogleParams({ operation: "web_search", params: { q: "test" } }),
      "test-key",
    );

    expect(result).not.toContain("/goto?url=");
    expect(result).toContain("https://scrape-resolved.example.com/article");
  });

  it("resolves a relative /goto link in a raw record to the real URL (json)", async () => {
    mockDownloadAndGotoResolve(
      [{ title: "Wrapped", link: "/goto?url=SCRTOK2", source: "Example" }],
      { SCRTOK2: "https://scrape-resolved-json.example.com/article" },
    );

    const result = await novadaScrapeGoogle(
      validateScrapeGoogleParams({ operation: "web_search", params: { q: "test" }, format: "json" }),
      "test-key",
    );

    expect(result).not.toContain("/goto?url=");
    expect(result).toContain("https://scrape-resolved-json.example.com/article");
  });

  it("keeps a record whose goto link is unresolvable without a link and surfaces the count in Agent Hints", async () => {
    mockDownloadAndGotoResolve(
      [
        { title: "Resolvable", link: "/goto?url=SCRTOK3", source: "A" },
        { title: "Unresolvable", link: "/goto?url=SCRTOKBAD", source: "B" },
      ],
      { SCRTOK3: "https://scrape-good.example.com/" },
    );

    const result = await novadaScrapeGoogle(
      validateScrapeGoogleParams({ operation: "web_search", params: { q: "test" } }),
      "test-key",
    );

    // The hint text itself legitimately mentions the "/goto?url=..." pattern by
    // name for human readability — assert the actual unresolved TOKEN is gone,
    // not the generic phrase.
    expect(result).not.toContain("SCRTOKBAD");
    expect(result).toContain("https://scrape-good.example.com/");
    expect(result).toContain("Unresolvable"); // retained: title still visible
    expect(result).toContain("1 result(s) kept without a link");
  });

  it("an already-absolute link is passed through with zero resolve calls", async () => {
    mockDownloadAndGotoResolve([{ title: "Plain", link: "https://plain-scrape.example.com/", source: "A" }], {});
    const result = await novadaScrapeGoogle(
      validateScrapeGoogleParams({ operation: "web_search", params: { q: "test" } }),
      "test-key",
    );
    expect(result).toContain("https://plain-scrape.example.com/");
    // Only the download-poll GET should have fired — no goto-resolve call.
    const getCalls = mockedAxios.get.mock.calls.map((c) => c[0] as string);
    expect(getCalls.some((u) => u.startsWith("https://www.google.com/goto"))).toBe(false);
  });
});


// 2026-11-05 review follow-up: live Google records carry `redirect_link` (a
// google.com/url click-tracking URL). It must never reach any output format.
describe("novada_scrape_google — redirect_link never reaches the output", () => {
  const records = [
    {
      title: "Wrapped",
      link: "/goto?url=SCRRL1",
      redirect_link: "https://www.google.com/url?sa=t&source=web&rct=j&opi=89978449&url=SCRRL1&ved=2ahUKE",
      source: "Example",
    },
    {
      title: "Plain",
      link: "https://plain.example.com/page",
      redirect_link: "https://www.google.com/url?sa=t&source=web&rct=j&opi=89978449&url=SCRRL2&ved=2ahUKF",
      source: "Example",
    },
  ];

  for (const format of ["markdown", "json", "csv", "html", "toon"] as const) {
    it(`${format}: no redirect_link field and no google.com/url? link`, async () => {
      mockDownloadAndGotoResolve(records, { SCRRL1: "https://resolved.example.com/a" });
      const result = await novadaScrapeGoogle(
        validateScrapeGoogleParams({ operation: "web_search", params: { q: "test" }, format }),
        "test-key",
      );
      expect(result).not.toContain("redirect_link");
      expect(result).not.toContain("google.com/url?");
      expect(result).toContain("https://plain.example.com/page");
    });
  }

  it("resolves only the records the response returns (limit), never the discarded tail", async () => {
    mockDownloadAndGotoResolve(
      [
        { title: "One", link: "/goto?url=LIMTOK1" },
        { title: "Two", link: "/goto?url=LIMTOK2" },
        { title: "Three", link: "/goto?url=LIMTOK3" },
      ],
      { LIMTOK1: "https://one.example.com/", LIMTOK2: "https://two.example.com/", LIMTOK3: "https://three.example.com/" },
    );
    await novadaScrapeGoogle(
      validateScrapeGoogleParams({ operation: "web_search", params: { q: "test" }, limit: 1 }),
      "test-key",
    );
    const googleCalls = mockedAxios.get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("https://www.google.com/"));
    expect(googleCalls).toEqual(["https://www.google.com/goto?url=LIMTOK1"]);
  });
});

describe("novada_scrape_google — nested redirect links (video key_moments, source_info_link)", () => {
  it("json and markdown carry no relative or Google-redirect link at any depth", async () => {
    for (const format of ["json", "markdown"] as const) {
      mockDownloadAndGotoResolve(
        [{
          title: "Video",
          link: "https://www.youtube.com/watch?v=abc",
          key_moments: [{ link: "/goto?url=KMTOK", time: "00:10", title: "Part" }],
          rich: { source_info_link: "/goto?url=SITOK" },
        }],
        {},
      );
      const result = await novadaScrapeGoogle(
        validateScrapeGoogleParams({ operation: "web_search", params: { q: "test" }, format }),
        "test-key",
      );
      expect(result).not.toContain("/goto?url=");
      expect(result).toContain("https://www.youtube.com/watch?v=abc");
      expect(result).toContain("00:10");
    }
  });
});
