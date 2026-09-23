/**
 * B2 (2026-09-21) — novada_setup full-ledger readiness.
 *
 * Problem this pins: setup consulted ONE ledger (Capture, via
 * plan_balance_all({products:["capture"]})) and declared "ready" while every
 * proxy product could be expired/exhausted — an agent learned that scrapers/
 * proxy were dead only by burning a failing call. Fix: setup ALSO fans out an
 * unfiltered novadaPlanBalanceAll({}) and renders a compact per-product status
 * line (residential/isp/mobile/datacenter/static/capture) plus a cheap
 * NOVADA_BROWSER_WS presence check, and the machine-readable `## Agent` block
 * enumerates per-product status.
 *
 * `state:"ready"` keeps meaning "the key authenticates" — a dead product does
 * NOT flip the key state; it is surfaced alongside it.
 *
 * CLASS-shaped fixture: the required product keys are DERIVED from
 * FLOW_BALANCE_ENDPOINTS (+ "static"), so adding a 7th product to the table
 * makes the fixture-coverage guard below fail until a new fixture ROW is added
 * — never a silent gap.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/tools/wallet_balance.js", () => ({
  novadaWalletBalance: vi.fn(),
}));
// Keep the REAL table exports (FLOW_BALANCE_ENDPOINTS) — only the fetch is mocked.
vi.mock("../../src/tools/plan_balance_all.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tools/plan_balance_all.js")>();
  return { ...actual, novadaPlanBalanceAll: vi.fn() };
});

import { novadaWalletBalance } from "../../src/tools/wallet_balance.js";
import { novadaPlanBalanceAll, FLOW_BALANCE_ENDPOINTS } from "../../src/tools/plan_balance_all.js";
const mockedWallet = vi.mocked(novadaWalletBalance);
const mockedPlanBalance = vi.mocked(novadaPlanBalanceAll);

const { novadaSetup } = await import("../../src/tools/setup.js");

const API_KEY = "sk-test-READINESS";

/**
 * The authoritative product-key list, CLASS-derived: every flow-ledger row in
 * the shared table, plus the per-IP "static" product plan_balance_all appends.
 * A 7th product added to FLOW_BALANCE_ENDPOINTS automatically lands here.
 */
const REQUIRED_KEYS: string[] = [...FLOW_BALANCE_ENDPOINTS.map((e) => e.key), "static"];

/** One fixture ROW per product key — the coverage guard below enforces completeness. */
const FULL_FIXTURE: Record<string, unknown> = {
  residential: { status: "ok", balance: { balance: 3.5 * 1024 * 1024 * 1024 }, balance_human: "3.5 GB" },
  isp: { status: "ok", balance: { balance: 0 }, expired: true, expires_at_human: "2026-07-08", exhausted: true, balance_human: "0.0 MB" },
  mobile: { status: "ok", balance: { total: 100, used: 100 }, exhausted: true, balance_human: "100/100 req" },
  datacenter: { status: "error", error: "Product not provisioned (HTTP 404)", unavailable: true },
  static: { status: "ok", balance: { billing_model: "per_ip_lifecycle", active_ip_count: 2 } },
  capture: { status: "ok", balance: { balance: 49.03 }, balance_human: "49.03 credits" },
};

const CAPTURE_SCOPED_RESPONSE = JSON.stringify({
  status: "ok",
  per_product: { capture: FULL_FIXTURE.capture },
});

const FULL_RESPONSE = JSON.stringify({
  status: "partial",
  summary: { active_products: ["residential", "static", "capture"], expired_products: ["isp"], unavailable_products: ["datacenter"] },
  per_product: FULL_FIXTURE,
});

/** Route the two plan_balance_all call shapes: scoped {products:[...]} vs unfiltered {}. */
function mockPlanBalanceRouting(opts?: { failUnfiltered?: boolean }) {
  mockedPlanBalance.mockImplementation(async (params: { products?: string[] }) => {
    const scoped = Array.isArray(params?.products) && params.products.length > 0;
    if (scoped) return CAPTURE_SCOPED_RESPONSE;
    if (opts?.failUnfiltered) throw new Error("Developer-api returned HTTP 503");
    return FULL_RESPONSE;
  });
}

const ENV_KEYS = ["NOVADA_API_KEY", "NOVADA_DEVELOPER_API_KEY", "NOVADA_BROWSER_WS"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  mockedWallet.mockResolvedValue(JSON.stringify({ status: "ok", data: { balance: 50.1 } }));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("fixture class guard — every product key has a fixture ROW", () => {
  it("FULL_FIXTURE covers every FLOW_BALANCE_ENDPOINTS key + static (a 7th product = a new fixture row, not a silent gap)", () => {
    for (const key of REQUIRED_KEYS) {
      expect(FULL_FIXTURE, `fixture is missing a row for product "${key}" — add one`).toHaveProperty(key);
    }
  });
});

describe("novadaSetup — full-ledger per-product readiness (B2)", () => {
  it("makes the UNFILTERED plan_balance_all call (all products), not just the scoped capture one", async () => {
    mockPlanBalanceRouting();

    await novadaSetup({} as never, API_KEY);

    expect(mockedPlanBalance).toHaveBeenCalledWith({}, API_KEY);
    // The scoped capture call (G-12 wallet-line enrichment) still happens too.
    expect(mockedPlanBalance).toHaveBeenCalledWith({ products: ["capture"] }, API_KEY);
  });

  it("enumerates EVERY product key in the machine-readable product_status line", async () => {
    mockPlanBalanceRouting();

    const result = await novadaSetup({} as never, API_KEY);

    const statusLine = result.split("\n").find((l) => l.startsWith("product_status:"));
    expect(statusLine, "## Agent block must carry a product_status: line").toBeDefined();
    for (const key of REQUIRED_KEYS) {
      expect(statusLine, `product_status must enumerate "${key}"`).toContain(`${key}=`);
    }
  });

  it("surfaces expired / exhausted / not-provisioned products BEFORE the agent burns a call on them", async () => {
    mockPlanBalanceRouting();

    const result = await novadaSetup({} as never, API_KEY);

    // Machine-readable statuses (worst-first derivation: expired beats exhausted).
    expect(result).toContain("isp=expired");
    expect(result).toContain("mobile=exhausted");
    expect(result).toContain("datacenter=not_provisioned");
    expect(result).toContain("residential=active");

    // Human-readable compact line names the dead products too.
    expect(result).toContain("Products:");
    expect(result).toMatch(/isp[^\n·]*expired/);
    expect(result).toMatch(/mobile[^\n·]*exhausted/);
    expect(result).toMatch(/datacenter[^\n·]*not provisioned/);
  });

  it("key state stays 'ready' (the key authenticates) even when proxy products are dead — readiness is additive, not a gate", async () => {
    mockPlanBalanceRouting();

    const result = await novadaSetup({} as never, API_KEY);

    expect(result).toContain("You're ready");
    expect(result).toContain("key_state: ready");
    expect(result).toContain("isp=expired");
  });

  it("NOVADA_BROWSER_WS presence check: not set → browser_ws_configured: false (env-only, no network)", async () => {
    mockPlanBalanceRouting();
    delete process.env.NOVADA_BROWSER_WS;

    const result = await novadaSetup({} as never, API_KEY);

    expect(result).toContain("browser_ws_configured: false");
    expect(result).toContain("Browser WS");
  });

  it("NOVADA_BROWSER_WS presence check: set → browser_ws_configured: true", async () => {
    mockPlanBalanceRouting();
    process.env.NOVADA_BROWSER_WS = "wss://user:pass@browser.example.com";

    const result = await novadaSetup({} as never, API_KEY);

    expect(result).toContain("browser_ws_configured: true");
    // Never echo the credential-bearing value itself.
    expect(result).not.toContain("wss://user:pass@browser.example.com");
  });

  it("readiness-fetch failure degrades honestly (product_status: unavailable + pointer) and never blocks the ready state", async () => {
    mockPlanBalanceRouting({ failUnfiltered: true });

    const result = await novadaSetup({} as never, API_KEY);

    expect(result).toContain("You're ready");
    expect(result).toContain("product_status: unavailable");
    expect(result).toContain('novada_account(section="plans")');
  });

  it("no key set → no plan_balance_all calls at all (no gratuitous network on first run)", async () => {
    mockPlanBalanceRouting();

    const result = await novadaSetup({} as never, undefined);

    expect(result).toContain("No API key yet");
    expect(mockedPlanBalance).not.toHaveBeenCalled();
  });
});
