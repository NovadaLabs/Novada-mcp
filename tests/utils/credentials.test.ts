import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { withCredentials, getWebUnblockerKey, getBrowserWs, getProxyCredentials, resolveProxyCredentials, redactSecret } from "../../src/utils/credentials.js";

describe("credentials — env var fallback", () => {
  beforeEach(() => {
    delete process.env.NOVADA_WEB_UNBLOCKER_KEY;
    delete process.env.NOVADA_BROWSER_WS;
    delete process.env.NOVADA_PROXY_USER;
    delete process.env.NOVADA_PROXY_PASS;
    delete process.env.NOVADA_PROXY_ENDPOINT;
  });

  it("getWebUnblockerKey returns undefined when not set", () => {
    expect(getWebUnblockerKey()).toBeUndefined();
  });

  it("getWebUnblockerKey reads from process.env fallback", () => {
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "env-key";
    expect(getWebUnblockerKey()).toBe("env-key");
  });

  it("getBrowserWs returns undefined when not set", () => {
    expect(getBrowserWs()).toBeUndefined();
  });

  it("getBrowserWs reads from process.env fallback", () => {
    process.env.NOVADA_BROWSER_WS = "wss://example.com";
    expect(getBrowserWs()).toBe("wss://example.com");
  });

  it("getProxyCredentials returns null when env vars missing", () => {
    expect(getProxyCredentials()).toBeNull();
  });

  it("getProxyCredentials returns null when only some vars set", () => {
    process.env.NOVADA_PROXY_USER = "user";
    process.env.NOVADA_PROXY_PASS = "pass";
    // no endpoint
    expect(getProxyCredentials()).toBeNull();
  });

  it("getProxyCredentials returns creds when all env vars set", () => {
    process.env.NOVADA_PROXY_USER = "user";
    process.env.NOVADA_PROXY_PASS = "pass";
    process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";
    const creds = getProxyCredentials();
    expect(creds).toEqual({ user: "user", pass: "pass", endpoint: "proxy.example.com:7777" });
  });
});

describe("withCredentials — scoped overrides", () => {
  beforeEach(() => {
    delete process.env.NOVADA_WEB_UNBLOCKER_KEY;
    delete process.env.NOVADA_BROWSER_WS;
    delete process.env.NOVADA_PROXY_USER;
  });

  it("scoped key overrides env var for the duration of fn", async () => {
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "env-key";
    let insideKey: string | undefined;

    await withCredentials({ webUnblockerKey: "scoped-key" }, async () => {
      insideKey = getWebUnblockerKey();
    });

    expect(insideKey).toBe("scoped-key");
    // After exiting scope, env var is back
    expect(getWebUnblockerKey()).toBe("env-key");
  });

  it("multiple concurrent scopes are isolated", async () => {
    const results: string[] = [];

    await Promise.all([
      withCredentials({ webUnblockerKey: "key-A" }, async () => {
        await new Promise(r => setTimeout(r, 10));
        results.push(getWebUnblockerKey() ?? "none");
      }),
      withCredentials({ webUnblockerKey: "key-B" }, async () => {
        await new Promise(r => setTimeout(r, 5));
        results.push(getWebUnblockerKey() ?? "none");
      }),
    ]);

    // Both keys must appear, no cross-contamination
    expect(results).toContain("key-A");
    expect(results).toContain("key-B");
  });

  it("scoped proxy creds override env vars", async () => {
    process.env.NOVADA_PROXY_USER = "env-user";
    process.env.NOVADA_PROXY_PASS = "env-pass";
    process.env.NOVADA_PROXY_ENDPOINT = "env.proxy.com:7777";

    let insideCreds: { user: string; pass: string; endpoint: string } | null = null;
    await withCredentials({ proxyUser: "sdk-user", proxyPass: "sdk-pass", proxyEndpoint: "sdk.proxy.com:7777" }, async () => {
      insideCreds = getProxyCredentials();
    });

    expect(insideCreds).toEqual({ user: "sdk-user", pass: "sdk-pass", endpoint: "sdk.proxy.com:7777" });
    // Env vars still intact after scope
    expect(getProxyCredentials()).toEqual({ user: "env-user", pass: "env-pass", endpoint: "env.proxy.com:7777" });
  });

  it("withCredentials returns the fn return value", async () => {
    const result = await withCredentials({ webUnblockerKey: "k" }, async () => 42);
    expect(result).toBe(42);
  });

  // L3 unified-key: store.apiKey serves as fallback for web unblocker.
  // When caller passes only { apiKey } (no webUnblockerKey), getWebUnblockerKey() must return apiKey.
  it("store.apiKey is returned by getWebUnblockerKey when no webUnblockerKey is set", async () => {
    let result: string | undefined;
    await withCredentials({ apiKey: "caller-api-key" }, async () => {
      result = getWebUnblockerKey();
    });
    expect(result).toBe("caller-api-key");
  });

  it("store.webUnblockerKey takes priority over store.apiKey", async () => {
    let result: string | undefined;
    await withCredentials({ apiKey: "caller-api-key", webUnblockerKey: "explicit-unblocker" }, async () => {
      result = getWebUnblockerKey();
    });
    expect(result).toBe("explicit-unblocker");
  });

  it("store.apiKey takes priority over NOVADA_WEB_UNBLOCKER_KEY env var", async () => {
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "env-unblocker";
    let result: string | undefined;
    await withCredentials({ apiKey: "caller-api-key" }, async () => {
      result = getWebUnblockerKey();
    });
    // webUnblockerKey is not set in store, apiKey IS set in store → store.apiKey wins over env.
    // Per fallback chain: store.webUnblockerKey ?? store.apiKey ?? env.NOVADA_WEB_UNBLOCKER_KEY ?? env.NOVADA_API_KEY
    expect(result).toBe("caller-api-key");
    delete process.env.NOVADA_WEB_UNBLOCKER_KEY;
  });
});

describe("resolveProxyCredentials — apiKey threading (L3 unified-key)", () => {
  beforeEach(() => {
    delete process.env.NOVADA_PROXY_USER;
    delete process.env.NOVADA_PROXY_PASS;
    delete process.env.NOVADA_PROXY_ENDPOINT;
    delete process.env.NOVADA_API_KEY;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when NOVADA_PROXY_ENDPOINT is not set", async () => {
    const result = await resolveProxyCredentials("any-key");
    expect(result).toBeNull();
  });

  it("returns direct creds when NOVADA_PROXY_USER+PASS+ENDPOINT are all set (no API call)", async () => {
    process.env.NOVADA_PROXY_USER = "user";
    process.env.NOVADA_PROXY_PASS = "pass";
    process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";

    // Should return env-based creds without making a network call.
    const result = await resolveProxyCredentials(undefined);
    expect(result).toEqual({ user: "user", pass: "pass", endpoint: "proxy.example.com:7777" });
  });

  it("returns null when NOVADA_PROXY_ENDPOINT is set but no apiKey is available for auto-fetch", async () => {
    process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";
    // No NOVADA_API_KEY in env, no caller apiKey → cannot auto-fetch → null.
    const result = await resolveProxyCredentials(undefined);
    expect(result).toBeNull();
  });

  it("prefers caller-supplied apiKey over NOVADA_API_KEY for auto-fetch (billing isolation)", async () => {
    process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";
    process.env.NOVADA_API_KEY = "server-key";

    // Mock fetch so we can verify which key was sent in the Authorization header.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { list: [{ account: "auto-user", password: "auto-pass" }] } }),
    } as Response);

    const result = await resolveProxyCredentials("caller-key");
    expect(result).toEqual({ user: "auto-user", pass: "auto-pass", endpoint: "proxy.example.com:7777" });

    // Authorization header must use the CALLER key, NOT the server key.
    const callArgs = fetchSpy.mock.calls[0];
    const headers = (callArgs[1] as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer caller-key");
    expect(headers["Authorization"]).not.toBe("Bearer server-key");
  });
});

describe("redactSecret", () => {
  it("returns (not set) for undefined", () => {
    expect(redactSecret(undefined)).toBe("(not set)");
  });

  it("returns **** for short values (<= 4 chars)", () => {
    expect(redactSecret("ab")).toBe("****");
    expect(redactSecret("abcd")).toBe("****");
  });

  it("returns last 4 chars with **** prefix for longer values", () => {
    expect(redactSecret("abcdefgh")).toBe("****efgh");
    expect(redactSecret("sk-abc123xyz")).toBe("****3xyz");
  });
});
