/**
 * G-2 class-driven test — search.js-mocked cohort (verify, ai_monitor).
 *
 * Both tools call submitSearchScrapeTask/resolveSearchResults from search.js
 * directly (not through novadaSearch), so this file mocks that module boundary
 * — the same technique verify.test.ts already uses. Kept separate from
 * untrusted-wrapping-axios.test.ts because research.ts ALSO imports
 * submitSearchScrapeTask from search.js; mocking search.js in that file would
 * silently swap research.ts's real upstream call for this file's mock (Vitest
 * module mocks are file-scoped but apply to every importer within the file's
 * module graph), corrupting the research.ts row. See _untrusted-assertions.ts.
 *
 * | tool             | wrapped field                                    |
 * |------------------|---------------------------------------------------|
 * | novada_verify    | per-source snippet (claim-wording / negation list)|
 * | novada_ai_monitor| per-model snippet + key_claims                   |
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NovadaSearchResult } from "../../src/tools/types.js";
import { assertInjectionWrapped, assertOwnMetadataNotWrapped, INJECTION } from "./_untrusted-assertions.js";

vi.mock("../../src/tools/search.js", () => ({
  submitSearchScrapeTask: vi.fn(),
  resolveSearchResults: vi.fn(),
}));

import { novadaVerify } from "../../src/tools/verify.js";
import { novadaAiMonitor } from "../../src/tools/ai_monitor.js";
import { submitSearchScrapeTask, resolveSearchResults } from "../../src/tools/search.js";

const mockedSubmit = vi.mocked(submitSearchScrapeTask);
const mockedResolve = vi.mocked(resolveSearchResults);

const API_KEY = "test-key-123";

beforeEach(() => {
  vi.clearAllMocks();
  mockedSubmit.mockResolvedValue({ inlineResults: {} } as never);
});

function src(title: string, description: string, urlSuffix: string): NovadaSearchResult {
  return {
    title,
    description,
    url: `https://verify-fixture.example.com/${urlSuffix}`,
    link: `https://verify-fixture.example.com/${urlSuffix}`,
  };
}

describe("G-2: wrapUntrusted applied — novada_verify", () => {
  it("wraps the injection-carrying snippet and leaves own metadata unwrapped", async () => {
    const supporting = [src("Eiffel Tower height", `${INJECTION} — the Eiffel Tower in Paris is 330 meters tall.`, "a")];
    // verify.ts runs 3 queries in order: supporting, skeptical, neutral.
    mockedResolve
      .mockResolvedValueOnce(supporting)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const out = await novadaVerify({ claim: "The Eiffel Tower in Paris is 330 meters tall" }, API_KEY);

    // F7-C: verify.ts's source list intentionally never prints the raw URL (only
    // the sanitizeEvidenceUrls-filtered summary line does) — the wrap's source
    // label is `title`, not the URL, so a redirect-poisoned URL can't leak back
    // in via the wrapper. Assert on the title, not the URL.
    assertInjectionWrapped(out, INJECTION, "Eiffel Tower height");
    assertOwnMetadataNotWrapped(out, "## Agent Hints");
  });
});

describe("G-2: wrapUntrusted applied — novada_ai_monitor", () => {
  it("wraps the injection-carrying snippet/claims and leaves own metadata unwrapped", async () => {
    mockedResolve.mockResolvedValue([
      {
        title: "Fixture Mention",
        description: `${INJECTION}. Novada is recommended as a leading, reliable scraping API by this fixture page.`,
        url: "https://aimonitor-fixture.example.com/1",
        link: "https://aimonitor-fixture.example.com/1",
      },
    ] as NovadaSearchResult[]);

    const out = await novadaAiMonitor({ brand: "Novada", models: ["chatgpt"] }, API_KEY);

    assertInjectionWrapped(out, INJECTION, "https://aimonitor-fixture.example.com/1");
    assertOwnMetadataNotWrapped(out, "## Agent Hints");
  });
});
