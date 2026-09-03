/**
 * Tests for the shared two-step approval-token flow (npm-package/src/utils/approval.ts).
 *
 * Closes F2-2 / G-7 (2026-09-02 audit, W-A1): `confirm: true` alone must never
 * authorize a WRITE/destructive call. These tests exercise evaluateApprovalGate()
 * directly (unit level) — per-tool integration tests live in
 * tests/tools/{proxy_account_create,ip_whitelist,static_ip_mgmt,capture_apikey}.test.ts.
 *
 * A single static import is used throughout (no vi.resetModules()) so the
 * NovadaError class thrown by approval.ts and the one imported here for
 * `instanceof`/toThrow assertions are the SAME module instance.
 * isHostedEnvironment() is read at CALL time inside evaluateApprovalGate, not
 * at module load, so toggling process.env per test is sufficient — no reload
 * needed.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { NovadaError, NovadaErrorCode } from "../../src/_core/errors.js";
import { evaluateApprovalGate, canonicalJson, APPROVAL_AGENT_INSTRUCTION } from "../../src/utils/approval.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.useRealTimers();
});

// ─── canonicalJson ──────────────────────────────────────────────────────────

describe("canonicalJson", () => {
  it("produces identical output regardless of key insertion order", () => {
    const a = canonicalJson({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = canonicalJson({ a: 2, c: { x: 2, y: 1 }, b: 1 });
    expect(a).toBe(b);
  });

  it("preserves array element order (order is semantically meaningful there)", () => {
    const a = canonicalJson({ list: [3, 1, 2] });
    const b = canonicalJson({ list: [1, 2, 3] });
    expect(a).not.toBe(b);
  });

  it("is sensitive to value changes on the same key set", () => {
    const a = canonicalJson({ ip: "1.2.3.4" });
    const b = canonicalJson({ ip: "1.2.3.5" });
    expect(a).not.toBe(b);
  });
});

// ─── Local/stdio path (default — no VERCEL/VERCEL_ENV/AWS_LAMBDA_FUNCTION_NAME) ──

describe("evaluateApprovalGate — local/stdio (per-process random secret)", () => {
  beforeEach(() => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.NOVADA_APPROVAL_SECRET;
  });

  it("F2-2 RED: no approval_token, no confirm -> returns a PREVIEW (not authorized, not an error)", () => {
    const result = evaluateApprovalGate({ ip: "203.0.113.7" }, "test_action");
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(typeof result.approvalToken).toBe("string");
      expect(result.approvalToken.length).toBeGreaterThan(0);
      expect(result.expiresInSeconds).toBe(600); // 10 minutes
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    }
  });

  it("F2-2 RED: confirm:true ALONE (no approval_token) is REJECTED — thrown, not returned", () => {
    let caught: unknown;
    try {
      evaluateApprovalGate({ ip: "203.0.113.7", confirm: true }, "test_action");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NovadaError);
    const err = caught as NovadaError;
    expect(err.agent_instruction).toBe(APPROVAL_AGENT_INSTRUCTION);
    // agent_instruction must survive into the agent-facing string too (=> isError:true path).
    expect(err.toAgentString()).toContain(APPROVAL_AGENT_INSTRUCTION);
  });

  it("GREEN: preview -> mint token -> execute with SAME payload + token is authorized", () => {
    const payload = { ip: "203.0.113.7", product: "1" };
    const preview = evaluateApprovalGate({ ...payload }, "test_action");
    expect(preview.authorized).toBe(false);
    if (preview.authorized) throw new Error("unreachable");

    const executed = evaluateApprovalGate(
      { ...payload, approval_token: preview.approvalToken },
      "test_action",
    );
    expect(executed).toEqual({ authorized: true });
  });

  it("RED: token minted for one payload is REJECTED against a mutated payload", () => {
    const preview = evaluateApprovalGate({ ip: "203.0.113.7" }, "test_action");
    if (preview.authorized) throw new Error("unreachable");

    expect(() =>
      evaluateApprovalGate(
        { ip: "203.0.113.99", approval_token: preview.approvalToken }, // ip changed after minting
        "test_action",
      ),
    ).toThrow(NovadaError);
  });

  it("RED: expired token is REJECTED even with the exact original payload", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const payload = { ip: "203.0.113.7" };
    const preview = evaluateApprovalGate({ ...payload }, "test_action");
    if (preview.authorized) throw new Error("unreachable");

    // Advance past the 10-minute TTL.
    vi.setSystemTime(new Date("2026-01-01T00:11:00.000Z"));

    expect(() =>
      evaluateApprovalGate({ ...payload, approval_token: preview.approvalToken }, "test_action"),
    ).toThrow(NovadaError);
  });

  it("RED: garbage/invented token string is REJECTED (never accepted)", () => {
    expect(() =>
      evaluateApprovalGate(
        { ip: "203.0.113.7", approval_token: "totally-invented-value" },
        "test_action",
      ),
    ).toThrow(NovadaError);
  });

  it("a token minted for a DIFFERENT action label still verifies — action label is error-message context only; the real binding is params.action inside the canonical payload for multi-action tools", () => {
    const payload = { action: "add", ip: "203.0.113.7" };
    const preview = evaluateApprovalGate({ ...payload }, "ip_whitelist_add");
    if (preview.authorized) throw new Error("unreachable");
    const executed = evaluateApprovalGate(
      { ...payload, approval_token: preview.approvalToken },
      "totally_different_label",
    );
    expect(executed).toEqual({ authorized: true });
  });
});

// ─── Hosted/serverless path ─────────────────────────────────────────────────

describe("evaluateApprovalGate — hosted (isHostedEnvironment() true)", () => {
  beforeEach(() => {
    process.env.VERCEL = "1";
    delete process.env.NOVADA_APPROVAL_SECRET;
  });

  it("FAILS CLOSED when NOVADA_APPROVAL_SECRET is unset — even the preview mint is refused", () => {
    let caught: unknown;
    try {
      evaluateApprovalGate({ ip: "203.0.113.7" }, "static_ip_open");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NovadaError);
    expect((caught as NovadaError).code).toBe(NovadaErrorCode.PRODUCT_UNAVAILABLE);
    expect((caught as NovadaError).retryable).toBe(false);
  });

  it("happy path works once NOVADA_APPROVAL_SECRET is set: preview -> execute with matching token", () => {
    process.env.NOVADA_APPROVAL_SECRET = "test-shared-secret-not-a-real-credential";
    const payload = { ip_type: "normal", region: "frankfurt", duration: "month", num: 3 };
    const preview = evaluateApprovalGate({ ...payload }, "static_ip_open");
    expect(preview.authorized).toBe(false);
    if (preview.authorized) throw new Error("unreachable");

    const executed = evaluateApprovalGate(
      { ...payload, approval_token: preview.approvalToken },
      "static_ip_open",
    );
    expect(executed).toEqual({ authorized: true });
  });

  it("a token minted while the secret was set is REJECTED once the secret is unset (config regressed mid-flight)", () => {
    process.env.NOVADA_APPROVAL_SECRET = "test-shared-secret-not-a-real-credential";
    const payload = { ip_type: "normal", region: "frankfurt", duration: "month", num: 3 };
    const preview = evaluateApprovalGate({ ...payload }, "static_ip_open");
    if (preview.authorized) throw new Error("unreachable");

    delete process.env.NOVADA_APPROVAL_SECRET;
    expect(() =>
      evaluateApprovalGate({ ...payload, approval_token: preview.approvalToken }, "static_ip_open"),
    ).toThrow(NovadaError);
  });
});
