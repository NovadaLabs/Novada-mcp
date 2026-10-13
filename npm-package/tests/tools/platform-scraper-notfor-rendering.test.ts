/**
 * Round 4 (S1-connector, F5 — independent judge 2026-10-13, BORDERLINE:
 * description-accurate-and-narrow).
 *
 * Judge's finding: novada_scrape_youtube's "Not for:" line read "the
 * transcript/subtitles of a YouTube video — use this operation is currently
 * backend_broken (live-verified 2026-10-13) and has been removed from this
 * tool's enum" — a template bug (platform_scraper.ts's renderDescription
 * force-prefixed "use " onto EVERY notFor entry's second half, which only
 * reads correctly when that half names a replacement tool/action, not when
 * it's a free-form statement like "this operation is currently ...").
 *
 * Fix: PlatformScraperDescription.notFor now accepts a second shape,
 * `{ when, note }`, rendered as `${when} — ${note}` (no forced "use "
 * prefix) — chosen per-entry by the config author, not inferred. This is
 * the shared template every novada_scrape_<platform> tool goes through, so
 * the fix (and this test) covers the whole class, not just YouTube.
 */
import { describe, it, expect } from "vitest";
import { TOOLS } from "../../src/core.js";
import { PLATFORM_SCRAPER_TOOLS } from "../../src/tools/platform_scrapers.js";

const GARBLED_PATTERN = /use this operation is currently/i;

describe("platform-scraper notFor rendering (F5): no garbled 'use this operation is currently...' artifact anywhere", () => {
  it("sanity: PLATFORM_SCRAPER_TOOLS is non-empty (guards against this suite silently passing over an empty set)", () => {
    expect(PLATFORM_SCRAPER_TOOLS.length).toBeGreaterThan(5);
  });

  it("novada_scrape_youtube's rendered description no longer contains the garbled phrase", () => {
    const youtube = TOOLS.find((t) => t.name === "novada_scrape_youtube")!;
    expect(youtube.description).not.toMatch(GARBLED_PATTERN);
  });

  it("novada_scrape_youtube's 'Not for:' line reads as a complete, grammatical statement for the backend_broken transcript op", () => {
    const youtube = TOOLS.find((t) => t.name === "novada_scrape_youtube")!;
    expect(youtube.description).toContain(
      "The transcript/subtitles of a YouTube video — this operation (transcript_by_video) is currently backend_broken",
    );
  });

  it("CLASS sweep: no platform-scraper tool's description contains the garbled artifact (not a YouTube-only fix)", () => {
    const offenders = TOOLS.filter((t) => GARBLED_PATTERN.test(t.description)).map((t) => t.name);
    expect(offenders).toEqual([]);
  });

  it("MIRROR: a normal {when, useInstead} notFor entry (e.g. novada_scrape_amazon's) still renders with the 'use X' phrasing — the fix added a shape, it didn't remove the original one", () => {
    const amazon = TOOLS.find((t) => t.name === "novada_scrape_amazon")!;
    expect(amazon.description).toMatch(/— use /);
  });
});
