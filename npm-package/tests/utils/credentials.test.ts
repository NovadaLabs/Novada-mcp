import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  withCredentials,
  getWebUnblockerKey,
  getBrowserWs,
  getProxyCredentials,
  resolveProxyCredentials,
  redactSecret,
  fetchProxySubAccountCredentials,
  fetchBrowserSubAccountCredentials,
  getEffectiveApiKey,
  clearBrowserWsCachesForTest,
} from "../../src/utils/credentials.js";

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
    // F11: `source` discloses HOW creds were obtained ("direct" = env/SDK —
    // the flow-ledger for them is unknowable, so proxy.ts labels the ledger
    // "unverified … supplied via env" when the preflight is indeterminate).
    const result = await resolveProxyCredentials(undefined);
    expect(result).toEqual({ user: "user", pass: "pass", endpoint: "proxy.example.com:7777", source: "direct" });
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
    // HIGH-1: `billingApiKey` exposes the EXACT key the fetched sub-account
    // bills to, so the F11 ledger preflight can read that account's ledger
    // (never the server env account's).
    expect(result).toEqual({
      user: "auto-user",
      pass: "auto-pass",
      endpoint: "proxy.example.com:7777",
      source: "auto_fetched",
      billingApiKey: "caller-key",
    });

    // Authorization header must use the CALLER key, NOT the server key.
    const callArgs = fetchSpy.mock.calls[0];
    const headers = (callArgs[1] as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer caller-key");
    expect(headers["Authorization"]).not.toBe("Bearer server-key");
  });
});

// TENANT SAFETY (multi-tenant hosted server): the auto-fetch caches are process-global
// and shared across callers. Each entry must be keyed by the fetching apiKey's fingerprint
// so caller A's fetched proxy/browser credentials are NEVER served to caller B within the
// 6h TTL. These tests assert that a second, DIFFERENT key does not read the first key's
// cache entry, and that the SAME key does hit the cache (no redundant network call).
describe("auto-fetch cache — per-key tenant isolation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchProxySubAccountCredentials does NOT serve caller A's creds to caller B", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, data: { list: [{ account: "A-user", password: "A-pass" }] } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, data: { list: [{ account: "B-user", password: "B-pass" }] } }),
      } as Response);

    const a = await fetchProxySubAccountCredentials("tenant-a-key-cache-iso-proxy");
    const b = await fetchProxySubAccountCredentials("tenant-b-key-cache-iso-proxy");

    // B must get its OWN creds, not A's cached creds.
    expect(a).toEqual({ account: "A-user", password: "A-pass" });
    expect(b).toEqual({ account: "B-user", password: "B-pass" });
    // A different key must trigger its own network fetch (no cross-tenant cache hit).
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Authorization headers must carry each caller's own key.
    const h0 = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    const h1 = (fetchSpy.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(h0["Authorization"]).toBe("Bearer tenant-a-key-cache-iso-proxy");
    expect(h1["Authorization"]).toBe("Bearer tenant-b-key-cache-iso-proxy");
  });

  it("fetchProxySubAccountCredentials reuses the cache for the SAME key (one network call)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { list: [{ account: "same-user", password: "same-pass" }] } }),
    } as Response);

    const key = "tenant-same-key-cache-hit-proxy";
    const first = await fetchProxySubAccountCredentials(key);
    const second = await fetchProxySubAccountCredentials(key);

    expect(first).toEqual({ account: "same-user", password: "same-pass" });
    expect(second).toEqual(first);
    // Second call served from cache → only ONE network call.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("fetchBrowserSubAccountCredentials does NOT serve caller A's WSS endpoint to caller B", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, data: { list: [{ account: "A-br", password: "A-brpass" }] } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, data: { list: [{ account: "B-br", password: "B-brpass" }] } }),
      } as Response);

    const a = await fetchBrowserSubAccountCredentials("tenant-a-key-cache-iso-browser");
    const b = await fetchBrowserSubAccountCredentials("tenant-b-key-cache-iso-browser");

    // Each caller gets a WSS URL built from its OWN sub-account, never the other's.
    // Username carries the required `-zone-browser` zone suffix (see credentials.ts).
    expect(a).toContain("A-br-zone-browser:A-brpass@");
    expect(b).toContain("B-br-zone-browser:B-brpass@");
    expect(a).not.toEqual(b);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("getBrowserWs does NOT leak the auto-fetch cache (no apiKey to match against)", async () => {
    delete process.env.NOVADA_BROWSER_WS;
    // Populate the browser cache for some caller...
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { list: [{ account: "leaky", password: "leaky-pass" }] } }),
    } as Response);
    await fetchBrowserSubAccountCredentials("some-tenant-key-getbrowserws-leak");

    // getBrowserWs() has no apiKey context → must NOT return the cached value.
    // (store empty + env unset → undefined). This closes the unconditional-cache-fallback leak.
    expect(getBrowserWs()).toBeUndefined();
  });

  // #41 Round 3 (reviewer finding #2, "browser credential auto-provisioning
  // race"): concurrent calls for the SAME key must share one in-flight request
  // ("resolve per caller key once") instead of each starting its own, and a
  // failure must be cached briefly so a call that just lost mcp.ts's race
  // doesn't force every near-simultaneous call to re-pay (and re-lose) the same
  // slow/failing round-trip from scratch.
  describe("fetchBrowserSubAccountCredentials — in-flight de-dup + failure cache (#41 Round 3)", () => {
    beforeEach(() => {
      clearBrowserWsCachesForTest();
    });

    it("de-dupes concurrent calls for the same key into exactly ONE upstream fetch", async () => {
      let resolveFetch!: (v: Response) => void;
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        () => new Promise<Response>((resolve) => { resolveFetch = resolve; })
      );
      const key = "tenant-inflight-dedup-key";
      // Fire 3 concurrent calls BEFORE the single in-flight fetch resolves.
      const p1 = fetchBrowserSubAccountCredentials(key);
      const p2 = fetchBrowserSubAccountCredentials(key);
      const p3 = fetchBrowserSubAccountCredentials(key);
      expect(fetchSpy).toHaveBeenCalledTimes(1); // NOT 3 — one shared in-flight promise
      resolveFetch({
        ok: true,
        json: async () => ({ code: 0, data: { list: [{ account: "dedup-acct", password: "dedup-pass" }] } }),
      } as Response);
      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      expect(r1).toBe(r2);
      expect(r2).toBe(r3);
      expect(r1).toContain("dedup-acct-zone-browser:dedup-pass@");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("caches a FAILURE briefly — a second call within the TTL does not re-hit the network", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
      } as Response);
      const key = "tenant-failure-cache-key";
      const first = await fetchBrowserSubAccountCredentials(key);
      expect(first).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // A second call for the SAME key, immediately after, must be served from
      // the brief failure cache — no second network call, no second wait.
      const second = await fetchBrowserSubAccountCredentials(key);
      expect(second).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1); // still 1 — not re-attempted
    });

    it("mirror: a DIFFERENT key is never served the first key's cached failure (no cross-tenant false negative)", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({ ok: false } as Response) // key A fails
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ code: 0, data: { list: [{ account: "b-ok", password: "b-pass" }] } }),
        } as Response); // key B succeeds
      const a = await fetchBrowserSubAccountCredentials("tenant-failure-cache-key-a");
      const b = await fetchBrowserSubAccountCredentials("tenant-failure-cache-key-b");
      expect(a).toBeNull();
      expect(b).toContain("b-ok-zone-browser:b-pass@");
      expect(fetchSpy).toHaveBeenCalledTimes(2); // each key paid its OWN network call
    });

    it("an exception (network error, not just a non-ok response) is also cached as a failure", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNRESET"));
      const key = "tenant-exception-failure-cache-key";
      const first = await fetchBrowserSubAccountCredentials(key);
      expect(first).toBeNull();
      const second = await fetchBrowserSubAccountCredentials(key);
      expect(second).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe("getEffectiveApiKey (#41 Round 3)", () => {
  const savedEnvKey = process.env.NOVADA_API_KEY;
  afterEach(() => {
    if (savedEnvKey === undefined) delete process.env.NOVADA_API_KEY;
    else process.env.NOVADA_API_KEY = savedEnvKey;
  });

  it("prefers the store-scoped apiKey (the caller's real key on hosted) over the server's own env var", () => {
    process.env.NOVADA_API_KEY = "server-own-key";
    const result = withCredentials({ apiKey: "caller-real-key" }, () => getEffectiveApiKey());
    expect(result).toBe("caller-real-key");
  });

  it("falls back to NOVADA_API_KEY when no store-scoped apiKey is present (single-tenant stdio use)", () => {
    process.env.NOVADA_API_KEY = "stdio-env-key";
    expect(getEffectiveApiKey()).toBe("stdio-env-key");
  });

  it("mirror: no store apiKey and no env var → undefined, never a crash", () => {
    delete process.env.NOVADA_API_KEY;
    expect(getEffectiveApiKey()).toBeUndefined();
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
