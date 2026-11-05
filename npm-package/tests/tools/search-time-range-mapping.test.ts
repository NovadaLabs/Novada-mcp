/**
 * search-goto-links-2026-11-04 item (ii): novada_search's time_range/start_date/
 * end_date params must translate into the field name+value shape each upstream
 * scraper_id actually understands — NOT a literal `time_range=week` field, which
 * was live-verified (2026-11-04, production scraper.novada.com) to be silently
 * ignored by the google_search scraper (returned unfiltered, months/years-old
 * results). See search.ts's buildTimeFilterFields doc comment for the full
 * investigation, including the live date-range checks that confirmed the
 * tbs=cdr:1,cd_min:...,cd_max:... custom-range shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { submitSearchScrapeTask } from "../../src/tools/search.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-time-range";

beforeEach(() => {
  vi.clearAllMocks();
  mockedAxios.post.mockResolvedValue({ data: { code: 0, data: { task_id: "t1" } } });
});

function formBodyOf(callIndex = 0): URLSearchParams {
  return mockedAxios.post.mock.calls[callIndex][1] as URLSearchParams;
}

describe("buildTimeFilterFields wire format — google.com", () => {
  it.each([
    ["day", "qdr:d"],
    ["week", "qdr:w"],
    ["month", "qdr:m"],
    ["year", "qdr:y"],
  ])("time_range=%s -> tbs=%s (never a bare time_range field)", async (timeRange, expectedTbs) => {
    await submitSearchScrapeTask(API_KEY, "google.com", "google_search", "q", 10, "q", true, { time_range: timeRange });
    const form = formBodyOf();
    expect(form.get("tbs")).toBe(expectedTbs);
    expect(form.get("time_range")).toBeNull();
  });

  it("start_date + end_date -> tbs=cdr:1,cd_min:...,cd_max:... (custom range wins over time_range)", async () => {
    await submitSearchScrapeTask(API_KEY, "google.com", "google_search", "q", 10, "q", true, {
      time_range: "week", // must be overridden by the explicit range
      start_date: "2024-01-01",
      end_date: "2024-01-31",
    });
    const form = formBodyOf();
    expect(form.get("tbs")).toBe("cdr:1,cd_min:1/1/2024,cd_max:1/31/2024");
    expect(form.get("time_range")).toBeNull();
    expect(form.get("start_date")).toBeNull();
    expect(form.get("end_date")).toBeNull();
  });

  // Fake timers drive both Date.now() and `new Date()`; the previous version
  // only stubbed Date.now, never reached the code's clock, and passed only on
  // the calendar day it was written.
  it.each([
    ["early in the UTC day", "2026-11-04T00:00:00Z", "11/4/2026"],
    ["late in the UTC day — already the next day east of UTC", "2026-11-04T23:30:00Z", "11/5/2026"],
  ])("start_date only -> cd_max is the latest calendar date anywhere (%s)", async (_label, now, expectedMax) => {
    vi.useFakeTimers({ now: new Date(now) });
    try {
      await submitSearchScrapeTask(API_KEY, "google.com", "google_search", "q", 10, "q", true, {
        start_date: "2026-10-01",
      });
      const form = formBodyOf();
      expect(form.get("tbs")).toBe(`cdr:1,cd_min:10/1/2026,cd_max:${expectedMax}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no time filter at all -> no tbs field sent", async () => {
    await submitSearchScrapeTask(API_KEY, "google.com", "google_search", "q", 10, "q", true, {});
    const form = formBodyOf();
    expect(form.get("tbs")).toBeNull();
  });

  it("an unparseable start_date falls back to a sentinel rather than sending a malformed tbs", async () => {
    await submitSearchScrapeTask(API_KEY, "google.com", "google_search", "q", 10, "q", true, {
      start_date: "not-a-date",
      end_date: "2024-01-31",
    });
    const form = formBodyOf();
    expect(form.get("tbs")).toBe("cdr:1,cd_min:1/1/2000,cd_max:1/31/2024");
  });
});

describe("buildTimeFilterFields wire format — duckduckgo.com", () => {
  it.each([
    ["day", "d"],
    ["week", "w"],
    ["month", "m"],
    ["year", "y"],
  ])("time_range=%s -> df=%s (catalog's own declared enum for this op)", async (timeRange, expectedDf) => {
    await submitSearchScrapeTask(API_KEY, "duckduckgo.com", "duckduckgo", "q", 10, "q", true, { time_range: timeRange });
    const form = formBodyOf();
    expect(form.get("df")).toBe(expectedDf);
    expect(form.get("time_range")).toBeNull();
    expect(form.get("tbs")).toBeNull();
  });
});

describe("buildTimeFilterFields wire format — yandex.com (documented unresolved)", () => {
  it("preserves the PRE-EXISTING time_range passthrough — not remapped without live verification", async () => {
    // yandex's catalog `within` enum (["0","77","1","2"]) is not self-evidently a
    // day/week/month/year encoding; no live verification confirmed a mapping, so
    // this intentionally keeps the OLD (already broken) behavior rather than
    // guess at a new, unverified one. See search.ts's buildTimeFilterFields doc
    // comment and the fix report's "known follow-up" section.
    await submitSearchScrapeTask(API_KEY, "yandex.com", "yandex", "keyword", 10, "keyword", false, { time_range: "week" });
    const form = formBodyOf();
    expect(form.get("time_range")).toBe("week");
  });
});
