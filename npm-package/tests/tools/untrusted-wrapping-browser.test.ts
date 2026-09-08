/**
 * G-2 class-driven test — novada_browser.
 *
 * | tool           | wrapped field                                          |
 * |----------------|---------------------------------------------------------|
 * | novada_browser | page-derived action data (snapshot/aria_snapshot/evaluate) |
 *
 * Separate file because it mocks playwright-core (a module none of the other
 * tools touch), matching browser.test.ts's own mocking pattern.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { assertInjectionWrapped, assertOwnMetadataNotWrapped, INJECTION } from "./_untrusted-assertions.js";

vi.mock("playwright-core", () => ({
  chromium: { connectOverCDP: vi.fn() },
}));

import { novadaBrowser } from "../../src/tools/browser.js";
import { chromium } from "playwright-core";
import { closeSession, listSessions } from "../../src/utils/browser.js";

const PAGE_URL = "https://browser-fixture.example.com";

function setupBrowserMock() {
  const mockPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    title: vi.fn().mockResolvedValue("Fixture Page"),
    url: vi.fn().mockReturnValue(PAGE_URL),
    content: vi.fn().mockResolvedValue(`<html><body>${INJECTION}</body></html>`),
    ariaSnapshot: vi.fn().mockResolvedValue(`- document:\n  - text "${INJECTION}"`),
    evaluate: vi.fn().mockResolvedValue(INJECTION),
    setDefaultTimeout: vi.fn(),
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

describe("G-2: wrapUntrusted applied — novada_browser", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const id of listSessions()) {
      await closeSession(id);
    }
    process.env.NOVADA_BROWSER_WS = "wss://test:test@fixture.example.com";
  });

  it("wraps page-derived action data (snapshot) and leaves own metadata unwrapped", async () => {
    setupBrowserMock();
    const out = await novadaBrowser({
      actions: [{ action: "navigate", url: PAGE_URL, wait_until: "domcontentloaded" }, { action: "snapshot" }],
      timeout: 60000,
    });
    assertInjectionWrapped(out, INJECTION, PAGE_URL);
    assertOwnMetadataNotWrapped(out, "## Agent Hints");
  });

  it("wraps page-derived action data (aria_snapshot) and leaves own metadata unwrapped", async () => {
    setupBrowserMock();
    const out = await novadaBrowser({
      actions: [{ action: "navigate", url: PAGE_URL, wait_until: "domcontentloaded" }, { action: "aria_snapshot" }],
      timeout: 60000,
    });
    assertInjectionWrapped(out, INJECTION, PAGE_URL);
    assertOwnMetadataNotWrapped(out, "## Agent Hints");
  });

  it("wraps page-derived action data (evaluate) and leaves own metadata unwrapped", async () => {
    setupBrowserMock();
    const out = await novadaBrowser({
      actions: [{ action: "navigate", url: PAGE_URL, wait_until: "domcontentloaded" }, { action: "evaluate", script: "document.title" }],
      timeout: 60000,
    });
    assertInjectionWrapped(out, INJECTION, PAGE_URL);
    assertOwnMetadataNotWrapped(out, "## Agent Hints");
  });

  it("does NOT wrap our own status text for click/type actions", async () => {
    const mockPage = setupBrowserMock();
    mockPage.title.mockResolvedValue("Fixture Page");
    const out = await novadaBrowser({
      actions: [{ action: "navigate", url: PAGE_URL, wait_until: "domcontentloaded" }],
      timeout: 60000,
    });
    // navigate's own status text ("Navigated to: ...") must never appear inside a wrap block
    assertOwnMetadataNotWrapped(out, "Navigated to:");
  });
});
