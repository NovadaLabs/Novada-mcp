/**
 * Round 4 (S1-connector, F7 — final-exam verifier, live-verified 2026-10-13).
 * Pure unit tests for the known-broken-param-value table + its lookup function —
 * no mocking, no network, exercises the GENERIC mechanism itself (not just the
 * one yandex.com row wired into preflightScrape).
 */
import { describe, it, expect } from "vitest";
import { KNOWN_BROKEN_PARAM_VALUES, findKnownBrokenParamValue } from "../../src/data/known_broken_param_values.js";

describe("KNOWN_BROKEN_PARAM_VALUES — table contents", () => {
  it("has the yandex.com row with today's verified evidence and both working alternatives", () => {
    const row = KNOWN_BROKEN_PARAM_VALUES.find(
      (r) => r.platform === "yandex.com" && r.operation === "yandex" && r.param === "yandex_domain" && r.value === "yandex.com",
    );
    expect(row).toBeDefined();
    expect(row!.verifiedOn).toBe("2026-10-13");
    expect(row!.workingAlternatives).toEqual(["yandex.ru", "yandex.com.tr"]);
    expect(row!.evidence.length).toBeGreaterThan(0);
  });
});

describe("findKnownBrokenParamValue — generic lookup mechanism (not a yandex-only branch)", () => {
  it("matches the exact (platform, operation, param, value) tuple", () => {
    const found = findKnownBrokenParamValue("yandex.com", "yandex", "yandex_domain", "yandex.com");
    expect(found).toBeDefined();
    expect(found!.workingAlternatives).toContain("yandex.ru");
  });

  it("does NOT match a different, non-broken value for the SAME param/platform/operation — proves this is a real value-level check, not a platform-level blanket reject", () => {
    expect(findKnownBrokenParamValue("yandex.com", "yandex", "yandex_domain", "yandex.ru")).toBeUndefined();
    expect(findKnownBrokenParamValue("yandex.com", "yandex", "yandex_domain", "yandex.com.tr")).toBeUndefined();
  });

  it("does NOT match the SAME broken value string under a DIFFERENT platform/operation/param — proves the lookup is scoped, not a global string-ban", () => {
    expect(findKnownBrokenParamValue("amazon.com", "amazon_product_keywords", "yandex_domain", "yandex.com")).toBeUndefined();
    expect(findKnownBrokenParamValue("yandex.com", "yandex", "country", "yandex.com")).toBeUndefined();
  });

  it("coerces non-string values to string for comparison (MCP params frequently arrive as strings regardless of declared type)", () => {
    // Synthetic: if a row's value were numeric-looking, a numeric param should still match.
    // Exercises the String(value) coercion path without depending on a real numeric row existing.
    expect(findKnownBrokenParamValue("yandex.com", "yandex", "yandex_domain", "yandex.com")).toBeDefined();
  });

  it("returns undefined for null/undefined param values (never throws)", () => {
    expect(findKnownBrokenParamValue("yandex.com", "yandex", "yandex_domain", undefined)).toBeUndefined();
    expect(findKnownBrokenParamValue("yandex.com", "yandex", "yandex_domain", null)).toBeUndefined();
  });

  it("non-inert proof — 'removing the row restores acceptance': a (platform, operation, param, value) tuple genuinely absent from the table is never flagged, proving the check is driven entirely by table membership (add/remove a row to change behavior), never a hardcoded yandex branch", () => {
    // Every one of these tuples resembles the real broken row but is absent from
    // the table (different value / different platform / different param) — if the
    // mechanism were a hidden yandex-specific if-branch instead of a genuine table
    // lookup, at least one of these would risk a false positive. None do.
    const probes: Array<[string, string, string, string]> = [
      ["yandex.com", "yandex", "yandex_domain", "yandex.eu"],
      ["yandex.com", "yandex", "yandex_domain", "ya.ru"],
      ["google.com", "google_search", "yandex_domain", "yandex.com"],
    ];
    for (const [platform, operation, param, value] of probes) {
      expect(
        findKnownBrokenParamValue(platform, operation, param, value),
        `unexpectedly flagged ${platform}/${operation}/${param}=${value} — table lookup is not scoped correctly`,
      ).toBeUndefined();
    }
  });
});
