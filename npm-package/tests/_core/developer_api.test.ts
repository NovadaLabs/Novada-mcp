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
