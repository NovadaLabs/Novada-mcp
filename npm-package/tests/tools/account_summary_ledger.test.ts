/**
 * novada_account (section="summary") / account_summary.ts — G-12 fix (b):
 * name BOTH ledgers in the readable headline, and flag the wallet-funded/
 * capture-$0 shape explicitly in agent_instruction.
 *
 * Finding (G-security-billing.md, G-12): plan_balance_all's payload already
 * carries the Capture NUMBER two levels deep at
 * sections.plans.per_product.capture.balance.balance, but the human-readable
 * headline used to show Wallet + an aggregate active/expired COUNT only —
 * never the Capture number itself. This file proves the headline now shows
 * both, and that the exact "wallet-$0-but-capture-funded" (and its inverse,
 * "capture-$0-but-wallet-funded") incident shape is called out by name.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/tools/wallet_balance.js", () => ({
  novadaWalletBalance: vi.fn(),
}));
vi.mock("../../src/tools/plan_balance_all.js", () => ({
  novadaPlanBalanceAll: vi.fn(),
}));
vi.mock("../../src/tools/capture_logs.js", () => ({
  novadaCaptureLogs: vi.fn().mockResolvedValue(JSON.stringify({ status: "ok", data: { list: [] } })),
}));

import { novadaWalletBalance } from "../../src/tools/wallet_balance.js";
import { novadaPlanBalanceAll } from "../../src/tools/plan_balance_all.js";
const mockedWallet = vi.mocked(novadaWalletBalance);
const mockedPlanBalance = vi.mocked(novadaPlanBalanceAll);

const { novadaAccountSummary } = await import("../../src/tools/account_summary.js");

beforeEach(() => {
  vi.clearAllMocks();
});

function planBalancePayload(opts: {
  captureBalance?: number;
  active?: string[];
  expired?: string[];
  unavailable?: string[];
  allExpired?: boolean;
}): string {
  return JSON.stringify({
    status: "ok",
    summary: {
      active_products: opts.active ?? [],
      expired_products: opts.expired ?? [],
      unavailable_products: opts.unavailable ?? [],
      all_plans_expired: opts.allExpired ?? false,
    },
    per_product:
      opts.captureBalance === undefined
        ? {}
        : { capture: { status: "ok", balance: { balance: opts.captureBalance } } },
  });
}

describe("account_summary — headline names BOTH Wallet and Capture", () => {
  it("shows both numeric balances when both are funded", async () => {
    mockedWallet.mockResolvedValue(JSON.stringify({ status: "ok", data: { balance: 50.10 } }));
    mockedPlanBalance.mockResolvedValue(planBalancePayload({ captureBalance: 49.03, active: ["residential", "capture"] }));

    const raw = await novadaAccountSummary({} as never);
    const parsed = JSON.parse(raw) as { headline: string };

    expect(parsed.headline).toContain("Wallet: 50.10");
    expect(parsed.headline).toContain("Capture: 49.03");
  });

  it("THE G-12 INCIDENT SHAPE: Wallet funded, Capture $0.00 — agent_instruction names both ledgers and the exact mismatch", async () => {
    mockedWallet.mockResolvedValue(JSON.stringify({ status: "ok", data: { balance: 50.10 } }));
    mockedPlanBalance.mockResolvedValue(planBalancePayload({ captureBalance: 0, active: ["residential"] }));

    const raw = await novadaAccountSummary({} as never);
    const parsed = JSON.parse(raw) as { headline: string; agent_instruction: string };

    expect(parsed.headline).toContain("Wallet: 50.10");
    expect(parsed.headline).toContain("Capture: 0.00");
    expect(parsed.agent_instruction).toContain("Capture balance is 0.00");
    expect(parsed.agent_instruction.toLowerCase()).toContain("different ledgers");
    expect(parsed.agent_instruction).toContain("novada_search");
    expect(parsed.agent_instruction).toContain("novada_scrape");
  });

  it("Capture errored (fetch failure, not just $0): headline says 'Capture: error', never silently omitted", async () => {
    mockedWallet.mockResolvedValue(JSON.stringify({ status: "ok", data: { balance: 50.10 } }));
    mockedPlanBalance.mockRejectedValue(new Error("Developer-api returned HTTP 503"));

    const raw = await novadaAccountSummary({} as never);
    const parsed = JSON.parse(raw) as { headline: string; status: string };

    expect(parsed.headline).toContain("Wallet: 50.10");
    expect(parsed.headline).toContain("Capture: error");
    expect(parsed.status).toBe("partial");
  });

  it("all-flow-plans-expired path still fires (unaffected by the Capture addition) and still separately notes Capture is funded separately", async () => {
    mockedWallet.mockResolvedValue(JSON.stringify({ status: "ok", data: { balance: 12.5 } }));
    mockedPlanBalance.mockResolvedValue(
      planBalancePayload({ captureBalance: 8.2, expired: ["residential"], allExpired: true }),
    );

    const raw = await novadaAccountSummary({} as never);
    const parsed = JSON.parse(raw) as { headline: string; agent_instruction: string };

    expect(parsed.headline).toContain("ALL plans expired");
    expect(parsed.headline).toContain("Capture: 8.20");
    expect(parsed.agent_instruction).toContain("Capture is funded separately");
  });
});
