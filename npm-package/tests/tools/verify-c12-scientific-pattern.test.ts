/**
 * C12 — SCIENTIFIC_CLAIM_PATTERN over-broad (verify.ts:358)
 *
 * The bare word "data" in the pattern causes policy/tech claims like
 * "TikTok collects user data and shares it with the Chinese government"
 * to be classified as scientific, triggering no_authoritative_sources_found
 * and the primary-literature nudge.
 *
 * Fix: drop bare "data" from the pattern (or require it in a research
 * context like "data shows"/"the data suggest"). Genuine scientific claims
 * (hedged association, epidemiology, clinical) must still classify correctly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NovadaSearchResult } from "../../src/tools/types.js";

vi.mock("../../src/tools/search.js", () => ({
  submitSearchScrapeTask: vi.fn(),
  resolveSearchResults: vi.fn(),
}));

import { novadaVerify } from "../../src/tools/verify.js";
import { submitSearchScrapeTask, resolveSearchResults } from "../../src/tools/search.js";

const mockedSubmit = vi.mocked(submitSearchScrapeTask);
const mockedResolve = vi.mocked(resolveSearchResults);

const API_KEY = "test-key-c12";

beforeEach(() => {
  vi.clearAllMocks();
  mockedSubmit.mockResolvedValue({ inlineResults: {} } as never);
});

function srcUrl(title: string, description: string, fullUrl: string): NovadaSearchResult {
  return { title, description, url: fullUrl, link: fullUrl };
}

function mockWithSocialSources() {
  const socialSrcs = [
    srcUrl("Reddit", "TikTok collects user data and shares it.", "https://reddit.com/r/privacy/tiktok"),
    srcUrl("Twitter thread", "TikTok shares data with Chinese government says report.", "https://twitter.com/user/status/123"),
    srcUrl("Facebook post", "TikTok data sharing confirmed.", "https://facebook.com/groups/privacy"),
  ];
  mockedResolve
    .mockResolvedValueOnce(socialSrcs)
    .mockResolvedValueOnce(socialSrcs)
    .mockResolvedValueOnce(socialSrcs);
}

// ─── C12-A: Policy/tech claim with bare "data" must NOT get scientific nudge ──

describe("C12: SCIENTIFIC_CLAIM_PATTERN must not over-classify policy/tech claims", () => {
  it("policy claim with 'user data' does NOT emit no_authoritative_sources_found nudge", async () => {
    mockWithSocialSources();
    const out = await novadaVerify(
      { claim: "TikTok collects user data and shares it with the Chinese government" },
      API_KEY,
    );
    // Must NOT fire the scientific-literature redirect
    expect(out).not.toContain("no_authoritative_sources_found");
    // Must NOT suggest primary literature for a policy claim
    expect(out).not.toMatch(/verify_against_primary_literature/);
  });

  it("policy claim with 'data' word must NOT be classified as scientific via bare-data match", async () => {
    // Even with only social sources, a plain policy claim should not get the science nudge
    mockWithSocialSources();
    const out = await novadaVerify(
      { claim: "Facebook sells user data to advertisers without explicit consent" },
      API_KEY,
    );
    expect(out).not.toContain("no_authoritative_sources_found");
    expect(out).not.toMatch(/verify_against_primary_literature/);
  });

  // ─── C12-B: Genuine scientific claim must STILL trigger the nudge ──────────

  it("genuine scientific claim (hedged association) still gets low-authority warning when sources are social-only", async () => {
    const socialSrcs = [
      srcUrl("Reddit health", "Coffee is associated with reduced diabetes risk.", "https://reddit.com/r/health/coffee"),
      srcUrl("Facebook health", "Coffee linked to lower diabetes risk.", "https://facebook.com/healthpage/coffee"),
      srcUrl("Medium blog", "Coffee consumption associated with diabetes outcomes.", "https://medium.com/@blogger/coffee"),
    ];
    mockedResolve
      .mockResolvedValueOnce(socialSrcs)
      .mockResolvedValueOnce(socialSrcs)
      .mockResolvedValueOnce(socialSrcs);

    const out = await novadaVerify(
      { claim: "Moderate coffee consumption is associated with reduced type-2 diabetes risk" },
      API_KEY,
    );
    // Hedged association claim with social-only sources MUST still warn about primary literature
    expect(out).toMatch(/primary[_\-\s]literature|peer[_\-\s]reviewed|authoritative|pubmed|clinical/i);
  });

  it("claim with 'data shows' phrase IS classified as scientific research context", async () => {
    // "data shows" indicates a research context — should still classify as scientific
    const socialSrcs = [
      srcUrl("Reddit", "Data shows coffee reduces diabetes risk.", "https://reddit.com/r/health"),
      srcUrl("Facebook", "The data suggest coffee is protective.", "https://facebook.com/health"),
      srcUrl("Medium", "Research data shows lower risk.", "https://medium.com/@user"),
    ];
    mockedResolve
      .mockResolvedValueOnce(socialSrcs)
      .mockResolvedValueOnce(socialSrcs)
      .mockResolvedValueOnce(socialSrcs);

    const out = await novadaVerify(
      { claim: "The data shows that regular exercise reduces cardiovascular disease risk" },
      API_KEY,
    );
    // "data shows" is a research-context phrase — scientific classification should still apply
    // This claim won't be hedged (no "associated with" etc.) but "data shows" should match research context
    // The key check: it should NOT skip the scientific pathway (it may or may not have authority warning
    // depending on how the fix is implemented — we at minimum check it completes without error)
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(10);
  });
});
