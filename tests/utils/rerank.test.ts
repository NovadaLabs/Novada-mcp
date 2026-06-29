import { describe, it, expect } from "vitest";
import { rerankResults } from "../../src/utils/rerank.js";
import { detectIntent, classifyAuthority } from "../../src/utils/authority.js";

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

  // ─── NOV-567: domain-authority signal (intent-gated, bounded) ───────────────

  it("factual intent: authoritative source outranks PR wire at equal keyword score", () => {
    // Identical title+snippet keyword match → only the URL authority differs.
    const reuters = { title: "Acme earnings report", description: "Acme posted Q3 earnings", url: "https://www.reuters.com/markets/acme" };
    const pr = { title: "Acme earnings report", description: "Acme posted Q3 earnings", url: "https://www.prnewswire.com/news/acme" };
    const out = rerankResults([pr, reuters], "acme earnings report", "factual");
    expect(out[0]).toEqual(reuters);
    expect(out[1]).toEqual(pr);
  });

  it("social intent: social domains are NOT penalized (target of the query)", () => {
    // Under social intent, a reddit result tied on keywords keeps its original
    // position relative to a neutral result — no down-rank applied.
    const reddit = { title: "best mechanical keyboard", description: "thread discussion", url: "https://www.reddit.com/r/keyboards/x" };
    const blog = { title: "best mechanical keyboard", description: "thread discussion", url: "https://example.com/post" };
    const out = rerankResults([reddit, blog], "best mechanical keyboard reddit thread", "social");
    // Equal keyword score + zero authority delta → stable order preserves reddit first.
    expect(out[0]).toEqual(reddit);
  });

  it("factual intent does not override a genuine title-match delta", () => {
    // PR wire with the keyword in the TITLE must still beat an authoritative
    // source that only matches in the snippet — authority is a nudge, not a veto.
    const prTitleMatch = { title: "Acme revenue soars", description: "company update", url: "https://www.businesswire.com/acme" };
    const govSnippetOnly = { title: "Quarterly filings index", description: "Acme revenue figures listed here", url: "https://www.sec.gov/cgi-bin/acme" };
    const out = rerankResults([govSnippetOnly, prTitleMatch], "acme revenue", "factual");
    expect(out[0]).toEqual(prTitleMatch);
  });

  it("missing/invalid url does not crash with authority scoring enabled", () => {
    const results = [
      { title: "Acme earnings", description: "report" },           // no url at all
      { title: "Acme earnings", description: "report", url: "not a url" }, // unparseable
      { title: "Acme earnings", description: "report", url: "https://www.reuters.com/x" },
    ];
    expect(() => rerankResults(results, "acme earnings", "factual")).not.toThrow();
    const out = rerankResults(results, "acme earnings", "factual");
    // Authoritative result floats to the top; the others (neutral) stay below.
    expect(out[0]).toEqual({ title: "Acme earnings", description: "report", url: "https://www.reuters.com/x" });
  });

  it("default intent applies only a mild authority nudge (ties broken, deltas preserved)", () => {
    const wiki = { title: "Widget", description: "info", url: "https://en.wikipedia.org/wiki/Widget" };
    const social = { title: "Widget", description: "info", url: "https://www.facebook.com/widget" };
    // Equal keyword score; mild default nudge surfaces the authoritative source.
    const out = rerankResults([social, wiki], "widget");
    expect(out[0]).toEqual(wiki);
  });
});

describe("detectIntent", () => {
  it("classifies finance/research queries as factual", () => {
    expect(detectIntent("AAPL quarterly earnings revenue")).toBe("factual");
    expect(detectIntent("Tesla SEC 10-K filing")).toBe("factual");
    expect(detectIntent("phase 3 clinical trial results study")).toBe("factual");
  });

  it("classifies social/navigational queries as social", () => {
    expect(detectIntent("elon musk twitter")).toBe("social");
    expect(detectIntent("best laptops reddit thread")).toBe("social");
    expect(detectIntent("john doe linkedin profile")).toBe("social");
  });

  it("falls back to default for generic queries", () => {
    expect(detectIntent("how to bake sourdough bread")).toBe("default");
    expect(detectIntent("")).toBe("default");
    expect(detectIntent(undefined)).toBe("default");
  });

  it("social term wins over factual term when both present", () => {
    // "reddit" (social) co-occurs with "stock" (factual) → social wins so we
    // never penalize the reddit results the user explicitly asked for.
    expect(detectIntent("best stock picks reddit")).toBe("social");
  });
});

describe("classifyAuthority", () => {
  it("recognizes TLD-group suffixes and seeded authoritative domains", () => {
    expect(classifyAuthority("https://www.whitehouse.gov/")).toBe("authoritative");
    expect(classifyAuthority("https://cs.stanford.edu/page")).toBe("authoritative");
    expect(classifyAuthority("https://www.reuters.com/markets")).toBe("authoritative");
    expect(classifyAuthority("https://en.wikipedia.org/wiki/X")).toBe("authoritative");
    expect(classifyAuthority("https://www.sec.gov/x")).toBe("authoritative");
  });

  it("recognizes social/PR domains incl. subdomains", () => {
    expect(classifyAuthority("https://m.facebook.com/x")).toBe("social");
    expect(classifyAuthority("https://www.prnewswire.com/news")).toBe("social");
    expect(classifyAuthority("https://twitter.com/x")).toBe("social");
  });

  it("returns neutral for unknown or invalid urls", () => {
    expect(classifyAuthority("https://example.com/x")).toBe("neutral");
    expect(classifyAuthority("not a url")).toBe("neutral");
    expect(classifyAuthority(undefined)).toBe("neutral");
  });
});
