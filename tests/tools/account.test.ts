/**
 * Tests for novada_account — human-readable card output + json format.
 *
 * Mocks account_summary, wallet_balance, plan_balance_all, wallet_usage_record,
 * traffic_daily, and health to avoid real API calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks (must be before dynamic imports) ──────────────────────────────────

vi.mock("../../src/tools/account_summary.js", () => ({
  novadaAccountSummary: vi.fn(),
}));
vi.mock("../../src/tools/wallet_balance.js", () => ({
  novadaWalletBalance: vi.fn(),
}));
vi.mock("../../src/tools/plan_balance_all.js", () => ({
  novadaPlanBalanceAll: vi.fn(),
}));
vi.mock("../../src/tools/wallet_usage_record.js", () => ({
  novadaWalletUsageRecord: vi.fn(),
}));
vi.mock("../../src/tools/traffic_daily.js", () => ({
  novadaTrafficDaily: vi.fn(),
}));
vi.mock("../../src/tools/health.js", () => ({
  novadaHealth: vi.fn(),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { novadaAccountSummary } from "../../src/tools/account_summary.js";
import { novadaWalletBalance } from "../../src/tools/wallet_balance.js";
import { novadaPlanBalanceAll } from "../../src/tools/plan_balance_all.js";
import { novadaWalletUsageRecord } from "../../src/tools/wallet_usage_record.js";
import { novadaTrafficDaily } from "../../src/tools/traffic_daily.js";
import { novadaHealth } from "../../src/tools/health.js";

const mockedSummary = vi.mocked(novadaAccountSummary);
const mockedWallet = vi.mocked(novadaWalletBalance);
const mockedPlans = vi.mocked(novadaPlanBalanceAll);
const mockedUsage = vi.mocked(novadaWalletUsageRecord);
const mockedTraffic = vi.mocked(novadaTrafficDaily);
const mockedHealth = vi.mocked(novadaHealth);

const { novadaAccount, validateAccountParams } = await import("../../src/tools/account.js");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** A realistic account_summary response with ISP expired and static not provisioned. */
function makeSummaryJson(opts: {
  balance?: number;
  expiredProducts?: string[];
  activeProducts?: string[];
  unavailableProducts?: string[];
} = {}): string {
  const balance = opts.balance ?? 105.10;
  const expired = opts.expiredProducts ?? ["isp"];
  const active = opts.activeProducts ?? ["residential"];
  const unavailable = opts.unavailableProducts ?? ["mobile", "datacenter", "static", "capture"];

  const perProduct: Record<string, unknown> = {};
  for (const p of active) {
    perProduct[p] = { status: "ok", balance: { balance_mb: 10240 }, expired: false, expires_at: "2026-12-31" };
  }
  for (const p of expired) {
    perProduct[p] = { status: "ok", balance: { balance_mb: 0 }, expired: true, expires_at: "2025-01-01" };
  }
  for (const p of unavailable) {
    perProduct[p] = { status: "error", unavailable: true, see_errors: true };
  }

  return JSON.stringify({
    status: "ok",
    latency_ms: 250,
    headline: `Wallet: €${balance.toFixed(2)} · Plans: ${active.length} active / ${expired.length} expired / ${unavailable.length} unavailable`,
    sections: {
      wallet: { status: "ok", balance, currency: "€" },
      plans: {
        status: "ok",
        summary: {
          active_products: active,
          expired_products: expired,
          unavailable_products: unavailable,
          all_plans_expired: active.length === 0 && expired.length > 0,
        },
        per_product: perProduct,
      },
      capture_recent: { status: "ok", recent: [{ id: "c1" }, { id: "c2" }] },
    },
    errors: [
      ...unavailable.map(p => ({ product: p, error: "Product not provisioned on this account (HTTP 404)" })),
    ],
    agent_instruction: "Account snapshot.",
  });
}

function makeHealthMarkdown(): string {
  return `## Novada API — Account Status\n\napi_key: ****abcd\nchecked: ${new Date().toISOString()}\n\n> no synthetic probes, no credit cost.\n\n| Product | Status | Notes |\n|---------|--------|-------|\n| Search / Extract / Scraper / Unblock | ✅ Available | €105.10 |\n| Proxy | ✅ Available | Auto-provisioned |\n| Browser API | ❌ Not entitled | |\n\n---\n## Summary\n- 2/3 product groups available`;
}

function makeWalletJson(balance = 105.10): string {
  return JSON.stringify({ status: "ok", data: { balance, currency: "€" } });
}

function makePlansJson(): string {
  return JSON.stringify({
    status: "ok",
    summary: { active_products: ["residential"], expired_products: ["isp"], unavailable_products: ["mobile", "datacenter", "static", "capture"] },
    per_product: {
      residential: { status: "ok", balance: { balance_mb: 10240 }, expired: false, expires_at: "2026-12-31" },
      isp: { status: "ok", balance: { balance_mb: 0 }, expired: true, expires_at: "2025-01-01" },
      mobile: { status: "error", unavailable: true, see_errors: true },
      datacenter: { status: "error", unavailable: true, see_errors: true },
      static: { status: "error", unavailable: true, see_errors: true },
      capture: { status: "error", unavailable: true, see_errors: true },
    },
    errors: [
      { product: "mobile", error: "Product not provisioned on this account (HTTP 404)" },
      { product: "datacenter", error: "Product not provisioned on this account (HTTP 404)" },
      { product: "static", error: "Product not provisioned on this account (HTTP 404)" },
      { product: "capture", error: "Product not provisioned on this account (HTTP 404)" },
    ],
  });
}

function makeUsageJson(): string {
  return JSON.stringify({
    status: "ok",
    data: {
      count: 2,
      list: [
        { created_at: "2026-06-30T10:00:00Z", remark: "Search API usage", amount: -0.50, currency: "€" },
        { created_at: "2026-06-29T09:00:00Z", remark: "Wallet top-up", amount: 50.00, currency: "€" },
      ],
    },
  });
}

function makeTrafficJson(): string {
  return JSON.stringify({
    status: "ok",
    range: { start_time: "2026-06-27", end_time: "2026-07-04" },
    total_mb_across_products: 2560,
    per_product: {
      residential: { status: "ok", total_mb: 2048 },
      isp: { status: "ok", total_mb: 512 },
      mobile: { status: "error", error: "Product not provisioned" },
      datacenter: { status: "error", error: "Product not provisioned" },
      static: { status: "error", error: "Product not provisioned" },
    },
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockedSummary.mockResolvedValue(makeSummaryJson());
  mockedHealth.mockResolvedValue(makeHealthMarkdown());
  mockedWallet.mockResolvedValue(makeWalletJson());
  mockedPlans.mockResolvedValue(makePlansJson());
  mockedUsage.mockResolvedValue(makeUsageJson());
  mockedTraffic.mockResolvedValue(makeTrafficJson());
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Schema validation ────────────────────────────────────────────────────────

describe("validateAccountParams", () => {
  it("defaults section=summary and format=card", () => {
    const p = validateAccountParams({});
    expect(p.section).toBe("summary");
    expect(p.format).toBe("card");
  });

  it("accepts format=json", () => {
    const p = validateAccountParams({ format: "json" });
    expect(p.format).toBe("json");
  });

  it("rejects invalid format", () => {
    expect(() => validateAccountParams({ format: "xml" })).toThrow();
  });

  it("accepts all valid sections", () => {
    for (const section of ["summary", "balance", "usage", "plans", "traffic"] as const) {
      const p = validateAccountParams({ section });
      expect(p.section).toBe(section);
    }
  });
});

// ─── Summary — card format ────────────────────────────────────────────────────

describe("novadaAccount summary section — card format", () => {
  it("renders a human card (not raw JSON)", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "card" }));
    // Should be markdown, NOT a raw JSON object
    expect(result).not.toMatch(/^\{/);
    expect(result).toContain("## Novada Account");
  });

  it("shows wallet balance in readable form", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "card" }));
    expect(result).toContain("€105.10");
  });

  it("surfaces expired plan VISIBLY — not buried", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "card" }));
    // The expired warning must be prominent — not just in a table cell
    expect(result).toContain("⚠️");
    expect(result.toLowerCase()).toContain("expired");
    expect(result.toLowerCase()).toContain("isp");
  });

  it("shows a plan table with status icons", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "card" }));
    expect(result).toContain("| Plan | Status | Balance | Expires |");
    expect(result).toContain("✅ active");
    expect(result).toContain("⚠️ EXPIRED");
    expect(result).toContain("⛔ not provisioned");
  });

  it("shows balance in human units (MB/GB) not raw bytes", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "card" }));
    // 10240 MB = 10.0 GB
    expect(result).toMatch(/10\.0\s*GB/);
  });

  it("does NOT show raw API error text for not-provisioned products", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "card" }));
    // The raw 404 error text should NOT appear in human card
    expect(result).not.toContain("HTTP 404");
    expect(result).not.toContain("Product not provisioned on this account");
  });

  it("includes dashboard link when expired plans exist", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "card" }));
    expect(result).toContain("dashboard.novada.com");
  });
});

// ─── Summary — json format ────────────────────────────────────────────────────

describe("novadaAccount summary section — json format", () => {
  it("returns parseable JSON", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "json" }));
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("is flat — wallet balance at wallet.balance not data.data.balance", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "json" }));
    const obj = JSON.parse(result) as Record<string, unknown>;
    const wallet = obj.wallet as Record<string, unknown>;
    expect(typeof wallet.balance).toBe("number");
    expect(wallet.balance).toBeCloseTo(105.10);
  });

  it("includes human-readable balance_human field", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "json" }));
    const obj = JSON.parse(result) as Record<string, unknown>;
    const wallet = obj.wallet as Record<string, unknown>;
    expect(wallet.balance_human).toBe("€105.10");
  });

  it("identifies expired plans in plans.expired array", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "json" }));
    const obj = JSON.parse(result) as Record<string, unknown>;
    const plans = obj.plans as Record<string, unknown>;
    expect(plans.expired).toContain("isp");
  });

  it("marks each per_product status as expired/active/not_provisioned", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "json" }));
    const obj = JSON.parse(result) as Record<string, unknown>;
    const plans = obj.plans as Record<string, unknown>;
    const pp = plans.per_product as Record<string, Record<string, unknown>>;
    expect(pp.residential.status).toBe("active");
    expect(pp.isp.status).toBe("expired");
    expect(pp.static.status).toBe("not_provisioned");
  });

  it("does NOT include raw API error text in errors array", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "json" }));
    const obj = JSON.parse(result) as Record<string, unknown>;
    const errors = (obj.errors as Array<{ product: string; message: string }>) ?? [];
    // not_provisioned errors should be filtered out
    for (const e of errors) {
      expect(e.message).not.toContain("HTTP 404");
      expect(e.message).not.toContain("Product not provisioned");
    }
  });

  it("includes balance_mb and balance_human per product", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "json" }));
    const obj = JSON.parse(result) as Record<string, unknown>;
    const plans = obj.plans as Record<string, unknown>;
    const pp = plans.per_product as Record<string, Record<string, unknown>>;
    expect(pp.residential.balance_mb).toBe(10240);
    expect(pp.residential.balance_human).toMatch(/GB|MB/);
  });
});

// ─── Balance section ──────────────────────────────────────────────────────────

describe("novadaAccount balance section", () => {
  it("card: renders readable balance", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "balance", format: "card" }));
    expect(result).toContain("€105.10");
    expect(result).toContain("Wallet Balance");
  });

  it("json: passes raw wallet JSON through", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "balance", format: "json" }));
    const obj = JSON.parse(result) as Record<string, unknown>;
    const data = obj.data as Record<string, unknown>;
    expect(data.balance).toBeCloseTo(105.10);
  });
});

// ─── Plans section ────────────────────────────────────────────────────────────

describe("novadaAccount plans section", () => {
  it("card: renders plan table with expired marker", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "plans", format: "card" }));
    expect(result).toContain("Plan Balances");
    expect(result).toContain("| Plan | Status | Balance | Expires |");
    expect(result).toContain("⚠️ EXPIRED");
    expect(result).toContain("ISP");
  });

  it("card: shows active plan with GB balance", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "plans", format: "card" }));
    // 10240 MB = 10.0 GB
    expect(result).toMatch(/10\.0\s*GB/);
  });

  it("card: shows dashboard link for expired plans", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "plans", format: "card" }));
    expect(result).toContain("dashboard.novada.com");
  });

  it("card: not-provisioned products show ⛔", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "plans", format: "card" }));
    expect(result).toContain("⛔ not provisioned");
  });

  it("json: passes raw plan JSON through", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "plans", format: "json" }));
    const obj = JSON.parse(result) as Record<string, unknown>;
    expect(obj.summary).toBeDefined();
    expect(obj.per_product).toBeDefined();
  });
});

// ─── Usage section ────────────────────────────────────────────────────────────

describe("novadaAccount usage section", () => {
  it("card: renders markdown table", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "usage", format: "card" }));
    expect(result).toContain("Wallet Usage History");
    expect(result).toContain("| Date | Description | Amount |");
    expect(result).toContain("Search API usage");
  });

  it("json: passes raw usage JSON through", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "usage", format: "json" }));
    const obj = JSON.parse(result) as Record<string, unknown>;
    const data = obj.data as Record<string, unknown>;
    expect(Array.isArray(data.list)).toBe(true);
  });
});

// ─── Traffic section ──────────────────────────────────────────────────────────

describe("novadaAccount traffic section", () => {
  it("card: renders traffic table with GB totals", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "traffic", format: "card" }));
    expect(result).toContain("Traffic Usage");
    expect(result).toContain("| Product | Consumed |");
    // 2560 MB = 2.5 GB
    expect(result).toMatch(/2\.5\s*GB/);
  });

  it("card: shows residential traffic", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "traffic", format: "card" }));
    expect(result).toContain("residential");
  });

  it("json: passes raw traffic JSON through", async () => {
    const result = await novadaAccount(validateAccountParams({ section: "traffic", format: "json" }));
    const obj = JSON.parse(result) as Record<string, unknown>;
    expect(typeof obj.total_mb_across_products).toBe("number");
  });
});

// ─── Graceful degradation on dev-api business-code failures ──────────────────

describe("novadaAccount — graceful degradation on dev-api failure", () => {
  it("summary card: returns dashboard-pointer message (not raw error) when account_summary throws a non-auth error", async () => {
    mockedSummary.mockRejectedValue(new Error("Developer-api rejected request (code=40002): No approval received"));
    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "card" }));
    // Must NOT surface as a bare error blob (isError flag, raw stack, etc.)
    expect(result).not.toContain("isError");
    // Must contain the friendly pointer as primary content
    expect(result).toContain("dashboard.novada.com/wallet/");
    expect(result).toContain("API key still works");
    // The friendly pointer must come BEFORE any reason snippet
    const pointerIdx = result.indexOf("dashboard.novada.com/wallet/");
    const reasonIdx = result.indexOf("Reason:");
    // If there's a Reason line, the pointer must appear before it
    if (reasonIdx !== -1) {
      expect(pointerIdx).toBeLessThan(reasonIdx);
    }
  });

  it("summary json: returns structured unavailable object (not raw error) on non-auth failure", async () => {
    mockedSummary.mockRejectedValue(new Error("Developer-api rejected request (code=40002): No approval received"));
    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "json" }));
    const obj = JSON.parse(result) as Record<string, unknown>;
    expect(obj.status).toBe("unavailable");
    expect(obj.message).toContain("dashboard.novada.com/wallet/");
    expect(obj.agent_instruction).toContain("not an auth failure");
    // Must be parseable JSON — not a raw error string thrown as a bare object
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("balance card: returns dashboard-pointer on non-auth dev-api failure", async () => {
    mockedWallet.mockRejectedValue(new Error("Developer-api rejected request (code=40002): No approval received"));
    const result = await novadaAccount(validateAccountParams({ section: "balance", format: "card" }));
    expect(result).toContain("dashboard.novada.com/wallet/");
    // Must NOT be just the raw error blob without any friendly context
    expect(result).not.toContain("isError");
  });

  it("balance json: returns structured unavailable object on non-auth failure", async () => {
    mockedWallet.mockRejectedValue(new Error("Developer-api rejected request (code=99): Some business error"));
    const result = await novadaAccount(validateAccountParams({ section: "balance", format: "json" }));
    const obj = JSON.parse(result) as Record<string, unknown>;
    expect(obj.status).toBe("unavailable");
    expect(obj.message).toContain("dashboard.novada.com/wallet/");
  });

  it("plans card: returns dashboard-pointer on non-auth failure", async () => {
    mockedPlans.mockRejectedValue(new Error("Network error"));
    const result = await novadaAccount(validateAccountParams({ section: "plans", format: "card" }));
    expect(result).toContain("dashboard.novada.com/wallet/");
  });

  it("usage card: returns dashboard-pointer on non-auth failure", async () => {
    mockedUsage.mockRejectedValue(new Error("Developer-api returned HTTP 500. Treat as transient"));
    const result = await novadaAccount(validateAccountParams({ section: "usage", format: "card" }));
    expect(result).toContain("dashboard.novada.com/wallet/");
  });

  it("traffic card: returns dashboard-pointer on non-auth failure", async () => {
    mockedTraffic.mockRejectedValue(new Error("Developer-api rejected request (code=40002): No approval received"));
    const result = await novadaAccount(validateAccountParams({ section: "traffic", format: "card" }));
    expect(result).toContain("dashboard.novada.com/wallet/");
    // Must not be a bare error blob
    expect(result).not.toContain("isError");
  });

  it("non-zero business code does NOT surface as INVALID_API_KEY / 'key invalid'", async () => {
    mockedSummary.mockRejectedValue(new Error("Developer-api rejected request (code=40002): No approval received"));
    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "card" }));
    expect(result).not.toMatch(/key.*invalid/i);
    expect(result).not.toContain("INVALID_API_KEY");
  });

  it("includes a sanitized reason snippet (without raw secrets) when available", async () => {
    mockedWallet.mockRejectedValue(new Error("Developer-api rejected request (code=40002): No approval received"));
    const result = await novadaAccount(validateAccountParams({ section: "balance", format: "card" }));
    // The reason line should appear but must not expose secret patterns
    expect(result).toContain("Reason:");
    expect(result).not.toMatch(/api_key=[^&\s"')\*]/);
  });

  it("auth failure (INVALID_API_KEY) still bubbles — is NOT silently swallowed", async () => {
    const { NovadaError, NovadaErrorCode } = await import("../../src/_core/errors.js");
    const authErr = new NovadaError({
      code: NovadaErrorCode.INVALID_API_KEY,
      message: "Developer-api auth failure: key rejected",
      agent_instruction: "Fix the key",
      retryable: false,
    });
    mockedSummary.mockRejectedValue(authErr);
    await expect(
      novadaAccount(validateAccountParams({ section: "summary", format: "card" }))
    ).rejects.toThrow();
  });
});

// ─── All-expired edge case ────────────────────────────────────────────────────

describe("novadaAccount — all plans expired", () => {
  it("card shows prominent warning when all plans are expired", async () => {
    mockedSummary.mockResolvedValue(makeSummaryJson({
      balance: 105.10,
      expiredProducts: ["residential", "isp"],
      activeProducts: [],
      unavailableProducts: ["mobile", "datacenter", "static", "capture"],
    }));

    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "card" }));
    expect(result).toContain("⚠️");
    // Both expired products should be mentioned
    expect(result.toLowerCase()).toContain("residential");
    expect(result.toLowerCase()).toContain("isp");
    expect(result).toContain("dashboard.novada.com");
  });

  it("json correctly lists all expired in plans.expired", async () => {
    mockedSummary.mockResolvedValue(makeSummaryJson({
      balance: 105.10,
      expiredProducts: ["residential", "isp"],
      activeProducts: [],
      unavailableProducts: ["mobile", "datacenter", "static", "capture"],
    }));

    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "json" }));
    const obj = JSON.parse(result) as Record<string, unknown>;
    const plans = obj.plans as Record<string, unknown>;
    expect(plans.expired).toContain("residential");
    expect(plans.expired).toContain("isp");
    expect((plans.active as string[]).length).toBe(0);
  });
});
