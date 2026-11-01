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

// ─── reveal_credentials (2026-11-01, owner decision option A) ──────────────
//
// A user who explicitly asks can get REAL static-ISP dial credentials
// through a two-step approval-token flow (reusing evaluateApprovalGate, the
// same mechanism as "open"/"renew"). Preview shows masked IP/port/region/
// expiry only; execute shows the real username/password + two ready-to-paste
// formats. "list"/"export" (tested above) stay masked — no regression.

describe("novada_static_ip_mgmt — reveal_credentials (2026-11-01, owner decision option A)", () => {
  it("preview (no approval_token): masked rows (ip/port/region/expiry only), count, and an approval_token; no credentials anywhere in the output", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });

    const out = await dispatch("novada_static_ip_mgmt", { action: "reveal_credentials", status: "1" }, "caller-key-sip");
    expect(out).not.toContain("ax0kSJ8snE6wF1mR");
    expect(out).not.toContain("p3K0rNpsP2iR");

    const obj = JSON.parse(out) as {
      status: string;
      approval_token?: string;
      preview: { count: number; rows: Array<Record<string, unknown>> };
    };
    expect(obj.status).toBe("confirmation_required");
    expect(typeof obj.approval_token).toBe("string");
    expect((obj.approval_token ?? "").length).toBeGreaterThan(0);
    expect(obj.preview.count).toBe(1);
    const row = obj.preview.rows[0];
    expect(row.ip).toBe("203.0.113.4");
    expect(row.port).toBe(8886);
    expect(row.region).toBe("frankfurt");
    expect(row.expire_time).toBe(1798761600);
    expect(row.account).toBeUndefined();
    expect(row.password).toBeUndefined();
  });

  it("GREEN: preview -> approval_token -> execute reveals real credentials + both ready-to-paste formats", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });

    const preview = await dispatch("novada_static_ip_mgmt", { action: "reveal_credentials", status: "1" }, "caller-key-sip");
    const { approval_token } = JSON.parse(preview) as { approval_token: string };
    expect(approval_token).toBeTruthy();

    const executed = await dispatch(
      "novada_static_ip_mgmt",
      { action: "reveal_credentials", status: "1", approval_token },
      "caller-key-sip",
    );
    expect(mockedPost).toHaveBeenCalledTimes(2); // 1 preview fetch + 1 execute fetch
    const obj = JSON.parse(executed) as { status: string; count: number; rows: Array<Record<string, unknown>> };
    expect(obj.status).toBe("ok");
    expect(obj.count).toBe(1);
    const row = obj.rows[0];
    expect(row.ip).toBe("203.0.113.4");
    expect(row.port).toBe(8886);
    expect(row.username).toBe("ax0kSJ8snE6wF1mR");
    expect(row.password).toBe("p3K0rNpsP2iR");
    expect(row.dial_string).toBe("203.0.113.4:8886:ax0kSJ8snE6wF1mR:p3K0rNpsP2iR");
    expect(row.proxy_url).toBe("http://ax0kSJ8snE6wF1mR:p3K0rNpsP2iR@203.0.113.4:8886");
  });

  it("RED: confirm:true self-supplied on reveal_credentials (no approval_token) is REJECTED and never reveals credentials", async () => {
    const { dispatch } = await import("../../src/core.js");
    await expect(
      dispatch("novada_static_ip_mgmt", { action: "reveal_credentials", confirm: true }, "caller-key-sip"),
    ).rejects.toThrow();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("RED: a token minted for key_word=\"a\" is rejected when the execute call widens key_word (filter-widening tamper)", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });

    const preview = await dispatch(
      "novada_static_ip_mgmt",
      { action: "reveal_credentials", key_word: "a" },
      "caller-key-sip",
    );
    const { approval_token } = JSON.parse(preview) as { approval_token: string };

    await expect(
      dispatch(
        "novada_static_ip_mgmt",
        { action: "reveal_credentials", key_word: "", approval_token },
        "caller-key-sip",
      ),
    ).rejects.toThrow();
    // Only the 1 preview fetch happened — the widened execute call never reached devApi.
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it("RED: a token minted for limit=10 is rejected when the execute call widens limit to 50 (quantity-widening tamper)", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });

    const preview = await dispatch(
      "novada_static_ip_mgmt",
      { action: "reveal_credentials", limit: 10 },
      "caller-key-sip",
    );
    const { approval_token } = JSON.parse(preview) as { approval_token: string };

    await expect(
      dispatch(
        "novada_static_ip_mgmt",
        { action: "reveal_credentials", limit: 50, approval_token },
        "caller-key-sip",
      ),
    ).rejects.toThrow();
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it("limit is capped at 50 regardless of a higher requested value, on both preview and execute, and the response says so", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });

    const preview = await dispatch(
      "novada_static_ip_mgmt",
      { action: "reveal_credentials", limit: 200 },
      "caller-key-sip",
    );
    const previewObj = JSON.parse(preview) as { preview: { limit_capped_to?: number }; approval_token: string };
    expect(previewObj.preview.limit_capped_to).toBe(50);
    expect((mockedPost.mock.calls[0][1] as Record<string, unknown>).limit).toBe(50);

    const executed = await dispatch(
      "novada_static_ip_mgmt",
      { action: "reveal_credentials", limit: 200, approval_token: previewObj.approval_token },
      "caller-key-sip",
    );
    const execObj = JSON.parse(executed) as { limit_capped_to?: number };
    expect(execObj.limit_capped_to).toBe(50);
    expect((mockedPost.mock.calls[1][1] as Record<string, unknown>).limit).toBe(50);
  });

  it("no status filter defaults to \"1\" (in-use), same as list", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });

    await dispatch("novada_static_ip_mgmt", { action: "reveal_credentials" }, "caller-key-sip");
    expect((mockedPost.mock.calls[0][1] as Record<string, unknown>).status).toBe("1");
  });

  // DONE-DEFINITION: "does a credential leak into the error text on an
  // upstream failure for the execute call?" sanitizeServerMsg (errors.ts) is
  // ALREADY proven to mask a bare JSON-shaped `{"account":"..."}` fragment —
  // see tests/errors.test.ts's "masks a JSON-shaped 'account' field" (added
  // 2026-10-30 for this exact credential family) — and that masking happens
  // INSIDE the real devApiPost, before it ever throws. This file mocks
  // devApiPost at the module level (so it CANNOT exercise that real
  // sanitization pass — asserting on it here would be testing the mock, not
  // the product), so what THIS handler must prove instead is narrower but
  // just as load-bearing: it does not wrap/rewrap/reconstruct the error with
  // any raw interpolation of its own. Whatever devApiPost throws (already
  // sanitized in production) propagates verbatim — exactly like "list"/
  // "export"/"open"/"renew" already do, with no new error-formatting surface
  // introduced for "reveal_credentials".
  it("DONE-DEFINITION: an upstream failure on the execute call propagates devApiPost's own (already-sanitized) error verbatim — no new interpolation in the handler", async () => {
    const { dispatch } = await import("../../src/core.js");
    const upstreamError = new Error("Developer-api rejected request (code=10001): already sanitized by devApiPost");
    mockedPost
      .mockResolvedValueOnce({ list: [ipRow({})], total: 1 })
      .mockRejectedValueOnce(upstreamError);

    const preview = await dispatch("novada_static_ip_mgmt", { action: "reveal_credentials" }, "caller-key-sip");
    const { approval_token } = JSON.parse(preview) as { approval_token: string };

    await expect(
      dispatch("novada_static_ip_mgmt", { action: "reveal_credentials", approval_token }, "caller-key-sip"),
    ).rejects.toThrow(upstreamError.message);
  });
});

// ─── reveal_credentials — MCP elicitation path (2026-11-01 follow-up) ──────
//
// Independent security review, finding HIGH-1: the approval_token round-trips
// through the AGENT, so a prompt-injected or careless agent could call twice
// itself with no human in the loop. When the connected MCP client advertises
// elicitation, the stdio server (index.ts) builds an `elicitConfirm` callback
// from the live Server's getClientCapabilities()/elicitInput() and threads it
// through dispatch()'s ctx -> novadaStaticIpMgmt -> handleRevealCredentials.
// These tests exercise that plumbing end-to-end via dispatch() with a FAKE
// elicitConfirm (no real MCP transport/SDK mocking needed — proves the
// dependency-injection seam is clean and testable, per the review's ask).
//
// When elicitConfirm is supplied, it is the ONLY confirmation mechanism:
// approval_token is never read, so a pre-minted/replayed token cannot bypass
// the human-in-the-loop step — these tests assert elicitConfirm is always
// invoked regardless of what else the caller passes.

describe("novada_static_ip_mgmt — reveal_credentials via MCP elicitation (2026-11-01 follow-up)", () => {
  it("accept: reveals real credentials, calls devApiPost exactly ONCE (no second agent-initiated call needed), and the elicit message names the count", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });

    const elicitConfirm = vi.fn(async (_message: string) => "accept" as const);
    const out = await dispatch(
      "novada_static_ip_mgmt",
      { action: "reveal_credentials", status: "1" },
      "caller-key-sip",
      { elicitConfirm },
    );

    expect(mockedPost).toHaveBeenCalledTimes(1); // ONE upstream call total, not preview+execute
    expect(elicitConfirm).toHaveBeenCalledTimes(1);
    expect(elicitConfirm.mock.calls[0][0]).toContain("1 static ISP IP");

    const obj = JSON.parse(out) as { status: string; count: number; rows: Array<Record<string, unknown>> };
    expect(obj.status).toBe("ok");
    expect(obj.count).toBe(1);
    expect(obj.rows[0].username).toBe("ax0kSJ8snE6wF1mR");
    expect(obj.rows[0].password).toBe("p3K0rNpsP2iR");
    expect(obj.rows[0].dial_string).toBe("203.0.113.4:8886:ax0kSJ8snE6wF1mR:p3K0rNpsP2iR");
  });

  it("decline: NO credentials anywhere in the output; clear non-throwing 'declined' response", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });

    const elicitConfirm = vi.fn(async () => "decline" as const);
    const out = await dispatch(
      "novada_static_ip_mgmt",
      { action: "reveal_credentials" },
      "caller-key-sip",
      { elicitConfirm },
    );

    expect(elicitConfirm).toHaveBeenCalledTimes(1);
    expect(out).not.toContain("ax0kSJ8snE6wF1mR");
    expect(out).not.toContain("p3K0rNpsP2iR");
    const obj = JSON.parse(out) as { status: string; decision: string };
    expect(obj.status).toBe("declined");
    expect(obj.decision).toBe("decline");
  });

  it("cancel: NO credentials anywhere in the output; distinguishable from decline", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });

    const elicitConfirm = vi.fn(async () => "cancel" as const);
    const out = await dispatch(
      "novada_static_ip_mgmt",
      { action: "reveal_credentials" },
      "caller-key-sip",
      { elicitConfirm },
    );

    expect(out).not.toContain("ax0kSJ8snE6wF1mR");
    const obj = JSON.parse(out) as { status: string; decision: string };
    expect(obj.status).toBe("declined");
    expect(obj.decision).toBe("cancel");
  });

  it("elicit throws (transport/client error): fails CLOSED — NO credentials, no unhandled rejection", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });

    const elicitConfirm = vi.fn(async () => {
      throw new Error("client does not support form elicitation");
    });
    const out = await dispatch(
      "novada_static_ip_mgmt",
      { action: "reveal_credentials" },
      "caller-key-sip",
      { elicitConfirm },
    );

    expect(out).not.toContain("ax0kSJ8snE6wF1mR");
    const obj = JSON.parse(out) as { status: string; decision: string };
    expect(obj.status).toBe("declined");
    expect(obj.decision).toBe("error");
  });

  it("TOKEN-BYPASS ATTEMPT: a pre-minted approval_token does NOT bypass elicitation when the capability is present — elicitConfirm is still invoked and a decline still yields no credentials", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });

    // Mint a token the normal (no-capability) way first, as an agent attempting
    // to short-circuit the flow might try to carry forward.
    const preview = await dispatch("novada_static_ip_mgmt", { action: "reveal_credentials" }, "caller-key-sip");
    const { approval_token } = JSON.parse(preview) as { approval_token: string };
    mockedPost.mockClear();
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });

    const elicitConfirm = vi.fn(async () => "decline" as const);
    const out = await dispatch(
      "novada_static_ip_mgmt",
      { action: "reveal_credentials", approval_token }, // a syntactically-valid token supplied anyway
      "caller-key-sip",
      { elicitConfirm },
    );

    // elicitConfirm was STILL invoked — the token had zero effect on the flow.
    expect(elicitConfirm).toHaveBeenCalledTimes(1);
    expect(out).not.toContain("ax0kSJ8snE6wF1mR");
    const obj = JSON.parse(out) as { status: string };
    expect(obj.status).toBe("declined");
  });

  it("no elicitation capability (ctx omitted): unchanged approval_token fallback still applies", async () => {
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });

    // No ctx at all — exactly how every pre-existing test in this file calls dispatch().
    const out = await dispatch("novada_static_ip_mgmt", { action: "reveal_credentials" }, "caller-key-sip");
    const obj = JSON.parse(out) as { status: string; approval_token?: string };
    expect(obj.status).toBe("confirmation_required");
    expect(typeof obj.approval_token).toBe("string");
  });
});

// ─── hosted action-level refusal for "open"/"renew"/"reveal_credentials" (2026-11-01, FINAL) ─
//
// novada_static_ip_mgmt is no longer HOSTED_HIDDEN as a whole tool (see
// hosted-server/vercel/api/mcp.ts's HOSTED_HIDDEN set) — "list"/"export" are
// dispatchable on a hosted runtime like any other tool. "open"/"renew"
// (billable WRITE actions never ported to hosted) and, per the 2026-11-01
// FINAL owner decision, "reveal_credentials" (real dial credentials need a
// human-in-the-loop confirmation — MCP elicitation — that the stateless
// hosted endpoint cannot perform; an agent-carried approval_token alone is
// not an acceptable substitute) are ALL refused, at the ACTION level, BEFORE
// the approval gate, elicitation, or any devApiPost call runs.
//
// Table-driven across all three actions (mirrors HOSTED_REFUSED_ACTIONS in
// src/tools/static_ip_mgmt.ts itself) — a 4th hosted-refused action later
// extends this table, not a new describe block.

const HOSTED_REFUSED_CASES: ReadonlyArray<{
  action: "open" | "renew" | "reveal_credentials";
  payload: Record<string, unknown>;
}> = [
  { action: "open", payload: OPEN_PAYLOAD },
  { action: "renew", payload: RENEW_PAYLOAD },
  { action: "reveal_credentials", payload: { action: "reveal_credentials" } },
];

describe.each(HOSTED_REFUSED_CASES)(
  "novada_static_ip_mgmt — hosted action-level refusal: action=$action (2026-11-01, final)",
  ({ payload }) => {
    it("is refused BEFORE the approval gate runs — confirm:true never reaches the gate's own rejection", async () => {
      process.env.VERCEL = "1";
      const { dispatch } = await import("../../src/core.js");
      await expect(
        dispatch("novada_static_ip_mgmt", { ...payload, confirm: true }, "caller-key-sip"),
      ).rejects.toThrow(/not available on the hosted/);
      expect(mockedPost).not.toHaveBeenCalled();
    });

    it("is refused even with no approval_token/confirm at all (never returns a preview on hosted)", async () => {
      process.env.VERCEL = "1";
      const { dispatch } = await import("../../src/core.js");
      await expect(
        dispatch("novada_static_ip_mgmt", { ...payload }, "caller-key-sip"),
      ).rejects.toThrow(/not available on the hosted/);
      expect(mockedPost).not.toHaveBeenCalled();
    });

    it("is refused on hosted WITHOUT ever invoking elicitConfirm, even when ctx supplies one (hosted never has a real elicitation-capable client; a supplied callback must still never fire)", async () => {
      process.env.VERCEL = "1";
      const { dispatch } = await import("../../src/core.js");
      const elicitConfirm = vi.fn(async () => "accept" as const);
      await expect(
        dispatch("novada_static_ip_mgmt", { ...payload }, "caller-key-sip", { elicitConfirm }),
      ).rejects.toThrow(/not available on the hosted/);
      expect(mockedPost).not.toHaveBeenCalled();
      expect(elicitConfirm).not.toHaveBeenCalled();
    });

    it("is UNAFFECTED locally (no VERCEL/AWS_LAMBDA env) — preview still works", async () => {
      const { dispatch } = await import("../../src/core.js");
      mockedPost.mockResolvedValue({ list: [], total: 0 });
      const out = await dispatch("novada_static_ip_mgmt", { ...payload }, "caller-key-sip");
      const obj = JSON.parse(out) as { status: string };
      expect(obj.status).toBe("confirmation_required");
    });
  },
);

describe("novada_static_ip_mgmt — hosted: list/export remain available (only open/renew/reveal_credentials are refused)", () => {
  it("'list' remains available on a hosted runtime", async () => {
    process.env.VERCEL = "1";
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [], total: 0 });
    const out = await dispatch("novada_static_ip_mgmt", { action: "list" }, "caller-key-sip");
    const obj = JSON.parse(out) as { status: string };
    expect(obj.status).toBe("ok");
  });

  it("'export' remains available on a hosted runtime", async () => {
    process.env.VERCEL = "1";
    const { dispatch } = await import("../../src/core.js");
    mockedPost.mockResolvedValue({ list: [], total: 0 });
    const out = await dispatch("novada_static_ip_mgmt", { action: "export" }, "caller-key-sip");
    const obj = JSON.parse(out) as { status: string };
    expect(obj.status).toBe("ok");
  });
});

// ─── reveal_credentials description accuracy (2026-11-01, local-only wording) ─
//
// The model-facing description must not claim reveal_credentials is reachable
// on hosted, and must name BOTH confirmation paths available locally: a
// single elicitation-confirmed call (elicitation-capable clients) and the
// preview+approval_token two-step (every other local client).

describe("novada_static_ip_mgmt — reveal_credentials description accuracy (2026-11-01, local-only)", () => {
  it("the action enum's own .describe() text says reveal_credentials is local-MCP-server-only and names both confirmation paths", async () => {
    const { StaticIpMgmtParamsSchema } = await import("../../src/tools/static_ip_mgmt.js");
    const description = StaticIpMgmtParamsSchema.shape.action.description ?? "";
    expect(description).toMatch(/"reveal_credentials"[^.]*local MCP server only/i);
    expect(description).toMatch(/not available on the hosted endpoint/i);
    expect(description).toMatch(/elicitation-capable[^.]*single call confirmed by the human user in a dialog/i);
    expect(description).toMatch(/approval_token two-step/i);
  });

  it("core.ts's top-level TOOLS description for novada_static_ip_mgmt does not claim reveal_credentials is reachable on hosted", async () => {
    const { TOOLS } = await import("../../src/core.js");
    const tool = TOOLS.find((t) => t.name === "novada_static_ip_mgmt");
    expect(tool).toBeDefined();
    const description = tool!.description;
    // Must not describe reveal_credentials as hosted-reachable (the stale
    // pre-2026-11-01-final claim this test guards against regressing to).
    expect(description).not.toMatch(/reveal_credentials["'`]?\s+(?:are|is)\s+(?:also\s+)?(?:reachable|available|served)\s+on\s+(?:the\s+)?hosted/i);
  });
});

// ─── local saveOutput skip (2026-11-01, Done-definition) ───────────────────
//
// reveal_credentials' real-credential response must NEVER be written to disk
// via the npm package's output auto-save (~/Downloads/novada-mcp/...,
// utils/output.ts's saveOutput). static_ip_mgmt.ts does not call saveOutput
// for ANY action — this is a structural (import-level) guarantee, not a
// runtime branch, so it is asserted as a source-level drift guard: if a
// future edit ever wires any static_ip_mgmt action to saveOutput, this test
// fails immediately and must be re-reviewed for the reveal_credentials case
// specifically.
describe("novada_static_ip_mgmt — reveal_credentials output is never auto-saved to disk", () => {
  it("static_ip_mgmt.ts does not import or call saveOutput (structural skip)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve(__dirname, "../../src/tools/static_ip_mgmt.ts"),
      "utf-8",
    );
    expect(src).not.toMatch(/saveOutput/);
    expect(src).not.toMatch(/from ["']\.\.\/utils\/output\.js["']/);
  });
});
