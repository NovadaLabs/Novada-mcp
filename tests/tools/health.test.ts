/**
 * Tests for novada_health (facts-based, no synthetic probes).
 *
 * The new health.ts reads account facts via:
 *   - novadaWalletBalance (wallet balance)
 *   - novadaPlanBalanceAll (plan balances, full mode only)
 *   - fetchProxySubAccountCredentials (proxy entitlement)
 *   - fetchBrowserSubAccountCredentials (browser entitlement)
 *   - getProxyCredentials / getBrowserWs (explicit env creds)
 *
 * We mock all four to avoid real API calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock credentials utils — must be before importing health.ts
vi.mock("../../src/utils/credentials.js", () => ({
  getBrowserWs: vi.fn(),
  getProxyCredentials: vi.fn(),
  resolveProxyCredentials: vi.fn(),
  getWebUnblockerKey: vi.fn(),
  fetchProxySubAccountCredentials: vi.fn(),
  fetchBrowserSubAccountCredentials: vi.fn(),
}));

// Mock wallet_balance and plan_balance_all to avoid dev-API calls
vi.mock("../../src/tools/wallet_balance.js", () => ({
  novadaWalletBalance: vi.fn(),
}));
vi.mock("../../src/tools/plan_balance_all.js", () => ({
  novadaPlanBalanceAll: vi.fn(),
}));

import {
  getBrowserWs,
  getProxyCredentials,
  fetchProxySubAccountCredentials,
  fetchBrowserSubAccountCredentials,
} from "../../src/utils/credentials.js";
import { novadaWalletBalance } from "../../src/tools/wallet_balance.js";
import { novadaPlanBalanceAll } from "../../src/tools/plan_balance_all.js";

const mockedGetBrowserWs = vi.mocked(getBrowserWs);
const mockedGetProxyCredentials = vi.mocked(getProxyCredentials);
const mockedFetchProxyCreds = vi.mocked(fetchProxySubAccountCredentials);
const mockedFetchBrowserCreds = vi.mocked(fetchBrowserSubAccountCredentials);
const mockedWalletBalance = vi.mocked(novadaWalletBalance);
const mockedPlanBalanceAll = vi.mocked(novadaPlanBalanceAll);

const { novadaHealth } = await import("../../src/tools/health.js");

const API_KEY = "test-key-abcd";

/** Wallet response with the given balance */
function walletJson(balance: number, currency = "€"): string {
  return JSON.stringify({ status: "ok", data: { balance, currency } });
}

/** Minimal plan balance response — all products unavailable (not provisioned) */
function planJsonEmpty(): string {
  return JSON.stringify({
    status: "ok",
    summary: { active_products: [], expired_products: [], unavailable_products: ["residential", "isp", "mobile", "datacenter", "static", "capture"] },
    per_product: {
      residential: { status: "error", unavailable: true },
      isp: { status: "error", unavailable: true },
      mobile: { status: "error", unavailable: true },
      datacenter: { status: "error", unavailable: true },
      static: { status: "error", unavailable: true },
      capture: { status: "error", unavailable: true },
    },
  });
}

/** Plan balance response with one active product */
function planJsonActive(key: string, balanceMb: number, expiresAt: string): string {
  const perProduct: Record<string, unknown> = {
    residential: { status: "error", unavailable: true },
    isp: { status: "error", unavailable: true },
    mobile: { status: "error", unavailable: true },
    datacenter: { status: "error", unavailable: true },
    static: { status: "error", unavailable: true },
    capture: { status: "error", unavailable: true },
  };
  perProduct[key] = {
    status: "ok",
    balance: { balance_mb: balanceMb },
    expired: false,
    expires_at_human: expiresAt,
  };
  return JSON.stringify({
    status: "ok",
    summary: { active_products: [key], expired_products: [], unavailable_products: Object.keys(perProduct).filter(k => k !== key) },
    per_product: perProduct,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults: no env creds, auto-provision returns null
  mockedGetProxyCredentials.mockReturnValue(null);
  mockedGetBrowserWs.mockReturnValue(undefined);
  mockedFetchProxyCreds.mockResolvedValue(null);
  mockedFetchBrowserCreds.mockResolvedValue(null);
  // Defaults: wallet €10, no plan data
  mockedWalletBalance.mockResolvedValue(walletJson(10.0));
  mockedPlanBalanceAll.mockResolvedValue(planJsonEmpty());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("novadaHealth (facts-based)", () => {
  it("makes NO synthetic HTTP probe calls — only account-fact helpers", async () => {
    // fetch should NOT be called at all (no synthetic probes)
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    mockedFetchProxyCreds.mockResolvedValue({ account: "u", password: "p" });
    mockedFetchBrowserCreds.mockResolvedValue("wss://u:p@host");

    await novadaHealth(API_KEY);

    // fetchProxySubAccountCredentials and fetchBrowserSubAccountCredentials
    // use their own fetch internally — but those go through the mocked module.
    // The global fetch (synthetic-probe path) must NOT be called.
    expect(mockFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("quick mode: shows wallet balance and product availability", async () => {
    mockedFetchProxyCreds.mockResolvedValue({ account: "u", password: "p" });
    mockedFetchBrowserCreds.mockResolvedValue("wss://u:p@host");

    const result = await novadaHealth(API_KEY, "quick");

    expect(result).toContain("## Novada API — Account Status");
    expect(result).toContain("Search / Extract / Scraper / Unblock");
    expect(result).toContain("Proxy");
    expect(result).toContain("Browser API");
    // All available
    expect(result).toContain("✅ Available");
    // Wallet amount surfaced
    expect(result).toContain("€10.00");
  });

  it("quick mode: wallet €0 → needs_topup for pay-per-use tools", async () => {
    mockedWalletBalance.mockResolvedValue(walletJson(0));
    mockedFetchProxyCreds.mockResolvedValue({ account: "u", password: "p" });
    mockedFetchBrowserCreds.mockResolvedValue("wss://u:p@host");

    const result = await novadaHealth(API_KEY, "quick");

    expect(result).toContain("⚠️ Needs top-up");
    expect(result).toContain("€0.00");
    expect(result).toContain("Action Required");
  });

  it("proxy not entitled (auto-provision returns null) → not_entitled row", async () => {
    mockedFetchProxyCreds.mockResolvedValue(null);
    mockedFetchBrowserCreds.mockResolvedValue("wss://u:p@host");

    const result = await novadaHealth(API_KEY);

    expect(result).toContain("❌ Not entitled");
    expect(result).toContain("dashboard.novada.com/overview/proxy/");
  });

  it("proxy with explicit env creds → available (no auto-provision call)", async () => {
    mockedGetProxyCredentials.mockReturnValue({ user: "u", pass: "p", endpoint: "proxy:7777" });

    const result = await novadaHealth(API_KEY);

    expect(result).toContain("Proxy");
    expect(result).toContain("✅ Available");
    // Auto-provision should NOT be called when explicit creds present
    expect(mockedFetchProxyCreds).not.toHaveBeenCalled();
  });

  it("browser with explicit NOVADA_BROWSER_WS → available (no auto-provision call)", async () => {
    mockedGetBrowserWs.mockReturnValue("wss://user:pass@browser.example.com");

    const result = await novadaHealth(API_KEY);

    expect(result).toContain("Browser API");
    expect(result).toContain("✅ Available");
    expect(mockedFetchBrowserCreds).not.toHaveBeenCalled();
  });

  it("browser auto-provisioned from API key → available", async () => {
    mockedFetchBrowserCreds.mockResolvedValue("wss://u-zone-browser:p@upg-scbr2.novada.com");

    const result = await novadaHealth(API_KEY);

    expect(result).toContain("Browser API");
    expect(result).toContain("✅ Available");
    expect(result).toContain("Auto-provisioned");
  });

  it("browser not entitled → not_entitled row with dashboard link", async () => {
    mockedFetchBrowserCreds.mockResolvedValue(null);

    const result = await novadaHealth(API_KEY);

    expect(result).toContain("Browser API");
    expect(result).toContain("❌ Not entitled");
    expect(result).toContain("dashboard.novada.com/overview/browser/");
  });

  it("masks API key — only shows last 4 chars", async () => {
    const result = await novadaHealth("supersecretkey-1234");

    expect(result).toContain("****1234");
    expect(result).not.toContain("supersecretkey");
  });

  it("includes ISO timestamp in output", async () => {
    const result = await novadaHealth(API_KEY);

    expect(result).toMatch(/checked: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("includes markdown table with Product | Status | Notes headers", async () => {
    const result = await novadaHealth(API_KEY);

    expect(result).toContain("| Product | Status | Notes |");
    expect(result).toContain("|---------|--------|-------|");
  });

  it("includes authoritative-data disclaimer", async () => {
    const result = await novadaHealth(API_KEY);

    expect(result).toContain("no synthetic probes");
    expect(result).toContain("no credit cost");
  });

  it("wallet error → error status for pay-per-use row", async () => {
    mockedWalletBalance.mockRejectedValue(new Error("auth failure"));

    const result = await novadaHealth(API_KEY);

    expect(result).toContain("❌ Error");
    // Should still render a full table, not crash
    expect(result).toContain("## Novada API — Account Status");
  });

  it("full mode: calls plan_balance_all and shows plan table", async () => {
    mockedPlanBalanceAll.mockResolvedValue(planJsonActive("residential", 5000, "2026-12-31"));
    mockedFetchProxyCreds.mockResolvedValue({ account: "u", password: "p" });
    mockedFetchBrowserCreds.mockResolvedValue("wss://u:p@host");

    const result = await novadaHealth(API_KEY, "full");

    expect(result).toContain("### Proxy Plan Balances");
    expect(result).toContain("Residential");
    expect(result).toContain("5000 MB");
    expect(result).toContain("2026-12-31");
    expect(mockedPlanBalanceAll).toHaveBeenCalledOnce();
  });

  it("quick mode: does NOT call plan_balance_all", async () => {
    await novadaHealth(API_KEY, "quick");

    expect(mockedPlanBalanceAll).not.toHaveBeenCalled();
  });

  it("full mode: expired proxy plan → shows Expired status in plan table", async () => {
    const expiredPlanJson = JSON.stringify({
      status: "ok",
      summary: { active_products: [], expired_products: ["residential"], unavailable_products: [] },
      per_product: {
        residential: {
          status: "ok",
          balance: { balance_mb: 0 },
          expired: true,
          expires_at_human: "2025-01-01",
        },
        isp: { status: "error", unavailable: true },
        mobile: { status: "error", unavailable: true },
        datacenter: { status: "error", unavailable: true },
        static: { status: "error", unavailable: true },
        capture: { status: "error", unavailable: true },
      },
    });
    mockedPlanBalanceAll.mockResolvedValue(expiredPlanJson);
    mockedFetchProxyCreds.mockResolvedValue({ account: "u", password: "p" });
    mockedFetchBrowserCreds.mockResolvedValue("wss://u:p@host");

    const result = await novadaHealth(API_KEY, "full");

    expect(result).toContain("⚠️ Expired");
    expect(result).toContain("2025-01-01");
    expect(result).toContain("dashboard.novada.com");
  });

  it("summary section present with count", async () => {
    const result = await novadaHealth(API_KEY);

    expect(result).toContain("## Summary");
    expect(result).toMatch(/\d+\/\d+ product groups available/);
  });
});
