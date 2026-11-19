/**
 * FIX-A (2026-07-30, agent-first extract error path): summarizeAggregateError maps a
 * bare Promise.any() AggregateError (default message: literal "All promises were
 * rejected" — zero actionable content) to a summary of its distinct underlying causes.
 * Pure in-process logic, zero network.
 */

import { describe, it, expect } from "vitest";
import { summarizeAggregateError, serpCaptureFailedHint, isBlockClassFetchFailure, NOT_ESCALATE_STATUSES } from "../../src/_core/errors.js";

/**
 * #41 (2026-11-19, congress.gov/apnews.com repro): isBlockClassFetchFailure must see
 * a status wrapped behind a `.cause` chain, not just inside an AggregateError's
 * `.errors` array — utils/http.ts's fetchViaProxy wraps a failed direct-fetch leg as
 * `new Error("Direct fetch failed: ...", { cause: originalAxiosError })`, and when a
 * DOMAIN_REGISTRY/route-memory-pinned host calls fetchViaProxy directly (no outer
 * Promise.any race), THIS wrapped error — not an AggregateError — is exactly what
 * extract.ts's escalation gate receives. Before the `.cause` traversal fix,
 * collectStatuses/matchesBlockClassNetworkPattern only looked at `.response` and
 * `.errors`, so the real 403 on `.cause.response.status` was invisible and the
 * static→render escalation never fired — live-reproduced on apnews.com even though
 * its DOMAIN_REGISTRY entry predates this fix.
 */
describe("isBlockClassFetchFailure — .cause chain traversal (#41)", () => {
  it("finds a block-class status hidden one level down a .cause chain (the exact fetchViaProxy wrap shape)", () => {
    const original = Object.assign(new Error("Request failed with status code 403"), { response: { status: 403 } });
    const wrapped = Object.assign(
      new Error("Direct fetch failed: Request failed with status code 403. Proxy circuit: unknown"),
      { cause: original }
    );
    expect(isBlockClassFetchFailure(wrapped)).toBe(true);
  });

  it("finds a NOT-escalate status (404) hidden behind .cause too — the fix must not just blanket-escalate everything wrapped", () => {
    const original = Object.assign(new Error("Request failed with status code 404"), { response: { status: 404 } });
    const wrapped = Object.assign(new Error("Direct fetch failed: Request failed with status code 404."), { cause: original });
    // No block-class signal anywhere (404 is NOT in BLOCK_CLASS_STATUSES) and no
    // network pattern matches → isBlockClassFetchFailure stays false, same as a bare
    // 404 today. It is NOT this function's job to positively veto escalation for
    // NOT_ESCALATE_STATUSES — extract.ts's own caller-level checks do that — only to
    // avoid manufacturing a false positive for a status this function has no
    // "actively blocked" evidence for.
    expect(isBlockClassFetchFailure(wrapped)).toBe(false);
    expect(NOT_ESCALATE_STATUSES.has(404)).toBe(true);
  });

  it("finds a status nested inside an AggregateError leg that is ITSELF a .cause-wrapped error (the real congress.gov top-level shape)", () => {
    const directLegStatus403 = Object.assign(new Error("Request failed with status code 403"), { response: { status: 403 } });
    const proxyLegOriginal = Object.assign(new Error("Request failed with status code 403"), { response: { status: 403 } });
    const proxyLegWrapped = Object.assign(
      new Error("Direct fetch failed: Request failed with status code 403. Proxy circuit: unknown"),
      { cause: proxyLegOriginal }
    );
    const agg = new AggregateError([directLegStatus403, proxyLegWrapped], "All promises were rejected");
    expect(isBlockClassFetchFailure(agg)).toBe(true);
  });

  it("a network-pattern match behind .cause (ETIMEDOUT) is also found, not just status codes", () => {
    const original = Object.assign(new Error("connect ETIMEDOUT 1.2.3.4:443"), { code: "ETIMEDOUT" });
    const wrapped = Object.assign(new Error("Direct fetch failed: connect ETIMEDOUT 1.2.3.4:443"), { cause: original });
    expect(isBlockClassFetchFailure(wrapped)).toBe(true);
  });

  it("a cyclic .cause chain does not hang or throw (defensive depth bound)", () => {
    const a: Error & { cause?: unknown } = new Error("a");
    const b: Error & { cause?: unknown } = new Error("b");
    a.cause = b;
    b.cause = a; // cycle
    expect(() => isBlockClassFetchFailure(a)).not.toThrow();
  });

  it("an unclassified error with no status and no .cause still returns false (no over-escalation)", () => {
    expect(isBlockClassFetchFailure(new Error("something unrelated went wrong"))).toBe(false);
  });
});

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
import { isBlockClassFetchFailure, BLOCK_CLASS_STATUSES, NOT_ESCALATE_STATUSES, toolFailure, isToolFailure, stripToolFailureMark } from "../../src/_core/errors.js";

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

// ─── C3 (wave B/C, 2026-11-18): 419/418/420/444 added, 499 excluded ─────────
describe("isBlockClassFetchFailure — C3 nonstandard block-class codes", () => {
  it("419 escalates (live repro: news.ycombinator.com's 'slow down' rate-limit on a plain GET)", () => {
    expect(isBlockClassFetchFailure(axiosLikeError(419))).toBe(true);
  });

  it("499 (nginx client-closed-request) does NOT escalate — it means OUR OWN fetch aborted, not a server block", () => {
    expect(isBlockClassFetchFailure(axiosLikeError(499))).toBe(false);
  });

  it("every C3-added code (418, 419, 420, 444) is a BLOCK_CLASS_STATUSES member and 499 is not", () => {
    expect(BLOCK_CLASS_STATUSES.has(418)).toBe(true);
    expect(BLOCK_CLASS_STATUSES.has(419)).toBe(true);
    expect(BLOCK_CLASS_STATUSES.has(420)).toBe(true);
    expect(BLOCK_CLASS_STATUSES.has(444)).toBe(true);
    expect(BLOCK_CLASS_STATUSES.has(499)).toBe(false);
    expect(NOT_ESCALATE_STATUSES.has(499)).toBe(false); // unclassified, not "genuinely missing" either
  });
});

// ─── F3 (round 5, owner direction): structural toolFailure() marker ──────────
//
// Replaces the deleted textual/heading-table approach entirely (no
// FAILURE_HEADER_LITERALS, no SUCCESS_OR_NEUTRAL_HEADERS, no scanner). A
// failure is marked at its one point of origin via toolFailure(); the
// marker's PRESENCE is the only signal — never the text's wording — so a
// successful result can say literally anything (including the words
// "error", "failed", "unavailable") without ever being misclassified.
describe("toolFailure / isToolFailure / stripToolFailureMark — F3 structural marker", () => {
  it("isToolFailure is true only for text that went through toolFailure()", () => {
    expect(isToolFailure(toolFailure("## Extract Failed\nsomething broke"))).toBe(true);
    expect(isToolFailure("## Extract Failed\nsomething broke")).toBe(false); // never marked
  });

  it("stripToolFailureMark removes the mark and is a no-op on unmarked text", () => {
    const marked = toolFailure("## Extract Failed\nbody");
    expect(stripToolFailureMark(marked)).toBe("## Extract Failed\nbody");
    expect(stripToolFailureMark("plain text")).toBe("plain text");
  });

  it("the mark survives being the FIRST thing in a JSON-formatted failure (monitor.ts's JSON branch) and strips back to valid JSON", () => {
    const json = JSON.stringify({ status: "error", error: "boom" });
    const marked = toolFailure(json);
    expect(isToolFailure(marked)).toBe(true);
    const stripped = stripToolFailureMark(marked);
    expect(() => JSON.parse(stripped)).not.toThrow();
    expect(JSON.parse(stripped)).toEqual({ status: "error", error: "boom" });
  });

  // H1's original bug (rounds 1-4): a word-list/heading-table detector reading
  // TEXT for "error"/"failed"/"unavailable" flips a caller-interpolated
  // success header to isError:true. Structurally impossible now — there is
  // no text inspection at all. Prove it directly: a string that is NOT
  // marked, no matter what it says, is never a failure.
  it.each([
    "## Research: common React error boundary patterns\n\nagent_instruction: status:success",
    "## Extracted Content\nurl: https://example.com/articles/why-extract-failed-is-a-myth\ntitle: Service Unavailable Explained",
    "## Brand Presence on AI-Company Domains — Error Unavailable Failed Inc\n\nSentiment: positive.",
  ])("unmarked text is never a failure regardless of wording: %j", (text) => {
    expect(isToolFailure(text)).toBe(false);
  });

  it("is false-safe on non-string/empty/nullish input", () => {
    expect(isToolFailure("")).toBe(false);
    expect(isToolFailure(undefined)).toBe(false);
    expect(isToolFailure(null)).toBe(false);
    expect(isToolFailure(42)).toBe(false);
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
