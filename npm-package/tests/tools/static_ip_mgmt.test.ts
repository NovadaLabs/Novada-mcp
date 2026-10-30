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
    // staticHouseStatusTotal calls devApiPost INTERNALLY within the same module
    // — a same-module call is NOT intercepted by mocking devApiPost from an
    // external importer (Vitest/esbuild module-mock gotcha, same reason
    // plan_balance_all_not_provisioned.test.ts mocks devApiParallel directly
    // instead of relying on its internal devApiPost calls). Mock it explicitly
    // wherever a test needs to control the expired/released count probes.
    staticHouseStatusTotal: vi.fn(),
  };
});

import { devApiPost, staticHouseStatusTotal } from "../../src/_core/developer_api.js";
const mockedPost = vi.mocked(devApiPost);
const mockedStatusTotal = vi.mocked(staticHouseStatusTotal);

beforeEach(() => {
  mockedPost.mockReset();
  mockedStatusTotal.mockReset();
  // Deterministic default — list/export with status omitted fire 2
  // staticHouseStatusTotal probes unconditionally; without an explicit mock
  // they'd fall through to the REAL (un-interceptable, same-module) devApiPost
  // and depend on the sandbox's network reachability to fail fast. Tests that
  // care about specific counts override this per-test.
  mockedStatusTotal.mockResolvedValue(undefined);
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
    // No explicit status → defaults to "1" (see below), which also fires the
    // two best-effort expired/released count probes (also static_house/list).
    mockedPost.mockResolvedValue({ list: [], total: 0 });
    await dispatch("novada_static_ip_mgmt", { action: "list" }, "caller-key-sip");
    expect(mockedPost.mock.calls[0][0]).toBe("/v1/static_house/list");
  });
});

// ─── Credential redaction + status default (2026-10-30, account-tools-redaction) ───
//
// Incident: list/export echoed a per-IP dial username/password in plaintext
// AND listed every long-expired/released IP by default. Fixed by (1) routing
// `data` through the shared maskCredentials helper and (2) defaulting `status`
// to "1" (in-use) when the caller omits it, with a summary line naming how
// many expired/released IPs exist. Real maskCredentials is exercised (only
// devApiPost is mocked, per the file's existing mock setup).

/** A static_house/list-shaped row carrying a per-IP dial credential pair. */
function ipRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1,
    ip: "203.0.113.4",
    port: 8886,
    region: "frankfurt",
    status: 1,
    expire_time: 1798761600,
    account: "ax0kSJ8snE6wF1mR",
    password: "p3K0rNpsP2iR",
    ...over,
  };
}

describe("novada_static_ip_mgmt — credential redaction (list/export)", () => {
  it("'list' masks account/password in each row; ip/port/region/expiry survive", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });

    const out = await dispatch("novada_static_ip_mgmt", { action: "list", status: "1" }, "caller-key-sip");
    expect(out).not.toContain("ax0kSJ8snE6wF1mR");
    expect(out).not.toContain("p3K0rNpsP2iR");

    const obj = JSON.parse(out) as { data: { list: Array<Record<string, unknown>> } };
    const row = obj.data.list[0];
    expect(row.account).toBe("<PROXY_USER>");
    expect(row.password).toBe("***");
    expect(row.ip).toBe("203.0.113.4");
    expect(row.port).toBe(8886);
    expect(row.region).toBe("frankfurt");
    expect(row.expire_time).toBe(1798761600);
  });

  it("'export' masks account/password the same way", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });

    const out = await dispatch("novada_static_ip_mgmt", { action: "export", status: "1" }, "caller-key-sip");
    expect(out).not.toContain("ax0kSJ8snE6wF1mR");
    expect(out).not.toContain("p3K0rNpsP2iR");
    const obj = JSON.parse(out) as { data: { list: Array<Record<string, unknown>> } };
    expect(obj.data.list[0].account).toBe("<PROXY_USER>");
    expect(obj.data.list[0].password).toBe("***");
  });

  it("MIRROR: a lookalike field (e.g. password_updated_at) is not touched", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({
      list: [ipRow({ password_updated_at: "2026-10-01" })],
      total: 1,
    });
    const out = await dispatch("novada_static_ip_mgmt", { action: "list", status: "1" }, "caller-key-sip");
    const obj = JSON.parse(out) as { data: { list: Array<Record<string, unknown>> } };
    expect(obj.data.list[0].password_updated_at).toBe("2026-10-01");
  });
});

describe("novada_static_ip_mgmt — status default to in-use (2026-10-30)", () => {
  it("'list' with no status forwards status:\"1\" to the server and reports expired/released counts", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });
    // staticHouseStatusTotal's internal devApiPost call is NOT reachable
    // through mockedPost (same-module call, see the mock-factory comment
    // above) — mock the exported count helper directly.
    mockedStatusTotal.mockImplementation(async (status: "2" | "3") =>
      status === "2" ? 3 : 5,
    );

    const out = await dispatch("novada_static_ip_mgmt", { action: "list" }, "caller-key-sip");
    const obj = JSON.parse(out) as { status: string; summary?: string; data: { total: number } };
    expect(obj.status).toBe("ok");
    expect(obj.data.total).toBe(1);
    expect(obj.summary).toContain("3 expired");
    expect(obj.summary).toContain("5 released");
    expect(obj.summary).toContain('status:"2"');
    expect(obj.summary).toContain('status:"3"');

    // Main call used the forced default; the 2 count-only probes went through
    // staticHouseStatusTotal, not a second/third direct devApiPost call.
    const mainCall = mockedPost.mock.calls.find((c) => (c[1] as Record<string, unknown>).status === "1");
    expect(mainCall).toBeTruthy();
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedStatusTotal).toHaveBeenCalledWith("2", "caller-key-sip");
    expect(mockedStatusTotal).toHaveBeenCalledWith("3", "caller-key-sip");
  });

  it("'export' with no status also defaults to \"1\" and appends a summary", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });
    mockedStatusTotal.mockImplementation(async (status: "2" | "3") =>
      status === "2" ? 2 : 0,
    );

    const out = await dispatch("novada_static_ip_mgmt", { action: "export" }, "caller-key-sip");
    const obj = JSON.parse(out) as { summary?: string };
    // A genuine 0 count is still reported (it confirms the probe succeeded,
    // distinct from an undefined count when the probe itself failed/errored).
    expect(obj.summary).toContain("2 expired");
    expect(obj.summary).toContain("0 released");
  });

  it("explicit status:\"\" (all) is honored exactly — no forcing, no extra count probes", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [ipRow({ status: 2 })], total: 1 });

    const out = await dispatch("novada_static_ip_mgmt", { action: "list", status: "" }, "caller-key-sip");
    const obj = JSON.parse(out) as { summary?: string };
    expect(obj.summary).toBeUndefined();
    expect(mockedPost).toHaveBeenCalledTimes(1);
    const call = mockedPost.mock.calls.at(-1)!;
    expect((call[1] as Record<string, unknown>).status).toBe("");
  });

  it("explicit status:\"2\" (expired) is honored exactly — no default, no extra probes", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [ipRow({ status: 2 })], total: 1 });

    await dispatch("novada_static_ip_mgmt", { action: "list", status: "2" }, "caller-key-sip");
    expect(mockedPost).toHaveBeenCalledTimes(1);
    const call = mockedPost.mock.calls.at(-1)!;
    expect((call[1] as Record<string, unknown>).status).toBe("2");
  });
});
