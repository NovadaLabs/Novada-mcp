/**
 * Tests for novada_static_ip_mgmt — two-step approval-token gate on
 * "open"/"renew" (F2-2/G-7 fix, 2026-09, W-A1).
 *
 * F2-2 (V4-corrected, worse than the first-pass finding): the F2-eval
 * recovery agent R9 self-supplied `confirm: true` on a PURCHASE of 3 static
 * IPs while "fixing" an unrelated ip_type enum error — a self-authorized
 * spend with no prior human-reviewed preview. That shape (and the
 * first-contact equivalent, F2-28-with-confirm) must now be REJECTED before
 * devApiPost is ever called. Only a preview -> approval_token -> execute
 * round-trip may reach devApiPost for a WRITE action. "list"/"export"
 * (read-only) are unaffected and untested here (no gate change).
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

const OPEN_PAYLOAD = {
  action: "open" as const,
  ip_type: "normal" as const,
  region: "frankfurt",
  duration: "month" as const,
  num: 3,
};

const RENEW_PAYLOAD = {
  action: "renew" as const,
  renew_ip_list: "203.0.113.4,203.0.113.5",
  duration: "week" as const,
};

describe("novada_static_ip_mgmt — approval-token gate on 'open' (F2-2/G-7)", () => {
  it("F2-2 RED: confirm:true self-supplied on a PURCHASE (F2-eval R9 shape, no approval_token) is REJECTED and NEVER reaches devApi", async () => {
    const { dispatch } = await import("../../src/core.js");
    await expect(
      dispatch("novada_static_ip_mgmt", { ...OPEN_PAYLOAD, confirm: true }, "caller-key-sip"),
    ).rejects.toThrow();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("'open' without any gate field returns a preview + approval_token, no purchase made", async () => {
    const { dispatch } = await import("../../src/core.js");
    const out = await dispatch("novada_static_ip_mgmt", { ...OPEN_PAYLOAD }, "caller-key-sip");
    expect(mockedPost).not.toHaveBeenCalled();
    const obj = JSON.parse(out) as { status: string; approval_token?: string };
    expect(obj.status).toBe("confirmation_required");
    expect(typeof obj.approval_token).toBe("string");
    expect((obj.approval_token ?? "").length).toBeGreaterThan(0);
  });

  it("GREEN: preview -> approval_token -> execute with IDENTICAL params reaches devApi and forwards the caller apiKey", async () => {
    const { dispatch } = await import("../../src/core.js");
    const preview = await dispatch("novada_static_ip_mgmt", { ...OPEN_PAYLOAD }, "caller-key-sip");
    const { approval_token } = JSON.parse(preview) as { approval_token: string };
    expect(approval_token).toBeTruthy();
    expect(mockedPost).not.toHaveBeenCalled();

    mockedPost.mockResolvedValueOnce({ code: 0, msg: "ok", data: { opened: 3 } });
    const executed = await dispatch(
      "novada_static_ip_mgmt",
      { ...OPEN_PAYLOAD, approval_token },
      "caller-key-sip",
    );
    expect(mockedPost).toHaveBeenCalledTimes(1);
    const obj = JSON.parse(executed) as { status: string };
    expect(obj.status).toBe("opened");

    const call = mockedPost.mock.calls.at(-1);
    expect(call![0]).toBe("/v1/static_house/open");
    const opts = call![2] as { apiKey?: string } | undefined;
    expect(opts?.apiKey).toBe("caller-key-sip");
  });

  it("RED: a token minted for num=3 is rejected when the execute call changes num (spend amount tampering)", async () => {
    const { dispatch } = await import("../../src/core.js");
    const preview = await dispatch("novada_static_ip_mgmt", { ...OPEN_PAYLOAD }, "caller-key-sip");
    const { approval_token } = JSON.parse(preview) as { approval_token: string };

    await expect(
      dispatch(
        "novada_static_ip_mgmt",
        { ...OPEN_PAYLOAD, num: 30, approval_token },
        "caller-key-sip",
      ),
    ).rejects.toThrow();
    expect(mockedPost).not.toHaveBeenCalled();
  });
});

describe("novada_static_ip_mgmt — approval-token gate on 'renew' (F2-2/G-7)", () => {
  it("RED: confirm:true self-supplied on a renew is REJECTED and NEVER reaches devApi", async () => {
    const { dispatch } = await import("../../src/core.js");
    await expect(
      dispatch("novada_static_ip_mgmt", { ...RENEW_PAYLOAD, confirm: true }, "caller-key-sip"),
    ).rejects.toThrow();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("GREEN: 'renew' preview -> approval_token -> execute reaches devApi", async () => {
    const { dispatch } = await import("../../src/core.js");
    const preview = await dispatch("novada_static_ip_mgmt", { ...RENEW_PAYLOAD }, "caller-key-sip");
    const { approval_token } = JSON.parse(preview) as { approval_token: string };
    expect(mockedPost).not.toHaveBeenCalled();

    mockedPost.mockResolvedValueOnce({ code: 0, msg: "ok", data: {} });
    const executed = await dispatch(
      "novada_static_ip_mgmt",
      { ...RENEW_PAYLOAD, approval_token },
      "caller-key-sip",
    );
    expect(mockedPost).toHaveBeenCalledTimes(1);
    const obj = JSON.parse(executed) as { status: string };
    expect(obj.status).toBe("renewed");
  });
});

describe("novada_static_ip_mgmt — read-only actions unaffected by the gate", () => {
  it("'list' never requires approval_token and always calls devApi directly", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValueOnce({ code: 0, msg: "ok", data: { list: [], total: 0 } });
    await dispatch("novada_static_ip_mgmt", { action: "list" }, "caller-key-sip");
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost.mock.calls.at(-1)![0]).toBe("/v1/static_house/list");
  });
});
