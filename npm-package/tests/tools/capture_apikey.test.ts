/**
 * Tests for novada_capture_apikey — two-step approval-token gate on "reset"
 * (F2-2/G-7 fix, 2026-09, W-A1).
 *
 * "reset" invalidates the caller's live Capture API key immediately —
 * DESTRUCTIVE, not just a spend. `confirm: true` self-supplied on the first
 * call (no prior preview) must now be REJECTED before devApiPost is ever
 * called. "get" is read-only and untouched by this gate.
 *
 * Mocks devApiPost (network) so no real HTTP is made; the REAL approval.ts
 * gate is exercised (not mocked) since it is what's under test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/_core/developer_api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/_core/developer_api.js")>();
  return {
    ...actual,
    devApiPost: vi.fn(),
  };
});

import { devApiPost } from "../../src/_core/developer_api.js";
const mockedPost = vi.mocked(devApiPost);

beforeEach(() => {
  mockedPost.mockReset();
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
});

describe("novada_capture_apikey — 'get' is read-only, untouched by the gate", () => {
  it("'get' calls devApi directly with no gate fields required", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValueOnce({ code: 0, msg: "ok", data: { api_key: "sk_live_abcd1234" } });
    const out = await dispatch("novada_capture_apikey", { action: "get" }, "caller-key-cap");
    expect(mockedPost).toHaveBeenCalledTimes(1);
    const obj = JSON.parse(out) as { status: string; data: { data: { api_key: string } } };
    expect(obj.status).toBe("ok");
    // Secret masking (pre-existing, unrelated to this fix) still applies.
    // devApiPost mock returns the raw envelope {code,msg,data}; the tool wraps
    // it again under its own `data` key, so the masked key lands at data.data.api_key.
    expect(obj.data.data.api_key).toBe("****1234");
  });
});

describe("novada_capture_apikey — approval-token gate on 'reset' (F2-2/G-7)", () => {
  it("F2-2 RED: confirm:true self-supplied on the FIRST call (no approval_token) is REJECTED and NEVER reaches devApi", async () => {
    const { dispatch } = await import("../../src/core.js");
    await expect(
      dispatch("novada_capture_apikey", { action: "reset", confirm: true }, "caller-key-cap"),
    ).rejects.toThrow();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("'reset' without any gate field returns a warning preview + approval_token, key NOT invalidated", async () => {
    const { dispatch } = await import("../../src/core.js");
    const out = await dispatch("novada_capture_apikey", { action: "reset" }, "caller-key-cap");
    expect(mockedPost).not.toHaveBeenCalled();
    const obj = JSON.parse(out) as { status: string; approval_token?: string };
    expect(obj.status).toBe("confirmation_required");
    expect(typeof obj.approval_token).toBe("string");
    expect((obj.approval_token ?? "").length).toBeGreaterThan(0);
  });

  it("GREEN: preview -> approval_token -> execute with IDENTICAL params reaches devApi and forwards the caller apiKey", async () => {
    const { dispatch } = await import("../../src/core.js");
    const preview = await dispatch("novada_capture_apikey", { action: "reset" }, "caller-key-cap");
    const { approval_token } = JSON.parse(preview) as { approval_token: string };
    expect(approval_token).toBeTruthy();
    expect(mockedPost).not.toHaveBeenCalled();

    mockedPost.mockResolvedValueOnce({ code: 0, msg: "ok", data: { api_key: "sk_live_newkey5678" } });
    const executed = await dispatch(
      "novada_capture_apikey",
      { action: "reset", approval_token },
      "caller-key-cap",
    );
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost.mock.calls.at(-1)![0]).toBe("/v1/capture/reset_apikey");
    const obj = JSON.parse(executed) as { status: string };
    expect(obj.status).toBe("ok");

    const opts = mockedPost.mock.calls.at(-1)![2] as { apiKey?: string } | undefined;
    expect(opts?.apiKey).toBe("caller-key-cap");
  });

  it("RED: a token minted for action='reset' does not authorize action='get' (different canonical payload)", async () => {
    const { dispatch } = await import("../../src/core.js");
    const preview = await dispatch("novada_capture_apikey", { action: "reset" }, "caller-key-cap");
    const { approval_token } = JSON.parse(preview) as { approval_token: string };

    // "get" ignores approval_token entirely (no gate on the read path) — this
    // just documents that passing a reset-scoped token to "get" is harmless
    // (get never calls evaluateApprovalGate) rather than silently escalating.
    mockedPost.mockResolvedValueOnce({ code: 0, msg: "ok", data: { api_key: "sk_live_zzzz9999" } });
    const out = await dispatch("novada_capture_apikey", { action: "get", approval_token }, "caller-key-cap");
    expect(mockedPost.mock.calls.at(-1)![0]).toBe("/v1/capture/get_apikey");
    const obj = JSON.parse(out) as { status: string };
    expect(obj.status).toBe("ok");
  });

  it("RED: expired approval_token is rejected on 'reset' execute", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const { dispatch } = await import("../../src/core.js");
    const preview = await dispatch("novada_capture_apikey", { action: "reset" }, "caller-key-cap");
    const { approval_token } = JSON.parse(preview) as { approval_token: string };

    vi.setSystemTime(new Date("2026-01-01T00:11:00.000Z")); // past the 10-minute TTL
    await expect(
      dispatch("novada_capture_apikey", { action: "reset", approval_token }, "caller-key-cap"),
    ).rejects.toThrow();
    expect(mockedPost).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
