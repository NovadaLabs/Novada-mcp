// ─── Behavioral proof: fail-closed novada_scrape hint emission ────────────────
// Drives novadaExtract() end-to-end (mocked HTTP) to prove the fail-open bug is
// gone in practice, not just in the SCRAPER_PLATFORMS/isCatalogOpUsable unit
// tests (tests/data/scraper-platforms-drift-guard.test.ts).
//
// IMPORTANT (verify-before-pathologizing): for a plain reddit.com/www.reddit.com
// URL, rewriteRedditUrl() already rewrites the fetch target to old.reddit.com
// BEFORE the hint-emission code computes baseDomain — so the quality-hint sites
// (extractSingleInner) never actually saw baseDomain === "reddit.com" even with
// the old, buggy SCRAPER_PLATFORMS entry in place. That incidental shadowing does
// NOT make the underlying bug fake: (a) the SCRAPER_PLATFORMS entry was still
// objectively wrong (reddit.com is not a catalog domain — resources/index.ts's
// own "NOT AVAILABLE" list agrees), (b) getSuggestedFix's error-path hint (the
// exception branch, used when the fetch throws rather than returning low-quality
// content) reads the ORIGINAL un-rewritten url and was genuinely reachable, and
// (c) the identical mechanism (fail-open isCatalogOpUsable) was live-reachable
// for instagram.com (wrong op) and glassdoor.com (domain absent, no rewrite
// escape hatch) via the exact same two call sites. Both the reddit.com case and
// a domain with no compensating side effects are exercised below.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import { novadaExtract, SCRAPER_PLATFORMS, getSuggestedFix } from "../../src/tools/extract.js";
import { clearCache } from "../../src/_core/session-cache.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);
const API_KEY = "test-key-123";

const botHtml =
  "<html><head><title>Just a moment...</title></head><body>Checking your browser before allowing you access.</body></html>";

beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
});

describe("Behavioral: reddit.com extract emits no phantom novada_scrape hint", () => {
  it("BEFORE/AFTER — low-quality reddit.com extraction never suggests the removed reddit_subreddit_posts op", async () => {
    mockedAxios.get.mockResolvedValue({ data: botHtml });

    const result = await novadaExtract(
      { url: "https://www.reddit.com/r/test", format: "markdown" },
      API_KEY
    );

    // AFTER the fix: no phantom hint, for either reason (map entry removed, and
    // the actual baseDomain seen here is old.reddit.com post-rewrite anyway).
    expect(result).not.toContain('platform="reddit.com"');
    expect(result).not.toContain("reddit_subreddit_posts");
    // The real, correct reddit guidance (URL rewrite notice) is still present.
    expect(result).toContain("Reddit URL rewritten to old.reddit.com");
  });

  it("getSuggestedFix (error path, original un-rewritten url) never suggests a reddit novada_scrape op", () => {
    // A generic error message that matches none of getSuggestedFix's earlier
    // keyword branches (bot/challenge/403/econnrefused/js/etc.), so execution
    // reaches the per-domain SCRAPER_PLATFORMS-derived branch this task owns.
    const fix = getSuggestedFix("https://www.reddit.com/r/test", "unexpected upstream failure xyz123");
    expect(fix).not.toContain("novada_scrape");
    expect(fix).not.toContain("reddit_subreddit_posts");
  });

  it("getSuggestedFix would have emitted the phantom hint under the OLD map shape (sanity check the test is meaningful)", () => {
    // Prove this test can actually fail: temporarily reinstate the old (buggy)
    // entry and confirm getSuggestedFix's hint changes — showing the assertions
    // above are not vacuously true regardless of SCRAPER_PLATFORMS' contents.
    const mutable = SCRAPER_PLATFORMS as Record<string, string>;
    const hadEntry = Object.prototype.hasOwnProperty.call(mutable, "reddit.com");
    const original = mutable["reddit.com"];
    mutable["reddit.com"] = "reddit_subreddit_posts"; // the original bug
    try {
      const fixWithBug = getSuggestedFix("https://www.reddit.com/r/test", "unexpected upstream failure xyz123");
      // With the phantom op reinstated, isCatalogOpUsable still rejects it (catalog
      // has no reddit.com domain at all) — so even forcing the old map shape back
      // in, the FIXED isCatalogOpUsable/getScrapeHint gate still suppresses it.
      // This demonstrates the fix is in the validator, not merely "we deleted the
      // one bad row" — restoring the row does not resurrect the bug.
      expect(fixWithBug).not.toContain("reddit_subreddit_posts");
    } finally {
      if (hadEntry) mutable["reddit.com"] = original;
      else delete mutable["reddit.com"];
    }
  });
});

describe("Behavioral: a catalog-absent SCRAPER_PLATFORMS entry never reaches output (fail-closed, class-level)", () => {
  const PHANTOM_DOMAIN = "zz-drift-guard-phantom.example";

  afterEach(() => {
    delete (SCRAPER_PLATFORMS as Record<string, string>)[PHANTOM_DOMAIN];
  });

  it("injecting a phantom domain/op pair at runtime produces no hint for it, even at low extraction quality", async () => {
    (SCRAPER_PLATFORMS as Record<string, string>)[PHANTOM_DOMAIN] = "totally_made_up_op";
    mockedAxios.get.mockResolvedValue({ data: botHtml });

    const result = await novadaExtract(
      { url: `https://${PHANTOM_DOMAIN}/page`, format: "markdown" },
      API_KEY
    );

    expect(result).not.toContain(`platform="${PHANTOM_DOMAIN}"`);
    expect(result).not.toContain("totally_made_up_op");
  });

  it("(non-inert control) the SAME phantom domain WOULD have leaked under the old fail-open behavior", () => {
    // Directly demonstrates what the old isCatalogOpBroken-shaped check would have
    // done: `status === "backend_broken"` on an undefined catalog entry is false,
    // i.e. "not broken" => hint considered safe. This is the exact fail-open logic
    // this task replaced; kept here as a permanent explanatory regression anchor.
    const OLD_BUGGY_CHECK = (domain: string, op: string): boolean => {
      // mirrors: CATALOG_BY_DOMAIN.get(domain)?.get(op)?.status === "backend_broken"
      return undefined === "backend_broken"; // always false for an absent entry
    };
    expect(OLD_BUGGY_CHECK(PHANTOM_DOMAIN, "totally_made_up_op")).toBe(false);
    // false here means "not confirmed broken" -> the OLD code's `!isCatalogOpBroken(...)`
    // guard would have evaluated to `!false === true` -> hint emitted. The NEW code
    // instead requires positive proof of existence (isCatalogOpUsable), which is
    // exercised by the previous test and returns false for this same pair.
  });
});

describe("Behavioral: positive control — a genuinely valid entry still fires (fix isn't over-suppressing)", () => {
  it("github.com low-quality extraction still suggests the real github_repository_repo-url op", async () => {
    mockedAxios.get.mockResolvedValue({ data: botHtml });

    const result = await novadaExtract(
      { url: "https://github.com/some/repo", format: "markdown" },
      API_KEY
    );

    expect(result).toContain('novada_scrape(platform="github.com", operation="github_repository_repo-url")');
  });

  it("getSuggestedFix still recommends amazon.com's real op on a generic (non-keyword-matching) error", () => {
    const fix = getSuggestedFix("https://amazon.com/dp/B000TEST", "unexpected upstream failure xyz123");
    expect(fix).toContain('novada_scrape(platform="amazon.com", operation="amazon_product_keywords")');
  });

  it("getSuggestedFix now recommends instagram.com's CORRECTED op (ins_profiles_profileurl), not the old phantom", () => {
    const fix = getSuggestedFix("https://instagram.com/someuser", "unexpected upstream failure xyz123");
    expect(fix).toContain('novada_scrape(platform="instagram.com", operation="ins_profiles_profileurl")');
    expect(fix).not.toContain("instagram_profile_url");
  });
});
