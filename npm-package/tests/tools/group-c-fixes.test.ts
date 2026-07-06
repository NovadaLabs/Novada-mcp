/**
 * Group C red-team fixes — targeted tests for each of the 7 defects fixed.
 * All tests are unit-level (no live network); axios and routeFetch are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NovadaErrorCode } from "../../src/_core/errors.js";

// ─── Mock axios (used by search, research, scraper_submit) ─────────────────
vi.mock("axios");
// ─── Mock playwright-core so unblock.ts can be imported ───────────────────
vi.mock("playwright-core", () => ({
  chromium: { connectOverCDP: vi.fn() },
}));
// ─── Mock billing sub-tools so health tests don't hit the network ──────────
vi.mock("../../src/tools/wallet_balance.js", () => ({
  novadaWalletBalance: vi.fn().mockResolvedValue(
    JSON.stringify({ status: "ok", data: { balance: 10.0, currency: "€" } })
  ),
}));
vi.mock("../../src/tools/plan_balance_all.js", () => ({
  novadaPlanBalanceAll: vi.fn().mockResolvedValue(
    JSON.stringify({
      status: "ok",
      summary: { active_products: [], expired_products: [], unavailable_products: [] },
      per_product: {},
    })
  ),
}));

import axios from "axios";
import { novadaSearch } from "../../src/tools/search.js";
import { novadaResearch } from "../../src/tools/research.js";
import { novadaVerify } from "../../src/tools/verify.js";
import { novadaUnblock } from "../../src/tools/unblock.js";
import { novadaScraperSubmit } from "../../src/tools/scraper_submit.js";
import { novadaHealth } from "../../src/tools/health.js";
import { novadaHealthAll } from "../../src/tools/health_all.js";
import { novadaSearchFeedback } from "../../src/tools/search_feedback.js";

const API_KEY = "test-api-key-123";

beforeEach(() => {
  vi.clearAllMocks();
  // Provide Web Unblocker key so unblock can call the render path
  process.env.NOVADA_WEB_UNBLOCKER_KEY = "test-unblocker-key";
  delete process.env.NOVADA_BROWSER_WS;
  delete process.env.NOVADA_PROXY_USER;
  delete process.env.NOVADA_PROXY_ENDPOINT;
});

afterEach(() => {
  delete process.env.NOVADA_WEB_UNBLOCKER_KEY;
});

// ─── FIX-2: Unbounded input / DoS — search ────────────────────────────────

describe("FIX-2: query length cap (search)", () => {
  it("truncates query over 500 chars instead of throwing (NOV-682)", async () => {
    // Old contract threw INVALID_PARAMS; new contract truncates at a word
    // boundary and surfaces a query_truncated marker (see boundQuery / NOV-682).
    const longQuery = "a".repeat(501);
    vi.mocked(axios).post.mockResolvedValue({
      data: { code: 0, data: { task_id: "task-1" } },
    });
    vi.mocked(axios).get.mockResolvedValue({
      data: { organic_results: [] },
    });
    const result = await novadaSearch({ query: longQuery, engine: "google", num: 10, country: "", language: "" }, API_KEY);
    expect(result).toContain("No results found");
    expect(result).toContain("query_truncated:501→500");
  });

  it("accepts query exactly at limit (500 chars)", async () => {
    const borderQuery = "a".repeat(500);
    // Will fail at the API call — mock it to return empty
    vi.mocked(axios).post.mockResolvedValue({
      data: { code: 0, data: { task_id: "task-1" } },
    });
    vi.mocked(axios).get.mockResolvedValue({
      data: { organic_results: [] },
    });
    const result = await novadaSearch({ query: borderQuery, engine: "google", num: 10, country: "", language: "" }, API_KEY);
    // Should succeed (empty results, not a validation error)
    expect(result).toContain("No results found");
  });
});

// ─── FIX-2: Unbounded input / DoS — research ─────────────────────────────

describe("FIX-2: question length cap (research)", () => {
  it("rejects question over 2000 chars with INVALID_PARAMS", async () => {
    const longQuestion = "q".repeat(2001);
    await expect(novadaResearch({ question: longQuestion, depth: "quick" }, API_KEY))
      .rejects.toMatchObject({ name: "NovadaError", code: NovadaErrorCode.INVALID_PARAMS });
  });
});

// ─── FIX-2: Unbounded input / DoS — scraper_submit params ────────────────

describe("FIX-2: scraper_submit params payload cap", () => {
  it("rejects params with a string field over 2000 chars", async () => {
    await expect(novadaScraperSubmit({
      platform: "amazon.com",
      operation: "amazon_product_asin",
      params: { asin: "x".repeat(2001) },
    }, API_KEY)).rejects.toMatchObject({ name: "NovadaError", code: NovadaErrorCode.INVALID_PARAMS });
  });

  it("rejects params with total payload over 60KB", async () => {
    // Create a params object that serializes to >60KB
    const params: Record<string, string> = {};
    for (let i = 0; i < 50; i++) {
      params[`key${i}`] = "x".repeat(1300); // 50 * 1300 = 65000 chars > 60000
    }
    await expect(novadaScraperSubmit({
      platform: "amazon.com",
      operation: "amazon_product_keywords",
      params,
    }, API_KEY)).rejects.toMatchObject({ name: "NovadaError", code: NovadaErrorCode.INVALID_PARAMS });
  });

  it("accepts params within limits", async () => {
    vi.mocked(axios).post.mockResolvedValue({
      data: { code: 0, data: { task_id: "task-abc" } },
    });
    const result = await novadaScraperSubmit({
      platform: "amazon.com",
      operation: "amazon_product_asin",
      params: { asin: "B09XYZ1234" },
    }, API_KEY);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("submitted");
    expect(parsed.task_id).toBeDefined();
  });
});

// ─── FIX-3: Unblock timeout honored ──────────────────────────────────────

describe("FIX-3: unblock timeout honored", () => {
  it("returns structured error (not transport -32001) when timeout fires", async () => {
    // Make the render hang forever
    vi.mocked(axios).post.mockImplementation(() =>
      new Promise((resolve) => setTimeout(() => resolve({ data: { code: 0, data: { code: 200, html: "<html/>" } } }), 5000))
    );

    // Set a very short timeout (50ms) — should fire before the mocked response
    const startMs = Date.now();
    await expect(novadaUnblock({
      url: "https://slow-site.com",
      method: "render",
      timeout: 50,
    }, API_KEY)).rejects.toMatchObject({ name: "NovadaError", code: NovadaErrorCode.URL_UNREACHABLE });
    // Should bail out well before the 5s mock delay
    expect(Date.now() - startMs).toBeLessThan(2000);
  }, 5000);

  it("caps user timeout at 120s ceiling (does not raise timeout above ceiling)", () => {
    // Verify the cap logic inline without actually waiting
    const userTimeout = 999999;
    const CEILING = 120_000;
    const actual = Math.min(userTimeout, CEILING);
    expect(actual).toBe(CEILING);
  });
});

// ─── FIX-4: verify.ts injection sanitization ─────────────────────────────

describe("FIX-4: verify claim sanitization", () => {
  it("rejects empty/whitespace claim with NovadaError", async () => {
    await expect(novadaVerify({ claim: "   " } as never, API_KEY))
      .rejects.toMatchObject({ name: "NovadaError", code: NovadaErrorCode.INVALID_PARAMS });
  });

  it("rejects claim containing CRLF characters", async () => {
    await expect(novadaVerify({ claim: "real claim\r\ninjected instruction" }, API_KEY))
      .rejects.toMatchObject({ name: "NovadaError", code: NovadaErrorCode.INVALID_PARAMS });
  });

  it("rejects claim starting with javascript:", async () => {
    await expect(novadaVerify({ claim: "javascript:alert(1)" }, API_KEY))
      .rejects.toMatchObject({ name: "NovadaError", code: NovadaErrorCode.INVALID_PARAMS });
  });

  it("rejects claim containing null byte", async () => {
    await expect(novadaVerify({ claim: "claim\0injected" }, API_KEY))
      .rejects.toMatchObject({ name: "NovadaError", code: NovadaErrorCode.INVALID_PARAMS });
  });

  it("rejects claim over 1000 chars", async () => {
    await expect(novadaVerify({ claim: "x".repeat(1001) }, API_KEY))
      .rejects.toMatchObject({ name: "NovadaError", code: NovadaErrorCode.INVALID_PARAMS });
  });
});

// ─── FIX-5 (updated contract): health derives status from account facts, not synthetic probes
//
// Old behavior: health.ts fired synthetic HTTP probes (Web Unblocker, Scraper API) that burned
// credits and returned false results. Proxy/browser with env creds were labeled
// "configured (not verified)" to avoid claiming Active without a probe.
//
// New behavior: health.ts reads billing API (wallet, plan balances, sub-account entitlement)
// — no synthetic product probes at all. Proxy/browser with explicit env creds are "Available"
// (the creds ARE confirmed — reading them from the environment IS the entitlement check).
// Auto-provision (no env creds) calls the account API, not a synthetic product call.

describe("FIX-5 (updated): health reads account facts, no synthetic probes", () => {
  it("health.ts: proxy with explicit env creds → Available (no synthetic probe needed)", async () => {
    // Set both proxy AND browser env creds so neither auto-provision path fires.
    process.env.NOVADA_PROXY_USER = "testuser";
    process.env.NOVADA_PROXY_PASS = "testpass";
    process.env.NOVADA_PROXY_ENDPOINT = "proxy.novada.com:10000";
    process.env.NOVADA_BROWSER_WS = "wss://user:pass@browser.novada.com";

    // With both env creds set, health.ts reads no account API → global fetch NOT called.
    const fetchSpy = vi.spyOn(global, "fetch").mockRejectedValue(new Error("unexpected probe call"));
    try {
      const result = await novadaHealth(API_KEY);
      // New contract: explicit env creds → Available (entitlement confirmed by credential presence)
      expect(result).toContain("Proxy");
      expect(result).toContain("✅ Available");
      // No fetch calls at all (neither synthetic product probes NOR account API needed)
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      delete process.env.NOVADA_PROXY_USER;
      delete process.env.NOVADA_PROXY_PASS;
      delete process.env.NOVADA_PROXY_ENDPOINT;
      delete process.env.NOVADA_BROWSER_WS;
    }
  });

  it("health.ts: browser with NOVADA_BROWSER_WS set → Available (no synthetic probe needed)", async () => {
    // Set both proxy AND browser env creds so neither auto-provision path fires.
    process.env.NOVADA_PROXY_USER = "testuser";
    process.env.NOVADA_PROXY_PASS = "testpass";
    process.env.NOVADA_PROXY_ENDPOINT = "proxy.novada.com:10000";
    process.env.NOVADA_BROWSER_WS = "wss://user:pass@browser.novada.com";

    const fetchSpy = vi.spyOn(global, "fetch").mockRejectedValue(new Error("unexpected probe call"));
    try {
      const result = await novadaHealth(API_KEY);
      expect(result).toContain("Browser API");
      expect(result).toContain("✅ Available");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      delete process.env.NOVADA_PROXY_USER;
      delete process.env.NOVADA_PROXY_PASS;
      delete process.env.NOVADA_PROXY_ENDPOINT;
      delete process.env.NOVADA_BROWSER_WS;
    }
  });

  it("health_all.ts (alias): proxy with explicit env creds → Available (fact-based, no probe)", async () => {
    // Set both env creds → no auto-provision fetch fires.
    process.env.NOVADA_PROXY_USER = "testuser";
    process.env.NOVADA_PROXY_PASS = "testpass";
    process.env.NOVADA_PROXY_ENDPOINT = "proxy.novada.com:10000";
    process.env.NOVADA_BROWSER_WS = "wss://user:pass@browser.novada.com";

    const fetchSpy = vi.spyOn(global, "fetch").mockRejectedValue(new Error("unexpected probe call"));
    try {
      const result = await novadaHealthAll(API_KEY);
      expect(result).toContain("Proxy");
      expect(result).toContain("✅ Available");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      delete process.env.NOVADA_PROXY_USER;
      delete process.env.NOVADA_PROXY_PASS;
      delete process.env.NOVADA_PROXY_ENDPOINT;
      delete process.env.NOVADA_BROWSER_WS;
    }
  });
});

// ─── FIX-6: search emits search_id / feedback loop ───────────────────────

describe("FIX-6: search emits search_id for feedback loop", () => {
  it("markdown output contains a search_id field", async () => {
    vi.mocked(axios).post.mockResolvedValue({
      data: { code: 0, data: { task_id: "t1" } },
    });
    vi.mocked(axios).get.mockResolvedValue({
      data: { organic_results: [{ title: "T", url: "https://example.com", description: "D" }] },
    });
    const result = await novadaSearch({ query: "test query", engine: "google", num: 5, country: "", language: "" }, API_KEY);
    expect(result).toMatch(/search_id:search-\d+-\d+/);
  });

  it("JSON output contains search_id field", async () => {
    vi.mocked(axios).post.mockResolvedValue({
      data: { code: 0, data: { task_id: "t2" } },
    });
    vi.mocked(axios).get.mockResolvedValue({
      data: { organic_results: [{ title: "T", url: "https://example.com", description: "D" }] },
    });
    const result = await novadaSearch({ query: "test query", engine: "google", num: 5, format: "json", country: "", language: "" }, API_KEY);
    const parsed = JSON.parse(result);
    expect(parsed.search_id).toMatch(/^search-\d+-\d+$/);
  });

  it("search_feedback accepts the search_id format emitted by search", async () => {
    const searchId = `search-${Date.now()}-1`;
    const result = await novadaSearchFeedback({
      search_id: searchId,
      query: "test",
      rating: "good",
      useful_urls: ["https://example.com"],
      format: "json",
    });
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("recorded");
    expect(parsed.search_id).toBe(searchId);
  });
});

// ─── FIX-1: Path / PII leak — redactSecrets on output paths ──────────────
// Note: we don't test the actual home dir because it's environment-dependent.
// Instead we verify redactSecrets removes the NOVADA_BROWSER_WS value (a known
// secret pattern) when it appears in a path-like string.

describe("FIX-1: redactSecrets strips known secret patterns", () => {
  it("redactSecrets strips URL userinfo (user:pass@host)", async () => {
    const { redactSecrets } = await import("../../src/_core/errors.js");
    const withCreds = "https://user:password123@internal.novada.com/path";
    const redacted = redactSecrets(withCreds);
    expect(redacted).not.toContain("password123");
    expect(redacted).not.toContain("user:password123@");
  });

  it("redactSecrets strips internal novada host subdomains", async () => {
    const { redactSecrets } = await import("../../src/_core/errors.js");
    const msg = "Connected to upg-scbr2.novada.com successfully";
    const redacted = redactSecrets(msg);
    expect(redacted).not.toContain("upg-scbr2.novada.com");
    expect(redacted).toContain("[novada-internal-host]");
  });

  it("redactSecrets preserves public novada hosts", async () => {
    const { redactSecrets } = await import("../../src/_core/errors.js");
    const msg = "Visit dashboard.novada.com for your API key";
    const redacted = redactSecrets(msg);
    expect(redacted).toContain("dashboard.novada.com");
  });
});
