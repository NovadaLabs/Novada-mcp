/**
 * VISIBILITY — verification evidence wired into the novada_proxy RESPONSE.
 *
 * "How can I SEE if the proxy works?" — after issuing a config, novadaProxy
 * performs ONE IP-echo request through the issued proxy and puts the evidence
 * (exit_ip, org/ASN, country, latency) in the response. Cells pinned here:
 *
 *   verify outcome      response
 *   ─────────────────   ───────────────────────────────────────────────
 *   success             ## Verification block with exit_ip/org/country/latency
 *   402 payment         config STILL returned + verification_failed: payment_required
 *   407 auth            config STILL returned + verification_failed: auth_failed
 *   timeout             config STILL returned + verification_failed: timeout
 *   verify=false        skipped note, prober never called (opt-out)
 *   hosted runtime      skipped note, prober never called (local-stdio-only)
 *   not configured      nothing issued → prober never called
 *
 * Also pinned: the echo runs EXACTLY once (never inside any retry loop), it
 * probes the REAL issued username (zone/region/session suffix included), the
 * static/dedicated path probes the configured list entry, and the auto-fetched
 * credential path labels an indeterminate ledger as a lookup failure (vs the
 * env-creds "ledger unknown" wording).
 *
 * INVARIANT: no real credentials — mgmt API (global fetch), ledger lookup and
 * echo prober are all mocked; env values are fixtures.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/tools/plan_balance_all.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tools/plan_balance_all.js")>();
  return { ...actual, novadaPlanBalanceAll: vi.fn() };
});

// Partial mock: verifyProxyExit is controlled per-test; the runtime detection
// and list parsing stay real.
vi.mock("../../src/tools/proxy_verify.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tools/proxy_verify.js")>();
  return { ...actual, verifyProxyExit: vi.fn() };
});

import { novadaPlanBalanceAll } from "../../src/tools/plan_balance_all.js";
import { verifyProxyExit } from "../../src/tools/proxy_verify.js";
const mockedPlanBalance = vi.mocked(novadaPlanBalanceAll);
const mockedVerify = vi.mocked(verifyProxyExit);

const { novadaProxy } = await import("../../src/tools/proxy.js");

const SUCCESS_ECHO = {
  verified: true as const,
  exit_ip: "68.14.23.7",
  org: "Cox Communications",
  asn: "AS22773 Cox Communications Inc.",
  country: "United States",
  country_code: "US",
  latency_ms: 934,
};

function activeLedger(product = "residential"): string {
  return JSON.stringify({
    status: "ok",
    per_product: {
      [product]: {
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

const originalEnv = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  process.env.NOVADA_PROXY_USER = "testuser";
  process.env.NOVADA_PROXY_PASS = "testpass";
  process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  mockedPlanBalance.mockResolvedValue(activeLedger());
  mockedVerify.mockResolvedValue(SUCCESS_ECHO);
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

// ─── success evidence ─────────────────────────────────────────────────────────

describe("novadaProxy — verification evidence in the success response", () => {
  it("echo success: response carries exit_ip, org/ASN, country and latency", async () => {
    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("## Verification");
    expect(result).toContain("exit_ip: 68.14.23.7");
    expect(result).toContain("Cox Communications");
    expect(result).toContain("AS22773");
    expect(result).toContain("United States");
    expect(result).toContain("latency_ms: 934");
  });

  it("the echo runs EXACTLY once — never inside a retry loop", async () => {
    await novadaProxy({ type: "residential", format: "url" });
    expect(mockedVerify).toHaveBeenCalledTimes(1);
  });

  it("even when the echo FAILS, it is still called exactly once (no retry on failure)", async () => {
    mockedVerify.mockResolvedValue({
      verified: false,
      failure_class: "timeout",
      detail: "no echo response within 5000ms",
      latency_ms: 5000,
    });
    await novadaProxy({ type: "residential", format: "url" });
    expect(mockedVerify).toHaveBeenCalledTimes(1);
  });

  it("probes the REAL issued username — zone/region/session suffix included — against the configured endpoint", async () => {
    await novadaProxy({ type: "residential", country: "de", session_id: "sess42", format: "url" });
    expect(mockedVerify).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "proxy.example.com",
        port: 7777,
        username: "testuser-zone-res-region-de-session-sess42",
        password: "testpass",
      }),
      expect.anything(),
    );
  });

  it("warns when the exit country does not match the requested country", async () => {
    const result = await novadaProxy({ type: "residential", country: "de", format: "url" });
    // echo mock exits in US, request asked for de
    expect(result).toMatch(/does not match requested country/i);
  });

  it("no mismatch warning when exit country matches the request", async () => {
    const result = await novadaProxy({ type: "residential", country: "us", format: "url" });
    expect(result).not.toMatch(/does not match requested country/i);
  });

  it("evidence block appears for env and curl formats too", async () => {
    for (const format of ["env", "curl"] as const) {
      const result = await novadaProxy({ type: "residential", format });
      expect(result).toContain("## Verification");
      expect(result).toContain("exit_ip: 68.14.23.7");
    }
  });
});

// ─── graceful degradation ─────────────────────────────────────────────────────

describe("novadaProxy — echo failure degrades gracefully (config still returned)", () => {
  it("402 payment_required: config returned + classified note + top-up hint", async () => {
    mockedVerify.mockResolvedValue({
      verified: false,
      failure_class: "payment_required",
      detail: "gateway accepted the credentials but refused to route traffic (HTTP 402 Payment Required)",
      http_status: 402,
      latency_ms: 210,
    });
    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("proxy_url:");
    expect(result).toContain("verification_failed");
    expect(result).toContain("payment_required");
    expect(result).toContain("402");
    expect(result).toContain("https://dashboard.novada.com/overview/products/");
  });

  it("407 auth_failed: config returned + classified note", async () => {
    mockedVerify.mockResolvedValue({
      verified: false,
      failure_class: "auth_failed",
      detail: "proxy rejected the credentials (HTTP 407)",
      http_status: 407,
      latency_ms: 180,
    });
    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("proxy_url:");
    expect(result).toContain("verification_failed");
    expect(result).toContain("auth_failed");
  });

  it("timeout: config returned + classified note", async () => {
    mockedVerify.mockResolvedValue({
      verified: false,
      failure_class: "timeout",
      detail: "no echo response within 5000ms",
      latency_ms: 5000,
    });
    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("proxy_url:");
    expect(result).toContain("verification_failed");
    expect(result).toContain("timeout");
  });

  it("prober THROWING unexpectedly still returns the config (verification must never break issuing)", async () => {
    mockedVerify.mockRejectedValue(new Error("unexpected prober crash"));
    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("proxy_url:");
    expect(result).toContain("verification_failed");
  });
});

// ─── opt-out / runtime / not-configured cells ────────────────────────────────

describe("novadaProxy — verify opt-out, hosted runtime, and nothing-to-verify cells", () => {
  it("verify=false: prober never called, response says skipped", async () => {
    const result = await novadaProxy({ type: "residential", format: "url", verify: false });
    expect(mockedVerify).not.toHaveBeenCalled();
    expect(result).toContain("verification: skipped");
    expect(result).toContain("verify=false");
  });

  it("hosted runtime (VERCEL): prober never called, local-stdio-only disclosed", async () => {
    process.env.VERCEL = "1";
    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(mockedVerify).not.toHaveBeenCalled();
    expect(result).toContain("verification: skipped");
    expect(result).toMatch(/hosted/i);
  });

  it("no credentials at all: nothing issued → prober never called", async () => {
    delete process.env.NOVADA_PROXY_USER;
    delete process.env.NOVADA_PROXY_PASS;
    delete process.env.NOVADA_PROXY_ENDPOINT;
    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("not configured");
    expect(mockedVerify).not.toHaveBeenCalled();
  });
});

// ─── static / dedicated verification ─────────────────────────────────────────

describe("novadaProxy — static/dedicated verify through the configured list entry", () => {
  it("type=static: probes the first NOVADA_STATIC_PROXY_LIST entry; ledger disclosed as not applicable", async () => {
    process.env.NOVADA_STATIC_PROXY_LIST = "151.242.47.74:8886:fixtureUserA:fixturePassA";
    const result = await novadaProxy({ type: "static", country: "us", session_id: "s1", format: "url" });
    expect(mockedVerify).toHaveBeenCalledTimes(1);
    expect(mockedVerify).toHaveBeenCalledWith(
      expect.objectContaining({ host: "151.242.47.74", port: 8886, username: "fixtureUserA", password: "fixturePassA" }),
      expect.anything(),
    );
    expect(result).toContain("exit_ip: 68.14.23.7");
    expect(result).toMatch(/no flow ledger|not applicable/i);
    // ledger endpoint is NOT consulted for per-IP products
    expect(mockedPlanBalance).not.toHaveBeenCalled();
  });

  it("type=dedicated: probes the first NOVADA_DEDICATED_PROXY_LIST entry", async () => {
    process.env.NOVADA_DEDICATED_PROXY_LIST = "192.0.2.10:9999:fixtureUserB:fixturePassB";
    await novadaProxy({ type: "dedicated", session_id: "s1", format: "url" });
    expect(mockedVerify).toHaveBeenCalledWith(
      expect.objectContaining({ host: "192.0.2.10", port: 9999, username: "fixtureUserB", password: "fixturePassB" }),
      expect.anything(),
    );
  });

  it("type=static with no list configured: configuration_required returned, prober never called", async () => {
    delete process.env.NOVADA_STATIC_PROXY_LIST;
    const result = await novadaProxy({ type: "static", country: "us", session_id: "s1", format: "url" });
    expect(result).toContain("configuration_required");
    expect(mockedVerify).not.toHaveBeenCalled();
  });
});

// ─── credential-source disclosure ────────────────────────────────────────────

describe("novadaProxy — ledger disclosure distinguishes env creds from auto-fetched creds", () => {
  it("auto-fetched creds + indeterminate ledger: disclosed as a lookup failure (not 'supplied via env')", async () => {
    // No env proxy creds — force the mgmt-API auto-fetch path.
    delete process.env.NOVADA_PROXY_USER;
    delete process.env.NOVADA_PROXY_PASS;
    delete process.env.NOVADA_PROXY_ENDPOINT;
    process.env.NOVADA_API_KEY = `fixture-key-${Date.now()}-${Math.random()}`; // unique → dodges the 6h cred cache
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: 0, data: { list: [{ account: "autoFetchedUser", password: "autoFetchedPass" }] } }),
    })));
    mockedPlanBalance.mockRejectedValue(new Error("Developer-api returned HTTP 503"));

    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("proxy_url:");
    expect(result).toContain("unverified");
    expect(result).toMatch(/ledger lookup failed/i);
    expect(result).not.toContain("credentials supplied via env");
    // and the issued (auto-fetched) credentials are what gets probed
    expect(mockedVerify).toHaveBeenCalledWith(
      expect.objectContaining({ username: expect.stringContaining("autoFetchedUser") }),
      expect.anything(),
    );
  });
});
