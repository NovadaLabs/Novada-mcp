import { describe, it, expect } from "vitest";
import { rerankResults } from "../../src/utils/rerank.js";

describe("rerankResults", () => {
  it("returns single result unchanged", () => {
    const results = [{ title: "Only result", url: "https://a.com", description: "Some text" }];
    const out = rerankResults(results, "only result");
    expect(out).toEqual(results);
  });

  it("returns empty array unchanged", () => {
    const out = rerankResults([], "anything");
    expect(out).toEqual([]);
  });

  it("ranks results with query terms in title above those without", () => {
    const resultA = { title: "Coffee in Frankfurt", description: "Best spots", url: "https://a.com" };
    const resultB = { title: "Tea shops", description: "Nice places", url: "https://b.com" };
    const out = rerankResults([resultB, resultA], "coffee Frankfurt");
    expect(out[0]).toEqual(resultA);
  });

  it("returns original order when no meaningful query terms (all stop words)", () => {
    const resultA = { title: "Alpha", description: "First", url: "https://a.com" };
    const resultB = { title: "Beta", description: "Second", url: "https://b.com" };
    // "the a an" are all stop words → no scoring → original order preserved
    const out = rerankResults([resultA, resultB], "the a an");
    expect(out[0]).toEqual(resultA);
    expect(out[1]).toEqual(resultB);
  });

  it("is stable — results with equal score maintain relative order", () => {
    const resultA = { title: "Alpha page", description: "Info", url: "https://a.com" };
    const resultB = { title: "Beta page", description: "Info", url: "https://b.com" };
    // Query "page" matches both titles equally; original order should be preserved
    const out = rerankResults([resultA, resultB], "page");
    expect(out[0]).toEqual(resultA);
    expect(out[1]).toEqual(resultB);
  });

  it("title match outweighs snippet-only match", () => {
    const resultA = { title: "Python programming", description: "general info", url: "https://a.com" };
    const resultB = {
      title: "Something else",
      description: "Python programming is great for many things and many uses",
      url: "https://b.com",
    };
    const out = rerankResults([resultB, resultA], "python programming");
    expect(out[0]).toEqual(resultA);
  });

  it("includes 2-char tech terms (AI, ML, Go, JS) in scoring", () => {
    const resultA = { title: "AI search agents overview", description: "How AI works", url: "https://a.com" };
    const resultB = { title: "Database indexing", description: "B-tree structures", url: "https://b.com" };
    const out = rerankResults([resultB, resultA], "AI search");
    expect(out[0]).toEqual(resultA);
  });

  it("handles results with missing title and snippet fields gracefully", () => {
    const results = [
      { url: "https://a.com" },
      { title: "Python", url: "https://b.com" },
    ];
    expect(() => rerankResults(results, "python")).not.toThrow();
    const out = rerankResults(results, "python");
    // Result with title "Python" should rank first
    expect(out[0]).toEqual({ title: "Python", url: "https://b.com" });
  });
});
