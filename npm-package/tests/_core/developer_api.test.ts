/**
 * Tests for devApiPost's scoped 40002 ("No approval received") retry.
 *
 * code=40002 is a transient upstream handshake glitch on api-m.novada.com —
 * confirmed to self-recover on a plain retry. The retry MUST be scoped to
 * exactly this code, MUST NOT apply to write-type endpoints (create/delete/
 * reset are not provably idempotent), and MUST still fail after exhausting
 * retries on a persistent 40002.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { devApiPost } = await import("../../src/_core/developer_api.js");

function envelopeResp(code: number, msg: string, data: unknown = null) {
  return {
    data: { code, msg, data },
    status: 200,
    headers: {},
    config: {} as never,
    statusText: "OK",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("devApiPost — 40002 retry (read-type endpoint)", () => {
  it("retries once and succeeds when the 2nd attempt returns code=0", async () => {
    mockedAxios.post
      .mockResolvedValueOnce(envelopeResp(40002, "No approval received"))
      .mockResolvedValueOnce(envelopeResp(0, "success", { balance: 254.4 }));

    const result = await devApiPost("/v1/wallet/balance", {}, { apiKey: "k" });
    expect(result).toEqual({ balance: 254.4 });
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it("fails with INVALID_PARAMS after exhausting retries on a PERSISTENT 40002 (3 total attempts)", async () => {
    mockedAxios.post.mockResolvedValue(envelopeResp(40002, "No approval received"));

    await expect(devApiPost("/v1/wallet/balance", {}, { apiKey: "k" })).rejects.toThrow(
      /code=40002/,
    );
    // 1 initial + 2 retries = 3 total attempts, matching RETRY_DELAYS_MS length.
    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on an unrelated non-zero code (e.g. 10001 Invalid parameter)", async () => {
    mockedAxios.post.mockResolvedValue(envelopeResp(10001, "Invalid parameter"));

    await expect(devApiPost("/v1/wallet/balance", {}, { apiKey: "k" })).rejects.toThrow(
      /code=10001/,
    );
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on auth codes (11000/10002/401) — unchanged behavior", async () => {
    mockedAxios.post.mockResolvedValue(envelopeResp(11000, "invalid api key"));

    await expect(devApiPost("/v1/wallet/balance", {}, { apiKey: "k" })).rejects.toThrow(
      /auth failure/,
    );
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });
});

describe("devApiPost — 40002 retry EXCLUDED for write-type endpoints", () => {
  it("proxy_account/create does NOT retry on 40002 — fails immediately (not provably idempotent)", async () => {
    mockedAxios.post.mockResolvedValue(envelopeResp(40002, "No approval received"));

    await expect(
      devApiPost("/v1/proxy_account/create", { product: "1", account: "a", password: "p" }, { apiKey: "k" }),
    ).rejects.toThrow(/code=40002/);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it("white_list/add does NOT retry on 40002", async () => {
    mockedAxios.post.mockResolvedValue(envelopeResp(40002, "No approval received"));

    await expect(
      devApiPost("/v1/white_list/add", { product: "1", ip: "1.2.3.4" }, { apiKey: "k" }),
    ).rejects.toThrow(/code=40002/);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it("static_house/open does NOT retry on 40002", async () => {
    mockedAxios.post.mockResolvedValue(envelopeResp(40002, "No approval received"));

    await expect(
      devApiPost("/v1/static_house/open", { region: "us", num: 1, ip_type: "normal", duration: "month" }, { apiKey: "k" }),
    ).rejects.toThrow(/code=40002/);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });
});

describe("devApiPost — 401 agent-facing text never leaks an internal host", () => {
  it("points at the public dashboard, not [novada-internal-host]", async () => {
    mockedAxios.post.mockResolvedValue(envelopeResp(11000, "invalid api key"));

    // Error path: devApiPost envelope branch -> makeNovadaError(INVALID_API_KEY)
    // -> NovadaError.toAgentString() -> redactSecrets (rewrites non-public *.novada.com hosts).
    let caught: unknown;
    try {
      await devApiPost("/v1/wallet/balance", {}, { apiKey: "k" });
    } catch (e) {
      caught = e;
    }
    const { NovadaError } = await import("../../src/_core/errors.js");
    expect(caught).toBeInstanceOf(NovadaError);
    const text = (caught as InstanceType<typeof NovadaError>).toAgentString();
    expect(text).toContain("dashboard.novada.com");
    expect(text).not.toContain("[novada-internal-host]");
    expect(text).not.toContain("developer-api.novada.com");
  });

  it("missing-key message also points at the public dashboard", async () => {
    const saved = { d: process.env.NOVADA_DEVELOPER_API_KEY, a: process.env.NOVADA_API_KEY };
    delete process.env.NOVADA_DEVELOPER_API_KEY;
    delete process.env.NOVADA_API_KEY;
    try {
      const { getDeveloperApiKey } = await import("../../src/_core/developer_api.js");
      let text = "";
      try { getDeveloperApiKey(); } catch (e) { text = (e as { toAgentString(): string }).toAgentString(); }
      expect(text).toContain("dashboard.novada.com");
      expect(text).not.toContain("[novada-internal-host]");
    } finally {
      if (saved.d !== undefined) process.env.NOVADA_DEVELOPER_API_KEY = saved.d;
      if (saved.a !== undefined) process.env.NOVADA_API_KEY = saved.a;
    }
  });
});

// ─── maskCredentials (2026-10-30, account-tools-redaction) ────────────────────
//
// Shared helper promoted for the static-ISP-IP credential leak: an incident
// report showed novada_static_ip_mgmt (list/export) echoing a per-IP dial
// username/password in plaintext, plus listing every long-expired/released IP.
// This suite is table-driven over the CREDENTIAL_FIELDS class — every sensitive
// key maskCredentials claims to cover — plus the mirror rule (lookalike field
// names must survive untouched) and the fields that must NEVER be redacted.
describe("maskCredentials — secret/username redaction", () => {
  it("masks every known secret-kind field to '***', case-insensitively", async () => {
    const { maskCredentials } = await import("../../src/_core/developer_api.js");
    const secretKeys = ["password", "Passwd", "PWD", "pass", "secret", "TOKEN", "api_key", "ApiKey"];
    for (const key of secretKeys) {
      const input = { [key]: "s3cr3t-value" };
      const out = maskCredentials(input) as Record<string, unknown>;
      expect(out[key]).toBe("***");
    }
  });

  it("masks every known username-kind field to '<PROXY_USER>', case-insensitively", async () => {
    const { maskCredentials } = await import("../../src/_core/developer_api.js");
    const usernameKeys = ["account", "Account", "username", "USER_NAME"];
    for (const key of usernameKeys) {
      const input = { [key]: "real_dial_user_123" };
      const out = maskCredentials(input) as Record<string, unknown>;
      expect(out[key]).toBe("<PROXY_USER>");
      expect(JSON.stringify(out)).not.toContain("real_dial_user_123");
    }
  });

  it("recurses into nested objects and arrays (static_house/list-shaped fixture)", async () => {
    const { maskCredentials } = await import("../../src/_core/developer_api.js");
    const fixture = {
      list: [
        {
          id: 1,
          ip: "203.0.113.4",
          port: 8886,
          region: "frankfurt",
          status: 1,
          expire_time: 1798761600,
          credential: { account: "ax0kSJ8snE6wF1mR", password: "p3K0rNpsP2iR" },
        },
        {
          id: 2,
          ip: "203.0.113.5",
          port: 8887,
          region: "frankfurt",
          status: 2,
          expire_time: 1700000000,
          credential: { account: "secondUser", password: "secondPass" },
        },
      ],
      total: 2,
    };
    const out = maskCredentials(fixture) as typeof fixture;
    const serialized = JSON.stringify(out);

    // Credentials never leak in any form.
    expect(serialized).not.toContain("ax0kSJ8snE6wF1mR");
    expect(serialized).not.toContain("p3K0rNpsP2iR");
    expect(serialized).not.toContain("secondUser");
    expect(serialized).not.toContain("secondPass");
    expect(out.list[0].credential.account).toBe("<PROXY_USER>");
    expect(out.list[0].credential.password).toBe("***");
    expect(out.list[1].credential.account).toBe("<PROXY_USER>");
    expect(out.list[1].credential.password).toBe("***");

    // IP / port / region / status / expiry are untouched — users need these.
    expect(out.list[0].ip).toBe("203.0.113.4");
    expect(out.list[0].port).toBe(8886);
    expect(out.list[0].region).toBe("frankfurt");
    expect(out.list[0].status).toBe(1);
    expect(out.list[0].expire_time).toBe(1798761600);
    expect(out.list[1].ip).toBe("203.0.113.5");
    expect(out.total).toBe(2);
  });

  it("MIRROR: lookalike field names are NOT redacted (exact-match only, not substring)", async () => {
    const { maskCredentials } = await import("../../src/_core/developer_api.js");
    const fixture = {
      password_updated_at: "2026-10-29T00:00:00Z",
      token_count: 42,
      account_type: "classic",
      username_hint: "starts with a",
      passwordless: true,
      has_secret_sauce: "nope-not-a-secret",
    };
    const out = maskCredentials({ ...fixture }) as typeof fixture;
    expect(out).toEqual(fixture);
  });

  it("does not mutate non-object, null, or primitive-only input", async () => {
    const { maskCredentials } = await import("../../src/_core/developer_api.js");
    expect(maskCredentials(null)).toBeNull();
    expect(maskCredentials(42)).toBe(42);
    expect(maskCredentials("account")).toBe("account"); // a bare string is not a {key: value} pair
  });

  it("handles cyclic structures without infinite recursion", async () => {
    const { maskCredentials } = await import("../../src/_core/developer_api.js");
    const node: Record<string, unknown> = { account: "cyc_user" };
    node.self = node;
    expect(() => maskCredentials(node)).not.toThrow();
    expect(node.account).toBe("<PROXY_USER>");
  });

  it("ignores prototype-pollution keys", async () => {
    const { maskCredentials } = await import("../../src/_core/developer_api.js");
    const input = JSON.parse('{"__proto__":{"password":"x"},"account":"real"}');
    const out = maskCredentials(input) as Record<string, unknown>;
    expect(out.account).toBe("<PROXY_USER>");
    expect(({} as Record<string, unknown>).password).toBeUndefined();
  });
});
