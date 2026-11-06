/**
 * search-goto-links-2026-11-04 item (i): novada_scrape_google / the generic
 * scrape.ts engine must never leak raw base64 favicon/image blobs into json
 * or markdown output. A Google organic result's `favicon` field (and the
 * nested `about_this_result.source.icon`) is a `data:image/png;base64,...`
 * blob, live-measured at ~19KB EACH — csv/excel/html already dropped these
 * via curateTabularRecords; json/markdown did not.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrapeGoogle, validateScrapeGoogleParams } = await import("../../src/tools/scrape_google.js");

const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "google-task-base64" }, msg: "success" }, msg: "success" },
  status: 200,
  headers: {},
  config: {} as never,
  statusText: "OK",
};

function mockDownload(records: unknown[]) {
  mockedAxios.post.mockResolvedValue(SUBMIT_OK);
  mockedAxios.get.mockResolvedValue({
    data: [{ spider_code: 200, rest: { results: records } }],
    status: 200,
    headers: {},
    config: {} as never,
    statusText: "OK",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("novada_scrape_google — base64 favicon stripping (item i)", () => {
  const FAKE_FAVICON = "data:image/png;base64," + "A".repeat(300);

  it("strips a top-level base64 favicon field from markdown output", async () => {
    mockDownload(
      [{ title: "Has Favicon", link: "https://favicon-page.example.com/", favicon: FAKE_FAVICON }],
    );
    const result = await novadaScrapeGoogle(
      validateScrapeGoogleParams({ operation: "web_search", params: { q: "test" } }),
      "test-key",
    );
    expect(result).not.toContain(FAKE_FAVICON);
    expect(result).toContain("[base64 image data stripped]");
    expect(result).toContain("https://favicon-page.example.com/");
  });

  it("strips a NESTED base64 blob (about_this_result.source.icon) from json output", async () => {
    mockDownload(
      [
        {
          title: "Has Nested Icon",
          link: "https://nested-icon.example.com/",
          about_this_result: { source: { icon: FAKE_FAVICON, description: "a real description" } },
        },
      ],
    );
    const result = await novadaScrapeGoogle(
      validateScrapeGoogleParams({ operation: "web_search", params: { q: "test" }, format: "json" }),
      "test-key",
    );
    expect(result).not.toContain(FAKE_FAVICON);
    expect(result).toContain("[base64 image data stripped]");
    // The sibling non-blob field in the SAME nested object must survive.
    expect(result).toContain("a real description");
  });

  it("csv/excel/html tabular formats keep their EXISTING column-drop behavior (unchanged by this fix)", async () => {
    mockDownload(
      [{ title: "Has Favicon", link: "https://favicon-csv.example.com/", favicon: FAKE_FAVICON }],
    );
    const result = await novadaScrapeGoogle(
      validateScrapeGoogleParams({ operation: "web_search", params: { q: "test" }, format: "csv" }),
      "test-key",
    );
    expect(result).not.toContain(FAKE_FAVICON);
    // Column-drop (not a per-value marker) is still curateTabularRecords's behavior for csv.
    expect(result).not.toContain("[base64 image data stripped]");
  });
});
