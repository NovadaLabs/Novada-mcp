/**
 * Fix C (2026-09-21) — wire the existing runtime guard into novada_browser.
 *
 * Problem this pins: tools/browser.ts called chromium.connectOverCDP with NO
 * runtime guard. On a serverless runtime (Vercel/Lambda) the CDP WebSocket
 * cannot be held, and the connection attempt dies with a MISLEADING
 * "AuthorizationError: Account or Password verification failed" — a transport
 * failure masquerading as a credentials problem. extract.ts already gates on
 * utils/runtime.ts's isBrowserAvailableOnRuntime(); browser.ts now does too.
 *
 * Two halves:
 *  (a) runtime-incapable → novada_browser returns the clean unavailable message
 *      and NEVER calls connectOverCDP;
 *  (b) a GENUINE "AuthorizationError…"/"account or password" credential failure
 *      on a capable runtime classifies as PROXY_AUTH_FAILURE in classifyError
 *      (distinct from the transport false-positive the guard now prevents).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("playwright-core", () => ({
  chromium: { connectOverCDP: vi.fn() },
}));
// Wrap resolveBrowserWs in a delegating spy: every test keeps the REAL env-based
// behavior, and the auto-provision test below overrides it once to simulate a
// successful credential fetch from the API key (the real thing would hit the
// network). vi.clearAllMocks() clears calls, not implementations, so the
// delegating default survives across tests.
vi.mock("../../src/utils/credentials.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/credentials.js")>();
  return { ...actual, resolveBrowserWs: vi.fn(actual.resolveBrowserWs) };
});

import { novadaBrowser } from "../../src/tools/browser.js";
import { chromium } from "playwright-core";
import { classifyError, NovadaErrorCode } from "../../src/_core/errors.js";
import { closeSession, listSessions } from "../../src/utils/browser.js";
import { resolveBrowserWs } from "../../src/utils/credentials.js";

const mockedConnect = vi.mocked(chromium.connectOverCDP);
const mockedResolveWs = vi.mocked(resolveBrowserWs);

// NOVADA_* vars are stripped by tests/setup.ts; the serverless markers are not —
// save/restore them explicitly so this file is deterministic in any shell/CI.
const RUNTIME_KEYS = ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "DEPLOYMENT_SUPPORTS_WS"] as const;
let savedRuntimeEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  savedRuntimeEnv = {};
  for (const k of RUNTIME_KEYS) {
    savedRuntimeEnv[k] = process.env[k];
    delete process.env[k];
  }
  for (const id of listSessions()) {
    void closeSession(id);
  }
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedRuntimeEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function setupBrowserMock() {
  const mockPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    title: vi.fn().mockResolvedValue("Test Page"),
    setDefaultTimeout: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockBrowser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn().mockResolvedValue(undefined),
  };
  mockedConnect.mockResolvedValue(mockBrowser as never);
  return mockPage;
}

const NAVIGATE_PARAMS = {
  actions: [{ action: "navigate" as const, url: "https://example.com", wait_until: "domcontentloaded" as const }],
  timeout: 60000,
};

// ─── (a) The guard: serverless runtime never attempts the doomed connection ───

describe("novadaBrowser — runtime guard on serverless (Fix C)", () => {
  it("VERCEL runtime WITH credentials set: returns the clean unavailable message, connectOverCDP is NEVER called", async () => {
    process.env.VERCEL = "1";
    process.env.NOVADA_BROWSER_WS = "wss://user:pass@browser.example.com";

    const result = await novadaBrowser(NAVIGATE_PARAMS);

    expect(result).toContain("Browser Mode Unavailable");
    expect(result).toContain("status:browser_unavailable_on_runtime");
    // The message must name the REAL cause (transport), pre-empting the
    // misleading AuthorizationError the raw attempt produces.
    expect(result.toLowerCase()).toContain("websocket");
    // …and steer to the working alternative, not a novada_browser retry.
    expect(result).toContain("novada_extract");
    expect(result).toContain('render="render"');
    expect(mockedConnect).not.toHaveBeenCalled();
  });

  it("AWS Lambda runtime without credentials: same guard, no connection attempt, no misleading auth error", async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "my-fn";
    delete process.env.NOVADA_BROWSER_WS;

    const result = await novadaBrowser(NAVIGATE_PARAMS);

    expect(result).toContain("Browser Mode Unavailable");
    // The raw AuthorizationError must never be PRESENTED as the failure — if the
    // message references it at all, it must be as the misleading symptom the
    // guard prevents, with the real (transport) cause named.
    expect(result.toLowerCase()).toContain("masquerading");
    expect(result.toLowerCase()).toContain("transport");
    expect(mockedConnect).not.toHaveBeenCalled();
  });

  it("DEPLOYMENT_SUPPORTS_WS=true opt-in WITHOUT env WS (auto-provision from API key): guard must NOT fire — the opted-in runtime reaches resolveBrowserWs and connects", async () => {
    // Review HIGH (2026-09-21): the first guard predicate used
    // isBrowserAvailableOnRuntime(), which conflates transport capability with
    // credential PRESENCE (it checks getBrowserWs() — env/store only). On an
    // opted-in runtime with no env WS, resolveBrowserWs(apiKey) auto-provisions
    // credentials the runtime check cannot see — this config WORKED before the
    // guard and must keep working. The guard is a pure TRANSPORT check.
    process.env.VERCEL = "1";
    process.env.DEPLOYMENT_SUPPORTS_WS = "true";
    delete process.env.NOVADA_BROWSER_WS;
    mockedResolveWs.mockResolvedValueOnce("wss://auto:prov@browser.example.com");
    setupBrowserMock();

    const result = await novadaBrowser(NAVIGATE_PARAMS, "sk-test-autoprov");

    expect(result).not.toContain("status:browser_unavailable_on_runtime");
    expect(mockedResolveWs).toHaveBeenCalledWith("sk-test-autoprov");
    expect(mockedConnect).toHaveBeenCalledTimes(1);
    expect(result).toContain("navigate [ok]");
  });

  it("DEPLOYMENT_SUPPORTS_WS=true opt-in on a hosted runtime with WS set: guard stands down, connection proceeds", async () => {
    process.env.VERCEL = "1";
    process.env.DEPLOYMENT_SUPPORTS_WS = "true";
    process.env.NOVADA_BROWSER_WS = "wss://user:pass@browser.example.com";
    setupBrowserMock();

    const result = await novadaBrowser(NAVIGATE_PARAMS);

    expect(mockedConnect).toHaveBeenCalledTimes(1);
    expect(result).toContain("navigate [ok]");
  });

  it("capable local runtime is untouched: connection proceeds exactly as before", async () => {
    process.env.NOVADA_BROWSER_WS = "wss://user:pass@browser.example.com";
    setupBrowserMock();

    const result = await novadaBrowser(NAVIGATE_PARAMS);

    expect(mockedConnect).toHaveBeenCalledTimes(1);
    expect(result).toContain("navigate [ok]");
    expect(result).toContain("Test Page");
  });

  it("capable local runtime with NO credentials keeps the existing 'Not Configured' setup message (auto-provision path preserved, no false runtime error)", async () => {
    delete process.env.NOVADA_BROWSER_WS;

    const result = await novadaBrowser(NAVIGATE_PARAMS);

    expect(result).toContain("Not Configured");
    expect(result).toContain("NOVADA_BROWSER_WS");
    expect(result).not.toContain("status:browser_unavailable_on_runtime");
  });
});

// ─── (b) classifyError: genuine credential failure on a capable path ──────────

describe("classifyError — Browser API AuthorizationError classifies as PROXY_AUTH_FAILURE", () => {
  it("the full realistic Playwright message classifies as PROXY_AUTH_FAILURE (auth, no retry)", () => {
    const err = classifyError(
      new Error("browserType.connectOverCDP: AuthorizationError: Account or Password verification failed"),
    );
    expect(err.code).toBe(NovadaErrorCode.PROXY_AUTH_FAILURE);
    expect(err.retryable).toBe(false);
    const s = err.toAgentString();
    expect(s).toContain("failure_class: auth");
  });

  it("the bare 'Account or Password verification failed' string classifies as PROXY_AUTH_FAILURE", () => {
    const err = classifyError(new Error("Account or Password verification failed"));
    expect(err.code).toBe(NovadaErrorCode.PROXY_AUTH_FAILURE);
  });

  it("regression pin: benign text containing 'account or password' WITHOUT 'verification failed' is NOT PROXY_AUTH_FAILURE", () => {
    // Correctness gate (2026-09-21): the substring was narrowed to the full gateway phrase so
    // scraped-page prose and MCP browser selector params (e.g. text=account or password) no
    // longer false-positive into misleading proxy-credential guidance.
    expect(classifyError(new Error("please re-enter your account or password")).code).not.toBe(
      NovadaErrorCode.PROXY_AUTH_FAILURE,
    );
    expect(classifyError(new Error('waiting for locator("text=account or password")')).code).not.toBe(
      NovadaErrorCode.PROXY_AUTH_FAILURE,
    );
  });

  it("regression pin: a non-auth CDP transport failure still classifies as API_DOWN (retryable upstream issue)", () => {
    const err = classifyError(new Error("browserType.connectOverCDP: connect ECONNREFUSED — target closed"));
    expect(err.code).toBe(NovadaErrorCode.API_DOWN);
    expect(err.retryable).toBe(true);
  });

  it("regression pin: classic 407 proxy auth strings keep classifying as PROXY_AUTH_FAILURE", () => {
    expect(classifyError(new Error("Proxy authentication required (407)")).code).toBe(
      NovadaErrorCode.PROXY_AUTH_FAILURE,
    );
  });
});
