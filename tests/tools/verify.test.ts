import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NovadaSearchResult } from "../../src/tools/types.js";

// Mock the search module boundary that verify.ts actually depends on.
// This lets us drive verify's verdict logic with controlled result sets, instead
// of replaying the exact upstream axios body shape (which the old tests got wrong,
// causing every case to silently collapse to "Verify Unavailable").
vi.mock("../../src/tools/search.js", () => ({
  submitSearchScrapeTask: vi.fn(),
  resolveSearchResults: vi.fn(),
}));

import { novadaVerify } from "../../src/tools/verify.js";
import { submitSearchScrapeTask, resolveSearchResults } from "../../src/tools/search.js";

const mockedSubmit = vi.mocked(submitSearchScrapeTask);
const mockedResolve = vi.mocked(resolveSearchResults);

const API_KEY = "test-key-123";

beforeEach(() => {
  vi.clearAllMocks();
  // submit just returns a sentinel; resolve is what carries the per-query results.
  mockedSubmit.mockResolvedValue({ inlineResults: {} } as never);
});

/**
 * Drive the 3 queries (supporting, skeptical, neutral) in order. verify.ts calls
 * runSearchQuery in a fixed order via Promise.allSettled over [supporting, skeptical, neutral].
 */
function mockQueries(supporting: NovadaSearchResult[], skeptical: NovadaSearchResult[], neutral: NovadaSearchResult[]) {
  mockedResolve
    .mockResolvedValueOnce(supporting)
    .mockResolvedValueOnce(skeptical)
    .mockResolvedValueOnce(neutral);
}

/** Relevant source mentioning the given term, with optional dispute language. */
function src(title: string, description: string, urlSuffix: string): NovadaSearchResult {
  return {
    title,
    description,
    url: `https://example.com/${urlSuffix}`,
    link: `https://example.com/${urlSuffix}`,
  };
}

function getVerdict(out: string): string {
  return out.match(/verdict:\s*(\w+)/)?.[1] ?? "";
}
function getConfidence(out: string): number {
  return parseInt(out.match(/confidence:\s*(\d+)/)?.[1] ?? "-1", 10);
}

describe("novadaVerify", () => {
  it("returns supported only with multiple independent RELEVANT sources and no refutation", async () => {
    mockQueries(
      [
        src("Eiffel Tower height", "The Eiffel Tower in Paris is 330 meters tall.", "a"),
        src("Tower facts", "Paris landmark Eiffel reaches 330 meters.", "b"),
      ],
      [], // no skeptical/contradicting
      [src("Fact check Eiffel", "Confirmed: Eiffel Tower is 330 meters.", "c")],
    );

    const out = await novadaVerify({ claim: "The Eiffel Tower in Paris is 330 meters tall" }, API_KEY);
    expect(getVerdict(out)).toBe("supported");
    expect(out).toContain("## Claim Verification");
    expect(out).toContain("## Supporting Evidence");
    expect(out).toContain("## Contradicting Evidence");
    expect(out).toContain("## Agent Hints");
  });

  it("FALSE claim must NOT be 'supported' — refutation present yields unsupported/contested", async () => {
    // Supporting query happens to return co-occurring (relevant) snippets, but the
    // skeptical query returns sources that actively refute with dispute markers.
    mockQueries(
      [src("Flat earth forums", "Some people claim the earth is flat.", "f1")],
      [
        src("Earth is round", "The flat earth claim is false and has been debunked.", "f2"),
        src("Debunking flat earth", "No evidence the earth is flat; it is a myth.", "f3"),
        src("Science vs flat earth", "The earth is not flat — this is misinformation.", "f4"),
      ],
      [src("Fact check flat earth", "False: the earth is not flat.", "f5")],
    );

    const out = await novadaVerify({ claim: "The Earth is flat and does not orbit the Sun" }, API_KEY);
    expect(getVerdict(out)).not.toBe("supported");
    expect(["unsupported", "contested"]).toContain(getVerdict(out));
    expect(getConfidence(out)).not.toBe(100);
  });

  it("GIBBERISH / uncheckable claim must NOT be 'supported' — returns insufficient_data", async () => {
    // Search returns generic unrelated results that do NOT mention the nonsense terms.
    const noise = [
      src("Some article", "A generic page about cooking recipes and travel.", "g1"),
      src("Another page", "Latest news about technology and finance.", "g2"),
    ];
    mockQueries(noise, noise, noise);

    const out = await novadaVerify(
      { claim: "Florble wizzbang quux meeple snarf zibblefratz" },
      API_KEY,
    );
    expect(getVerdict(out)).toBe("insufficient_data");
    expect(getVerdict(out)).not.toBe("supported");
    expect(getConfidence(out)).toBe(0);
  });

  it("keyword overlap in UNRELATED snippets does NOT yield supported (relevance gate)", async () => {
    // All "supporting" results are returned by the query but none mention the claim's
    // key terms — they're unrelated pages. Must NOT be supported.
    const unrelated = [
      src("Stock market today", "The S&P 500 rose 2% amid earnings reports.", "u1"),
      src("Weather forecast", "Rain expected across the region this weekend.", "u2"),
      src("Recipe of the day", "How to bake sourdough bread at home.", "u3"),
    ];
    mockQueries(unrelated, [], unrelated);

    const out = await novadaVerify(
      { claim: "Quantum entanglement enables faster-than-light communication" },
      API_KEY,
    );
    expect(getVerdict(out)).not.toBe("supported");
    expect(getVerdict(out)).toBe("insufficient_data");
  });

  it("a single relevant supporting source is not enough for 'supported'", async () => {
    mockQueries(
      [src("Lone source", "Pangolins are the most trafficked mammal in the world.", "s1")],
      [],
      [],
    );

    const out = await novadaVerify(
      { claim: "Pangolins are the most trafficked mammal in the world" },
      API_KEY,
    );
    // Only one relevant source, no refutation → honest "insufficient_data", not "supported".
    expect(getVerdict(out)).not.toBe("supported");
    expect(getVerdict(out)).toBe("insufficient_data");
  });

  it("returns unsupported when refuting sources dominate", async () => {
    mockQueries(
      [],
      [
        src("Vaccines and autism", "The vaccine-autism claim is false and debunked.", "v1"),
        src("No link found", "No evidence vaccines cause autism; the study was fabricated.", "v2"),
      ],
      [src("Fact check", "False: vaccines do not cause autism.", "v3")],
    );

    const out = await novadaVerify({ claim: "Vaccines cause autism in children" }, API_KEY);
    expect(getVerdict(out)).toBe("unsupported");
    expect(getConfidence(out)).not.toBe(100);
  });

  it("returns contested when relevant support and refutation coexist", async () => {
    mockQueries(
      [
        src("Coffee benefits", "Studies suggest coffee is healthier than tea for adults.", "c1"),
        src("Coffee study", "Coffee shows more antioxidant benefit than tea.", "c2"),
      ],
      [
        src("Coffee myth", "The claim coffee is healthier than tea is misleading and not true.", "c3"),
        src("Tea wins", "No evidence coffee beats tea; that is misinformation.", "c4"),
      ],
      [],
    );

    const out = await novadaVerify(
      { claim: "Coffee is healthier than tea for most adults" },
      API_KEY,
    );
    expect(getVerdict(out)).toBe("contested");
  });

  it("never reports confidence 100 even for strong one-sided support", async () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      src(`Photosynthesis ${i}`, "Plants use photosynthesis to convert sunlight into energy.", `p${i}`),
    );
    mockQueries(many, [], many);

    const out = await novadaVerify(
      { claim: "Plants use photosynthesis to convert sunlight into energy" },
      API_KEY,
    );
    expect(getVerdict(out)).toBe("supported");
    expect(getConfidence(out)).toBeLessThanOrEqual(85);
    expect(getConfidence(out)).not.toBe(100);
  });

  it("returns insufficient_data when all queries return 0 results (relevance + emptiness)", async () => {
    mockQueries([], [], []);
    const out = await novadaVerify(
      { claim: "A completely obscure and unverifiable statement about widgets" },
      API_KEY,
    );
    // Empty but not failed → genuine insufficient_data (not the activation branch).
    expect(getVerdict(out)).toBe("insufficient_data");
    expect(getConfidence(out)).toBe(0);
  });

  it("handles full search unavailability (all queries throw) with activation guidance", async () => {
    mockedResolve.mockRejectedValue(new Error("Scraper API server error"));
    const out = await novadaVerify(
      { claim: "The Eiffel Tower is in Paris, France" },
      API_KEY,
    );
    expect(out).toContain("Verify Unavailable");
    expect(out).toContain("activate_scraper_api");
    expect(out).not.toContain("verdict:");
  });

  it("caps confidence at 60 when a key query fails (partial failure)", async () => {
    // Supporting query throws; skeptical returns refuting sources.
    mockedResolve
      .mockRejectedValueOnce(new Error("network error"))    // supporting fails
      .mockResolvedValueOnce([
        src("Great Wall myth", "The claim it is visible from space is false and debunked.", "w1"),
        src("Not visible", "No evidence the Great Wall is visible from space; it is a myth.", "w2"),
      ])                                                      // skeptical
      .mockResolvedValueOnce([]);                             // neutral

    const out = await novadaVerify(
      { claim: "The Great Wall of China is visible from space" },
      API_KEY,
    );
    expect(getVerdict(out)).toBe("unsupported");
    expect(getConfidence(out)).toBeLessThanOrEqual(60);
    expect(out).toContain("one search query failed");
  });

  it("rejects empty claim with a structured error", async () => {
    const out = await novadaVerify({ claim: "   " } as never, API_KEY);
    expect(out).toContain('"verdict":"error"');
  });

  it("runs all 3 queries (resolve called 3 times) with distinct angled queries", async () => {
    mockQueries(
      [src("S", "supporting relevant snippet about gravity", "x1")],
      [src("K", "skeptical relevant snippet about gravity", "x2")],
      [src("N", "neutral relevant snippet about gravity", "x3")],
    );

    await novadaVerify({ claim: "Gravity accelerates objects at 9.8 meters per second squared" }, API_KEY);

    expect(mockedSubmit).toHaveBeenCalledTimes(3);
    expect(mockedResolve).toHaveBeenCalledTimes(3);

    const queries = mockedSubmit.mock.calls.map(c => c[3] as string);
    // Supporting: claim text without debunking terms
    expect(queries.some(q => q.includes("evidence study research") && !q.includes("debunked") && !q.includes("fact check"))).toBe(true);
    // Skeptical: debunk terms
    expect(queries.some(q => q.includes("debunked") || q.includes("refuted") || q.includes("misinformation"))).toBe(true);
    // Neutral: fact check
    expect(queries.some(q => q.includes("fact check"))).toBe(true);
  });
});
