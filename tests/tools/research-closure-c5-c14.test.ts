/**
 * Gap tests for closure findings C5 and C14
 *
 * C5 [P1]: cookie-consent / cookie-policy patterns are in STRONG_CHROME_PATTERNS
 *   (always stripped regardless of length), causing GDPR cookie-consent research
 *   summaries to come back empty.
 *   Fix: move cookie-consent / cookie-policy into CONTEXT_SENSITIVE_PATTERNS so
 *   >80-char substantive sentences survive while short nav "Cookie policy" links
 *   are still stripped.
 *
 * C14 [P2]: chromeFraction splits on /[\n.!?]+/ but stripNavChrome splits on "\n"
 *   so multi-sentence GDPR/terms paragraphs fragment under 80 chars and falsely
 *   score synthesis:weak.
 *   Fix: align chromeFraction split to "\n" so the length guard behaves consistently.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaResearch } from "../../src/tools/research.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-closure-c5-c14";

const searchEnvelope = (org: { title: string; url: string; description: string }[]) => ({
  data: { code: 0, data: { data: { json: [{ rest: { organic: org } }] } } },
  status: 200,
  headers: {},
  config: {} as never,
  statusText: "OK",
});

const extractResponse = (body: string) => ({
  data: `<html><body>${body}</body></html>`,
  status: 200,
  headers: {},
  config: {} as never,
  statusText: "OK",
});

beforeEach(() => {
  vi.clearAllMocks();
});

// Research now assembles CITED SOURCE MATERIAL (## Researched source material for: …,
// material:grounded|snippets|insufficient) rather than a fake "synthesized" ## Summary.
// "substantive content survives" ⇒ material:grounded with topic text present;
// "nav-only content rejected" ⇒ material:insufficient. The underlying C5/C14 nav-chrome
// length-guard fixes still gate splitSentences/chromeFraction, so these cases still matter.
function extractMaterialSection(output: string): string {
  const match = output.match(/## Researched source material for:[^\n]*\n([\s\S]*?)(?=\n## Key Findings|\n---\n|$)/);
  return match ? match[1].trim() : "";
}

// ─── C5: cookie-consent / cookie-policy must not be ALWAYS stripped ─────────

describe("C5: cookie-consent phrases in substantive GDPR sentences survive", () => {
  it("C5-1: multi-sentence paragraph about cookie consent requirements is NOT stripped", async () => {
    // Each sentence contains "cookie consent" as SUBJECT MATTER, not as a nav link.
    // The paragraph is well over 80 chars per line — should survive CONTEXT_SENSITIVE guard.
    const cookieConsentContent = [
      "Under GDPR Article 7, cookie consent must be freely given, specific, informed and unambiguous.",
      "Cookie consent requirements mean that pre-ticked boxes or bundled consent clauses are prohibited by the regulation.",
      "A valid cookie consent mechanism must allow users to withdraw their agreement as easily as they gave it.",
      "The cookie consent framework under ePrivacy requires separate consent for each distinct processing purpose.",
    ].join("\n");

    mockedAxios.post.mockResolvedValue(
      searchEnvelope([
        {
          title: "GDPR Cookie Consent Guide",
          url: "https://gdpr.example.com/cookie-consent",
          description: "How cookie consent requirements work under GDPR Article 7",
        },
      ])
    );
    mockedAxios.get.mockResolvedValueOnce(
      extractResponse(`<article><p>${cookieConsentContent}</p></article>`)
    );

    const result = await novadaResearch(
      { question: "How do cookie consent requirements work under GDPR article 7?", depth: "quick" },
      API_KEY
    );

    // Substantive GDPR documentation must be surfaced as grounded material, not dropped.
    expect(result, "GDPR cookie consent documentation should be grounded material").toMatch(
      /material:grounded/
    );

    // Material must contain substantive cookie consent content
    const material = extractMaterialSection(result);
    expect(
      material,
      "Material must contain substantive cookie-consent content, not be empty"
    ).toMatch(/cookie\s+consent|GDPR|Article\s+7|ePrivacy|freely\s+given|unambiguous|withdraw/i);
  });

  it("C5-2: cookie-policy as GDPR subject in long sentence survives", async () => {
    const cookiePolicyContent = [
      "A cookie policy document must describe each category of cookie deployed including its purpose and retention period.",
      "The cookie policy obligations under GDPR differ from cookie consent obligations because disclosure alone does not authorize processing.",
      "Under the ePrivacy Directive, a cookie policy must list all third-party vendors and their data processing purposes.",
    ].join("\n");

    mockedAxios.post.mockResolvedValue(
      searchEnvelope([
        {
          title: "Cookie Policy Requirements",
          url: "https://legal.example.com/cookie-policy",
          description: "GDPR cookie policy documentation requirements",
        },
      ])
    );
    mockedAxios.get.mockResolvedValueOnce(
      extractResponse(`<article><p>${cookiePolicyContent}</p></article>`)
    );

    const result = await novadaResearch(
      { question: "What does GDPR require in a cookie policy document?", depth: "quick" },
      API_KEY
    );

    expect(result, "GDPR cookie policy documentation should be grounded material").toMatch(/material:grounded/);
    const material = extractMaterialSection(result);
    expect(material, "Material must retain cookie-policy/GDPR content").toMatch(
      /cookie\s+policy|GDPR|ePrivacy|retention|vendor|processing/i
    );
  });

  it("C5-PASS: short nav 'Cookie settings' link is still stripped", async () => {
    // Genuine nav-chrome-only content — short lines that are purely navigation affordances
    const navOnlyContent = "Cookie settings\nCookie policy\nAccept all cookies\nSign in\nPrivacy Policy";

    mockedAxios.post.mockResolvedValue(
      searchEnvelope([
        {
          title: "Nav Only Page",
          url: "https://navonly.example.com",
          description: "page with only cookie nav links",
        },
      ])
    );
    mockedAxios.get.mockResolvedValueOnce(
      extractResponse(
        `<nav><ul>${navOnlyContent
          .split("\n")
          .map(l => `<li>${l}</li>`)
          .join("")}</ul></nav>`
      )
    );

    const result = await novadaResearch(
      { question: "How do residential proxies work?", depth: "quick" },
      API_KEY
    );

    // A source with only nav-chrome cookie links (off-topic to "residential proxies")
    // yields no usable on-topic material → never grounded.
    expect(result, "Nav-only cookie links should not be grounded material").not.toMatch(/material:grounded/);
    expect(result).toMatch(/material:(insufficient|snippets)/);
    const material = extractMaterialSection(result);
    expect(material).not.toContain("Accept all cookies");
  });
});

// ─── C14: chromeFraction must split on \n (same as stripNavChrome) ──────────

describe("C14: chromeFraction split aligned with stripNavChrome for consistent length guard", () => {
  it("C14-1: multi-sentence GDPR paragraph on a single line is NOT falsely weak", async () => {
    // This scenario exposes the C14 bug: the paragraph is one long line containing
    // "cookie consent" and "privacy policy". When chromeFraction splits on /[\n.!?]+/,
    // it fragments into short sentences that each hit the 80-char CONTEXT_SENSITIVE
    // threshold and get flagged as chrome — but stripNavChrome (which splits on \n)
    // sees it as one long line that does NOT match. This mismatch causes the fragment
    // to score chromeFraction > 0.4 despite stripNavChrome leaving it intact.
    //
    // After the fix (chromeFraction splits on \n), both functions agree: long lines
    // are NOT chrome, chromeFraction stays low, synthesis:ok.
    //
    // NOTE: this is a paragraph on one logical line (no embedded \n). Sentence
    // splitting is intentionally done via period-space to create several sub-80-char
    // fragments in the OLD behavior.
    const singleLineParagraph =
      "Cookie consent under GDPR Article 7 requires freely given, specific and informed agreement. " +
      "Cookie policy disclosures must list all third-party vendors and purposes under ePrivacy rules. " +
      "Consent withdrawal must be as easy as giving consent per GDPR Article 7(3). " +
      "Valid cookie consent cannot be bundled with terms of service acceptance per WP29 guidance. " +
      "The data controller bears the burden of demonstrating cookie consent was lawfully obtained.";

    mockedAxios.post.mockResolvedValue(
      searchEnvelope([
        {
          title: "GDPR Cookie Consent Article 7",
          url: "https://gdpr.example.com/article-7",
          description: "GDPR cookie consent requirements Article 7",
        },
      ])
    );
    mockedAxios.get.mockResolvedValueOnce(
      extractResponse(`<article><p>${singleLineParagraph}</p></article>`)
    );

    const result = await novadaResearch(
      { question: "How do cookie consent requirements work under GDPR article 7?", depth: "quick" },
      API_KEY
    );

    // With old split /[\n.!?]+/, each sentence < 80 chars would falsely flag as chrome,
    // pushing chromeFraction > 0.4 and dropping the source. With fixed split /\n/, the whole
    // paragraph is one long line → chromeFraction ~0 → surfaced as grounded material.
    expect(result, "Single-line GDPR cookie-consent paragraph should be grounded material").toMatch(
      /material:grounded/
    );

    const material = extractMaterialSection(result);
    expect(material, "Material must contain substantive GDPR/cookie content").toMatch(
      /cookie\s+consent|GDPR|Article\s+7|ePrivacy|freely\s+given|withdrawal|vendor/i
    );
  });

  it("C14-2: chromeFraction and stripNavChrome are consistent on nav-only content", async () => {
    // Both functions should agree: nav-only short lines => stripped => synthesis:weak
    // This verifies the fix doesn't break the positive case.
    const navOnlyContent = "Cookie settings\nAccept cookies\nSign in\nPrivacy Policy\nTerms of Service";

    mockedAxios.post.mockResolvedValue(
      searchEnvelope([
        {
          title: "Nav Chrome Only",
          url: "https://navchrome2.example.com",
          description: "only nav chrome",
        },
      ])
    );
    mockedAxios.get.mockResolvedValueOnce(
      extractResponse(
        `<nav>${navOnlyContent
          .split("\n")
          .map(l => `<span>${l}</span>`)
          .join("\n")}</nav>`
      )
    );

    const result = await novadaResearch(
      { question: "How do residential proxies work?", depth: "quick" },
      API_KEY
    );

    // After alignment, nav-only lines still score high chromeFraction and, being off-topic
    // to "residential proxies", yield no usable on-topic material → never grounded.
    expect(result, "Nav-only content should not be grounded material after C14 fix").not.toMatch(
      /material:grounded/
    );
    expect(result).toMatch(/material:(insufficient|snippets)/);
  });
});
