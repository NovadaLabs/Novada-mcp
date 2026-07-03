/**
 * Round-3f gap tests — two structural defects that MUST be RED before fix, GREEN after.
 *
 * P1: STRONG_CHROME accept-cookies/tracking pattern has no length guard — it strips
 *     substantive GDPR sentences like "websites must allow users to accept cookies on
 *     a purpose-by-purpose basis" (>80 chars).
 *
 * P2: research.ts sentinel check only catches "## Extract Failed" but NOT "## Extraction Error"
 *     (the TOTAL_REQUEST_CEILING timeout sentinel added by C4 in extract.ts:1294). When novadaExtract
 *     returns "## Extraction Error", research.ts treats it as valid content and pushes
 *     the raw timeout error text into synthesizeAnswer as source material.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

// Mock novadaExtract at the module level.
// P1 tests use mockImplementation to return real-like content (mimicking successful extraction).
// P2 tests use mockImplementation to return the "## Extraction Error" sentinel (mimicking timeout).
vi.mock("../../src/tools/extract.js", () => ({
  novadaExtract: vi.fn(),
}));

import { novadaExtract } from "../../src/tools/extract.js";
import { novadaResearch } from "../../src/tools/research.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);
const mockedNovadaExtract = vi.mocked(novadaExtract);

const API_KEY = "test-key-round-3f";

const searchEnvelope = (org: { title: string; url: string; description: string }[]) => ({
  data: { code: 0, data: { data: { json: [{ rest: { organic: org } }] } } },
  status: 200,
  headers: {},
  config: {} as never,
  statusText: "OK",
});

/** Simulates novadaExtract returning successful markdown content. */
const successfulExtract = (content: string): string =>
  `## Extracted Content\nurl: https://example.com | mode: static | quality: high\n---\n\n${content}`;

/**
 * Simulates novadaExtract returning the TOTAL_REQUEST_CEILING sentinel string
 * (exactly as extract.ts:1294 does — a return value, not a thrown exception).
 */
const ceilingExtract = (url: string): string =>
  [
    `## Extraction Error`,
    `url: ${url}`,
    `error: Request exceeded the 30s total ceiling and was aborted.`,
    ``,
    `## Agent Action`,
    `agent_instruction: This URL took too long (>30s). Try render="static" to skip escalation, or novada_scrape for platform-specific data.`,
  ].join("\n");

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── P1: accept-cookies/tracking STRONG_CHROME false-positive ────────────────

describe("P1: accept-cookies/tracking must not strip substantive GDPR sentences", () => {
  it("GAP-P1-1: 'accept cookies' in a long GDPR Article 7 sentence is NOT stripped", async () => {
    // This is >80 chars and is substantive — must NOT be removed by the accept-cookies pattern.
    const gdprContent = [
      "Under GDPR Article 7, websites must allow users to accept cookies on a purpose-by-purpose basis rather than bundling consent.",
      "The right to accept cookies selectively is a cornerstone of granular consent requirements under the ePrivacy Directive.",
      "Controllers cannot require users to accept all tracking cookies as a condition of service access without violating GDPR.",
      "Data subjects must be able to withdraw consent to accept tracking just as easily as they gave it, per Recital 42.",
    ].join(" ");

    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{
        title: "GDPR Article 7 Cookie Consent",
        url: "https://gdpr.example.com/article7",
        description: "GDPR Article 7 governs how users accept cookies on a per-purpose basis",
      }])
    );
    mockedNovadaExtract.mockResolvedValueOnce(successfulExtract(gdprContent));

    const result = await novadaResearch(
      { question: "How does GDPR Article 7 govern how users accept cookies on a per-purpose basis?", depth: "quick" },
      API_KEY
    );

    // Must NOT be synthesis:weak — the content is substantive GDPR documentation
    expect(
      result,
      "GDPR accept-cookies substantive content should NOT produce synthesis:weak — the pattern has no length guard"
    ).not.toMatch(/synthesis:weak/);

    // The summary must retain cookie/consent-related content, not be empty
    const summaryMatch = result.match(/## Summary\n([\s\S]*?)(?=\n##|\n---\n|$)/);
    const summary = summaryMatch ? summaryMatch[1] : "";
    expect(
      summary,
      "Summary should retain GDPR/cookie content, not be stripped to nothing"
    ).toMatch(/GDPR|Article|cookie|consent|purpose|tracking|ePrivacy|withdraw/i);
  });

  it("GAP-P1-2: 'accept tracking' in a long analytics sentence is NOT stripped", async () => {
    const analyticsContent = [
      "Users who accept tracking cookies enable personalized advertising under the TCF (Transparency and Consent Framework).",
      "The legal basis to accept tracking for analytics differs from consent required to accept tracking for ad targeting.",
      "Publishers must present a clear interface for users to accept tracking or reject it for each purpose category.",
      "Vendors that accept tracking consent must register with the IAB Europe vendor list to rely on it downstream.",
    ].join(" ");

    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{
        title: "IAB TCF Tracking Consent",
        url: "https://iab.example.com/tcf",
        description: "How users accept tracking under IAB TCF and GDPR",
      }])
    );
    mockedNovadaExtract.mockResolvedValueOnce(successfulExtract(analyticsContent));

    const result = await novadaResearch(
      { question: "How does IAB TCF handle accept tracking consent?", depth: "quick" },
      API_KEY
    );

    expect(
      result,
      "IAB TCF accept-tracking substantive content should NOT produce synthesis:weak"
    ).not.toMatch(/synthesis:weak/);

    const summaryMatch = result.match(/## Summary\n([\s\S]*?)(?=\n##|\n---\n|$)/);
    const summary = summaryMatch ? summaryMatch[1] : "";
    expect(summary).toMatch(/tracking|consent|IAB|TCF|purpose|vendor|advertising/i);
  });

  it("GAP-P1-PASS: short 'Accept all cookies' button text IS still stripped", async () => {
    // Short nav affordance — MUST still be treated as chrome.
    const navCookieContent = "Accept all cookies\nAccept tracking\nReject all\nCookie settings";

    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{
        title: "Cookie Banner Page",
        url: "https://cookiebanner.example.com",
        description: "page with only cookie banner chrome",
      }])
    );
    // Return only the nav cookie chrome as extracted content — no substantive sentences
    mockedNovadaExtract.mockResolvedValueOnce(successfulExtract(navCookieContent));

    const result = await novadaResearch(
      { question: "How does residential proxy rotation work?", depth: "quick" },
      API_KEY
    );

    // A fragment with ONLY cookie-banner chrome must get synthesis:weak or synthesis:failed
    expect(
      result,
      "Cookie-banner-only fragment should yield synthesis:weak or synthesis:failed — short accept cookies is still chrome"
    ).toMatch(/synthesis:(weak|failed)/);
  });
});

// ─── P2: "## Extraction Error" sentinel not detected in research.ts ───────────

describe("P2: Extraction Error sentinel must be caught before content reaches synthesis", () => {
  it("GAP-P2-1: when novadaExtract returns '## Extraction Error' the error text must NOT appear in output", async () => {
    const timedOutUrl = "https://slow-site.example.com/very-slow-page";

    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{
        title: "Slow GDPR Reference Page",
        url: timedOutUrl,
        description: "GDPR Article 7 detailed analysis",
      }])
    );

    // Simulate extract.ts:1294 — novadaExtract returns the ceiling sentinel as a string,
    // not a thrown exception.
    mockedNovadaExtract.mockResolvedValueOnce(ceilingExtract(timedOutUrl));

    const result = await novadaResearch(
      { question: "How does GDPR Article 7 govern cookie consent?", depth: "quick" },
      API_KEY
    );

    // The raw timeout error text must NOT appear in the synthesis output
    expect(
      result,
      "Extraction Error sentinel text must not be embedded into research output as source material"
    ).not.toMatch(/Request exceeded the.*total ceiling.*aborted/i);

    expect(
      result,
      "Extraction Error sentinel header must not appear in research output"
    ).not.toMatch(/## Extraction Error/);
  });

  it("GAP-P2-2: research output should NOT contain agent_instruction from timed-out extraction", async () => {
    const timedOutUrl = "https://another-slow-site.example.com/slow";

    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{
        title: "Slow Legal Page",
        url: timedOutUrl,
        description: "Legal analysis of cookie consent",
      }])
    );

    mockedNovadaExtract.mockResolvedValueOnce(ceilingExtract(timedOutUrl));

    const result = await novadaResearch(
      { question: "What is cookie consent law?", depth: "quick" },
      API_KEY
    );

    // The agent_instruction from the timed-out extraction should NOT leak into the research report
    expect(
      result,
      "agent_instruction from timed-out extraction must not appear in research output"
    ).not.toMatch(/Try render="static" to skip escalation/);
  });
});
