/**
 * RED → GREEN tests for ITEM 2 — health probe:true opt-in capability check.
 *
 * Covers four requirements:
 * (a) Default output contains "does NOT verify live render capability" disclaimer
 * (b) probe:true calls the render path exactly once and reports observed outcome
 * (c) probe failure → card reflects failure, does NOT claim healthy render
 * (d) probe never runs without probe:true
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AxiosResponse } from "axios";

// ─── Mocks (must be declared before dynamic imports) ─────────────────────────

vi.mock("../../src/utils/credentials.js", () => ({
  getBrowserWs: vi.fn(),
  getProxyCredentials: vi.fn(),
  resolveProxyCredentials: vi.fn(),
  getWebUnblockerKey: vi.fn(),
  fetchProxySubAccountCredentials: vi.fn(),
  fetchBrowserSubAccountCredentials: vi.fn(),
}));

vi.mock("../../src/tools/wallet_balance.js", () => ({
  novadaWalletBalance: vi.fn(),
}));

vi.mock("../../src/tools/plan_balance_all.js", () => ({
  novadaPlanBalanceAll: vi.fn(),
}));

vi.mock("../../src/utils/http.js", () => ({
  fetchWithRender: vi.fn(),
  fetchWithRetry: vi.fn(),
  fetchViaProxy: vi.fn(),
  detectJsHeavyContent: vi.fn().mockReturnValue(false),
  detectBotChallenge: vi.fn().mockReturnValue(false),
  identifyAntiBot: vi.fn().mockReturnValue(null),
  USER_AGENT: "test-agent",
}));

// ─── Deferred imports (after mocks) ──────────────────────────────────────────

import {
  getBrowserWs,
  getProxyCredentials,
  fetchProxySubAccountCredentials,
  fetchBrowserSubAccountCredentials,
} from "../../src/utils/credentials.js";
import { novadaWalletBalance } from "../../src/tools/wallet_balance.js";
import { novadaPlanBalanceAll } from "../../src/tools/plan_balance_all.js";
import { fetchWithRender } from "../../src/utils/http.js";

const mockedGetBrowserWs = vi.mocked(getBrowserWs);
const mockedGetProxyCredentials = vi.mocked(getProxyCredentials);
const mockedFetchProxyCreds = vi.mocked(fetchProxySubAccountCredentials);
const mockedFetchBrowserCreds = vi.mocked(fetchBrowserSubAccountCredentials);
const mockedWalletBalance = vi.mocked(novadaWalletBalance);
const mockedPlanBalanceAll = vi.mocked(novadaPlanBalanceAll);
const mockedFetchWithRender = vi.mocked(fetchWithRender);

const { novadaHealth } = await import("../../src/tools/health.js");

const API_KEY = "test-probe-key-abcd";

function walletJson(balance: number): string {
  return JSON.stringify({ status: "ok", data: { balance, currency: "€" } });
}

function planJsonEmpty(): string {
  return JSON.stringify({
    status: "ok",
    summary: { active_products: [], expired_products: [], unavailable_products: [] },
    per_product: {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetProxyCredentials.mockReturnValue(null);
  mockedGetBrowserWs.mockReturnValue(undefined);
  mockedFetchProxyCreds.mockResolvedValue(null);
  mockedFetchBrowserCreds.mockResolvedValue(null);
  mockedWalletBalance.mockResolvedValue(walletJson(10.0));
  mockedPlanBalanceAll.mockResolvedValue(planJsonEmpty());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("novadaHealth — probe:true opt-in render capability check", () => {
  // ── (a) Default disclaimer ────────────────────────────────────────────────
  it("(a) default output contains the does-NOT-verify disclaimer", async () => {
    const result = await novadaHealth(API_KEY);

    expect(result).toContain("does NOT verify live render capability");
    expect(result).toContain("probe:true");
  });

  it("(a) default output does NOT mention 'probe performed'", async () => {
    const result = await novadaHealth(API_KEY);

    expect(result).not.toContain("probe performed");
    expect(result).not.toContain("render_probe");
  });

  // ── (b) probe:true calls render path exactly once, reports result ─────────
  it("(b) probe:true calls render path exactly once", async () => {
    mockedFetchWithRender.mockResolvedValueOnce({
      status: 200,
      data: "<html><body>Example Domain</body></html>",
    } as AxiosResponse);

    await novadaHealth(API_KEY, "quick", true);

    expect(mockedFetchWithRender).toHaveBeenCalledOnce();
  });

  it("(b) probe:true calls render path with example.com", async () => {
    mockedFetchWithRender.mockResolvedValueOnce({
      status: 200,
      data: "<html/>",
    } as AxiosResponse);

    await novadaHealth(API_KEY, "quick", true);

    expect(mockedFetchWithRender).toHaveBeenCalledWith(
      expect.stringContaining("example.com"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("(b) probe:true response reports attempted: true and ok: true on success", async () => {
    mockedFetchWithRender.mockResolvedValueOnce({
      status: 200,
      data: "<html/>",
    } as AxiosResponse);

    const result = await novadaHealth(API_KEY, "quick", true);

    expect(result).toContain("attempted: true");
    expect(result).toContain("ok: true");
  });

  it("(b) probe:true response includes billing disclosure", async () => {
    mockedFetchWithRender.mockResolvedValueOnce({
      status: 200,
      data: "<html/>",
    } as AxiosResponse);

    const result = await novadaHealth(API_KEY, "quick", true);

    expect(result).toContain("probe performed 1 real render call billed to your account");
  });

  // ── (c) probe failure → card reflects failure ─────────────────────────────
  it("(c) probe failure → response reports ok: false", async () => {
    mockedFetchWithRender.mockRejectedValueOnce(new Error("connection refused"));

    const result = await novadaHealth(API_KEY, "quick", true);

    expect(result).toContain("ok: false");
  });

  it("(c) probe failure → card does NOT claim render is healthy", async () => {
    mockedFetchWithRender.mockRejectedValueOnce(new Error("timeout"));

    const result = await novadaHealth(API_KEY, "quick", true);

    // The probe result block must not show a passing render status
    // Check: ok: false is present AND ok: true is NOT
    expect(result).toContain("ok: false");
    expect(result).not.toContain("ok: true");
  });

  it("(c) probe failure → error detail included in response", async () => {
    mockedFetchWithRender.mockRejectedValueOnce(new Error("HTTP 503 service unavailable"));

    const result = await novadaHealth(API_KEY, "quick", true);

    expect(result).toContain("503");
  });

  // ── (d) probe never runs without probe:true ───────────────────────────────
  it("(d) probe never runs without probe:true — default call", async () => {
    await novadaHealth(API_KEY);

    expect(mockedFetchWithRender).not.toHaveBeenCalled();
  });

  it("(d) probe never runs without probe:true — quick mode explicit", async () => {
    await novadaHealth(API_KEY, "quick");

    expect(mockedFetchWithRender).not.toHaveBeenCalled();
  });

  it("(d) probe never runs without probe:true — full mode", async () => {
    await novadaHealth(API_KEY, "full");

    expect(mockedFetchWithRender).not.toHaveBeenCalled();
  });

  // ── probe + full mode combination ────────────────────────────────────────
  it("probe:true works with full mode — render probe AND plan data both in response", async () => {
    mockedFetchWithRender.mockResolvedValueOnce({
      status: 200,
      data: "<html/>",
    } as AxiosResponse);

    const result = await novadaHealth(API_KEY, "full", true);

    expect(result).toContain("attempted: true");
    // Should still call plan balance for full mode
    expect(mockedPlanBalanceAll).toHaveBeenCalledOnce();
  });
});
