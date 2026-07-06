import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all HTTP dependencies before imports
vi.mock("axios");
vi.mock("playwright-core", () => ({
  chromium: {
    connectOverCDP: vi.fn(),
  },
}));

import { routeFetch, getModeCost } from "../../src/utils/router.js";
import axios from "axios";
import { chromium } from "playwright-core";

// Must be > 200 chars (JS_DETECTION_THRESHOLD) and contain no JS signals
const MOCK_HTML = "<html><head><title>Test Page</title></head><body><h1>Hello World</h1><p>This is a normal server-rendered page with plenty of content. It has paragraphs, headings, and real text that makes it look like a legitimate web page with actual content for testing purposes.</p><p>Another paragraph here.</p></body></html>";
// Must contain JS signals
const JS_HEAVY_HTML = '<html><head></head><body><div id="root"></div></body></html>';

function mockAxiosGet(html: string) {
  vi.mocked(axios).get.mockResolvedValue({ data: html, status: 200, statusText: "OK", headers: {}, config: {} as never });
}

function mockAxiosPost(html: string) {
  vi.mocked(axios).post.mockResolvedValue({
    data: { code: 0, data: { code: 200, html } },
    status: 200, statusText: "OK", headers: {}, config: {} as never,
  });
}

function mockBrowser(html: string) {
  const mockPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue(html),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
  };
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

describe("routeFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NOVADA_WEB_UNBLOCKER_KEY;
    delete process.env.NOVADA_BROWSER_WS;
  });

  it("static mode returns HTML without escalation", async () => {
    mockAxiosGet(MOCK_HTML);
    const result = await routeFetch("https://example.com", { render: "static", apiKey: "key" });
    expect(result.mode).toBe("static");
    expect(result.cost).toBe("low");
    expect(result.html).toBe(MOCK_HTML);
  });

  it("render mode calls Web Unblocker", async () => {
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "test-key";
    mockAxiosPost(MOCK_HTML);
    const result = await routeFetch("https://example.com", { render: "render", apiKey: "key" });
    expect(result.mode).toBe("render");
    expect(result.cost).toBe("medium");
  });

  it("render mode falls back to render-failed when NOVADA_WEB_UNBLOCKER_KEY is absent", async () => {
    delete process.env.NOVADA_WEB_UNBLOCKER_KEY;
    mockAxiosGet(MOCK_HTML);
    const result = await routeFetch("https://example.com", { render: "render", apiKey: "key" });
    expect(result.mode).toBe("render-failed");
    expect(result.cost).toBe("low");
    expect(result.html).toBe(MOCK_HTML);
  });

  it("browser mode calls Browser API", async () => {
    process.env.NOVADA_BROWSER_WS = "wss://test:test@example.com";
    mockBrowser(MOCK_HTML);
    const result = await routeFetch("https://example.com", { render: "browser" });
    expect(result.mode).toBe("browser");
    expect(result.cost).toBe("high");
  });

  it("auto mode stays static for normal HTML", async () => {
    mockAxiosGet(MOCK_HTML);
    const result = await routeFetch("https://example.com", { render: "auto", apiKey: "key" });
    expect(result.mode).toBe("static");
    expect(result.cost).toBe("low");
  });

  it("auto mode escalates to render for JS-heavy content", async () => {
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "test-key";
    // First call (static) returns JS-heavy, second (render) returns good content
    vi.mocked(axios).get.mockResolvedValue({ data: JS_HEAVY_HTML, status: 200, statusText: "OK", headers: {}, config: {} as never });
    vi.mocked(axios).post.mockResolvedValue({
      data: { code: 0, data: { code: 200, html: MOCK_HTML } },
      status: 200, statusText: "OK", headers: {}, config: {} as never,
    });
    const result = await routeFetch("https://spa-app.com", { render: "auto", apiKey: "key" });
    expect(result.mode).toBe("render");
    expect(result.cost).toBe("medium");
  });

  it("auto mode returns render-failed when unblocker fails with non-auth error", async () => {
    // Static returns JS-heavy, render POST fails with a non-auth error.
    // fetchWithRender now re-throws all errors — the router's catch block fires
    // and returns render-failed (correct behavior, not a silent fallback).
    vi.mocked(axios).get.mockResolvedValue({ data: JS_HEAVY_HTML, status: 200, statusText: "OK", headers: {}, config: {} as never });
    vi.mocked(axios).post.mockRejectedValue(new Error("Unblocker down"));
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "test-key";

    const result = await routeFetch("https://spa-app.com", { render: "auto", apiKey: "key" });
    // fetchWithRender propagates the error — router catches it and returns render-failed
    // This is the correct behavior: mode metadata accurately reflects what happened.
    expect(result.mode).toBe("render-failed");
    expect(result.cost).toBe("low");
  });

  it("returns JSON-stringified content when API returns object in static mode", async () => {
    vi.mocked(axios).get.mockResolvedValue({ data: { json: true }, status: 200, statusText: "OK", headers: {}, config: {} as never });
    const result = await routeFetch("https://api.com/data", { render: "static", apiKey: "key" });
    expect(result.mode).toBe("static");
    expect(result.html).toContain('"json": true');
  });
});

describe("getModeCost", () => {
  it("returns correct cost tiers", () => {
    expect(getModeCost("static")).toBe("low");
    expect(getModeCost("render")).toBe("medium");
    expect(getModeCost("browser")).toBe("high");
    expect(getModeCost("render-failed")).toBe("low");
  });
});
