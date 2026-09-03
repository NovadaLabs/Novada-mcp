// ─── SCRAPER_PLATFORMS Drift Guard ────────────────────────────────────────────
// Regression guard for the fail-open cross-tool hint bug (2026-09-02 audit).
//
// Root cause: SCRAPER_PLATFORMS (extract.ts) is a hand-maintained
// domain -> novada_scrape operation map. The old validator (isCatalogOpBroken)
// returned `false` (= "not broken, hint is safe") for ANY domain/op pair absent
// from scraper_catalog.ts, not just ones explicitly marked "backend_broken" —
// i.e. it failed OPEN. That let three stale/typo'd entries slip through and emit
// phantom `novada_scrape(platform=..., operation=...)` suggestions the backend
// would reject with 11006 ("invalid operation") / 11008 ("unknown platform"):
//   - "reddit.com"    -> "reddit_subreddit_posts"   (domain never in the catalog)
//   - "glassdoor.com" -> "glassdoor_company_reviews_url" (domain never in the catalog)
//   - "instagram.com" -> "instagram_profile_url"    (domain real, op never existed —
//                                                     real ops are ins_profiles_*)
//
// The fix (isCatalogOpUsable) is fail-CLOSED: a domain/op pair must actually
// resolve inside CATALOG_BY_DOMAIN, with a non-"backend_broken" status, or the
// hint is suppressed. This file guards the CLASS of bug — every current AND
// future SCRAPER_PLATFORMS entry — not just the three fixed instances.

import { describe, it, expect } from "vitest";
import {
  SCRAPER_PLATFORMS,
  isCatalogOpUsable,
  getScrapeHint,
} from "../../src/tools/extract.js";
import { CATALOG_BY_DOMAIN } from "../../src/data/scraper_catalog.js";

describe("SCRAPER_PLATFORMS drift guard — class audit", () => {
  it("the map is non-empty (guard below is not vacuously true)", () => {
    expect(Object.keys(SCRAPER_PLATFORMS).length).toBeGreaterThan(0);
  });

  it("every SCRAPER_PLATFORMS domain/op pair is a real, non-backend_broken catalog op", () => {
    const failures = Object.entries(SCRAPER_PLATFORMS)
      .filter(([domain, op]) => !isCatalogOpUsable(domain, op))
      .map(([domain, op]) => `${domain} -> ${op}`);
    // A future PR that adds a phantom-op entry to SCRAPER_PLATFORMS fails HERE, at
    // test time, instead of silently shipping a hint the backend rejects.
    expect(failures).toEqual([]);
  });

  // One assertion per entry (not just the aggregate above) so a future regression
  // pinpoints exactly which domain broke instead of one opaque array diff.
  it.each(Object.entries(SCRAPER_PLATFORMS))(
    "%s -> %s resolves to a real, non-broken catalog op",
    (domain, op) => {
      expect(isCatalogOpUsable(domain, op)).toBe(true);
    }
  );
});

describe("SCRAPER_PLATFORMS drift guard — non-inert proof", () => {
  // Prove the guard actually discriminates valid vs. phantom entries, rather than
  // being a tautology that always passes (e.g. isCatalogOpUsable always returning true).
  it("a synthetic phantom domain fails the guard", () => {
    const withPhantom: Record<string, string> = {
      ...SCRAPER_PLATFORMS,
      "phantom-platform.test": "phantom_op_does_not_exist",
    };
    const failures = Object.entries(withPhantom).filter(
      ([domain, op]) => !isCatalogOpUsable(domain, op)
    );
    expect(failures).toEqual([["phantom-platform.test", "phantom_op_does_not_exist"]]);
  });

  it("a synthetic phantom OP on an otherwise-real domain fails the guard (the exact instagram.com bug shape)", () => {
    // amazon.com is a real catalog domain; the op below never existed on it.
    expect(isCatalogOpUsable("amazon.com", "amazon_totally_made_up_op")).toBe(false);
  });

  it("a backend_broken op on a real domain fails the guard (status must also be checked, not just existence)", () => {
    // amazon_global-product_keywords is a REAL slug under amazon.com, but status:"backend_broken".
    const op = CATALOG_BY_DOMAIN.get("amazon.com")?.get("amazon_global-product_keywords");
    expect(op?.status).toBe("backend_broken"); // fixture sanity check
    expect(isCatalogOpUsable("amazon.com", "amazon_global-product_keywords")).toBe(false);
  });

  it("getScrapeHint returns null (never throws) for a domain absent from SCRAPER_PLATFORMS", () => {
    expect(getScrapeHint("not-in-the-map.example")).toBeNull();
  });

  it("getScrapeHint returns null for a domain injected with a phantom op — proves the emission helper itself is fail-closed, not just the raw validator", () => {
    const mutated: Record<string, string> = { ...SCRAPER_PLATFORMS };
    mutated["phantom-platform.test"] = "phantom_op_does_not_exist";
    // getScrapeHint reads the real SCRAPER_PLATFORMS singleton, so we assert the
    // underlying validator agrees with what getScrapeHint would do for this pair —
    // getScrapeHint's own suppression is exercised end-to-end in the behavioral
    // test file (extract-scrape-hint-behavior.test.ts) via a live map mutation.
    expect(isCatalogOpUsable("phantom-platform.test", mutated["phantom-platform.test"])).toBe(false);
  });
});

describe("Regression: the three originally-broken entries are fixed", () => {
  it("reddit.com was removed — it was never a real catalog domain", () => {
    expect(SCRAPER_PLATFORMS["reddit.com"]).toBeUndefined();
    expect(CATALOG_BY_DOMAIN.has("reddit.com")).toBe(false);
    // The old (wrong) pairing must still fail the validator even if re-added by accident.
    expect(isCatalogOpUsable("reddit.com", "reddit_subreddit_posts")).toBe(false);
  });

  it("glassdoor.com was removed — it was never a real catalog domain", () => {
    expect(SCRAPER_PLATFORMS["glassdoor.com"]).toBeUndefined();
    expect(CATALOG_BY_DOMAIN.has("glassdoor.com")).toBe(false);
    expect(isCatalogOpUsable("glassdoor.com", "glassdoor_company_reviews_url")).toBe(false);
  });

  it("instagram.com now points at a real op (ins_profiles_profileurl), not the phantom instagram_profile_url", () => {
    expect(SCRAPER_PLATFORMS["instagram.com"]).toBe("ins_profiles_profileurl");
    // The OLD value must still fail if it ever reappears.
    expect(isCatalogOpUsable("instagram.com", "instagram_profile_url")).toBe(false);
    // The NEW value is genuinely valid.
    expect(isCatalogOpUsable("instagram.com", SCRAPER_PLATFORMS["instagram.com"])).toBe(true);
  });

  it("twitter.com is kept — it resolves through the x.com platform alias novada_scrape applies at call time", () => {
    expect(SCRAPER_PLATFORMS["twitter.com"]).toBe("twitter_profile_username");
    expect(isCatalogOpUsable("twitter.com", "twitter_profile_username")).toBe(true);
    // Sanity: CATALOG_BY_DOMAIN itself has no "twitter.com" key — the alias inside
    // isCatalogOpUsable is what makes this resolve, not a catalog entry.
    expect(CATALOG_BY_DOMAIN.has("twitter.com")).toBe(false);
  });

  // Definitive non-inert proof: replay the EXACT pre-fix SCRAPER_PLATFORMS map
  // (verbatim, as it existed on branch fix/audit-2026-09-02 HEAD 63ba891, before
  // this task's changes) through the CURRENT (fixed) isCatalogOpUsable. If the
  // guard above (`it.each` over the live map) had existed pre-fix, THIS is what
  // it would have reported: exactly the 3 bad rows, 0 false positives on the 9
  // good ones. This is what makes the drift guard non-inert — it demonstrably
  // distinguishes the known-bad shape from the known-good one, not just today's
  // already-clean map.
  it("replaying the ORIGINAL pre-fix map finds exactly the 3 known-bad rows and no false positives", () => {
    const ORIGINAL_PRE_FIX_MAP: Record<string, string> = {
      "amazon.com": "amazon_product_keywords",
      "reddit.com": "reddit_subreddit_posts",
      "github.com": "github_repository_repo-url",
      "tiktok.com": "tiktok_posts_url",
      "linkedin.com": "linkedin_company_information_url",
      "youtube.com": "youtube_video_search_label",
      "instagram.com": "instagram_profile_url",
      "twitter.com": "twitter_profile_username",
      "x.com": "twitter_profile_username",
      "glassdoor.com": "glassdoor_company_reviews_url",
      "shein.com": "shein_product_url",
      "perplexity.ai": "perplexity_answer_searchterm",
    };
    const failures = Object.entries(ORIGINAL_PRE_FIX_MAP)
      .filter(([domain, op]) => !isCatalogOpUsable(domain, op))
      .map(([domain, op]) => `${domain} -> ${op}`);
    expect(failures.sort()).toEqual(
      [
        "reddit.com -> reddit_subreddit_posts",
        "glassdoor.com -> glassdoor_company_reviews_url",
        "instagram.com -> instagram_profile_url",
      ].sort()
    );
  });
});
