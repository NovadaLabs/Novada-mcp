/**
 * MEDIUM-6 (re-review, reports/review-fix-eval-f-rows-2026-09-10.md) — the
 * boot-time auto-provision (INC-198) is the SECOND member of the
 * "auto-fetched" credential class, and it must carry PROVENANCE.
 *
 * Scenario (endpoint-only stdio config, the INC-198 use case):
 * NOVADA_PROXY_ENDPOINT + NOVADA_API_KEY set, no user/pass. At boot, run()
 * fetches sub-account creds WITH the env key and injects them into
 * process.env.NOVADA_PROXY_USER/PASS. Under ad5d654 every later proxy call
 * classified those creds `source:"direct"` → the F11 fail-closed ledger gate
 * was silently SKIPPED (a2ae130 refused this class correctly on an exhausted
 * ledger) and the response disclosed "the account they bill cannot be read
 * from here" — FALSE for this class: the boot key fetched them one function
 * earlier, so the billing account IS knowable.
 *
 * Pinned here:
 *   1. boot class + EXHAUSTED ledger → REFUSES again, ledger read WITH the
 *      boot key (billing key = boot key).                    [RED vs ad5d654]
 *   2. boot class + ACTIVE ledger → issues with the REAL ledger disclosure,
 *      never the false "cannot be read from here" line.      [RED vs ad5d654]
 *   3. genuinely user-supplied env creds (pair differs from the boot-injected
 *      one) → still fail OPEN with the "ledger unknown" disclosure, nothing
 *      consulted — provenance discriminates by VALUE, not "env vars are set".
 *   4. key rotated after boot (fingerprint mismatch) → falls back to the
 *      fail-open + disclose arm: the billing account genuinely cannot be read
 *      with the current key any more.
 *   5. boot provision is a no-op when no endpoint is set or creds are already
 *      present (guard parity with the pre-refactor run() block).
 *
 * The boot step exercised is the REAL production function
 * (autoProvisionProxyCredentialsAtBoot — the exact code index.ts run() calls),
 * not a test-local reimplementation of the injection.
 *
 * INVARIANT: no real credentials, no network — the mgmt-API auto-fetch
 * (global fetch), the ledger lookup and the IP-echo prober are all
 * mocked/stubbed.
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
import {
  autoProvisionProxyCredentialsAtBoot,
  clearBootProvisionedProxyCredentials,
} from "../../src/utils/credentials.js";
const mockedPlanBalance = vi.mocked(novadaPlanBalanceAll);

const { novadaProxy } = await import("../../src/tools/proxy.js");

/** Fixture sub-account returned by the (stubbed) mgmt-API auto-fetch. */
function stubMgmtFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 0,
        data: { list: [{ account: "boot-sub-user", password: "boot-sub-pass" }] },
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

/** Ledger mock answering per-KEY: the boot key's account vs everything else. */
function ledgerByKey(bootKey: string, opts: { bootExhausted: boolean }): void {
  mockedPlanBalance.mockImplementation(async (params: unknown, apiKey?: string) => {
    const product =
      ((params as { products?: string[] })?.products ?? ["residential"])[0] ?? "residential";
    if (apiKey === bootKey) {
      return ledgerPayload(product, { exhausted: opts.bootExhausted });
    }
    // No key / any other key → the WRONG account's ledger (inverse state, so
    // a lookup that dropped the boot key cannot accidentally stay green).
    return ledgerPayload(product, { exhausted: !opts.bootExhausted });
  });
}

function freshBootKey(): string {
  return `sk-test-boot-${Math.random().toString(36).slice(2)}`;
}

const originalEnv = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  clearBootProvisionedProxyCredentials();
  // Endpoint-only stdio shape (INC-198): endpoint set, NO user/pass — run()
  // auto-provisions them at boot. The per-test boot key is set in each test.
  delete process.env.NOVADA_PROXY_USER;
  delete process.env.NOVADA_PROXY_PASS;
  process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";
  stubMgmtFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearBootProvisionedProxyCredentials();
  process.env = { ...originalEnv };
});

describe("MEDIUM-6 — boot-provisioned creds carry provenance: the F11 ledger gate applies", () => {
  it("endpoint-only stdio boot class + EXHAUSTED ledger: REFUSES again (was: silent pass-through classified 'direct')", async () => {
    const BOOT_KEY = freshBootKey();
    process.env.NOVADA_API_KEY = BOOT_KEY;
    ledgerByKey(BOOT_KEY, { bootExhausted: true });

    // REAL production boot step — the same function index.ts run() calls.
    const provisioned = await autoProvisionProxyCredentialsAtBoot();
    expect(provisioned?.user).toBe("boot-sub-user");
    expect(process.env.NOVADA_PROXY_USER).toBe("boot-sub-user");
    expect(process.env.NOVADA_PROXY_PASS).toBe("boot-sub-pass");

    let caught: unknown;
    try {
      await novadaProxy({ type: "residential", format: "url" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NovadaError);
    const err = caught as NovadaError;
    // Full refusal evidence, from the BOOT key's ledger.
    expect(err.message).toContain("0.0 MB");
    expect(err.agent_instruction).toContain("/v1/residential_flow/balance");
    // The provenance invariant itself: billing key = boot key.
    expect(mockedPlanBalance).toHaveBeenCalledWith({ products: ["residential"] }, BOOT_KEY);
  });

  it("boot class + ACTIVE ledger: issues with the REAL ledger disclosure — never the false 'cannot be read from here' line", async () => {
    const BOOT_KEY = freshBootKey();
    process.env.NOVADA_API_KEY = BOOT_KEY;
    ledgerByKey(BOOT_KEY, { bootExhausted: false });

    await autoProvisionProxyCredentialsAtBoot();
    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("proxy_url:");
    // The billing account IS knowable here (the boot key fetched the creds) —
    // the evidence is its real ledger, not the direct-creds disclaimer.
    expect(result).toContain("3.5 GB");
    expect(result).not.toContain("cannot be read from here");
    expect(result).not.toContain("ledger unknown for the billing account");
    expect(mockedPlanBalance).toHaveBeenCalledWith({ products: ["residential"] }, BOOT_KEY);
  });

  it("genuinely user-supplied env creds (pair differs from boot-injected): still fail OPEN with the disclosure, nothing consulted", async () => {
    const BOOT_KEY = freshBootKey();
    process.env.NOVADA_API_KEY = BOOT_KEY;
    ledgerByKey(BOOT_KEY, { bootExhausted: true });

    await autoProvisionProxyCredentialsAtBoot();
    // The user overrides env with their OWN credentials — a different pair
    // than the boot-injected one. Provenance discriminates by VALUE, not by
    // "env vars are set".
    process.env.NOVADA_PROXY_USER = "my-own-user";
    process.env.NOVADA_PROXY_PASS = "my-own-pass";

    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("proxy_url:");
    expect(result).toContain("ledger unknown for the billing account");
    expect(mockedPlanBalance).not.toHaveBeenCalled();
  });

  it("key rotated after boot (fingerprint mismatch): falls back to fail-open + disclose — never claims a stale billing key", async () => {
    const BOOT_KEY = freshBootKey();
    process.env.NOVADA_API_KEY = BOOT_KEY;
    ledgerByKey(BOOT_KEY, { bootExhausted: true });

    await autoProvisionProxyCredentialsAtBoot();
    // The env key changes after boot — the injected pair still bills the OLD
    // key's account, which can no longer be read from here.
    process.env.NOVADA_API_KEY = freshBootKey();

    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("proxy_url:");
    expect(result).toContain("ledger unknown for the billing account");
    expect(mockedPlanBalance).not.toHaveBeenCalled();
  });

  it("guard parity: no endpoint, or creds already present → boot provision is a no-op", async () => {
    delete process.env.NOVADA_PROXY_ENDPOINT;
    process.env.NOVADA_API_KEY = freshBootKey();
    expect(await autoProvisionProxyCredentialsAtBoot()).toBeNull();
    expect(process.env.NOVADA_PROXY_USER).toBeUndefined();

    process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";
    process.env.NOVADA_PROXY_USER = "already-user";
    process.env.NOVADA_PROXY_PASS = "already-pass";
    expect(await autoProvisionProxyCredentialsAtBoot()).toBeNull();
    expect(process.env.NOVADA_PROXY_USER).toBe("already-user");
  });
});
