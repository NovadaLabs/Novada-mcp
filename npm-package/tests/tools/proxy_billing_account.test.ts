/**
 * HIGH-1 (review round, 2026-09-10) — the F11 ledger preflight must consult the
 * ledger of the account that will be BILLED, not whatever key the server
 * environment happens to carry.
 *
 * Background: credential auto-fetch resolves the effective key as
 * `apiKey ?? store.getStore()?.apiKey ?? process.env.NOVADA_API_KEY` (caller's
 * key wins on hosted/SDK pass-through), but the a2ae130 preflight read the
 * ledger with NO key — falling back to the SERVER account's env key. The gate
 * and the billing diverged, cross-account:
 *
 *   Direction A (caller-poor / server-rich): caller's plan is dead, server's is
 *     healthy → preflight passed, dead creds issued, and the "## Ledger"
 *     evidence printed the WRONG account's balance.
 *   Direction B (caller-rich / server-poor): server's ledger exhausted → every
 *     hosted caller, including healthy paying ones, was refused (the 2026-07-30
 *     wrong-ledger-denial P0 class, now across accounts).
 *
 * Pinned here (all RED against a2ae130):
 *   1. Direction A — the ledger lookup runs with the CALLER's key and the
 *      caller-exhausted ledger REFUSES (never issues silently).
 *   2. Direction B — the caller-rich ledger issues credentials even though the
 *      server env key's ledger is exhausted (never refuse a paying caller on
 *      the server's ledger).
 *   3. Direct env creds — the billing account is unknowable, so the preflight
 *      consults NOTHING and the response discloses "ledger unknown for the
 *      billing account" (fail-open + disclose, never judge the wrong account).
 *   4. The SDK sibling entry points follow the same billing-account rule.
 *
 * INVARIANT: no real credentials, no network — the mgmt-API auto-fetch (global
 * fetch), the ledger lookup and the IP-echo prober are all mocked/stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Network entry point mocked; the FLOW_BALANCE_ENDPOINTS table stays real.
vi.mock("../../src/tools/plan_balance_all.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tools/plan_balance_all.js")>();
  return { ...actual, novadaPlanBalanceAll: vi.fn() };
});

// The IP-echo prober never opens a socket in this file.
vi.mock("../../src/tools/proxy_verify.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tools/proxy_verify.js")>();
  return {
    ...actual,
    verifyProxyExit: vi.fn(async () => ({
      verified: true as const,
      exit_ip: "203.0.113.7",
      org: "ExampleNet",
      asn: "AS64500",
      country_code: "US",
      latency_ms: 42,
    })),
  };
});

import { novadaPlanBalanceAll } from "../../src/tools/plan_balance_all.js";
import { NovadaError } from "../../src/_core/errors.js";
import { withCredentials } from "../../src/utils/credentials.js";
const mockedPlanBalance = vi.mocked(novadaPlanBalanceAll);

const { novadaProxy } = await import("../../src/tools/proxy.js");
const { novadaProxyResidential } = await import("../../src/tools/proxy_residential.js");

const SERVER_KEY = "sk-test-server-env-key";

/** Fixture sub-account returned by the (stubbed) mgmt-API auto-fetch. */
function stubMgmtFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 0,
        data: { list: [{ account: "fixture-sub-user", password: "fixture-sub-pass" }] },
      }),
    })),
  );
}

function ledgerPayload(product: string, opts: { exhausted: boolean }): string {
  return JSON.stringify({
    status: "ok",
    per_product: {
      [product]: opts.exhausted
        ? {
            status: "ok",
            balance: { balance: 0, expire_time: 4102444800 },
            expired: false,
            expires_at_human: "2099-12-31",
            exhausted: true,
            balance_human: "0.0 MB",
          }
        : {
            status: "ok",
            balance: { balance: 3.5 * 1024 * 1024 * 1024, expire_time: 4102444800 },
            expired: false,
            expires_at_human: "2099-12-31",
            exhausted: false,
            balance_human: "3.5 GB",
          },
    },
  });
}

/** Ledger mock that answers per-KEY: the caller's account vs everything else. */
function ledgerByKey(callerKey: string, opts: { callerExhausted: boolean }): void {
  mockedPlanBalance.mockImplementation(async (params: unknown, apiKey?: string) => {
    const product =
      ((params as { products?: string[] })?.products ?? ["residential"])[0] ?? "residential";
    if (apiKey === callerKey) {
      return ledgerPayload(product, { exhausted: opts.callerExhausted });
    }
    // No key / server env key → the SERVER account's ledger (the wrong one).
    return ledgerPayload(product, { exhausted: !opts.callerExhausted });
  });
}

const originalEnv = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  // Hosted shape: server env key present, NO direct proxy creds → auto-fetch.
  delete process.env.NOVADA_PROXY_USER;
  delete process.env.NOVADA_PROXY_PASS;
  delete process.env.NOVADA_PROXY_ENDPOINT;
  process.env.NOVADA_API_KEY = SERVER_KEY;
  stubMgmtFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

describe("HIGH-1 direction A — caller-poor / server-rich: never issue silently on the server's healthy ledger", () => {
  it("hosted pass-through (store-scoped caller key): ledger is read with the CALLER key and the exhausted caller plan REFUSES", async () => {
    const CALLER_KEY = `sk-test-caller-poor-${Math.random().toString(36).slice(2)}`;
    ledgerByKey(CALLER_KEY, { callerExhausted: true });

    let caught: unknown;
    try {
      await withCredentials({ apiKey: CALLER_KEY }, () =>
        novadaProxy({ type: "residential", format: "url" }),
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NovadaError);
    const err = caught as NovadaError;
    // Refusal evidence is the CALLER account's ledger, not the server's.
    expect(err.message).toContain("0.0 MB");
    expect(err.agent_instruction).toContain("/v1/residential_flow/balance");

    // The billing-account invariant itself: the lookup carried the caller key.
    expect(mockedPlanBalance).toHaveBeenCalledWith({ products: ["residential"] }, CALLER_KEY);
  });
});

describe("HIGH-1 direction B — caller-rich / server-poor: never refuse a paying caller on the server's ledger", () => {
  it("hosted pass-through: caller's healthy ledger issues credentials even though the server env key's ledger is exhausted", async () => {
    const CALLER_KEY = `sk-test-caller-rich-${Math.random().toString(36).slice(2)}`;
    ledgerByKey(CALLER_KEY, { callerExhausted: false });

    const result = await withCredentials({ apiKey: CALLER_KEY }, () =>
      novadaProxy({ type: "residential", format: "url" }),
    );
    expect(result).toContain("proxy_url:");
    // The evidence line shows the CALLER account's (healthy) ledger.
    expect(result).toContain("3.5 GB");
    expect(mockedPlanBalance).toHaveBeenCalledWith({ products: ["residential"] }, CALLER_KEY);
  });

  it("SDK sibling (novadaProxyResidential): same billing-account rule — caller-rich is NOT refused", async () => {
    const CALLER_KEY = `sk-test-caller-rich-sdk-${Math.random().toString(36).slice(2)}`;
    ledgerByKey(CALLER_KEY, { callerExhausted: false });

    const result = await withCredentials({ apiKey: CALLER_KEY }, () =>
      novadaProxyResidential({ format: "url" }),
    );
    expect(result).toContain("proxy_url:");
    expect(mockedPlanBalance).toHaveBeenCalledWith({ products: ["residential"] }, CALLER_KEY);
  });
});

describe("HIGH-1 — direct env creds: billing account unknowable → consult NOTHING, disclose, fail open", () => {
  it("env user/pass/endpoint set: no ledger lookup at all, response discloses 'ledger unknown for the billing account'", async () => {
    process.env.NOVADA_PROXY_USER = "env-user";
    process.env.NOVADA_PROXY_PASS = "env-pass";
    process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";
    // Even a healthy-looking env-key ledger must NOT be consulted or printed —
    // it may belong to a different account than the env proxy credentials.
    mockedPlanBalance.mockResolvedValue(ledgerPayload("residential", { exhausted: false }));

    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("proxy_url:");
    expect(result).toContain("ledger unknown for the billing account");
    // Never judge (or display) another account's ledger.
    expect(result).not.toContain("3.5 GB");
    expect(mockedPlanBalance).not.toHaveBeenCalled();
  });

  it("env creds + EXHAUSTED env-key ledger: still issues (fail open) — a wrong-account ledger must never refuse", async () => {
    process.env.NOVADA_PROXY_USER = "env-user";
    process.env.NOVADA_PROXY_PASS = "env-pass";
    process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";
    mockedPlanBalance.mockResolvedValue(ledgerPayload("residential", { exhausted: true }));

    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("proxy_url:");
    expect(result).toContain("ledger unknown for the billing account");
    expect(mockedPlanBalance).not.toHaveBeenCalled();
  });
});
