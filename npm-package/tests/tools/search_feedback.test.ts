import { describe, it, expect, beforeEach } from "vitest";

import {
  novadaSearchFeedback,
  validateSearchFeedbackParams,
  getFeedbackForSearch,
  getTotalFeedbackCount,
  resetSearchFeedback,
} from "../../src/tools/search_feedback.js";

beforeEach(() => {
  resetSearchFeedback();
});

describe("validateSearchFeedbackParams", () => {
  it("requires search_id, query, and rating", () => {
    expect(() => validateSearchFeedbackParams({})).toThrow();
    expect(() => validateSearchFeedbackParams({ search_id: "s1", query: "q" })).toThrow();
  });

  it("rejects an invalid rating", () => {
    expect(() =>
      validateSearchFeedbackParams({ search_id: "s1", query: "q", rating: "great" })
    ).toThrow();
  });

  it("rejects a search_id with illegal characters", () => {
    expect(() =>
      validateSearchFeedbackParams({ search_id: "bad id!", query: "q", rating: "good" })
    ).toThrow();
  });

  it("rejects non-URL useful_urls entries", () => {
    expect(() =>
      validateSearchFeedbackParams({
        search_id: "s1",
        query: "q",
        rating: "good",
        useful_urls: ["not-a-url"],
      })
    ).toThrow();
  });

  it("defaults useful_urls to [] and format to markdown", () => {
    const p = validateSearchFeedbackParams({ search_id: "s1", query: "q", rating: "ok" });
    expect(p.useful_urls).toEqual([]);
    expect(p.format).toBe("markdown");
  });
});

describe("novadaSearchFeedback — markdown", () => {
  it("records feedback and returns a thank-you/echo with agent_instruction", async () => {
    const out = await novadaSearchFeedback(
      validateSearchFeedbackParams({
        search_id: "abc-123",
        query: "best proxy api",
        rating: "good",
        useful_urls: ["https://novada.com/", "https://example.com/docs"],
        note: "top result nailed it",
      })
    );

    expect(out).toContain("## Novada MCP — Search Feedback Recorded");
    expect(out).toContain("search_id: abc-123");
    expect(out).toContain("query: best proxy api");
    expect(out).toContain("rating: good");
    expect(out).toContain("useful_urls: 2");
    expect(out).toContain("https://novada.com/");
    expect(out).toContain("note: top result nailed it");
    expect(out).toContain("agent_instruction:");
  });

  it("persists feedback into the in-memory store keyed by search_id", async () => {
    await novadaSearchFeedback(
      validateSearchFeedbackParams({ search_id: "s9", query: "q", rating: "bad" })
    );

    const entries = getFeedbackForSearch("s9");
    expect(entries.length).toBe(1);
    expect(entries[0].rating).toBe("bad");
    expect(entries[0].query).toBe("q");
    expect(getTotalFeedbackCount()).toBe(1);
  });

  it("keeps multiple submissions for the same search_id (no overwrite)", async () => {
    const p1 = validateSearchFeedbackParams({ search_id: "dup", query: "q", rating: "ok" });
    const p2 = validateSearchFeedbackParams({ search_id: "dup", query: "q", rating: "good" });
    await novadaSearchFeedback(p1);
    const out2 = await novadaSearchFeedback(p2);

    expect(getFeedbackForSearch("dup").length).toBe(2);
    expect(out2).toContain("submissions_for_this_search: 2");
    expect(getTotalFeedbackCount()).toBe(2);
  });
});

describe("novadaSearchFeedback — json", () => {
  it("returns a parseable JSON object with the expected shape", async () => {
    const out = await novadaSearchFeedback(
      validateSearchFeedbackParams({
        search_id: "json-1",
        query: "q",
        rating: "ok",
        useful_urls: ["https://a.example/"],
        format: "json",
      })
    );
    const parsed = JSON.parse(out);

    expect(parsed.status).toBe("recorded");
    expect(parsed.search_id).toBe("json-1");
    expect(parsed.rating).toBe("ok");
    expect(parsed.useful_url_count).toBe(1);
    expect(parsed.useful_urls).toEqual(["https://a.example/"]);
    expect(parsed.note).toBeNull();
    expect(parsed.submissions_for_search).toBe(1);
    expect(typeof parsed.agent_instruction).toBe("string");
    expect(parsed.recorded_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});
