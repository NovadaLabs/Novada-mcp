/**
 * RED → GREEN tests for ITEM 4 — country accepted but not applied (silent no-op).
 *
 * Both novada_browser.country and novada_proxy type="isp" + country accept the param
 * but do NOT apply it (no geo-routing). The RESPONSE must surface a warning so agents
 * that missed the description don't assume geo-routing was applied.
 *
 * Covers four requirements:
 * (a) novada_browser called with country → response contains warnings section:
 *     "country accepted but not applied on this endpoint — do not rely on geo-routing"
 * (b) novada_proxy type="isp" with country → same pattern
 * (c) no warning when country not passed
 * (d) proxy types that DO honor country (residential etc.) emit NO such warning
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Browser mocks ────────────────────────────────────────────────────────────

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
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue("<html><body>test</body></html>"),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
    evaluate: vi.fn().mockResolvedValue("ok"),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    setDefaultTimeout: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    focus: vi.fn().mockResolvedValue(undefined),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    selectOption: vi.fn().mockResolvedValue(undefined),
    ariaSnapshot: vi.fn().mockResolvedValue("- document"),
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

// ─── Proxy imports ────────────────────────────────────────────────────────────

import { novadaProxy } from "../../src/tools/proxy.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  // Clean up any sessions from previous tests
  for (const id of listSessions()) {
    void closeSession(id);
  }
  // Restore env
  process.env.NOVADA_PROXY_USER = originalEnv.NOVADA_PROXY_USER;
  process.env.NOVADA_PROXY_PASS = originalEnv.NOVADA_PROXY_PASS;
  process.env.NOVADA_PROXY_ENDPOINT = originalEnv.NOVADA_PROXY_ENDPOINT;
  // Ensure browser WS is set for browser tests
  process.env.NOVADA_BROWSER_WS = "wss://test:test@example.com";
  // Ensure proxy creds are set for proxy tests
  process.env.NOVADA_PROXY_USER = "testuser";
  process.env.NOVADA_PROXY_PASS = "testpass";
  process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";
});

const NAVIGATE_ACTION = {
  actions: [{ action: "navigate" as const, url: "https://example.com", wait_until: "domcontentloaded" as const }],
  timeout: 60000,
};

// ─── (a) novada_browser with country → warning in response ──────────────────

describe("novada_browser — country param warning (ITEM 4a)", () => {
  it("(a) browser with country=de emits ## Warnings section", async () => {
    setupBrowserMock();

    const result = await novadaBrowser({ ...NAVIGATE_ACTION, country: "de" });

    expect(result).toContain("## Warnings");
  });

  it("(a) browser with country emits 'country accepted but not applied on this endpoint'", async () => {
    setupBrowserMock();

    const result = await novadaBrowser({ ...NAVIGATE_ACTION, country: "de" });

    expect(result).toContain("country accepted but not applied on this endpoint");
  });

  it("(a) browser with country emits 'do not rely on geo-routing'", async () => {
    setupBrowserMock();

    const result = await novadaBrowser({ ...NAVIGATE_ACTION, country: "de" });

    expect(result).toContain("do not rely on geo-routing");
  });

  it("(a) browser with country includes the received country value in warning", async () => {
    setupBrowserMock();

    const result = await novadaBrowser({ ...NAVIGATE_ACTION, country: "jp" });

    expect(result).toContain("jp");
  });

  // ── (c) no warning when country not passed ─────────────────────────────────

  it("(c) browser WITHOUT country: no 'country accepted but not applied' warning", async () => {
    setupBrowserMock();

    const result = await novadaBrowser(NAVIGATE_ACTION);

    expect(result).not.toContain("country accepted but not applied");
    expect(result).not.toContain("do not rely on geo-routing");
  });
});

// ─── (b) novada_proxy type=isp + country → warning in response ──────────────

describe("novada_proxy type=isp — country param warning (ITEM 4b)", () => {
  it("(b) proxy type=isp with country=de emits ## Warnings section", async () => {
    const result = await novadaProxy({ type: "isp", country: "de", format: "url" });

    expect(result).toContain("## Warnings");
  });

  it("(b) proxy type=isp with country emits 'country accepted but not applied on this endpoint'", async () => {
    const result = await novadaProxy({ type: "isp", country: "de", format: "url" });

    expect(result).toContain("country accepted but not applied on this endpoint");
  });

  it("(b) proxy type=isp with country emits 'do not rely on geo-routing'", async () => {
    const result = await novadaProxy({ type: "isp", country: "de", format: "url" });

    expect(result).toContain("do not rely on geo-routing");
  });

  // ── (c) no warning when country not passed ─────────────────────────────────

  it("(c) proxy type=isp WITHOUT country: no country-not-applied warning", async () => {
    const result = await novadaProxy({ type: "isp", format: "url" });

    expect(result).not.toContain("country accepted but not applied");
    expect(result).not.toContain("do not rely on geo-routing");
  });

  // ── (d) proxy types that honor country emit NO such warning ────────────────

  it("(d) proxy type=residential with country: no country-not-applied warning", async () => {
    const result = await novadaProxy({ type: "residential", country: "de", format: "url" });

    expect(result).not.toContain("country accepted but not applied");
  });

  it("(d) proxy type=mobile with country: no country-not-applied warning", async () => {
    const result = await novadaProxy({ type: "mobile", country: "de", format: "url" });

    expect(result).not.toContain("country accepted but not applied");
  });

  it("(d) proxy type=datacenter with country: no country-not-applied warning", async () => {
    const result = await novadaProxy({ type: "datacenter", country: "de", format: "url" });

    expect(result).not.toContain("country accepted but not applied");
  });
});
