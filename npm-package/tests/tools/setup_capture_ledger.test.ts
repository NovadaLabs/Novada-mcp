/**
 * novada_setup — G-12 fix (a): name BOTH ledgers, not Wallet-only.
 *
 * Finding (G-security-billing.md, G-12): "novada_setup's balance line reads the
 * wallet ledger only (setup.ts:78-81) — a wallet-$0/capture-funded account (the
 * exact 2026-07-30 incident shape) is told to 'top up'." This file proves the
 * fix: setup.ts now fetches Capture (scoped, via plan_balance_all) alongside
 * Wallet and shows BOTH numbers from a single novada_setup call, in both the
 * human-readable balance line and the machine-readable `## Agent` block —
 * and that a Capture-fetch failure never blocks or corrupts the (already
 * successful) Wallet result.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/tools/wallet_balance.js", () => ({
  novadaWalletBalance: vi.fn(),
}));
vi.mock("../../src/tools/plan_balance_all.js", () => ({
  novadaPlanBalanceAll: vi.fn(),
}));

import { novadaWalletBalance } from "../../src/tools/wallet_balance.js";
import { novadaPlanBalanceAll } from "../../src/tools/plan_balance_all.js";
const mockedWallet = vi.mocked(novadaWalletBalance);
const mockedPlanBalance = vi.mocked(novadaPlanBalanceAll);

const { novadaSetup } = await import("../../src/tools/setup.js");

// process.env is a process-global — strip/restore explicitly (mirrors
// setup.test.ts's ENV_KEYS pattern) so this file's assertions are not at the
// mercy of whatever the invoking shell happens to have set.
const ENV_KEYS = ["NOVADA_API_KEY", "NOVADA_DEVELOPER_API_KEY"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  mockedWallet.mockResolvedValue(JSON.stringify({ status: "ok", data: { balance: 50.10 } }));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("novadaSetup — shows BOTH Wallet and Capture balances in one call", () => {
  it("appends a Capture balance line alongside the Wallet line when Capture is funded", async () => {
    mockedPlanBalance.mockResolvedValue(
      JSON.stringify({ status: "ok", per_product: { capture: { status: "ok", balance: { balance: 49.03 } } } }),
    );

    const result = await novadaSetup({} as never, "sk-test-KEY1234");

    expect(result).toContain("Wallet balance: 50.10");
    expect(result).toContain("Capture balance: 49.03");
    // Asked for exactly the scoped product — no reason to fetch the other 5.
    expect(mockedPlanBalance).toHaveBeenCalledWith({ products: ["capture"] }, "sk-test-KEY1234");
    // Both surfaced in the machine-readable block too.
    expect(result).toContain("wallet_balance: 50.10");
    expect(result).toContain("capture_balance: 49.03");
  });

  it("THE G-12 INCIDENT SHAPE: Wallet has funds but Capture is $0.00 — must NOT read as a simple 'top up' with no ledger distinction", async () => {
    mockedPlanBalance.mockResolvedValue(
      JSON.stringify({ status: "ok", per_product: { capture: { status: "ok", balance: { balance: 0 } } } }),
    );

    const result = await novadaSetup({} as never, "sk-test-KEY1234");

    expect(result).toContain("Wallet balance: 50.10");
    expect(result).toContain("Capture balance: 0.00");
    // Must explicitly warn that these are DIFFERENT ledgers — the exact gap the
    // finding calls out ("would still read as 'top up' in setup's summary line").
    expect(result.toLowerCase()).toContain("different ledgers");
    expect(result).toContain("capture_balance: 0.00");
  });

  it("Capture not provisioned on this account: says so, never silently omitted", async () => {
    mockedPlanBalance.mockResolvedValue(
      JSON.stringify({ status: "partial", per_product: { capture: { status: "error", unavailable: true } } }),
    );

    const result = await novadaSetup({} as never, "sk-test-KEY1234");

    expect(result).toContain("Wallet balance: 50.10");
    expect(result).toContain("Capture balance: not provisioned");
    // No numeric capture_balance line when the value truly isn't known — never
    // fabricate a 0.00 that would misleadingly look like a real reading.
    expect(result).not.toContain("capture_balance:");
  });

  it("Capture-fetch failure (network/parse error) degrades honestly and never blocks the Wallet result", async () => {
    mockedPlanBalance.mockRejectedValue(new Error("Developer-api returned HTTP 503"));

    const result = await novadaSetup({} as never, "sk-test-KEY1234");

    expect(result).toContain("Wallet balance: 50.10");
    expect(result).toContain("Capture balance: unavailable right now");
    expect(result).toContain('novada_account(section="plans")');
    // The overall call must still succeed (state ready), not throw.
    expect(result).toContain("You're ready");
  });

  it("does not fetch Capture at all when the key is not set (state=not_set) — no gratuitous network call", async () => {
    const result = await novadaSetup({} as never, undefined);
    expect(result).toContain("No API key yet");
    expect(mockedPlanBalance).not.toHaveBeenCalled();
  });
});
