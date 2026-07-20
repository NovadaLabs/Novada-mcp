/**
 * Unit test for the release-acceptance live-smoke classifier.
 *
 * The live smoke gate must distinguish OUR integration breaking (wire_fail → block the
 * release) from the TARGET site being flaky (flake → report, retry, never block). Getting
 * this wrong in either direction is dangerous: too strict = every Instagram CAPTCHA blocks a
 * release (untrustworthy); too loose = a real bad-scraper_id ships. These assertions pin the
 * boundary using the ACTUAL response strings observed in the 2026-07-20 live run.
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs test-harness module, no type decls (pure string classifier)
import { classify } from "../../scripts/acceptance/classify.mjs";

describe("live-smoke classify() — three-way", () => {
  it("PASS: real success shapes are accepted", () => {
    expect(classify("## Scrape Results\nplatform: google.com | operation: web_search | records: 9 | source: live")).toBe("pass");
    expect(classify('status: processing\n⏳ Task still running (task_id="a203b31d...") after 45s.')).toBe("pass");
    expect(classify("records: 0")).toBe("pass"); // empty-but-valid is still a valid wire response
  });

  it("WIRE_FAIL: our-integration errors block the release", () => {
    expect(classify("Scraper returned code 11006 for operation 'x'. This means the operation ID is invalid")).toBe("wire_fail");
    expect(classify("10001: Missing required parameters. Check platform and operation fields.")).toBe("wire_fail");
    expect(classify("Unknown platform 'foo.com'. Use the exact domain")).toBe("wire_fail");
    expect(classify("failure_class: auth")).toBe("wire_fail");
    expect(classify("Error: INVALID_API_KEY")).toBe("wire_fail");
  });

  it("FLAKE: target-side transients are NOT wire failures (the exact strings from the live run)", () => {
    expect(classify("Error [API_DOWN]: Scraper collected 1 result(s) but all failed. error_code: 403 — Forbidden - The target page returned a CAPTCHA, login page, or a 503 error")).toBe("flake");
    expect(classify("Error [API_DOWN]: Scraper collected 1 result(s) but all failed. error_code: unknown — 520 Other Errors - Other undefined errors.")).toBe("flake");
    expect(classify("Scraper API error (HTTP undefined): undefined")).toBe("flake");
    expect(classify("timeout after 90000ms")).toBe("flake");
  });

  it("boundary: a target 403 must NOT be mistaken for an auth (our-key) failure", () => {
    // target-site 403/Forbidden = the site blocked the scraper; NOT our API key being invalid.
    const targetForbidden = "Error [API_DOWN]: error_code: 403 — Forbidden - The target page returned a CAPTCHA";
    expect(classify(targetForbidden)).toBe("flake");
    expect(classify(targetForbidden)).not.toBe("wire_fail");
  });
});
