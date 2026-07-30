/**
 * FIX-A + FIX-B (2026-07-30, agent-first extract error path). Live field feedback:
 *
 *  A. Extracting cell.com returned the raw "All promises were rejected" AggregateError
 *     message verbatim — an implementation detail with zero actionable content. The
 *     Promise.any race between a direct fetch and the proxy fetch (src/tools/extract.ts,
 *     effectiveMode === "auto" branch) must summarize the distinct underlying causes and
 *     carry a concrete agent_instruction instead of leaking the bare AggregateError text.
 *
 *  B. pmc.ncbi.nlm.nih.gov hard-blocks automated extraction (reCAPTCHA on static, 503 on
 *     render). PMC full texts have free official mirrors (europepmc.org, NCBI E-utilities
 *     efetch) — a failed/blocked PMC extraction must surface that mirror as a hint (no
 *     auto-reroute this round).
 *
 * All network is mocked via vi.mock("axios") — zero real network calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaExtract, getPmcMirrorHint } from "../../src/tools/extract.js";
import { clearCache } from "../../src/_core/session-cache.js";
import { clearRouteMemory } from "../../src/_core/route-memory.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-123";

beforeEach(() => {
  vi.clearAllMocks();
  // Extract's session cache and route-memory are module-level state; without a reset,
  // an earlier test's success/route pin can short-circuit a later test's mock.
  clearCache();
  clearRouteMemory();
});

// ─── FIX-B: getPmcMirrorHint (pure, no mocking needed) ─────────────────────────

describe("getPmcMirrorHint (pure)", () => {
  it("returns a concrete europepmc URL when the PMCID is present", () => {
    const hint = getPmcMirrorHint("https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/");
    expect(hint).not.toBeNull();
    expect(hint).toContain("https://europepmc.org/article/PMC/PMC1234567");
  });

  it("returns a generic mirror hint (no fabricated PMCID) when none can be extracted", () => {
    const hint = getPmcMirrorHint("https://pmc.ncbi.nlm.nih.gov/articles/");
    expect(hint).not.toBeNull();
    expect(hint).not.toMatch(/europepmc\.org\/article\/PMC\/PMC\d+/);
    expect(hint).toContain("europepmc.org");
  });

  it("matches the legacy www.ncbi.nlm.nih.gov/pmc path and still derives the PMCID", () => {
    const hint = getPmcMirrorHint("https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7654321/");
    expect(hint).not.toBeNull();
    expect(hint).toContain("PMC7654321");
  });

  it("returns null for a non-PMC host, even one that mentions a PMCID-shaped string", () => {
    expect(getPmcMirrorHint("https://example.com/articles/PMC1234567/")).toBeNull();
  });

  it("returns null for www.ncbi.nlm.nih.gov paths outside /pmc", () => {
    expect(getPmcMirrorHint("https://www.ncbi.nlm.nih.gov/gene/1234")).toBeNull();
  });

  it("returns null (never throws) for an unparsable URL", () => {
    expect(() => getPmcMirrorHint("not-a-url")).not.toThrow();
    expect(getPmcMirrorHint("not-a-url")).toBeNull();
  });
});

// ─── FIX-A: AggregateError summarization, end-to-end through novadaExtract ─────

describe("novadaExtract — AggregateError summarization (FIX-A)", () => {
  it("never leaks the raw 'All promises were rejected' AggregateError message and carries a concrete agent_instruction", async () => {
    // render="auto" races a direct fetch (fetchWithRetry) against fetchViaProxy — with
    // no proxy creds configured in the test env (tests/setup.ts strips NOVADA_PROXY_*),
    // fetchViaProxy falls back to a second fetchWithRetry call. Rejecting every
    // axios.get call with a plain (non-Axios) Error makes both legs reject immediately
    // (no internal retry loop) with distinct reasons — a genuine Promise.any AggregateError.
    let n = 0;
    mockedAxios.get.mockImplementation(async () => {
      n++;
      throw new Error(n === 1 ? "ECONNREFUSED 1.2.3.4:443" : "ENOTFOUND cell.com");
    });

    const result = await novadaExtract(
      { url: "https://cell-agentfirst-test.example/some-article", format: "markdown", render: "auto" },
      API_KEY
    );

    expect(result).toContain("## Extract Failed");
    expect(result).not.toContain("All promises were rejected");
    // Distinct underlying causes from both legs must be visible in the error text.
    expect(result).toMatch(/ECONNREFUSED 1\.2\.3\.4:443/);
    expect(result).toMatch(/ENOTFOUND cell-agentfirst-test\.example|ENOTFOUND cell\.com/);
    // The concrete agent_instruction guidance (not the old generic "may be rate-limiting").
    expect(result).toContain("agent_instruction:");
    expect(result).toContain("retry_recommended after 30s");
  });

  it("single-cause aggregate (both legs reject with the SAME reason) still summarizes cleanly", async () => {
    mockedAxios.get.mockImplementation(async () => {
      throw new Error("ENOTFOUND nov-single-cause-test.example");
    });

    const result = await novadaExtract(
      { url: "https://nov-single-cause-test.example/page", format: "markdown", render: "auto" },
      API_KEY
    );

    expect(result).toContain("## Extract Failed");
    expect(result).not.toContain("All promises were rejected");
    expect(result).toContain("ENOTFOUND nov-single-cause-test.example");
    expect(result).toContain("retry_recommended after 30s");
  });
});

// ─── FIX-B: PMC mirror hint, end-to-end through novadaExtract ──────────────────

describe("novadaExtract — PMC mirror hint (FIX-B)", () => {
  const jsHeavyHtml = "<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>";
  const richHtml = `<html><head><title>Rich Page</title></head><body>${"<p>Real content paragraph.</p>".repeat(25)}</body></html>`;

  it("PMC URL with a PMCID, blocked on every escalation attempt → concrete europepmc URL in agent_instruction", async () => {
    let n = 0;
    mockedAxios.get.mockImplementation(async () => {
      n++;
      // Static race (direct + proxy) both look like a bot challenge → triggers escalation.
      if (n <= 2) return { data: jsHeavyHtml } as never;
      // All render/escalation fetches fail — mirrors PMC's real "render mode 503s" behavior.
      throw new Error("render fetch failed with 503");
    });

    const result = await novadaExtract(
      { url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/", format: "markdown", render: "auto" },
      API_KEY
    );

    expect(result).toContain("mode: render-failed");
    expect(result).toContain("agent_instruction:");
    expect(result).toContain("https://europepmc.org/article/PMC/PMC1234567");
  });

  it("PMC URL WITHOUT an extractable PMCID, blocked → generic mirror hint (no fabricated URL)", async () => {
    let n = 0;
    mockedAxios.get.mockImplementation(async () => {
      n++;
      if (n <= 2) return { data: jsHeavyHtml } as never;
      throw new Error("render fetch failed with 503");
    });

    const result = await novadaExtract(
      { url: "https://pmc.ncbi.nlm.nih.gov/articles/", format: "markdown", render: "auto" },
      API_KEY
    );

    expect(result).toContain("mode: render-failed");
    expect(result).toContain("europepmc.org");
    expect(result).not.toMatch(/europepmc\.org\/article\/PMC\/PMC\d+/);
  });

  it("non-PMC failure never gets the PMC mirror hint", async () => {
    let n = 0;
    mockedAxios.get.mockImplementation(async () => {
      n++;
      if (n <= 2) return { data: jsHeavyHtml } as never;
      throw new Error("render fetch failed with 503");
    });

    const result = await novadaExtract(
      { url: "https://nov-non-pmc-blocked-test.example/page", format: "markdown", render: "auto" },
      API_KEY
    );

    expect(result).toContain("mode: render-failed");
    expect(result).not.toContain("europepmc.org");
    expect(result).not.toContain("mirror_hint");
  });

  it("a successful PMC extraction is completely untouched — no mirror hint appears", async () => {
    mockedAxios.get.mockResolvedValue({ data: richHtml, status: 200, headers: { "content-type": "text/html" }, config: {} as never, statusText: "OK" });

    const result = await novadaExtract(
      { url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/", format: "markdown" },
      API_KEY
    );

    expect(result).not.toContain("## Extract Failed");
    expect(result).not.toContain("europepmc.org");
    expect(result).not.toContain("mirror_hint");
  });
});
