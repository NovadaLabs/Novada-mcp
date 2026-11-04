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

