/**
 * F7 — Stance mitigation tests (P0)
 *
 * Four sub-issues tested:
 *   F7-A: Bucket labels must be provenance-honest (no "Supporting" / "Contradicting" stance assertions)
 *         + agent_instruction carries keyword-match caveat on every run.
 *   F7-B: Hedged/association claims with zero contradicting sources must be capped to ≤70 confidence
 *         and never return verdict "supported" at high confidence.
 *   F7-C: Evidence URLs containing redirect params (signOut, redirect=, source=, file=) are
 *         excluded/downranked from the evidence lists.
 *   F7-D: When source authority is low for a scientific claim, agent_instruction carries a
 *         primary-literature warning.
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

const API_KEY = "test-key-f7";

beforeEach(() => {
  vi.clearAllMocks();
  mockedSubmit.mockResolvedValue({ inlineResults: {} } as never);
});

function mockQueries(
  supporting: NovadaSearchResult[],
  skeptical: NovadaSearchResult[],
  neutral: NovadaSearchResult[],
) {
  mockedResolve
    .mockResolvedValueOnce(supporting)
    .mockResolvedValueOnce(skeptical)
    .mockResolvedValueOnce(neutral);
}

function src(title: string, description: string, urlSuffix: string): NovadaSearchResult {
  return {
    title,
    description,
    url: `https://example.com/${urlSuffix}`,
    link: `https://example.com/${urlSuffix}`,
  };
}

function srcUrl(title: string, description: string, fullUrl: string): NovadaSearchResult {
  return { title, description, url: fullUrl, link: fullUrl };
}

function getVerdict(out: string): string {
  return out.match(/verdict:\s*(\w+)/)?.[1] ?? "";
}
function getConfidence(out: string): number {
  return parseInt(out.match(/confidence:\s*(\d+)/)?.[1] ?? "-1", 10);
}

// ─── F7-A: Provenance-honest bucket labels ─────────────────────────────────

describe("F7-A: Provenance-honest bucket labels", () => {
  it("section headings must NOT use the word 'Supporting' as a stance assertion", async () => {
    mockQueries(
      [src("Eiffel Tower", "The Eiffel Tower in Paris is 330 meters tall.", "a1"),
       src("Paris facts", "Paris landmark Eiffel reaches 330 meters.", "a2")],
      [],
      [],
    );
    const out = await novadaVerify({ claim: "The Eiffel Tower is 330 meters tall" }, API_KEY);
    // Must NOT have the old stance-asserting header
    expect(out).not.toMatch(/^## Supporting Evidence/m);
    // Must have a provenance-honest alternative
    expect(out).toMatch(/## Sources matching/i);
  });

  it("section headings must NOT use the word 'Contradicting' as a stance assertion", async () => {
    mockQueries(
      [src("Eiffel Tower", "The Eiffel Tower in Paris is 330 meters tall.", "b1"),
       src("Paris facts", "Paris landmark Eiffel reaches 330 meters.", "b2")],
      [src("Eiffel myth", "The claim about Eiffel is false and debunked.", "b3")],
      [],
    );
    const out = await novadaVerify({ claim: "The Eiffel Tower is 330 meters tall" }, API_KEY);
    expect(out).not.toMatch(/^## Contradicting Evidence/m);
    expect(out).toMatch(/## Sources matching/i);
  });

  it("agent_instruction always carries keyword-match caveat", async () => {
    mockQueries(
      [src("Eiffel Tower", "The Eiffel Tower in Paris is 330 meters tall.", "c1"),
       src("Paris facts", "Paris landmark Eiffel reaches 330 meters.", "c2")],
      [],
      [src("Fact check Eiffel", "Confirmed: Eiffel Tower is 330 meters.", "c3")],
    );
    const out = await novadaVerify({ claim: "The Eiffel Tower is 330 meters tall" }, API_KEY);
    // Must contain keyword-match caveat in agent hints or instruction
    expect(out).toMatch(/keyword[_\-\s]match|keyword match|provenance|retrieval[_\-\s]query|query keyword/i);
  });
});

// ─── F7-B: Hedged/association claim confidence cap ─────────────────────────

describe("F7-B: Hedged claim confidence capping", () => {
  it("association language + zero contradicting → confidence capped ≤70 and not 'supported'", async () => {
    // Simulate: contradicting_count == 0, supporting sources present, but claim uses "associated with"
    const supportSrcs = [
      src("Coffee study", "Moderate coffee consumption associated with reduced risk of type 2 diabetes.", "d1"),
      src("Diabetes research", "Coffee linked to lower diabetes risk in cohort study associated with positive outcomes.", "d2"),
      src("Coffee meta-analysis", "Meta-analysis associated with moderate coffee intake and diabetes risk reduction.", "d3"),
    ];
    mockQueries(supportSrcs, [], supportSrcs);
    const out = await novadaVerify(
      { claim: "Moderate coffee consumption is associated with a reduced risk of type 2 diabetes." },
      API_KEY,
    );
    const conf = getConfidence(out);
    const verdict = getVerdict(out);
    // Confidence must be capped below 71 for a hedged/association claim
    expect(conf).toBeLessThanOrEqual(70);
    // Verdict must NOT be "supported" at high confidence for a hedged claim
    if (verdict === "supported") {
      expect(conf).toBeLessThanOrEqual(70);
    }
  });

  it("'may' hedge language + zero contradicting → verdict is not 'supported' at >70 confidence", async () => {
    const supportSrcs = [
      src("Aspirin trial", "Low-dose aspirin may reduce risk of heart disease according to observational data.", "e1"),
      src("Heart study", "Aspirin may lower cardiovascular events in high-risk patients.", "e2"),
      src("Meta study", "Evidence suggests aspirin may provide modest benefit.", "e3"),
    ];
    mockQueries(supportSrcs, [], supportSrcs);
    const out = await novadaVerify(
      { claim: "Aspirin may reduce the risk of heart disease in healthy adults." },
      API_KEY,
    );
    const conf = getConfidence(out);
    const verdict = getVerdict(out);
    if (verdict === "supported") {
      expect(conf).toBeLessThanOrEqual(70);
    }
    // Additionally: when hedging present, outcome should NOT be supported+high_confidence combo
    expect(verdict === "supported" && conf > 70).toBe(false);
  });

  it("'correlated' hedge language + zero contradicting → verdict contested or insufficient_data or capped", async () => {
    const supportSrcs = [
      src("Correlation study", "Screen time correlated with sleep issues in teenagers observed across cohorts.", "f1"),
      src("Sleep research", "Screen time and sleep are correlated in teen populations.", "f2"),
      src("Youth study", "Sleep quality correlated with screen time usage.", "f3"),
    ];
    mockQueries(supportSrcs, [], supportSrcs);
    const out = await novadaVerify(
      { claim: "Screen time is correlated with worse sleep in teenagers." },
      API_KEY,
    );
    const conf = getConfidence(out);
    const verdict = getVerdict(out);
    // Correlated claim: never high-confidence supported
    expect(verdict === "supported" && conf > 70).toBe(false);
  });

  it("non-hedged factual claim with multiple sources keeps normal verdict logic unchanged", async () => {
    // This is a regression guard: the cap must NOT apply to non-hedged claims
    const supportSrcs = [
      src("Eiffel Tower", "The Eiffel Tower in Paris is 330 meters tall.", "g1"),
      src("Paris facts", "Paris landmark Eiffel reaches 330 meters.", "g2"),
      src("Tower facts", "The 330-meter Eiffel Tower stands in Paris.", "g3"),
    ];
    mockQueries(supportSrcs, [], supportSrcs);
    const out = await novadaVerify(
      { claim: "The Eiffel Tower in Paris is 330 meters tall." },
      API_KEY,
    );
    const verdict = getVerdict(out);
    // Non-hedged factual claim must still be able to reach "supported"
    expect(verdict).toBe("supported");
  });
});

// ─── F7-C: URL sanitization — reject redirect-poisoned URLs ───────────────

describe("F7-C: Redirect-poisoned URL rejection/downranking", () => {
  it("URL with 'signOut' path component is excluded from evidence list", async () => {
    const redirectUrl = "https://accounts.example.com/signOut?redirect=https://source.com/study";
    const goodUrl = "https://pubmed.ncbi.nlm.nih.gov/study12345";
    const supportSrcs = [
      srcUrl("SignOut page", "Eiffel Tower is 330 meters in Paris.", redirectUrl),
      srcUrl("PubMed study", "Eiffel Tower height is 330 meters in Paris France.", goodUrl),
      srcUrl("Another source", "The Eiffel Tower in Paris stands 330 meters tall.", "https://example.com/h2"),
    ];
    mockQueries(supportSrcs, [], []);
    const out = await novadaVerify({ claim: "The Eiffel Tower in Paris is 330 meters tall" }, API_KEY);
    // The signOut URL must NOT appear in the Supporting URLs agent hint
    expect(out).not.toContain(redirectUrl);
  });

  it("URL with 'redirect=' query param is excluded from evidence URLs", async () => {
    const redirectUrl = "https://login.example.com/auth?redirect=https://example.org/article&token=abc";
    const goodUrl = "https://reuters.com/eiffel-tower-height";
    const supportSrcs = [
      srcUrl("Redirect auth", "The Eiffel Tower is 330 meters in Paris.", redirectUrl),
      srcUrl("Reuters", "Eiffel Tower in Paris is 330 meters tall.", goodUrl),
      srcUrl("Another source", "Eiffel Tower stands 330 meters.", "https://example.com/i1"),
    ];
    mockQueries(supportSrcs, [], []);
    const out = await novadaVerify({ claim: "The Eiffel Tower in Paris is 330 meters tall" }, API_KEY);
    expect(out).not.toContain(redirectUrl);
  });

  it("URL with 'source=' cross-domain param is excluded from evidence URLs", async () => {
    const redirectUrl = "https://viewer.example.com/view?source=https://malicious.com&id=123";
    const goodUrl = "https://wikipedia.org/Eiffel_Tower";
    const supportSrcs = [
      srcUrl("External viewer", "Eiffel Tower in Paris is 330 meters.", redirectUrl),
      srcUrl("Wikipedia Eiffel", "The Eiffel Tower in Paris is 330 meters tall.", goodUrl),
      srcUrl("Paris guide", "Eiffel Tower stands 330 meters in Paris.", "https://example.com/j1"),
    ];
    mockQueries(supportSrcs, [], []);
    const out = await novadaVerify({ claim: "The Eiffel Tower in Paris is 330 meters tall" }, API_KEY);
    expect(out).not.toContain(redirectUrl);
  });

  it("URL with nested viewer 'file=' param is excluded from evidence URLs", async () => {
    const redirectUrl = "https://docs.example.com/viewer?file=https://external.com/report.pdf";
    const goodUrl = "https://nih.gov/eiffel-study";
    const supportSrcs = [
      srcUrl("Doc viewer", "Eiffel Tower is 330 meters tall in Paris.", redirectUrl),
      srcUrl("NIH study", "Eiffel Tower height confirmed at 330 meters.", goodUrl),
      srcUrl("Paris study", "The Eiffel Tower stands 330 meters in Paris.", "https://example.com/k1"),
    ];
    mockQueries(supportSrcs, [], []);
    const out = await novadaVerify({ claim: "The Eiffel Tower in Paris is 330 meters tall" }, API_KEY);
    expect(out).not.toContain(redirectUrl);
  });

  it("URL with nested viewer 'file=' param whose decoded value contains signOut is excluded", async () => {
    // This replicates the real-world case: PDF viewer whose file= param embeds a signOut path
    // e.g. ?file=%2Findex.php%2Findex%2Flogin%2FsignOut%3Fsource%3D%2Esolalal.com%2Fsugar3%2F
    const redirectUrl = "https://elixirpublishers.in/plugins/generic/pdfJsViewer/pdf.js/web/viewer.html?file=%2Findex.php%2Findex%2Flogin%2FsignOut%3Fsource%3D%2Esolalal.com%2Fsugar3%2F&id=fFIteKHFidB";
    const goodUrl = "https://nih.gov/eiffel-study";
    const supportSrcs = [
      srcUrl("PDF viewer signOut", "Eiffel Tower is 330 meters tall in Paris.", redirectUrl),
      srcUrl("NIH study", "Eiffel Tower height confirmed at 330 meters.", goodUrl),
      srcUrl("Paris study", "The Eiffel Tower stands 330 meters in Paris.", "https://example.com/k2"),
    ];
    mockQueries(supportSrcs, [], []);
    const out = await novadaVerify({ claim: "The Eiffel Tower in Paris is 330 meters tall" }, API_KEY);
    expect(out).not.toContain(redirectUrl);
    // The good URL must still be present
    expect(out).toContain(goodUrl);
  });

  it("clean URLs are NOT filtered out", async () => {
    const goodUrl = "https://reuters.com/eiffel-tower-facts";
    const goodUrl2 = "https://wikipedia.org/Eiffel_Tower";
    const supportSrcs = [
      srcUrl("Reuters", "Eiffel Tower in Paris is 330 meters tall.", goodUrl),
      srcUrl("Wikipedia", "The Eiffel Tower stands 330 meters in Paris.", goodUrl2),
      srcUrl("Paris guide", "Eiffel Tower: 330 meters tall.", "https://example.com/l1"),
    ];
    mockQueries(supportSrcs, [], supportSrcs);
    const out = await novadaVerify({ claim: "The Eiffel Tower in Paris is 330 meters tall" }, API_KEY);
    // Good URLs must still appear
    expect(out).toContain(goodUrl);
  });
});

// ─── F7-D: Low-authority scientific claim warning ─────────────────────────

describe("F7-D: Low-authority scientific claim warning", () => {
  it("scientific claim with only social/PR sources emits primary-literature agent_instruction", async () => {
    // All sources are from social/PR domains — low authority for a scientific claim
    const lowAuthSrcs = [
      srcUrl("Reddit post", "Coffee is associated with reduced type 2 diabetes risk.", "https://reddit.com/r/health/coffee-diabetes"),
      srcUrl("Facebook health page", "Coffee linked to lower diabetes risk.", "https://facebook.com/healthpage/coffee-study"),
      srcUrl("Medium blog", "Coffee consumption associated with diabetes outcomes.", "https://medium.com/@blogger/coffee"),
    ];
    mockQueries(lowAuthSrcs, [], lowAuthSrcs);
    const out = await novadaVerify(
      { claim: "Moderate coffee consumption is associated with a reduced risk of type 2 diabetes." },
      API_KEY,
    );
    // agent_instruction must warn about primary literature verification
    expect(out).toMatch(/primary[_\-\s]literature|peer[_\-\s]reviewed|primary source|authoritative|pubmed|clinical trial/i);
  });

  it("scientific claim with high-authority sources does NOT unnecessarily emit the warning", async () => {
    const highAuthSrcs = [
      srcUrl("PubMed coffee study", "Coffee consumption associated with reduced type 2 diabetes risk.", "https://pubmed.ncbi.nlm.nih.gov/study1"),
      srcUrl("NIH diabetes review", "Coffee linked to lower diabetes risk per NIH review.", "https://nih.gov/coffee-diabetes"),
      srcUrl("Reuters health", "Coffee associated with diabetes risk reduction in meta-analysis.", "https://reuters.com/coffee-diabetes"),
    ];
    mockQueries(highAuthSrcs, [], highAuthSrcs);
    const out = await novadaVerify(
      { claim: "Moderate coffee consumption is associated with a reduced risk of type 2 diabetes." },
      API_KEY,
    );
    // Should not carry an alarmist low-authority warning when sources ARE authoritative
    // (Note: the keyword-match caveat is always present — we only check for the specific
    // low-authority primary-literature warning that fires when sources are NOT authoritative)
    expect(out).not.toMatch(/low[_\-\s]authority|verify.*primary literature.*social.*sources/i);
  });
});
