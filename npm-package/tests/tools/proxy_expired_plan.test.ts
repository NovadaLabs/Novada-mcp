/**
 * novada_proxy — C-11 fix: refuse to hand out credentials for an EXPIRED or
 * not-provisioned flow plan instead of silently returning working-looking
 * config for a dead connection.
 *
 * Finding (C-reliability-live.md, C-11): "novada_proxy hands out ready-to-use
 * config for EXPIRED plans with zero warning. type=residential returned
 * rotating-proxy config while the same server's account tool shows Residential
 * EXPIRED 2026-07-08 / 0.0 MB. Agent wires a dead proxy, fails at connect time
 * with no clue." This file proves: (1) an expired/unprovisioned plan makes the
 * tool THROW a structured NovadaError naming the plan + a renew URL + an
 * agent_instruction (which the real dispatch layer in src/index.ts turns into
 * isError:true — simulated here via classifyError().toAgentString(), the exact
 * mechanism index.ts uses, without needing to import/boot index.ts itself);
 * (2) an active plan is unaffected; (3) an entitlement-CHECK failure (network
 * down, no dev-api key, timeout) fails OPEN — never blocks a working proxy
 * formatter over a diagnostics failure; (4) static/dedicated are exempt
 * entirely (different, user-managed credential model — no plan_balance_all
 * call is made for them at all).
 *
 * No live network call is made — plan_balance_all.js is fully mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// PARTIAL mock (F11): only the network entry point is mocked — the
// FLOW_BALANCE_ENDPOINTS table and deriveBalanceEvidence stay real because the
// preflight (proxy_preflight.ts) is driven by them.
vi.mock("../../src/tools/plan_balance_all.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tools/plan_balance_all.js")>();
  return { ...actual, novadaPlanBalanceAll: vi.fn() };
});

// F11 visibility follow-up: novadaProxy now runs a one-shot IP-echo probe on
// every issued config. Mock it so this file never opens a socket.
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

import { novadaPlanBalanceAll } from "../../src/tools/plan_balance_all.js";
import { classifyError, NovadaError } from "../../src/_core/errors.js";
const mockedPlanBalance = vi.mocked(novadaPlanBalanceAll);

const { novadaProxy } = await import("../../src/tools/proxy.js");

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

function planPayload(status: "ok" | "error", opts: { expired?: boolean; unavailable?: boolean } = {}): string {
  return JSON.stringify({
    status: "ok",
    per_product: {
      residential: status === "ok"
        ? { status: "ok", balance: { balance: opts.expired ? 0 : 500 }, expired: !!opts.expired }
        : { status: "error", unavailable: !!opts.unavailable, error: "not provisioned" },
    },
  });
}

describe("novadaProxy — C-11 expired-plan gate: throws a structured error, never silently succeeds", () => {
  it("EXPIRED residential plan: throws NovadaError naming the plan + renew URL + agent_instruction", async () => {
    mockedPlanBalance.mockResolvedValue(planPayload("ok", { expired: true }));

    await expect(novadaProxy({ type: "residential", format: "url" })).rejects.toBeInstanceOf(NovadaError);

    let caught: unknown;
    try {
      await novadaProxy({ type: "residential", format: "url" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NovadaError);
    const err = caught as NovadaError;
    expect(err.message).toMatch(/Residential/);
    expect(err.message).toMatch(/EXPIRED/);
    expect(err.agent_instruction).toContain("https://dashboard.novada.com/overview/products/");
    expect(err.agent_instruction).toContain('novada_account(section="plans")');
    expect(err.retryable).toBe(false);

    // Simulate the REAL dispatch path (src/index.ts: classifyError(e).toAgentString())
    // to prove the assembled agent-facing text — the thing that actually ships —
    // carries the plan name, renew URL, and agent_instruction. classifyError()
    // passes a NovadaError through untouched (see errors.ts), so this is the
    // exact string index.ts would put in the isError:true response.
    const agentString = classifyError(err).toAgentString();
    expect(agentString).toContain("Residential");
    expect(agentString).toContain("EXPIRED");
    expect(agentString).toContain("https://dashboard.novada.com/overview/products/");
    expect(agentString).toMatch(/agent_instruction:/);
    expect(agentString).toContain("failure_class:");
  });

  it("NOT PROVISIONED isp plan: throws NovadaError naming 'not provisioned'", async () => {
    mockedPlanBalance.mockResolvedValue(
      JSON.stringify({
        status: "partial",
        per_product: { isp: { status: "error", unavailable: true, error: "HTTP 404" } },
      }),
    );

    await expect(novadaProxy({ type: "isp", format: "url" })).rejects.toThrow(/not provisioned/i);
  });

  it("ACTIVE plan: does NOT block — returns real credentials", async () => {
    mockedPlanBalance.mockResolvedValue(planPayload("ok", { expired: false }));

    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("proxy_url:");
  });
});

describe("novadaProxy — entitlement CHECK failure fails OPEN (never blocks a working formatter)", () => {
  it("plan_balance_all rejecting (network/auth error) does not throw — proxy still returns credentials", async () => {
    mockedPlanBalance.mockRejectedValue(new Error("Developer-api returned HTTP 503"));

    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("proxy_url:");
  });

  it("malformed JSON from plan_balance_all does not throw — proxy still returns credentials", async () => {
    mockedPlanBalance.mockResolvedValue("not json");

    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("proxy_url:");
  });

  it("a slow entitlement check (beyond the internal timeout) does not hang the tool — proxy still returns credentials", async () => {
    mockedPlanBalance.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(planPayload("ok", { expired: true })), 60_000)),
    );

    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("proxy_url:");
  }, 10_000);
});

describe("novadaProxy — static/dedicated are exempt from the entitlement check entirely", () => {
  it("type=static never calls plan_balance_all", async () => {
    process.env.NOVADA_STATIC_PROXY_LIST = "1.2.3.4:8886:userXXXX:passYYYY";
    await novadaProxy({ type: "static", country: "us", session_id: "s1", format: "url" });
    expect(mockedPlanBalance).not.toHaveBeenCalled();
  });

  it("type=dedicated never calls plan_balance_all", async () => {
    process.env.NOVADA_DEDICATED_PROXY_LIST = "1.2.3.4:9999:userXXXX:passYYYY";
    await novadaProxy({ type: "dedicated", session_id: "s1", format: "url" });
    expect(mockedPlanBalance).not.toHaveBeenCalled();
  });
});

describe("novadaProxy — entitlement check is scoped to only the requested product", () => {
  it("requests only the one product matching `type`, not all 6", async () => {
    mockedPlanBalance.mockResolvedValue(planPayload("ok", { expired: false }));
    await novadaProxy({ type: "residential", format: "url" });
    expect(mockedPlanBalance).toHaveBeenCalledWith({ products: ["residential"] });
  });
});
