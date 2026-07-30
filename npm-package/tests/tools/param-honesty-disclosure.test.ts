/**
 * RED → GREEN tests for the "param-honesty" defect class (2026-07-30 owner audit,
 * extended after review round 1 to a 4th class member found by the reviewer).
 *
 * Four params are ACCEPTED from the caller, silently NOT honored, with disclosure
 * living only in the tool DESCRIPTION prose (fine print an agent never re-reads):
 *
 *   1. novada_proxy country when type="isp"      — already fixed, precedent (see
 *      tests/tools/country-warning.test.ts). Not touched here.
 *   2. novada_browser country                    — accepted, never geo-routes the
 *      Browser API exit node. Covered below (a).
 *   3. novada_ai_monitor topics[1..n]             — only topics[0] is ever queried;
 *      the rest are silently dropped. Covered below (b). The eventual real fix is
 *      the topics×models fan-out tracked separately (TOW2-353, see the untracked
 *      WIP tests/tools/ai_monitor.test.ts) — THIS file only adds disclosure and
 *      must not implement fan-out.
 *   4. novada_extract country                    — accepted, but only takes effect
 *      on the render/js fetch path (fetchWithRender); the DEFAULT render="auto"
 *      race against a plain static fetch (fetchViaProxy, no country field at all)
 *      drops it, and a geo-blocked page is usually plain static HTML so it won't
 *      escalate. Surfaced by review round 1 as the exact fine-print antipattern
 *      this task exists to kill. Covered below (d).
 *
 * Contract for all four: disclosure must be (i) in the response body text AND (ii)
 * in the response's `agent_instruction`, naming the specific un-honored input — and
 * must fire ONLY when that input was actually supplied (no noise otherwise), and
 * ONLY when it was genuinely not applied (never when a later escalation actually
 * honored it — see the extract.ts render-mode tests in section (d)).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NovadaSearchResult } from "../../src/tools/types.js";

// ─── (a) novada_browser — country ────────────────────────────────────────────

vi.mock("playwright-core", () => ({
  chromium: { connectOverCDP: vi.fn() },
}));

import { novadaBrowser } from "../../src/tools/browser.js";
import { chromium } from "playwright-core";
import { closeSession, listSessions } from "../../src/utils/browser.js";

function createMockPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    title: vi.fn().mockResolvedValue("Test Page"),
    setDefaultTimeout: vi.fn(),
  };
}

function setupBrowserMock() {
  const mockPage = createMockPage();
  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockBrowser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(chromium.connectOverCDP).mockResolvedValue(mockBrowser as never);
  return mockPage;
}

const NAVIGATE_ACTION = {
  actions: [{ action: "navigate" as const, url: "https://example.com", wait_until: "domcontentloaded" as const }],
  timeout: 60000,
};

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  for (const id of listSessions()) {
    void closeSession(id);
  }
  process.env.NOVADA_BROWSER_WS = "wss://test:test@example.com";
  process.env.NOVADA_PROXY_USER = originalEnv.NOVADA_PROXY_USER;
  process.env.NOVADA_PROXY_PASS = originalEnv.NOVADA_PROXY_PASS;
  process.env.NOVADA_PROXY_ENDPOINT = originalEnv.NOVADA_PROXY_ENDPOINT;
});

describe("novada_browser — country agent_instruction disclosure", () => {
  it("(a) country supplied: body still contains the existing ## Warnings disclosure", async () => {
    setupBrowserMock();
    const result = await novadaBrowser({ ...NAVIGATE_ACTION, country: "de" });
    expect(result).toContain("## Warnings");
    expect(result).toContain("country accepted but not applied on this endpoint");
  });

  it("(a) country supplied: agent_instruction names the param and the workaround", async () => {
    setupBrowserMock();
    const result = await novadaBrowser({ ...NAVIGATE_ACTION, country: "de" });

    expect(result).toContain("agent_instruction:");
    // Must name WHICH input was not applied. Casing matches the proxy_isp precedent
    // ("accepted but not applied", lowercase "not" — review round 1 FIX 3).
    expect(result).toContain('country="de" was accepted but not applied to the browser exit node');
    // Must tell the agent what to do instead — review round 1 FIX 1: the workaround
    // must require render="render"/"js" explicitly, since novada_extract's own
    // DEFAULT (render="auto"/"static") drops country too.
    expect(result).toContain("do not rely on it for geo-restricted content");
    expect(result).toContain('use novada_extract with country="de" AND render="render" (or render="js") instead');
    expect(result).toContain('novada_extract\'s DEFAULT render="auto"/"static" path drops country just like this tool does');
  });

  it("(a) country supplied: the agent_instruction line and the country warning appear together", async () => {
    setupBrowserMock();
    const result = await novadaBrowser({ ...NAVIGATE_ACTION, country: "jp" });

    const warningIdx = result.indexOf("## Warnings");
    const instructionIdx = result.indexOf('agent_instruction: country="jp"');
    expect(warningIdx).toBeGreaterThan(-1);
    expect(instructionIdx).toBeGreaterThan(-1);
  });

  it("(c) country OMITTED: no country agent_instruction line at all (no noise)", async () => {
    setupBrowserMock();
    const result = await novadaBrowser(NAVIGATE_ACTION);

    expect(result).not.toContain("was accepted but not applied to the browser exit node");
    expect(result).not.toContain('agent_instruction: country=');
  });

  it("existing success shape is otherwise unchanged (actions/succeeded/failed line intact)", async () => {
    setupBrowserMock();
    const result = await novadaBrowser({ ...NAVIGATE_ACTION, country: "de" });

    expect(result).toContain("## Browser Session Results");
    expect(result).toContain("actions: 1 | succeeded: 1 | failed: 0");
    expect(result).toContain("### Action 1: navigate [ok]");
  });
});

// ─── (b) novada_ai_monitor — topics[1..n] ────────────────────────────────────

vi.mock("../../src/tools/search.js", () => ({
  submitSearchScrapeTask: vi.fn(),
  resolveSearchResults: vi.fn(),
}));

import { novadaAiMonitor } from "../../src/tools/ai_monitor.js";
import { submitSearchScrapeTask, resolveSearchResults } from "../../src/tools/search.js";

const mockedSubmit = vi.mocked(submitSearchScrapeTask);
const mockedResolve = vi.mocked(resolveSearchResults);

const API_KEY = "test-key-123";

function resultFor(query: string): NovadaSearchResult[] {
  return [{
    title: `Result for ${query}`,
    url: "https://openai.com/mention",
    link: "https://openai.com/mention",
    description: `${query} — neutral mention`,
    snippet: `${query} — neutral mention`,
  }];
}

beforeEach(() => {
  mockedSubmit.mockImplementation(async (_apiKey, _scraperName, _scraperId, query) => ({
    inlineResults: { __query: query },
  } as never));
  mockedResolve.mockImplementation(async (_apiKey, submitted) => {
    const query = (submitted as unknown as { inlineResults: { __query: string } }).inlineResults.__query;
    return resultFor(query);
  });
});

describe("novada_ai_monitor — topics[1..n] disclosure", () => {
  it("(b) multiple topics supplied: body contains a ## Warnings block naming the ignored topics", async () => {
    const result = await novadaAiMonitor(
      { brand: "novada", models: ["chatgpt"], topics: ["pricing", "reliability", "support"] },
      API_KEY,
    );

    expect(result).toContain("## Warnings");
    expect(result).toContain("topics[1..] accepted but not applied");
    // The warning is JSON.stringify'd (matching the browser.ts/proxy_isp.ts
    // warningsBlock convention), so embedded quotes are backslash-escaped.
    expect(result).toContain("only topics[0]");
    expect(result).toContain("pricing");
    expect(result).toContain("reliability");
    expect(result).toContain("support");
  });

  it("(b) multiple topics supplied: agent_instruction names the ignored topics and tells the agent to issue one call per topic", async () => {
    const result = await novadaAiMonitor(
      { brand: "novada", models: ["chatgpt"], topics: ["pricing", "reliability"] },
      API_KEY,
    );

    expect(result).toContain("agent_instruction:");
    expect(result).toContain('topics "reliability" were accepted but not applied');
    expect(result).toContain("do not rely on them being queried");
    expect(result).toContain("Issue one novada_ai_monitor call per topic to cover the rest");
  });

  // Regression guard for the 2026-07-30 marker-drift incident: contract-test.py's
  // PARAM_HONESTY invariant (case 9) requires the SAME case-insensitive marker set
  // (["not applied", "do not rely"]) to appear on BOTH the body "## Warnings" block
  // AND, separately, the `agent_instruction:` line — checking only one surface let
  // ai_monitor's agent_instruction drift out of sync with its own body disclosure
  // (it said "were NOT queried" instead of sharing the class-wide marker used by
  // novada_proxy/novada_browser/novada_extract). Pin both surfaces here so that
  // drift trips locally before it ever reaches the nightly canary.
  it("(b) shared PARAM_HONESTY marker ['not applied' | 'do not rely'] present on BOTH the body warning and the agent_instruction line", async () => {
    const result = await novadaAiMonitor(
      { brand: "novada", models: ["chatgpt"], topics: ["pricing", "reliability", "support"] },
      API_KEY,
    );

    const warningsIdx = result.indexOf("## Warnings");
    const agentInstructionIdx = result.indexOf("agent_instruction:");
    expect(warningsIdx).toBeGreaterThan(-1);
    expect(agentInstructionIdx).toBeGreaterThan(-1);
    expect(agentInstructionIdx).toBeGreaterThan(warningsIdx);

    const bodyText = result.slice(warningsIdx, agentInstructionIdx).toLowerCase();
    const instructionText = result.slice(agentInstructionIdx).toLowerCase();
    const sharedMarkers = ["not applied", "do not rely"];

    expect(sharedMarkers.some(m => bodyText.includes(m))).toBe(true);
    expect(sharedMarkers.some(m => instructionText.includes(m))).toBe(true);
  });

  it("(c) single topic supplied: NO ignored-topics disclosure anywhere (no noise)", async () => {
    const result = await novadaAiMonitor(
      { brand: "novada", models: ["chatgpt"], topics: ["pricing"] },
      API_KEY,
    );

    expect(result).not.toContain("## Warnings");
    expect(result).not.toContain("topics[1..] accepted but not applied");
    expect(result).not.toContain("were NOT queried");
  });

  it("(c) no topics supplied at all: NO ignored-topics disclosure anywhere (no noise)", async () => {
    const result = await novadaAiMonitor({ brand: "novada", models: ["chatgpt"] }, API_KEY);

    expect(result).not.toContain("## Warnings");
    expect(result).not.toContain("were NOT queried");
  });

  it("does not implement topic fan-out — still issues exactly ONE query per model regardless of topic count", async () => {
    await novadaAiMonitor(
      { brand: "novada", models: ["chatgpt", "perplexity"], topics: ["pricing", "reliability", "support"] },
      API_KEY,
    );

    // Fan-out (topics × models) is TOW2-353 and explicitly out of scope for this
    // disclosure-only fix — 2 models × 1 (topics[0]-only) query = 2, not 6.
    expect(mockedSubmit).toHaveBeenCalledTimes(2);
  });

  it("existing success shape is otherwise unchanged (header + mentions_found line intact)", async () => {
    const result = await novadaAiMonitor(
      { brand: "novada", models: ["chatgpt"], topics: ["pricing", "reliability"] },
      API_KEY,
    );

    expect(result).toContain("## Brand Presence on AI-Company Domains — novada");
    expect(result).toMatch(/mentions_found: \d+/);
  });
});

// ─── (d) novada_extract — country dropped on the default auto/static path ───
//
// Review round 1 HIGH + 4th class member. novada_extract's `country` only reaches
// an outbound fetch via fetchWithRender (render/js path). The default render="auto"
// races a direct static fetch / fetchViaProxy — neither forwards country — so a
// geo-blocked page (usually plain static HTML, per the review) silently drops it.
// extract.ts now tracks this precisely via `countryAppliedToServedContent`, set
// ONLY at the fetchWithRender call sites that actually forward params.country, and
// explicitly reset to false by the Wayback fallback (which never forwards country
// regardless of what happened earlier). See the PARAM-HONESTY comments in extract.ts.

vi.mock("axios");

import axios from "axios";
import { novadaExtract } from "../../src/tools/extract.js";
import { clearCache } from "../../src/_core/session-cache.js";

const mockedAxios = vi.mocked(axios);
const EXTRACT_API_KEY = "test-key-123";

const CLEAN_HTML = `
  <html>
    <head><title>Geo Page</title></head>
    <body>
      <main>
        <h1>Geo Page</h1>
        <p>${"This is plain static content with enough text to pass the extraction quality bar. ".repeat(6)}</p>
      </main>
    </body>
  </html>
`;

beforeEach(() => {
  clearCache();
  mockedAxios.get.mockResolvedValue({ data: CLEAN_HTML, headers: { "content-type": "text/html" } });
  mockedAxios.post.mockResolvedValue({
    data: { data: { html: CLEAN_HTML, status_code: 200 } },
    status: 200,
    headers: {},
  });
});

describe("novada_extract — country dropped on default auto/static path", () => {
  it("(d) country supplied, default render='auto' resolves via static: body has ## Warnings naming country and the resolved mode", async () => {
    const result = await novadaExtract({ url: "https://example.com/geo", country: "de" }, EXTRACT_API_KEY);

    expect(result).toContain("## Warnings");
    // The warning is JSON.stringify'd (matching the browser.ts/ai_monitor.ts
    // warningsBlock convention), so embedded quotes are backslash-escaped.
    expect(result).toContain("accepted but not applied");
    expect(result).toContain("de");
    expect(result).toContain('resolved via mode=');
    expect(result).toContain("static");
    expect(result).toContain("do not rely on it here");
  });

  it("(d) country supplied, default render='auto' resolves via static: agent_instruction names country and tells the agent to retry with render=\"render\"", async () => {
    const result = await novadaExtract({ url: "https://example.com/geo", country: "de" }, EXTRACT_API_KEY);

    expect(result).toContain("agent_instruction:");
    expect(result).toContain('country="de" was accepted but NOT applied (resolved mode: "static")');
    expect(result).toContain("do not rely on it for geo-restricted content");
    expect(result).toContain('Retry with render="render" (or render="js") and country="de" to have it actually honored');
  });

  it("(d) country supplied AND actually applied via render=\"render\": NO disclosure anywhere (country was genuinely honored)", async () => {
    const result = await novadaExtract({ url: "https://example.de", render: "render", country: "de" }, EXTRACT_API_KEY);

    expect(result).toContain("mode: render");
    expect(result).not.toContain("## Warnings");
    expect(result).not.toContain("accepted but not applied");
    expect(result).not.toContain('country="de" was accepted but NOT applied');
  });

  it("(d) country OMITTED entirely: NO disclosure regardless of resolved mode (no noise)", async () => {
    const result = await novadaExtract({ url: "https://example.com/geo" }, EXTRACT_API_KEY);

    expect(result).not.toContain("## Warnings");
    expect(result).not.toContain("accepted but not applied");
  });

  it("existing success shape is otherwise unchanged (header/title/mode lines intact)", async () => {
    const result = await novadaExtract({ url: "https://example.com/geo", country: "de" }, EXTRACT_API_KEY);

    expect(result).toContain("## Extracted Content");
    expect(result).toContain("title: Geo Page");
    expect(result).toMatch(/mode: \w+/);
  });
});

// ─── (a) review round 2 HIGH regression guard ────────────────────────────────
//
// The JS-heavy auto-escalation branch has THREE pickBetterHtml-adjacent outcomes:
// render-succeeds-clean (sets the flag), render-still-JS-heavy-then-browser-wins
// (correctly no flag — browser doesn't support country), and render-still-JS-heavy-
// then-browser-LOSES-so-render-is-kept (the actually-served content IS the
// country-fetched render — round 2 found this third case never set the flag,
// producing a FALSE "not applied" disclosure with self-contradictory text:
// `resolved via mode="render", not "render"`). This test pins that third case.

describe("novada_extract — round 2 regression: render kept after failed browser escalation", () => {
  it("(a) static AND render both JS-heavy, browser escalation fails/blank, pickBetterHtml KEEPS render: NO false disclosure", async () => {
    const prevWs = process.env.NOVADA_BROWSER_WS;
    const prevUnblocker = process.env.NOVADA_WEB_UNBLOCKER_KEY;
    process.env.NOVADA_BROWSER_WS = "wss://test:test@example.com";
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "test-unblocker-key";
    try {
      // Static race (direct fetch + proxy fetch, both via axios.get) — JS-heavy shell,
      // triggers auto-escalation into the try block.
      const staticShell = `<html><head><title>App</title></head><body><div id="root"></div></body></html>`;
      mockedAxios.get.mockResolvedValue({ data: staticShell, headers: { "content-type": "text/html" } });

      // Render fetch (fetchWithRender → axios.post, since NOVADA_WEB_UNBLOCKER_KEY is
      // set) forwards params.country (extract.ts line ~1154) and returns a DIFFERENT
      // JS-heavy shell — NOT a bot-challenge, so this lands in the "else if
      // (isBrowserConfigured())" branch (round 2's bug site), not the bot-challenge
      // branch.
      // 3 divs (0 <p> tags) keeps detectBotChallenge's "divCount<3 && pCount===0"
      // heuristic signal from firing — a single bare div would tip it to 2+ signals
      // (short body text is an unavoidable 1st signal) and misroute this test into
      // the bot-challenge branch instead of the "still JS-heavy" branch under test.
      const renderJsHeavyShell = `<html><head><title>App Shell</title></head><body><div id="__next"></div><div></div><div></div></body></html>`;
      mockedAxios.post.mockResolvedValue({
        data: { code: 0, data: { code: 200, html: renderJsHeavyShell, msg: "", msg_detail: "" } },
        status: 200,
        headers: { "content-type": "text/html" },
      });

      // Browser escalation returns blank — pickBetterHtml.adopted stays false, so the
      // served content is renderJsHeavyShell (mode stays "render"), not browserHtml.
      const utilsIndex = await import("../../src/utils/index.js");
      const utilsSpy = vi.spyOn(utilsIndex, "fetchViaBrowser").mockResolvedValue("");

      clearCache();
      const result = await novadaExtract(
        { url: "https://round2-render-kept.example", country: "de", format: "markdown" },
        EXTRACT_API_KEY,
      );

      utilsSpy.mockRestore();

      // Confirm we actually reached the intended branch (served content is "render").
      expect(result).toContain("mode: render");
      // The regression: no false "country not applied" disclosure when country WAS
      // genuinely forwarded to the fetch whose result is what got served.
      expect(result).not.toContain("## Warnings");
      expect(result).not.toContain("accepted but not applied");
      expect(result).not.toContain('country="de" was accepted but NOT applied');
      // The reported symptom was specifically this self-contradictory phrasing —
      // pin it directly so a future regression is caught even if other assertions
      // above are loosened.
      expect(result).not.toContain('resolved via mode="render", not "render"');
    } finally {
      if (prevWs === undefined) delete process.env.NOVADA_BROWSER_WS; else process.env.NOVADA_BROWSER_WS = prevWs;
      if (prevUnblocker === undefined) delete process.env.NOVADA_WEB_UNBLOCKER_KEY; else process.env.NOVADA_WEB_UNBLOCKER_KEY = prevUnblocker;
    }
  });
});

// ─── (e) review round 2 MEDIUM: batch mode must not truncate the disclosure away ─
//
// The per-item inline summary snippet is sliced AFTER the header block's own
// "---" separator, which sits AFTER the ## Warnings block — so the disclosure is
// structurally excluded from the snippet the agent actually reads inline,
// regardless of page size. types.ts explicitly promotes batch mode for comparing
// prices across countries — the most country-sensitive use case is the one that
// silently lost the disclosure. Fixed by putting a `country_not_applied:true`
// flag directly on each item's "### [i/n] STATUS: url" header line, which the
// batch summary never truncates.

describe("novada_extract — round 2 regression: batch mode surfaces disclosure inline", () => {
  it("(b) batch mode, large page (~12.7K chars) + country not applied: header line carries country_not_applied:true", async () => {
    clearCache();
    // ~12.7K chars — matches the reviewer's own reproduction size, well past any
    // per-item snippet budget, and definitely past where the ## Warnings block
    // (which sits BEFORE the snippet's start point) would ever survive slicing.
    const largePage = `<html><head><title>EU Product</title></head><body><main><h1>EU Product</h1><p>${"Price comparison text across European countries. ".repeat(250)}</p></main></body></html>`;
    mockedAxios.get.mockResolvedValue({ data: largePage, headers: { "content-type": "text/html" } });

    const result = await novadaExtract(
      { urls: ["https://shop.example/de", "https://shop.example/fr"], country: "de" },
      EXTRACT_API_KEY,
    );

    expect(result).toContain("## Batch Extract Results");
    // The flag survives on the header line for BOTH items (2 of 2).
    expect(result).toContain("country_not_applied:true");
    const flagCount = (result.match(/country_not_applied:true/g) ?? []).length;
    expect(flagCount).toBe(2);
    // Batch-level agent_instruction-equivalent hint naming the count and the workaround.
    expect(result).toContain('country="de" was accepted but NOT applied on 2 of 2 URL(s)');
    expect(result).toContain('Retry those URLs individually with render="render"');
  });

  it("(b) batch mode, country OMITTED: no country_not_applied flag anywhere (no noise)", async () => {
    clearCache();
    const largePage = `<html><head><title>EU Product</title></head><body><main><h1>EU Product</h1><p>${"Plain content, no geo-targeting involved here at all. ".repeat(250)}</p></main></body></html>`;
    mockedAxios.get.mockResolvedValue({ data: largePage, headers: { "content-type": "text/html" } });

    const result = await novadaExtract(
      { urls: ["https://shop.example/de", "https://shop.example/fr"] },
      EXTRACT_API_KEY,
    );

    expect(result).not.toContain("country_not_applied:true");
    expect(result).not.toContain("was accepted but NOT applied on");
  });
});
