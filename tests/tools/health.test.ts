import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch globally before importing the module
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock credentials utils
vi.mock("../../src/utils/credentials.js", () => ({
  getBrowserWs: vi.fn(),
  getProxyCredentials: vi.fn(),
  resolveProxyCredentials: vi.fn(),
  getWebUnblockerKey: vi.fn(),
}));

import { getBrowserWs, resolveProxyCredentials, getWebUnblockerKey } from "../../src/utils/credentials.js";
const mockedGetBrowserWs = vi.mocked(getBrowserWs);
const mockedResolveProxyCredentials = vi.mocked(resolveProxyCredentials);
const mockedGetWebUnblockerKey = vi.mocked(getWebUnblockerKey);

const { novadaHealth } = await import("../../src/tools/health.js");

const API_KEY = "test-key-abcd";

function makeFetchResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: all env-based products not configured
  mockedGetBrowserWs.mockReturnValue(undefined);
  mockedResolveProxyCredentials.mockResolvedValue(null);
  mockedGetWebUnblockerKey.mockReturnValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("novadaHealth", () => {
  it("shows active HTTP probes and configured env-based products when all set", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 0, data: [] }),
    });
    mockedResolveProxyCredentials.mockResolvedValue({ user: "u", pass: "p", endpoint: "proxy.example.com:7777" });
    mockedGetBrowserWs.mockReturnValue("wss://user:pass@browser.example.com");
    mockedGetWebUnblockerKey.mockReturnValue("test-unblocker-key");

    const result = await novadaHealth(API_KEY);

    expect(result).toContain("✅ Active");
    // health.ts probes: Web Unblocker / Extract + Scraper API (no separate Search probe)
    expect(result).toContain("Web Unblocker / Extract");
    expect(result).toContain("Scraper API (search + 13 active platforms)");
    expect(result).toContain("Proxy");
    expect(result).toContain("Browser API");
    // Proxy/Browser are "configured_unverified" (no live probe possible) — not fully "active"
    expect(result).toContain("configured (not verified)");
  });

  it("shows Not activated for Scraper API when response indicates error code 11006", async () => {
    mockedGetWebUnblockerKey.mockReturnValue("test-unblocker-key");
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("webunlocker.novada.com")) return makeFetchResponse(200, { code: 0 });
      // scraper.novada.com/request → 11006
      return makeFetchResponse(200, { code: 11006, msg: "not activated" });
    });

    const result = await novadaHealth(API_KEY);

    expect(result).toContain("Scraper API (search + 13 active platforms)");
    expect(result).toContain("Not activated");
    expect(result).toContain("dashboard.novada.com/overview/scraper/");
    expect(result).toContain("## Next Steps");
  });

  it("shows Not configured for Proxy when resolveProxyCredentials returns null", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 0 }),
    });
    // resolveProxyCredentials returns null → proxy not configured
    mockedResolveProxyCredentials.mockResolvedValue(null);
    mockedGetBrowserWs.mockReturnValue("wss://ws.example.com");

    const result = await novadaHealth(API_KEY);

    expect(result).toContain("Proxy");
    expect(result).toContain("⚠️ Not configured");
    // The not-configured note tells users what to set
    expect(result).toContain("NOVADA_PROXY_USER");
    expect(result).toContain("## Next Steps");
    expect(result).toContain("NOVADA_PROXY_ENDPOINT");
  });

  it("shows Not configured for Browser API when NOVADA_BROWSER_WS env var is absent", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 0 }),
    });
    mockedResolveProxyCredentials.mockResolvedValue({ user: "u", pass: "p", endpoint: "proxy:7777" });
    mockedGetBrowserWs.mockReturnValue(undefined);

    const result = await novadaHealth(API_KEY);

    expect(result).toContain("Browser API");
    expect(result).toContain("⚠️ Not configured");
    expect(result).toContain("NOVADA_BROWSER_WS");
    expect(result).toContain("dashboard.novada.com/overview/browser/");
  });

  it("masks API key — only shows last 4 chars", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    const result = await novadaHealth("supersecretkey-1234");

    expect(result).toContain("****1234");
    expect(result).not.toContain("supersecretkey");
  });

  it("includes ISO timestamp in output", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    const result = await novadaHealth(API_KEY);

    expect(result).toMatch(/checked: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("includes markdown table with correct headers", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    const result = await novadaHealth(API_KEY);

    expect(result).toContain("| Product | Status | Latency |");
    expect(result).toContain("|---------|--------|---------|");
  });

  it("shows summary counts correctly when some products inactive", async () => {
    // No unblocker key → extract is "not configured"
    mockedGetWebUnblockerKey.mockReturnValue(undefined);
    mockFetch.mockImplementation((_url: string) => {
      return makeFetchResponse(200, { code: 11006 }); // scraper not activated
    });
    mockedResolveProxyCredentials.mockResolvedValue(null);
    mockedGetBrowserWs.mockReturnValue(undefined);

    const result = await novadaHealth(API_KEY);

    expect(result).toContain("## Summary");
    // scraper=not_activated; extract=not_configured; proxy=not_configured; browser=not_configured
    expect(result).toContain("not activated");
    expect(result).toContain("not configured");
  });

  it("handles fetch timeout/network error gracefully — shows error row not crash", async () => {
    mockFetch.mockRejectedValue(new Error("fetch failed: connection timeout"));

    const result = await novadaHealth(API_KEY);

    expect(result).toContain("❌ Error:");
    // Should still return a complete markdown table
    expect(result).toContain("## Novada API — Health Check");
    expect(result).toContain("## Summary");
  });

  it("runs 1 HTTP probe when unblocker key is absent (extract skipped)", async () => {
    mockedGetWebUnblockerKey.mockReturnValue(undefined);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    await novadaHealth(API_KEY);

    // Scraper only = 1 HTTP probe (Extract skipped: no unblocker key)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("runs 2 HTTP probes when unblocker key is configured (extract + scraper)", async () => {
    mockedGetWebUnblockerKey.mockReturnValue("test-unblocker-key");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 0 }),
    });

    await novadaHealth(API_KEY);

    // Extract + Scraper = 2 HTTP probes
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not show not-configured or not-activated items when HTTP probes succeed and env vars are set", async () => {
    mockedGetWebUnblockerKey.mockReturnValue("test-unblocker-key");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 0 }),
    });
    mockedResolveProxyCredentials.mockResolvedValue({ user: "u", pass: "p", endpoint: "proxy:7777" });
    // Well-formed wss URL — BrowserWS is configured_unverified (no live probe)
    mockedGetBrowserWs.mockReturnValue("wss://user:pass@ws.example.com");

    const result = await novadaHealth(API_KEY);

    // HTTP products are active; proxy/browser are configured_unverified
    expect(result).toContain("✅ Active");
    // Should NOT have not-configured or not-activated bullet items
    expect(result).not.toContain("Not configured");
    expect(result).not.toContain("Not activated");
  });
});
