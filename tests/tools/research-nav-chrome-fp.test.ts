/**
 * Gap test for round-3 veto: NAV_CHROME_PATTERNS false positives on substantive research content
 *
 * Veto scenario: patterns /\bsign\s+(in|up)\b/i, /\bprivacy\s+policy\b/i,
 * /\bterms\s+(of\s+)?(service|use)\b/i are too broad — they strip lines where
 * "sign in", "privacy policy", "terms of service" appear as SUBJECT MATTER in a
 * substantive sentence, causing a GDPR/OAuth fragment to score chromeFraction=1.0
 * and wrongly get synthesis:weak.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaResearch } from "../../src/tools/research.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-nav-fp";

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

describe("NAV_CHROME false-positive: substantive content containing chrome phrases", () => {
  it("VETO-FP-1: sentence with 'sign in' as subject of OAuth documentation is NOT stripped", async () => {
    // Substantive OAuth sentence — "sign in" is the SUBJECT being documented, not a nav affordance
    const oauthContent = [
      "The OAuth 2.0 sign in flow begins when a user requests access to a protected resource.",
      "During the sign in process, the authorization server issues an access token after validating credentials.",
      "The sign in redirect URI must be registered in the OAuth provider to prevent open redirect attacks.",
      "Implementing sign in with PKCE is recommended for public clients to mitigate authorization code interception.",
    ].join(" ");

    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{ title: "OAuth 2.0 Guide", url: "https://oauth.example.com", description: "OAuth 2.0 sign in flow documentation" }])
    );
    mockedAxios.get.mockResolvedValueOnce(extractResponse(`<article><p>${oauthContent}</p></article>`));

    const result = await novadaResearch(
      { question: "How does OAuth 2.0 sign in flow work?", depth: "quick" },
      API_KEY
    );

    // The synthesis must NOT be synthesis:weak — the content is substantive OAuth documentation
    expect(result, "OAuth documentation with 'sign in' as subject should produce synthesis:ok, not synthesis:weak").not.toMatch(/synthesis:weak/);
    // The summary must retain OAuth-specific content
    const summaryMatch = result.match(/## Summary\n([\s\S]*?)(?=\n##|\n---\n|$)/);
    const summary = summaryMatch ? summaryMatch[1] : "";
    expect(summary, "Summary should retain OAuth/authorization content").toMatch(/OAuth|authorization|token|PKCE|redirect/i);
  });

  it("VETO-FP-2: sentence with 'privacy policy' as GDPR subject is NOT stripped", async () => {
    // Substantive GDPR sentence — "privacy policy" is the topic being analyzed
    const gdprContent = [
      "Under GDPR Article 13, a privacy policy must disclose the legal basis for processing personal data.",
      "The privacy policy implications for cross-border data transfer require Standard Contractual Clauses.",
      "A compliant privacy policy under GDPR must specify data retention periods and subject rights.",
      "Privacy policy violations can result in fines of up to 4% of global annual turnover under GDPR enforcement.",
    ].join(" ");

    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{ title: "GDPR Compliance Guide", url: "https://gdpr.example.com", description: "GDPR privacy policy requirements" }])
    );
    mockedAxios.get.mockResolvedValueOnce(extractResponse(`<article><p>${gdprContent}</p></article>`));

    const result = await novadaResearch(
      { question: "What are the privacy policy implications under GDPR?", depth: "quick" },
      API_KEY
    );

    expect(result, "GDPR documentation with 'privacy policy' as subject should produce synthesis:ok").not.toMatch(/synthesis:weak/);
    const summaryMatch = result.match(/## Summary\n([\s\S]*?)(?=\n##|\n---\n|$)/);
    const summary = summaryMatch ? summaryMatch[1] : "";
    expect(summary, "Summary should retain GDPR content").toMatch(/GDPR|Article|data|processing|fines|retention/i);
  });

  it("VETO-FP-3: sentence with 'terms of service' as compliance subject is NOT stripped", async () => {
    // Substantive sentence about terms as legal topic
    const termsContent = [
      "The terms of service must clearly state how user data is shared with third parties.",
      "Mandatory arbitration clauses in terms of service have faced regulatory scrutiny in several jurisdictions.",
      "Terms of service violations by platforms can expose them to liability under consumer protection laws.",
      "A well-drafted terms of service agreement delineates acceptable use policies and content moderation rules.",
    ].join(" ");

    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{ title: "Legal Compliance Guide", url: "https://legal.example.com", description: "Terms of service compliance" }])
    );
    mockedAxios.get.mockResolvedValueOnce(extractResponse(`<article><p>${termsContent}</p></article>`));

    const result = await novadaResearch(
      { question: "What are the legal implications of terms of service agreements?", depth: "quick" },
      API_KEY
    );

    expect(result, "Legal documentation with 'terms of service' as subject should produce synthesis:ok").not.toMatch(/synthesis:weak/);
    const summaryMatch = result.match(/## Summary\n([\s\S]*?)(?=\n##|\n---\n|$)/);
    const summary = summaryMatch ? summaryMatch[1] : "";
    expect(summary, "Summary should retain terms/legal content").toMatch(/terms|service|arbitration|liability|regulatory|compliance/i);
  });

  it("VETO-FP-4: combined OAuth + GDPR question — both 'sign in' and 'privacy policy' must survive", async () => {
    // The exact live repro scenario from the veto
    const combinedContent = [
      "The OAuth 2.0 sign in flow involves the authorization code grant where the client redirects to the identity provider.",
      "Upon successful sign in, the server issues a JWT containing user claims and scope information.",
      "Privacy policy implications under GDPR require that OAuth providers disclose data processing purposes.",
      "The privacy policy must be presented before the first sign in if personal data is collected during the flow.",
    ].join(" ");

    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{ title: "OAuth GDPR Guide", url: "https://oauthgdpr.example.com", description: "OAuth 2.0 sign in and GDPR privacy policy" }])
    );
    mockedAxios.get.mockResolvedValueOnce(extractResponse(`<article><p>${combinedContent}</p></article>`));

    const result = await novadaResearch(
      { question: "How does OAuth 2.0 sign in flow work and what are the privacy policy implications under GDPR?", depth: "quick" },
      API_KEY
    );

    // Must NOT be synthesis:weak — the fragment is substantive documentation
    expect(result, "Combined OAuth+GDPR content should produce synthesis:ok").not.toMatch(/synthesis:weak/);
    const summaryMatch = result.match(/## Summary\n([\s\S]*?)(?=\n##|\n---\n|$)/);
    const summary = summaryMatch ? summaryMatch[1] : "";
    // The summary should contain content related to both OAuth and GDPR
    expect(summary, "Summary should contain OAuth or GDPR content").toMatch(/OAuth|authorization|JWT|GDPR|privacy|disclosure/i);
  });

  it("VETO-CHROME-PASS: genuine nav-affordance lines are still stripped", async () => {
    // A genuine nav-chrome-only fragment: each line IS a short UI label, not substantive
    const navOnlyContent = "Sign in\nSign up\nPrivacy Policy\nTerms of Service\nToggle navigation\nCookie settings";

    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{ title: "Nav Chrome Page", url: "https://navchrome.example.com", description: "page with only navigation chrome" }])
    );
    mockedAxios.get.mockResolvedValueOnce(extractResponse(`<nav><ul>${navOnlyContent.split("\n").map(l => `<li>${l}</li>`).join("")}</ul></nav>`));

    const result = await novadaResearch(
      { question: "How do residential proxies work?", depth: "quick" },
      API_KEY
    );

    // A fragment with ONLY nav chrome should get synthesis:weak or synthesis:failed
    expect(result, "Genuine nav-only fragment should yield synthesis:weak or synthesis:failed").toMatch(/synthesis:(weak|failed)/);
  });
});
