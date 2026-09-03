/**
 * Tests for novada_ip_whitelist — caller apiKey forwarding (TOW2-249 review)
 * PLUS the two-step approval-token gate on "add"/"del" (F2-2/G-7 fix,
 * 2026-09, W-A1).
 *
 * F2-2: `confirm: true` self-supplied on the FIRST call (no prior preview)
 * used to reach the API immediately — exactly the F2-eval F2-26 scenario
 * ("Add the IP 89.0.142.86 to the whitelist ..." with confirm:true baked in
 * by the calling agent). That must now be REJECTED before devApiPost is
 * ever called. Only a preview -> approval_token -> execute round-trip may
 * reach devApiPost for a WRITE action. "list" (read-only) is unaffected.
 *
 * Asserts the dispatch layer (core.ts) threads the caller apiKey through to
 * devApiPost opts, matching the established sibling pattern (proxy_account_list,
 * proxy_account_create, capture_apikey, static_ip_mgmt).
 *
 * Mocks devApiPost (network) so no real HTTP is made; the REAL approval.ts
 * gate is exercised (not mocked) since it is what's under test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (before dynamic import) ────────────────────────────────────────────

vi.mock("../../src/_core/developer_api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/_core/developer_api.js")>();
  return {
    ...actual,
    devApiPost: vi.fn(),
  };
});

import { devApiPost } from "../../src/_core/developer_api.js";
const mockedPost = vi.mocked(devApiPost);

// Dynamic import AFTER mock is registered
const { dispatch } = await import("../../src/core.js");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Minimal successful list response shape */
function mockListResponse(): void {
  mockedPost.mockResolvedValueOnce({ code: 0, msg: "ok", data: { list: [], total: 0 } });
}

beforeEach(() => {
  mockedPost.mockReset();
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
});

// ─── apiKey forwarding via dispatch ──────────────────────────────────────────

describe("novada_ip_whitelist — caller apiKey forwarding (dispatch)", () => {
  it("forwards an explicit caller apiKey through to devApiPost opts", async () => {
    mockListResponse();
    await dispatch("novada_ip_whitelist", { action: "list", product: "1" }, "caller-key-ip-1234");
    const call = mockedPost.mock.calls.at(-1);
    expect(call).toBeTruthy();
    const opts = call![2] as { apiKey?: string } | undefined;
    expect(opts?.apiKey).toBe("caller-key-ip-1234");
  });

  it("falls back to env resolution when no caller apiKey is supplied", async () => {
    mockListResponse();
    await dispatch("novada_ip_whitelist", { action: "list", product: "1" });
    const call = mockedPost.mock.calls.at(-1);
    expect(call).toBeTruthy();
    // No caller key → opts.apiKey is undefined; devApiPost resolves from env internally.
    const opts = call![2] as { apiKey?: string } | undefined;
    expect(opts?.apiKey).toBeUndefined();
  });
});

// ─── approval-token gate on "add" / "del" (F2-2 / G-7) ───────────────────────

describe("novada_ip_whitelist — approval-token gate on WRITE actions (F2-2/G-7)", () => {
  it("F2-2 RED: confirm:true on the FIRST call (F2-26 shape, no approval_token) is REJECTED and NEVER reaches devApi", async () => {
    // Exact F2-eval F2-26 scenario: agent self-supplies confirm:true instead
    // of going through the preview step.
    await expect(
      dispatch(
        "novada_ip_whitelist",
        { action: "add", product: "5", ip: "89.0.142.86", confirm: true },
        "caller-key-wl",
      ),
    ).rejects.toThrow();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("RED: confirm:true on 'del' is likewise rejected before devApi", async () => {
    await expect(
      dispatch(
        "novada_ip_whitelist",
        { action: "del", product: "1", ips: "203.0.113.4,203.0.113.5", confirm: true },
        "caller-key-wl",
      ),
    ).rejects.toThrow();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("'add' without any gate field returns a preview + approval_token, no API call", async () => {
    const out = await dispatch("novada_ip_whitelist", { action: "add", product: "1", ip: "203.0.113.7" });
    expect(mockedPost).not.toHaveBeenCalled();
    const obj = JSON.parse(out) as { status: string; approval_token?: string };
    expect(obj.status).toBe("confirmation_required");
    expect(typeof obj.approval_token).toBe("string");
    expect((obj.approval_token ?? "").length).toBeGreaterThan(0);
  });

  it("GREEN: 'add' preview -> approval_token -> execute with IDENTICAL params reaches devApi", async () => {
    const payload = { action: "add" as const, product: "1" as const, ip: "203.0.113.7" };
    const preview = await dispatch("novada_ip_whitelist", { ...payload }, "caller-key-wl");
    const { approval_token } = JSON.parse(preview) as { approval_token: string };
    expect(approval_token).toBeTruthy();
    expect(mockedPost).not.toHaveBeenCalled();

    mockedPost.mockResolvedValueOnce({ code: 0, msg: "ok", data: {} });
    const executed = await dispatch("novada_ip_whitelist", { ...payload, approval_token }, "caller-key-wl");
    expect(mockedPost).toHaveBeenCalledTimes(1);
    const obj = JSON.parse(executed) as { status: string };
    expect(obj.status).toBe("added");

    const call = mockedPost.mock.calls.at(-1);
    const opts = call![2] as { apiKey?: string } | undefined;
    expect(opts?.apiKey).toBe("caller-key-wl");
  });

  it("GREEN: 'del' preview -> approval_token -> execute with IDENTICAL params reaches devApi", async () => {
    const payload = { action: "del" as const, product: "5" as const, ips: "89.0.142.86" };
    const preview = await dispatch("novada_ip_whitelist", { ...payload }, "caller-key-wl");
    const { approval_token } = JSON.parse(preview) as { approval_token: string };
    expect(mockedPost).not.toHaveBeenCalled();

    mockedPost.mockResolvedValueOnce({ code: 0, msg: "ok", data: {} });
    const executed = await dispatch("novada_ip_whitelist", { ...payload, approval_token }, "caller-key-wl");
    expect(mockedPost).toHaveBeenCalledTimes(1);
    const obj = JSON.parse(executed) as { status: string };
    expect(obj.status).toBe("deleted");
  });

  it("RED: a token minted for 'add' with one ip is rejected when the execute call changes the ip", async () => {
    const preview = await dispatch(
      "novada_ip_whitelist",
      { action: "add", product: "1", ip: "203.0.113.7" },
      "caller-key-wl",
    );
    const { approval_token } = JSON.parse(preview) as { approval_token: string };

    await expect(
      dispatch(
        "novada_ip_whitelist",
        { action: "add", product: "1", ip: "203.0.113.99", approval_token },
        "caller-key-wl",
      ),
    ).rejects.toThrow();
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
