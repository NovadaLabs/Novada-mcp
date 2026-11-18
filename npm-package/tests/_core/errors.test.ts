/**
 * FIX-A (2026-07-30, agent-first extract error path): summarizeAggregateError maps a
 * bare Promise.any() AggregateError (default message: literal "All promises were
 * rejected" — zero actionable content) to a summary of its distinct underlying causes.
 * Pure in-process logic, zero network.
 */

import { describe, it, expect } from "vitest";
import { summarizeAggregateError, serpCaptureFailedHint } from "../../src/_core/errors.js";

/**
 * Round 3 (S1-connector, item 3, live-verified 2026-10-13): table-driven unit test for
 * the shared per-platform hint serpCaptureFailedHint() — consumed by BOTH scrape.ts's
 * submitScrapeTask and search.ts's submitSearchScrapeTask for upstream business code
 * 10000 ("serp capture failed"). Pure function, no mocking needed.
 */
describe("serpCaptureFailedHint — per-platform code-10000 hint table", () => {
  it("yandex.com gets the specific, verified regional-TLD fix (yandex.ru / yandex.com.tr), not a generic retry", () => {
    const hint = serpCaptureFailedHint("yandex.com");
    expect(hint).toContain("yandex.ru");
    expect(hint).toContain("yandex.com.tr");
  });

  it("every other mapped search-engine domain (google.com, bing.com, duckduckgo.com) gets SOME actionable hint, not the yandex-specific one", () => {
    for (const domain of ["google.com", "bing.com", "duckduckgo.com"]) {
      const hint = serpCaptureFailedHint(domain);
      expect(hint.length).toBeGreaterThan(0);
      expect(hint).not.toContain("yandex_domain");
    }
  });

  it("an unmapped/arbitrary platform domain falls back to the default generic hint (never throws, never empty)", () => {
    const hint = serpCaptureFailedHint("totally-unmapped-platform.example");
    expect(hint.length).toBeGreaterThan(0);
    expect(hint.toLowerCase()).toContain("retry");
  });
});

describe("summarizeAggregateError", () => {
  it("lists distinct causes (3 causes) and never leaks the raw AggregateError message", () => {
    const agg = new AggregateError(
      [new Error("ECONNREFUSED 1.2.3.4:443"), new Error("ENOTFOUND example.com"), new Error("timeout of 3000ms exceeded")],
      "All promises were rejected"
    );
    const result = summarizeAggregateError(agg);
    expect(result).not.toBeNull();
    expect(result!.message).not.toContain("All promises were rejected");
    expect(result!.message).toContain("All 3 fetch strategies failed");
    expect(result!.causes).toHaveLength(3);
    expect(result!.message).toContain("ECONNREFUSED 1.2.3.4:443");
    expect(result!.message).toContain("ENOTFOUND example.com");
    expect(result!.message).toContain("timeout of 3000ms exceeded");
  });

  it("handles a single-cause aggregate", () => {
    const agg = new AggregateError([new Error("ECONNREFUSED 1.2.3.4:443")], "All promises were rejected");
    const result = summarizeAggregateError(agg);
    expect(result).not.toBeNull();
    expect(result!.causes).toEqual(["ECONNREFUSED 1.2.3.4:443"]);
    expect(result!.message).toBe("All 1 fetch strategies failed: ECONNREFUSED 1.2.3.4:443");
  });

  it("dedupes identical causes and caps at the first 3 distinct causes", () => {
    const agg = new AggregateError(
      [
        new Error("ECONNREFUSED"),
        new Error("ECONNREFUSED"), // duplicate — must be deduped
        new Error("cause-2"),
        new Error("cause-3"),
        new Error("cause-4"), // beyond the cap — must be dropped
      ],
      "All promises were rejected"
    );
    const result = summarizeAggregateError(agg);
    expect(result).not.toBeNull();
    expect(result!.causes).toEqual(["ECONNREFUSED", "cause-2", "cause-3"]);
    expect(result!.message).not.toContain("cause-4");
    // Total count in the message reflects the real error count, not the capped list.
    expect(result!.message).toContain("All 5 fetch strategies failed");
  });

  it("truncates an individual cause longer than ~120 chars", () => {
    const longMsg = "x".repeat(200);
    const agg = new AggregateError([new Error(longMsg)], "All promises were rejected");
    const result = summarizeAggregateError(agg);
    expect(result).not.toBeNull();
    expect(result!.causes[0].length).toBeLessThanOrEqual(120);
    expect(result!.causes[0].endsWith("…")).toBe(true);
  });

  it("collapses embedded newlines in a cause to a single line", () => {
    const agg = new AggregateError([new Error("line1\nline2\r\nline3")], "All promises were rejected");
    const result = summarizeAggregateError(agg);
    expect(result).not.toBeNull();
    expect(result!.causes[0]).not.toContain("\n");
    expect(result!.causes[0]).toContain("line1 line2 line3");
  });

  // Review round 1 (2026-07-30, CRITICAL, same class as errors.test.ts's
  // sanitizeServerMsg/toAgentString fix): U+2028/U+2029 are ECMA-262 line
  // terminators too, not just \r\n. A cause's message could otherwise smuggle
  // one past the old `[\r\n]`-only collapse, then land — uncollapsed — in the
  // combined `message` this function returns, which itself gets embedded in a
  // NovadaError.message and ultimately in toAgentString()'s output ahead of
  // the real agent_instruction line.
  it.each([
    ["U+2028 (LINE SEPARATOR)", "\u2028"],
    ["U+2029 (PARAGRAPH SEPARATOR)", "\u2029"],
  ])("collapses an embedded %s in a cause to a single line", (_label, sep) => {
    const agg = new AggregateError([new Error(`line1${sep}line2${sep}line3`)], "All promises were rejected");
    const result = summarizeAggregateError(agg);
    expect(result).not.toBeNull();
    expect(result!.causes[0]).not.toMatch(/[\r\n\u2028\u2029]/);
    expect(result!.causes[0]).toBe("line1 line2 line3");
  });

  it("returns null for a plain (non-aggregate) Error", () => {
    expect(summarizeAggregateError(new Error("plain failure"))).toBeNull();
  });

  it("returns null for a non-Error value", () => {
    expect(summarizeAggregateError("just a string")).toBeNull();
    expect(summarizeAggregateError(null)).toBeNull();
    expect(summarizeAggregateError(undefined)).toBeNull();
    expect(summarizeAggregateError(42)).toBeNull();
  });

  it("degrades to null (never throws) for a duck-typed aggregate with an empty errors array", () => {
    const fakeAgg = { message: "All promises were rejected", errors: [] };
    expect(() => summarizeAggregateError(fakeAgg)).not.toThrow();
    expect(summarizeAggregateError(fakeAgg)).toBeNull();
  });

  it("degrades to null (never throws) when `errors` is present but not an array", () => {
    const malformed = { message: "All promises were rejected", errors: "not-an-array" };
    expect(() => summarizeAggregateError(malformed)).not.toThrow();
    expect(summarizeAggregateError(malformed)).toBeNull();
  });

  it("degrades to null (never throws) when reading a property throws (pathological getter)", () => {
    const hostile = {
      message: "All promises were rejected",
      get errors(): unknown[] {
        throw new Error("getter exploded");
      },
    };
    expect(() => summarizeAggregateError(hostile)).not.toThrow();
    expect(summarizeAggregateError(hostile)).toBeNull();
  });

  it("accepts a duck-typed cross-realm AggregateError-shaped object (not instanceof AggregateError)", () => {
    const duckTyped = { name: "AggregateError", message: "All promises were rejected", errors: [new Error("cross-realm cause")] };
    const result = summarizeAggregateError(duckTyped);
    expect(result).not.toBeNull();
    expect(result!.causes).toEqual(["cross-realm cause"]);
  });
});

// ─── F2 (2026-11-18 reliability fix wave): block-class fetch-failure classifier ──
import { isBlockClassFetchFailure, BLOCK_CLASS_STATUSES, NOT_ESCALATE_STATUSES, looksLikeFailureEnvelope } from "../../src/_core/errors.js";

function axiosLikeError(status: number): unknown {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status },
  });
}

describe("isBlockClassFetchFailure — F2 escalation discriminator", () => {
  it.each([...BLOCK_CLASS_STATUSES])("status %i escalates (block-class)", (status) => {
    expect(isBlockClassFetchFailure(axiosLikeError(status))).toBe(true);
  });

  it.each([...NOT_ESCALATE_STATUSES])("status %i does NOT escalate (genuinely missing/unauthorized)", (status) => {
    expect(isBlockClassFetchFailure(axiosLikeError(status))).toBe(false);
  });

  it("escalates when the status is buried inside an AggregateError's .errors list (the real Promise.any shape)", () => {
    const agg = { name: "AggregateError", message: "All promises were rejected", errors: [axiosLikeError(404), axiosLikeError(403)] };
    expect(isBlockClassFetchFailure(agg)).toBe(true);
  });

  it("does NOT escalate when every leg of an AggregateError is a not-escalate status", () => {
    const agg = { name: "AggregateError", message: "All promises were rejected", errors: [axiosLikeError(404), axiosLikeError(401)] };
    expect(isBlockClassFetchFailure(agg)).toBe(false);
  });

  it.each(["ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "socket hang up"])(
    "network pattern %s escalates even with no HTTP status at all",
    (pattern) => {
      expect(isBlockClassFetchFailure(new Error(`connect ${pattern}`))).toBe(true);
    }
  );

  it("an unclassified error (no status, no recognized network pattern) does NOT escalate — conservative default", () => {
    expect(isBlockClassFetchFailure(new Error("something weird happened"))).toBe(false);
  });

  it("a plain non-error value never throws and returns false", () => {
    expect(isBlockClassFetchFailure(null)).toBe(false);
    expect(isBlockClassFetchFailure(undefined)).toBe(false);
    expect(isBlockClassFetchFailure("just a string")).toBe(false);
  });
});

// ─── F3 (2026-11-18 reliability fix wave): honest-failure-envelope detector ──────
describe("looksLikeFailureEnvelope — F3 honest isError discriminator", () => {
  it.each([
    "## Extract Failed\nurl: https://example.com\n\nError: timeout",
    "## Browser Mode Unavailable\n\nrender=\"browser\" requires NOVADA_BROWSER_WS.",
    "## Extraction Error\n\nsomething went wrong",
    "## Search Unavailable\n\nScraper API not activated.",
    "## Research Unavailable\n\nSearch failed with an account/authorization error.",
    "## Verify Unavailable\n\nCannot verify this claim right now.",
    "## Invalid Parameter \noperation 'x' is not valid",
  ])("flags a known failure header as a failure envelope: %s", (text) => {
    expect(looksLikeFailureEnvelope(text)).toBe(true);
  });

  it.each([
    "## Extracted Content\nurl: https://example.com\nmode: static | quality:ok",
    "## Search Results\n\n1. Example — https://example.com",
    "## Researched source material for: topic\n\n...",
    "## Scrape Results\n\n| field | value |",
    "## Crawl Results\n\n...",
    "## Site Map\n\n...",
    "## Batch Extract Results\n\n...",
  ])("does NOT flag a known success header: %s", (text) => {
    expect(looksLikeFailureEnvelope(text)).toBe(false);
  });

  it("flags a genuine zero-result research failure via its status marker even though its header says 'Incomplete', not Failed/Error/Unavailable", () => {
    const text = [
      "## Research Incomplete",
      "",
      "All search queries returned 0 results.",
      "",
      "## Agent Action",
      "agent_instruction: status:search_temporarily_failed | action: retry_once",
    ].join("\n");
    expect(looksLikeFailureEnvelope(text)).toBe(true);
  });

  it("does NOT flag research's partial-success shape (some sub-queries failed, but material was assembled)", () => {
    const text = [
      "## Researched source material for: topic",
      "",
      "some cited content here",
      "",
      "## Agent Action",
      "agent_instruction: status:partial | requested_depth:deep | resolved_depth:deep | queries:4/6 | sources:5 | material:full | answer_ready:true",
    ].join("\n");
    expect(looksLikeFailureEnvelope(text)).toBe(false);
  });

  it("does NOT flag ordinary content that merely discusses errors/failures in its own body text", () => {
    const text = [
      "## Extracted Content",
      "url: https://example.com/blog/how-we-handle-errors",
      "mode: static | quality:ok (score:80/100) | content_present:true | content_ok:true",
      "",
      "This article explains how our error handling and failure recovery system works.",
      "It discusses common error codes like 404 Not Found and 503 Service Unavailable.",
    ].join("\n");
    expect(looksLikeFailureEnvelope(text)).toBe(false);
  });

  it("is false-safe on non-string/empty input", () => {
    expect(looksLikeFailureEnvelope("")).toBe(false);
    expect(looksLikeFailureEnvelope(undefined)).toBe(false);
    expect(looksLikeFailureEnvelope(null)).toBe(false);
    expect(looksLikeFailureEnvelope(42)).toBe(false);
  });
});

// ─── F3 wiring check — stdio index.ts (mirrors the hosted mcp.ts structural test) ──
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
const __dirnameErrorsTest = fileURLToPath(new URL(".", import.meta.url));
const INDEX_TS = join(__dirnameErrorsTest, "..", "..", "src", "index.ts");

describe("index.ts source: F3 single choke point wiring", () => {
  it("defines applyHonestFailureFlag and wraps the CallToolRequestSchema handler with it", () => {
    const src = readFileSync(INDEX_TS, "utf8");
    assert_match(src, /function applyHonestFailureFlag/);
    const handlerIdx = src.indexOf('this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {');
    expect(handlerIdx).toBeGreaterThanOrEqual(0);
    const handlerOpen = src.slice(handlerIdx, handlerIdx + 600);
    assert_match(handlerOpen, /return applyHonestFailureFlag\(await \(async \(\) => \{/);
  });
});

function assert_match(src: string, re: RegExp) {
  expect(re.test(src)).toBe(true);
}
