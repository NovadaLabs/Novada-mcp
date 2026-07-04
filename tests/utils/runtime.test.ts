import { describe, it, expect, afterEach } from "vitest";
import { isBrowserAvailableOnRuntime, getBrowserUnavailableError } from "../../src/utils/runtime.js";

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

// ─── isBrowserAvailableOnRuntime ───────────────────────────────────────────────

describe("isBrowserAvailableOnRuntime", () => {
  it("returns false when VERCEL is set (serverless) and no WS override", () => {
    process.env.VERCEL = "1";
    delete process.env.DEPLOYMENT_SUPPORTS_WS;
    delete process.env.NOVADA_BROWSER_WS;
    expect(isBrowserAvailableOnRuntime()).toBe(false);
  });

  it("returns false when VERCEL_ENV is set (serverless) and no WS override", () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.DEPLOYMENT_SUPPORTS_WS;
    delete process.env.NOVADA_BROWSER_WS;
    expect(isBrowserAvailableOnRuntime()).toBe(false);
  });

  it("returns false when AWS_LAMBDA_FUNCTION_NAME is set and no WS override", () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "my-lambda";
    delete process.env.DEPLOYMENT_SUPPORTS_WS;
    delete process.env.NOVADA_BROWSER_WS;
    expect(isBrowserAvailableOnRuntime()).toBe(false);
  });

  it("returns false when VERCEL is set even if NOVADA_BROWSER_WS is present, unless DEPLOYMENT_SUPPORTS_WS=true", () => {
    process.env.VERCEL = "1";
    process.env.NOVADA_BROWSER_WS = "wss://user:pass@host.example.com";
    delete process.env.DEPLOYMENT_SUPPORTS_WS;
    expect(isBrowserAvailableOnRuntime()).toBe(false);
  });

  it("returns true when DEPLOYMENT_SUPPORTS_WS=true and NOVADA_BROWSER_WS is set (custom persistent runtime)", () => {
    process.env.VERCEL = "1";
    process.env.DEPLOYMENT_SUPPORTS_WS = "true";
    process.env.NOVADA_BROWSER_WS = "wss://user:pass@host.example.com";
    expect(isBrowserAvailableOnRuntime()).toBe(true);
  });

  it("returns false when DEPLOYMENT_SUPPORTS_WS=true but NOVADA_BROWSER_WS is missing", () => {
    process.env.DEPLOYMENT_SUPPORTS_WS = "true";
    delete process.env.NOVADA_BROWSER_WS;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    expect(isBrowserAvailableOnRuntime()).toBe(false);
  });

  it("returns false when not hosted but NOVADA_BROWSER_WS is missing", () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.DEPLOYMENT_SUPPORTS_WS;
    delete process.env.NOVADA_BROWSER_WS;
    expect(isBrowserAvailableOnRuntime()).toBe(false);
  });

  it("returns true when not hosted and NOVADA_BROWSER_WS is configured", () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.DEPLOYMENT_SUPPORTS_WS;
    process.env.NOVADA_BROWSER_WS = "wss://user:pass@host.example.com";
    expect(isBrowserAvailableOnRuntime()).toBe(true);
  });
});

// ─── getBrowserUnavailableError ────────────────────────────────────────────────

describe("getBrowserUnavailableError", () => {
  it("returns hosted-specific message with agent_instruction when on serverless", () => {
    process.env.VERCEL = "1";
    delete process.env.DEPLOYMENT_SUPPORTS_WS;
    const msg = getBrowserUnavailableError("browser");
    expect(msg).toContain("## Browser Mode Unavailable");
    // Structured agent_instruction field (required by agent-first rules)
    expect(msg).toContain("agent_instruction:");
    expect(msg).toContain("status:browser_unavailable_on_runtime");
    // Points to local MCP setup as alternative
    expect(msg).toContain("npx -y novada-mcp");
    expect(msg).toContain('render="render"');
    // Explains WHY so agent knows this is a transport issue not auth issue
    expect(msg).toContain("serverless");
    expect(msg).toContain("WebSocket");
  });

  it("mentions 'AuthorizationError' is a transport failure, not credentials error", () => {
    process.env.VERCEL = "1";
    delete process.env.DEPLOYMENT_SUPPORTS_WS;
    const msg = getBrowserUnavailableError("browser");
    expect(msg).toContain("AuthorizationError");
  });

  it("returns not-configured message when off serverless but WS missing", () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.DEPLOYMENT_SUPPORTS_WS;
    const msg = getBrowserUnavailableError("browser");
    expect(msg).toContain("## Browser Mode Unavailable");
    expect(msg).toContain("agent_instruction:");
    expect(msg).toContain("status:browser_not_configured");
    expect(msg).toContain("NOVADA_BROWSER_WS");
    expect(msg).toContain("dashboard.novada.com");
  });

  it("includes the render param value in both error variants", () => {
    process.env.VERCEL = "1";
    const hostedMsg = getBrowserUnavailableError("browser");
    expect(hostedMsg).toContain('render="browser"');

    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    const localMsg = getBrowserUnavailableError("browser");
    expect(localMsg).toContain('render="browser"');
  });

  it("works without a param (empty paramContext)", () => {
    process.env.VERCEL = "1";
    const msg = getBrowserUnavailableError();
    expect(msg).toContain("## Browser Mode Unavailable");
    expect(msg).toContain("agent_instruction:");
  });
});
