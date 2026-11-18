import { describe, it, expect, afterEach } from "vitest";
import { isBrowserAvailableOnRuntime, getBrowserUnavailableError } from "../../src/utils/runtime.js";

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

function clearRuntimeEnv() {
  delete process.env.NOVADA_RUNTIME_KIND;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  delete process.env.NOVADA_BROWSER_WS;
}

// ─── isBrowserAvailableOnRuntime ───────────────────────────────────────────────
//
// Round 8 (A/B verifier): canHoldWebSocket is now a property of WHICH
// RuntimeKind this is, never a separate opt-in flag (DEPLOYMENT_SUPPORTS_WS,
// removed). "local" and "hosted" (a long-lived Node server, e.g. EC2) can
// hold a persistent WS; only "serverless" (genuine Vercel/Lambda per-request
// isolates) cannot.

describe("isBrowserAvailableOnRuntime", () => {
  it("serverless (auto-detected via VERCEL): false, even with NOVADA_BROWSER_WS configured", () => {
    clearRuntimeEnv();
    process.env.VERCEL = "1";
    process.env.NOVADA_BROWSER_WS = "wss://user:pass@host.example.com";
    expect(isBrowserAvailableOnRuntime()).toBe(false);
  });

  it("serverless (auto-detected via VERCEL_ENV): false", () => {
    clearRuntimeEnv();
    process.env.VERCEL_ENV = "production";
    expect(isBrowserAvailableOnRuntime()).toBe(false);
  });

  it("serverless (auto-detected via AWS_LAMBDA_FUNCTION_NAME): false", () => {
    clearRuntimeEnv();
    process.env.AWS_LAMBDA_FUNCTION_NAME = "my-lambda";
    expect(isBrowserAvailableOnRuntime()).toBe(false);
  });

  it('explicit NOVADA_RUNTIME_KIND=serverless: false even with NOVADA_BROWSER_WS configured', () => {
    clearRuntimeEnv();
    process.env.NOVADA_RUNTIME_KIND = "serverless";
    process.env.NOVADA_BROWSER_WS = "wss://user:pass@host.example.com";
    expect(isBrowserAvailableOnRuntime()).toBe(false);
  });

  it('hosted (NOVADA_RUNTIME_KIND=hosted, e.g. EC2 server.mts): true when NOVADA_BROWSER_WS is configured — no extra flag needed', () => {
    clearRuntimeEnv();
    process.env.NOVADA_RUNTIME_KIND = "hosted";
    process.env.NOVADA_BROWSER_WS = "wss://user:pass@host.example.com";
    expect(isBrowserAvailableOnRuntime()).toBe(true);
  });

  it("hosted: false when NOVADA_BROWSER_WS is missing (transport is fine, credentials are not)", () => {
    clearRuntimeEnv();
    process.env.NOVADA_RUNTIME_KIND = "hosted";
    expect(isBrowserAvailableOnRuntime()).toBe(false);
  });

  it("local (no runtime signal set at all): false when NOVADA_BROWSER_WS is missing", () => {
    clearRuntimeEnv();
    expect(isBrowserAvailableOnRuntime()).toBe(false);
  });

  it("local: true when NOVADA_BROWSER_WS is configured", () => {
    clearRuntimeEnv();
    process.env.NOVADA_BROWSER_WS = "wss://user:pass@host.example.com";
    expect(isBrowserAvailableOnRuntime()).toBe(true);
  });
});

// ─── getBrowserUnavailableError ────────────────────────────────────────────────

describe("getBrowserUnavailableError", () => {
  it("returns the transport-unavailable message with agent_instruction when serverless", () => {
    clearRuntimeEnv();
    process.env.VERCEL = "1";
    const msg = getBrowserUnavailableError("browser");
    expect(msg).toContain("## Browser Mode Unavailable");
    // Structured agent_instruction field (required by agent-first rules)
    expect(msg).toContain("agent_instruction:");
    expect(msg).toContain("status:browser_unavailable_on_runtime");
    // Points to local MCP setup as alternative
    expect(msg).toContain("npx -y novada-mcp");
    expect(msg).toContain('render="render"');
    // Explains WHY so agent knows this is a transport issue not auth issue.
    // Round 8: this branch is now reached ONLY for RUNTIME.kind === "serverless"
    // (EC2 reports "hosted" and never reaches here) — still must not name a
    // specific platform, since a future serverless-reporting platform could be
    // anything.
    expect(msg).toContain("WebSocket");
    expect(msg).not.toContain("serverless");
    expect(msg).not.toContain("Vercel");
  });

  it("hosted (NOVADA_RUNTIME_KIND=hosted): the transport message is NOT returned even with no NOVADA_BROWSER_WS — it's the not-configured message instead", () => {
    clearRuntimeEnv();
    process.env.NOVADA_RUNTIME_KIND = "hosted";
    const msg = getBrowserUnavailableError("browser");
    expect(msg).toContain("status:browser_not_configured");
    expect(msg).not.toContain("status:browser_unavailable_on_runtime");
  });

  it("mentions 'AuthorizationError' is a transport failure, not credentials error", () => {
    clearRuntimeEnv();
    process.env.VERCEL = "1";
    const msg = getBrowserUnavailableError("browser");
    expect(msg).toContain("AuthorizationError");
  });

  it("returns not-configured message when not serverless but WS missing", () => {
    clearRuntimeEnv();
    const msg = getBrowserUnavailableError("browser");
    expect(msg).toContain("## Browser Mode Unavailable");
    expect(msg).toContain("agent_instruction:");
    expect(msg).toContain("status:browser_not_configured");
    expect(msg).toContain("NOVADA_BROWSER_WS");
    expect(msg).toContain("dashboard.novada.com");
  });

  it("includes the render param value in both error variants", () => {
    clearRuntimeEnv();
    process.env.VERCEL = "1";
    const serverlessMsg = getBrowserUnavailableError("browser");
    expect(serverlessMsg).toContain('render="browser"');

    clearRuntimeEnv();
    const localMsg = getBrowserUnavailableError("browser");
    expect(localMsg).toContain('render="browser"');
  });

  it("works without a param (empty paramContext)", () => {
    clearRuntimeEnv();
    process.env.VERCEL = "1";
    const msg = getBrowserUnavailableError();
    expect(msg).toContain("## Browser Mode Unavailable");
    expect(msg).toContain("agent_instruction:");
  });
});
