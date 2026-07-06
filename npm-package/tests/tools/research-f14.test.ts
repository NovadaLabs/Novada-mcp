/**
 * Tests for F14 (P1): Three sub-fixes for novadaResearch
 *
 * F14-1: nav/header chrome must not leak into the assembled source material
 * F14-2: generateSearchQueries truncates named entities from sub-queries
 * F14-3: depth=auto silently resolves with no provenance (no requested_depth / resolved_depth)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaResearch } from "../../src/tools/research.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-f14";

beforeEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Inline search envelope matching the format search.ts fast-path expects */
const searchEnvelope = (org: { title: string; url: string; description: string }[]) => ({
  data: { code: 0, data: { data: { json: [{ rest: { organic: org } }] } } },
  status: 200,
  headers: {},
  config: {} as never,
  statusText: "OK",
});

/** Make an extract HTTP response with given body text */
const extractResponse = (body: string) => ({
  data: `<html><body>${body}</body></html>`,
  status: 200,
  headers: {},
  config: {} as never,
  statusText: "OK",
});

/** Nav-chrome text that should never appear in summaries */
const NAV_CHROME = [
  "[Skip to main content]",
  "Skip to main content",
  "Sign up",
  "Sign in",
  "Toggle navigation",
  "Cookie settings",
  "Accept all cookies",
];

// ──────────────────────────────────────────────────────────────────────────────
// F14-1: nav/header chrome filtering in assembled source material
// ──────────────────────────────────────────────────────────────────────────────
// Contract note: research now assembles CITED SOURCE MATERIAL (## Researched source
// material for: …, material:grounded|snippets|insufficient) rather than a "synthesized"
// ## Summary. Nav chrome must never appear in the material; nav-only sources must not
// be presented as grounded material.

describe("F14-1: nav-chrome filtering in source material", () => {
  it("RED: material must NOT contain nav-chrome text like [Skip to main content]", async () => {
    // The extraction returns content that starts with nav chrome
    const navChrome = `[Skip to main content] Sign up Sign in Toggle navigation\n\nMain content about proxies here.`;
    const realContent = `Residential proxies route traffic through real ISP-assigned IP addresses. They are harder to detect than datacenter proxies. Datacenter proxies are faster but easier to block. Trade-offs include cost, speed, and detectability.`;

    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{ title: "Proxy Guide", url: "https://proxyguide.example.com", description: "Guide about proxies" }])
    );
    // Extraction returns nav chrome first
    mockedAxios.get.mockResolvedValueOnce(extractResponse(`<nav>${navChrome}</nav><article><p>${realContent}</p></article>`));

    const result = await novadaResearch(
      { question: "What are the main tradeoffs between residential and datacenter proxies?", depth: "quick" },
      API_KEY
    );

    const material = extractMaterialSection(result);
    // Material must not contain nav chrome lines
    for (const chrome of NAV_CHROME) {
      expect(material, `Material must not contain nav chrome: "${chrome}"`).not.toContain(chrome);
    }
  });

  it("RED: nav-chrome-only source is never grounded material (insufficient/snippets, not grounded)", async () => {
    // After stripping all nav-chrome lines, nothing on-topic survives → not grounded.
    const navOnlyContent = `[Skip to main content]\nSign up\nSign in\nToggle navigation\nCookie preferences`;

    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{ title: "Chrome Heavy Page", url: "https://chrome-heavy.example.com", description: "A page with lots of navigation" }])
    );
    mockedAxios.get.mockResolvedValueOnce(extractResponse(`<p>${navOnlyContent}</p>`));

    const result = await novadaResearch(
      { question: "How do residential proxies work for web scraping?", depth: "quick" },
      API_KEY
    );

    expect(result).not.toMatch(/material:grounded/);
    expect(result).toMatch(/material:(insufficient|snippets)/);
  });

  it("RED: prefers fragment containing question keywords over nav-chrome fragment", async () => {
    // First extracted content = chrome-heavy; second = actual answer
    mockedAxios.post.mockResolvedValue(
      searchEnvelope([
        { title: "Nav-heavy page", url: "https://nav.example.com", description: "navigation page" },
        { title: "Real proxy guide", url: "https://real.example.com", description: "residential proxies are real IPs" },
      ])
    );
    // URL-aware mock (nav page is a bot-challenge → extract.ts also fires a
    // web.archive.org fallback GET for it; keying on URL avoids the real content
    // being consumed by that out-of-order retry under Promise.all).
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes("real.example.com")) {
        return extractResponse(`<p>Residential proxies use real ISP-assigned IP addresses, making them harder to detect. Datacenter proxies are faster but more likely to be blocked by anti-bot systems.</p>`);
      }
      return extractResponse(`<nav>[Skip to main content] Sign up Sign in</nav>`); // nav.example.com + archive retry
    });

    const result = await novadaResearch(
      { question: "tradeoffs between residential and datacenter proxies for web scraping", depth: "quick" },
      API_KEY
    );

    const material = extractMaterialSection(result);
    // Should contain content about proxies, not nav chrome
    expect(material).toMatch(/residential|datacenter|ISP|proxy|proxies/i);
    for (const chrome of NAV_CHROME) {
      expect(material).not.toContain(chrome);
    }
  });

  it("chrome-heavy fragments get filtered: summary uses real content from other fragments", async () => {
    // Generalization scenario 1: chrome-heavy fragments → summary excludes them
    const chromeHeavy = "[Skip to main content] Sign in Sign up Toggle navigation Accept cookies";
    const realInfo = "Datacenter proxies originate from cloud providers and are fast and cheap. Residential proxies appear as home internet connections.";

    mockedAxios.post.mockResolvedValue(
      searchEnvelope([
        { title: "Chrome source", url: "https://chrome.example.com", description: "nav chrome page" },
        { title: "Real source", url: "https://real.example.com", description: realInfo },
      ])
    );
    // URL-aware mock: the chrome page is a bot-challenge, so extract.ts also fires a
    // web.archive.org fallback GET for it — 3 GETs for 2 sources, resolving out of
    // order under Promise.all. Keying on the URL (not a positional `Once` queue) keeps
    // the chrome page returning chrome content on BOTH its direct + archive fetch, so
    // the real source's content is never stolen by the retry.
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes("real.example.com")) return extractResponse(`<p>${realInfo}</p>`);
      return extractResponse(`<p>${chromeHeavy}</p>`); // chrome.example.com + its archive retry
    });

    const result = await novadaResearch(
      { question: "What is the difference between datacenter and residential proxies?", depth: "quick" },
      API_KEY
    );

    const material = extractMaterialSection(result);
    expect(material).toMatch(/datacenter|residential|proxy|proxies/i);
    expect(material).not.toContain("[Skip to main content]");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// F14-2: generateSearchQueries — named entity retention
// ──────────────────────────────────────────────────────────────────────────────

describe("F14-2: generateSearchQueries named entity retention", () => {
  it("RED: sub-queries retain the named comparand 'Novada' in comparison questions", async () => {
    // Currently keyPhrase = first-4 keywords, so "Novada" at position 5+ gets dropped
    // queries[0] is always the original question (which contains "Novada"),
    // but the derived sub-queries (indices 1+) lose the named entity.
    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{ title: "Comparison", url: "https://compare.example.com", description: "proxy comparison" }])
    );
    mockedAxios.get.mockResolvedValue(extractResponse("<p>Proxy services comparison here.</p>"));

    const result = await novadaResearch(
      { question: "What are the main differences between residential proxies and Novada?", depth: "quick" },
      API_KEY
    );

    // Sub-queries (position 1+) should contain "Novada" — right now they don't (keyPhrase = first 4 words)
    const queries = extractGeneratedQueries(result);
    // Skip the first query (which is the original question verbatim)
    const subQueries = queries.slice(1);
    const subQueryHasNovada = subQueries.some(q => q.toLowerCase().includes("novada"));
    expect(subQueryHasNovada, `"Novada" should appear in derived sub-queries (not just the original question). Sub-queries: ${JSON.stringify(subQueries)}`).toBe(true);
  });

  it("RED: 6+ keyword question keeps all named proper nouns in derived sub-queries", async () => {
    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{ title: "SDK docs", url: "https://sdk.example.com", description: "SDK version info" }])
    );
    mockedAxios.get.mockResolvedValue(extractResponse("<p>Model Context Protocol SDK for TypeScript details.</p>"));

    const result = await novadaResearch(
      { question: "What is the current version of the Model Context Protocol SDK for TypeScript?", depth: "quick" },
      API_KEY
    );

    const queries = extractGeneratedQueries(result);
    // Skip the first query (verbatim original question)
    const subQueries = queries.slice(1);

    // "TypeScript" is a named entity at position 7+ that currently gets truncated by the keyPhrase slice
    // It must appear in at least one derived sub-query
    const hasTypeScript = subQueries.some(q => q.toLowerCase().includes("typescript"));

    expect(hasTypeScript,
      `"TypeScript" (a named entity at word position 7+) should survive into derived sub-queries. Sub-queries: ${JSON.stringify(subQueries)}`
    ).toBe(true);
  });

  it("comparison question with zero-hit comparand emits warning in output", async () => {
    // Generalization scenario 4: comparison question where one comparand has zero hits → warning
    mockedAxios.post
      .mockResolvedValueOnce(searchEnvelope([{ title: "Proxy A info", url: "https://proxya.example.com", description: "ProxyA is a service" }]))
      .mockResolvedValue(searchEnvelope([])); // All other queries return 0 results

    mockedAxios.get.mockResolvedValue(extractResponse("<p>ProxyA is a residential proxy service.</p>"));

    const result = await novadaResearch(
      { question: "Compare ProxyA vs UnknownBrandXYZ residential proxy performance", depth: "quick" },
      API_KEY
    );

    // When a named comparand has zero hits, the output should warn about it
    // Currently no such warning exists — should appear in Agent Hints section
    expect(result).toMatch(/UnknownBrandXYZ|comparand|no results/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// F14-3: depth=auto provenance
// ──────────────────────────────────────────────────────────────────────────────

describe("F14-3: depth=auto provenance", () => {
  it("RED: depth=auto output contains both requested_depth and resolved_depth fields", async () => {
    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{ title: "MCP SDK", url: "https://mcp.example.com", description: "MCP SDK TypeScript version info" }])
    );
    mockedAxios.get.mockResolvedValue(extractResponse("<p>The Model Context Protocol SDK for TypeScript is at version 1.x.</p>"));

    const result = await novadaResearch(
      { question: "What is the current version of the Model Context Protocol SDK for TypeScript?", depth: "auto" },
      API_KEY
    );

    // F14-3: must emit both fields — currently only emits depth:resolved_value
    expect(result, "should contain requested_depth field").toMatch(/requested_depth/);
    expect(result, "should contain resolved_depth field").toMatch(/resolved_depth/);
  });

  it("RED: auto resolves to 'deep' for complex questions, provenance shows both", async () => {
    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{ title: "Proxy tradeoffs", url: "https://proxytrade.example.com", description: "tradeoffs between proxy types" }])
    );
    mockedAxios.get.mockResolvedValue(extractResponse("<p>Residential proxies have trade-offs versus datacenter proxies.</p>"));

    const result = await novadaResearch(
      { question: "What are the main tradeoffs between residential and datacenter proxies for web scraping?", depth: "auto" },
      API_KEY
    );

    expect(result).toMatch(/requested_depth[:\s]*auto/i);
    expect(result).toMatch(/resolved_depth[:\s]*(deep|quick)/i);
  });

  it("depth=quick explicit → provenance shows requested_depth=quick resolved_depth=quick", async () => {
    // Generalization scenario 3: explicit depth=quick still shows provenance
    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{ title: "Quick result", url: "https://quick.example.com", description: "quick proxy info" }])
    );
    mockedAxios.get.mockResolvedValue(extractResponse("<p>Quick proxy information here.</p>"));

    const result = await novadaResearch(
      { question: "How do HTTP proxies work?", depth: "quick" },
      API_KEY
    );

    expect(result).toMatch(/requested_depth[:\s]*quick/i);
    expect(result).toMatch(/resolved_depth[:\s]*quick/i);
  });

  it("depth=deep explicit → provenance shows requested_depth=deep resolved_depth=deep", async () => {
    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{ title: "Deep result", url: "https://deep.example.com", description: "deep proxy analysis" }])
    );
    mockedAxios.get.mockResolvedValue(extractResponse("<p>Detailed proxy analysis information here.</p>"));

    const result = await novadaResearch(
      { question: "What are the security considerations when using residential proxies?", depth: "deep" },
      API_KEY
    );

    expect(result).toMatch(/requested_depth[:\s]*deep/i);
    expect(result).toMatch(/resolved_depth[:\s]*deep/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Helpers for extracting output sections
// ──────────────────────────────────────────────────────────────────────────────

function extractMaterialSection(output: string): string {
  const match = output.match(/## Researched source material for:[^\n]*\n([\s\S]*?)(?=\n## Key Findings|\n---\n|$)/);
  return match ? match[1].trim() : "";
}

function extractGeneratedQueries(output: string): string[] {
  const match = output.match(/\*\*generated_queries\*\*:([\s\S]*?)(?=\n\*\*|\n---\n|$)/);
  if (!match) return [];
  return match[1].trim().split("\n").map(line => line.replace(/^\s*\d+\.\s*/, "").trim()).filter(Boolean);
}


