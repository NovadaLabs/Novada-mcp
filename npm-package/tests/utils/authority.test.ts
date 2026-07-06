import { describe, it, expect } from "vitest";
import { detectIntent } from "../../src/utils/authority.js";

describe("detectIntent — NOV-574 word-boundary guard", () => {
  // NOV-574 regression: a FACTUAL query that merely CONTAINS a social-platform token as an
  // in-word SUBSTRING must classify as "factual", never "social". detectIntent tokenizes on
  // whitespace and matches social/factual terms as whole tokens, so "thread"/"threads" inside
  // "threadbare" must NOT trip the social branch — the factual whole-words ("revenue", "filing")
  // win instead. Before the guard, a naive substring scan would have mis-flagged this as social
  // and (via authorityAdjustment) down-ranked the very authoritative sources the query wants.
  it("factual query with a social token only as a substring classifies factual, not social", () => {
    // "threadbare" embeds the social token "thread"/"threads"; "revenue"/"filing" are factual.
    expect(detectIntent("threadbare budget revenue filing")).toBe("factual");
  });

  it("'profiled revenue stock earnings' classifies factual ('profile' embedded in 'profiled')", () => {
    // "profiled" embeds the social token "profile"; the surrounding terms are all factual.
    expect(detectIntent("profiled revenue stock earnings")).toBe("factual");
  });

  it("a social token as a substring never yields social on its own (stockX example)", () => {
    // The task's example: a non-social, non-factual query must NOT be classified social just
    // because a platform-like fragment ("stockX") appears. No whole-word factual/social token
    // is present, so it falls through to "default" — and critically is NOT "social".
    expect(detectIntent("stockX sneaker resale price")).not.toBe("social");
    expect(detectIntent("stockX sneaker resale price")).toBe("default");
  });

  it("a real whole-word factual token still classifies factual", () => {
    expect(detectIntent("AAPL quarterly earnings revenue")).toBe("factual");
  });

  it("negative control: a genuine whole-word social token still classifies social", () => {
    // The guard must not over-correct: a real "profile" token (whole word) is still social,
    // so social/UGC results the user explicitly asked for are not penalized.
    expect(detectIntent("earnings profile of the company")).toBe("social");
  });

  it("punctuation-trimmed factual token still matches ('earnings.' / 'stock?')", () => {
    expect(detectIntent("what are the earnings.")).toBe("factual");
    expect(detectIntent("is this a good stock?")).toBe("factual");
  });

  it("empty/undefined query is default", () => {
    expect(detectIntent(undefined)).toBe("default");
    expect(detectIntent("")).toBe("default");
  });
});
