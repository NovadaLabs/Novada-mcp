/**
 * F11 — ledger preflight before issuing proxy credentials.
 *
 * CONFIRMED 2026-09-10: an owner key with residential_flow balance 0 (plan
 * expired 2026-07-08) received clean-looking credentials; the gateway accepted
 * auth then refused CONNECT with HTTP 402 — visible to the user only as curl
 * exit 56. This file pins the fix:
 *
 *  (1) CLASS-shaped preflight: one product × (balance, expire_time) lookup
 *      driven by FLOW_BALANCE_ENDPOINTS (plan_balance_all.ts) — a new proxy
 *      product is a new ROW in that table, never a new branch. A table-driven
 *      test iterates every proxy row to prove no product is skipped.
 *  (2) Fail-CLOSED on a positive bad ledger signal (balance 0 / expired /
 *      not provisioned): the refusal is a structured NovadaError carrying the
 *      FULL evidence — which ledger (endpoint path), balance, expiry, and the
 *      top-up path — never a generic error.
 *  (3) Fail-open on an INDETERMINATE preflight (no dev-api key, network error,
 *      timeout) — pinned by the pre-existing proxy_expired_plan.test.ts — but
 *      now with a disclosure line: env-supplied credentials whose ledger could
 *      not be read are labeled "unverified … ledger unknown".
 *  (4) The same gate covers the SDK sibling functions (novadaProxyResidential
 *      / novadaProxyIsp / …) — class, not instance: every entry point that
 *      issues flow-plan credentials preflights the same table.
 *
 * INVARIANT: no real credentials anywhere — plan_balance_all's network entry
 * point and the IP-echo prober are fully mocked; env values are fixtures.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Partial mock: the network entry point (novadaPlanBalanceAll) is mocked, but
// the endpoint TABLE and the balance-evidence derivation stay real — the whole
// point is that the preflight is driven by the real table.
vi.mock("../../src/tools/plan_balance_all.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tools/plan_balance_all.js")>();
  return { ...actual, novadaPlanBalanceAll: vi.fn() };
});

// The IP-echo prober never runs in this file — preflight is under test, not verify.
vi.mock("../../src/tools/proxy_verify.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tools/proxy_verify.js")>();
  return {
    ...actual,
    verifyProxyExit: vi.fn(async () => ({
      verified: true as const,
      exit_ip: "203.0.113.7",
      org: "ExampleNet",
      asn: "AS64500 ExampleNet",
      country: "United States",
      country_code: "US",
      latency_ms: 42,
    })),
  };
});

import { novadaPlanBalanceAll, FLOW_BALANCE_ENDPOINTS } from "../../src/tools/plan_balance_all.js";
import { NovadaError } from "../../src/_core/errors.js";
const mockedPlanBalance = vi.mocked(novadaPlanBalanceAll);

const { novadaProxy } = await import("../../src/tools/proxy.js");
const { novadaProxyResidential } = await import("../../src/tools/proxy_residential.js");
const { novadaProxyIsp } = await import("../../src/tools/proxy_isp.js");
const { preflightFlowLedger } = await import("../../src/tools/proxy_preflight.js");

const originalEnv = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOVADA_PROXY_USER = "testuser";
  process.env.NOVADA_PROXY_PASS = "testpass";
  process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";
});
afterEach(() => {
  process.env = { ...originalEnv };
});

/** Build a novadaPlanBalanceAll response for one product with a given ledger row. */
function ledgerPayload(product: string, entry: Record<string, unknown>): string {
  return JSON.stringify({ status: "ok", per_product: { [product]: entry } });
}

async function catchError(p: Promise<unknown>): Promise<NovadaError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(NovadaError);
    return e as NovadaError;
  }
  throw new Error("expected promise to reject");
}

// ─── (2) Fail-CLOSED with full evidence ──────────────────────────────────────

describe("F11 preflight — refuses 0-balance / expired ledgers with FULL evidence", () => {
  it("residential balance 0 (NOT expired — the confirmed F11 signature): refuses, names ledger + balance + expiry + top-up path", async () => {
    mockedPlanBalance.mockResolvedValue(ledgerPayload("residential", {
      status: "ok",
      balance: { balance: 0, expire_time: 4102444800 }, // 0 bytes, future expiry
      expired: false,
      expires_at_human: "2099-12-31",
      exhausted: true,
      balance_human: "0.0 MB",
    }));

    const err = await catchError(novadaProxy({ type: "residential", format: "url" }));
    // WHICH ledger
    expect(err.message).toContain("Residential");
    expect(err.agent_instruction).toContain("/v1/residential_flow/balance");
    // balance
    expect(err.message).toContain("0.0 MB");
    // expiry
    expect(err.message).toContain("2099-12-31");
    // top-up path
    expect(err.agent_instruction).toContain("https://dashboard.novada.com/overview/products/");
    expect(err.agent_instruction).toContain('novada_account(section="plans")');
    expect(err.retryable).toBe(false);
    // scoped lookup: exactly the one matching product
    expect(mockedPlanBalance).toHaveBeenCalledWith({ products: ["residential"] });
  });

  it("datacenter EXPIRED plan: refusal evidence carries the expiry date", async () => {
    mockedPlanBalance.mockResolvedValue(ledgerPayload("datacenter", {
      status: "ok",
      balance: { balance: 0, expire_time: 1751932800 },
      expired: true,
      expires_at_human: "2026-07-08",
      exhausted: true,
      balance_human: "0.0 MB",
    }));

    const err = await catchError(novadaProxy({ type: "datacenter", format: "url" }));
    expect(err.message).toContain("Datacenter");
    expect(err.message).toMatch(/EXPIRED/);
    expect(err.message).toContain("2026-07-08");
    expect(err.agent_instruction).toContain("/v1/dc_flow/balance");
    expect(err.agent_instruction).toContain("https://dashboard.novada.com/overview/products/");
  });

  it("mobile request-count shape (used >= total) with NO pre-enriched fields: derives exhaustion from the raw balance", async () => {
    // Raw entry only — no exhausted/balance_human enrichment. Preflight must
    // classify from the balance shape itself (fallback derivation).
    mockedPlanBalance.mockResolvedValue(ledgerPayload("mobile", {
      status: "ok",
      balance: { balance: 0, total: 100, used: 100 },
    }));

    const err = await catchError(novadaProxy({ type: "mobile", format: "url" }));
    expect(err.message).toContain("Mobile");
    expect(err.message).toContain("100/100 req");
    expect(err.agent_instruction).toContain("/v1/mobile_flow/mobile_flow_balance");
  });

  it("isp not provisioned: refuses naming 'not provisioned' + the ledger consulted", async () => {
    mockedPlanBalance.mockResolvedValue(ledgerPayload("isp", {
      status: "error",
      unavailable: true,
      error: "HTTP 404",
    }));

    const err = await catchError(novadaProxy({ type: "isp", format: "url" }));
    expect(err.message).toMatch(/not provisioned/i);
    expect(err.agent_instruction).toContain("/v1/isp_flow/balance");
  });
});

// ─── (1) CLASS shape: table-driven — every proxy row is gated ────────────────

describe("F11 preflight — table-driven class coverage (a new product is a new ROW)", () => {
  const proxyRows = FLOW_BALANCE_ENDPOINTS.filter((r) => r.proxy);

  it("the table contains the 4 flow proxy products (and capture is excluded from the gate)", () => {
    expect(proxyRows.map((r) => r.key).sort()).toEqual(["datacenter", "isp", "mobile", "residential"]);
    expect(FLOW_BALANCE_ENDPOINTS.find((r) => r.key === "capture")?.proxy).toBe(false);
  });

  for (const row of FLOW_BALANCE_ENDPOINTS.filter((r) => r.proxy)) {
    it(`type="${row.key}": exhausted ledger refuses with label "${row.label}" and ledger path "${row.path}"`, async () => {
      mockedPlanBalance.mockResolvedValue(ledgerPayload(row.key, {
        status: "ok",
        balance: { balance: 0, expire_time: 4102444800 },
        expired: false,
        expires_at_human: "2099-12-31",
        exhausted: true,
        balance_human: "0.0 MB",
      }));

      const err = await catchError(novadaProxy({ type: row.key as never, format: "url" }));
      expect(err.message).toContain(row.label);
      expect(err.agent_instruction).toContain(row.path);
      expect(mockedPlanBalance).toHaveBeenCalledWith({ products: [row.key] });
    });
  }

  it("preflightFlowLedger returns null for non-flow products (static/dedicated) — no ledger, no lookup", async () => {
    expect(await preflightFlowLedger("static")).toBeNull();
    expect(await preflightFlowLedger("dedicated")).toBeNull();
    expect(mockedPlanBalance).not.toHaveBeenCalled();
  });
});

// ─── active + indeterminate disclosures ──────────────────────────────────────

describe("F11 preflight — active ledger evidence and indeterminate disclosure in the response", () => {
  it("ACTIVE plan: credentials are issued and the response carries the ledger evidence (balance + expiry)", async () => {
    mockedPlanBalance.mockResolvedValue(ledgerPayload("residential", {
      status: "ok",
      balance: { balance: 3.5 * 1024 * 1024 * 1024, expire_time: 4102444800 },
      expired: false,
      expires_at_human: "2099-12-31",
      exhausted: false,
      balance_human: "3.5 GB",
    }));

    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("proxy_url:");
    expect(result).toContain("## Ledger");
    expect(result).toContain("active");
    expect(result).toContain("3.5 GB");
    expect(result).toContain("2099-12-31");
  });

  it("indeterminate preflight + env-supplied creds: issues creds but discloses 'credentials supplied via env, ledger unknown'", async () => {
    mockedPlanBalance.mockRejectedValue(new Error("Developer-api returned HTTP 503"));

    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("proxy_url:");
    expect(result).toContain("unverified");
    expect(result).toContain("credentials supplied via env, ledger unknown");
  });
});

// ─── (4) SDK sibling functions are gated by the same table ───────────────────

describe("F11 preflight — SDK sibling entry points share the same gate (class, not instance)", () => {
  it("novadaProxyResidential refuses an exhausted residential ledger with the same evidence", async () => {
    mockedPlanBalance.mockResolvedValue(ledgerPayload("residential", {
      status: "ok",
      balance: { balance: 0, expire_time: 4102444800 },
      expired: false,
      expires_at_human: "2099-12-31",
      exhausted: true,
      balance_human: "0.0 MB",
    }));

    const err = await catchError(novadaProxyResidential({ format: "url" }));
    expect(err.message).toContain("Residential");
    expect(err.message).toContain("0.0 MB");
    expect(err.agent_instruction).toContain("https://dashboard.novada.com/overview/products/");
  });

  it("novadaProxyIsp refuses an EXPIRED isp ledger", async () => {
    mockedPlanBalance.mockResolvedValue(ledgerPayload("isp", {
      status: "ok",
      balance: { balance: 0, expire_time: 1751932800 },
      expired: true,
      expires_at_human: "2026-07-08",
      exhausted: true,
      balance_human: "0.0 MB",
    }));

    await expect(novadaProxyIsp({ format: "url" })).rejects.toThrow(/EXPIRED/);
  });

  it("novadaProxyResidential still fails OPEN on an indeterminate preflight (network error)", async () => {
    mockedPlanBalance.mockRejectedValue(new Error("network down"));
    const result = await novadaProxyResidential({ format: "url" });
    expect(result).toContain("proxy_url:");
  });
});
