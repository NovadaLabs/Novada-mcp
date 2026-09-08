/**
 * Tests for novada_proxy_account_create — caller apiKey forwarding (TOW2-251)
 * PLUS the two-step approval-token gate (F2-2/G-7 fix, 2026-09, W-A1).
 *
 * F2-2: `confirm: true` self-supplied on the FIRST call (no prior preview)
 * used to reach the API immediately — exactly the F2-eval F2-25 scenario
 * ("Create a proxy sub-account called 'teammate1' ... " with confirm:true
 * baked in by the calling agent). That must now be REJECTED before
 * devApiPost is ever called. Only a preview -> approval_token -> execute
 * round-trip may reach devApiPost.
 *
 * Mocks devApiPost (network) but keeps the REAL maskPasswords + the REAL
 * approval.ts (no mock — the gate itself is what's under test here).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/_core/developer_api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/_core/developer_api.js")>();
  return {
    ...actual,            // keep the REAL maskPasswords
    devApiPost: vi.fn(),  // stub only the network call
  };
});

import { devApiPost } from "../../src/_core/developer_api.js";
const mockedPost = vi.mocked(devApiPost);

beforeEach(() => {
  vi.clearAllMocks();
  mockedPost.mockResolvedValue({ id: 999, account: "made", password: "PLAINTEXT" });
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
});

/** Minimal valid create args, no confirm/approval_token — always the preview shape. */
const BASE = {
  product: "1",
  account: "svc_acct",
  password: "hunter2hunter2",
  status: "1",
} as const;

describe("novada_proxy_account_create — approval-token gate (F2-2/G-7)", () => {
  it("F2-2 RED: confirm:true on the FIRST call (F2-25 shape, no approval_token) is REJECTED and NEVER reaches devApi", async () => {
    const { dispatch } = await import("../../src/core.js");
    // Exact F2-eval F2-25 scenario: agent self-supplies confirm:true instead
    // of going through the preview step.
    await expect(
      dispatch(
        "novada_proxy_account_create",
        { product: "1", account: "teammate1", password: "Xk29pQz1", confirm: true },
        "caller-key-1234",
      ),
    ).rejects.toThrow();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("RED: the rejection carries the two-step agent_instruction and isError-compatible shape", async () => {
    const { dispatch } = await import("../../src/core.js");
    let caught: unknown;
    try {
      await dispatch("novada_proxy_account_create", { ...BASE, confirm: true }, "caller-key-1234");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String((caught as Error).message ?? caught)).toMatch(/approved this account creation|not authorized|approval_token/i);
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("without any gate field it never hits the API and returns a preview + approval_token", async () => {
    const { dispatch } = await import("../../src/core.js");
    const out = await dispatch("novada_proxy_account_create", { ...BASE }, "caller-key-1234");
    expect(mockedPost).not.toHaveBeenCalled();
    const obj = JSON.parse(out) as { status: string; approval_token?: string };
    expect(obj.status).toBe("confirmation_required");
    expect(typeof obj.approval_token).toBe("string");
    expect((obj.approval_token ?? "").length).toBeGreaterThan(0);
  });

  it("GREEN: preview -> approval_token -> execute with IDENTICAL params reaches devApi and forwards the caller apiKey", async () => {
    const { dispatch } = await import("../../src/core.js");
    const preview = await dispatch("novada_proxy_account_create", { ...BASE }, "caller-key-1234");
    const { approval_token } = JSON.parse(preview) as { approval_token: string };
    expect(approval_token).toBeTruthy();
    expect(mockedPost).not.toHaveBeenCalled();

    const executed = await dispatch(
      "novada_proxy_account_create",
      { ...BASE, approval_token },
      "caller-key-1234",
    );
    expect(mockedPost).toHaveBeenCalledTimes(1);
    const obj = JSON.parse(executed) as { status: string };
    expect(obj.status).toBe("created");

    const call = mockedPost.mock.calls.at(-1);
    const opts = call![2] as { apiKey?: string } | undefined;
    expect(opts?.apiKey).toBe("caller-key-1234");
  });

  it("falls back to env resolution when no caller apiKey is supplied (execute call)", async () => {
    const { dispatch } = await import("../../src/core.js");
    const preview = await dispatch("novada_proxy_account_create", { ...BASE });
    const { approval_token } = JSON.parse(preview) as { approval_token: string };

    await dispatch("novada_proxy_account_create", { ...BASE, approval_token });
    const call = mockedPost.mock.calls.at(-1);
    expect(call).toBeTruthy();
    const opts = call![2] as { apiKey?: string } | undefined;
    expect(opts?.apiKey).toBeUndefined();
  });

  it("RED: a token minted for one payload is rejected when the execute call changes a field (e.g. password)", async () => {
    const { dispatch } = await import("../../src/core.js");
    const preview = await dispatch("novada_proxy_account_create", { ...BASE }, "caller-key-1234");
    const { approval_token } = JSON.parse(preview) as { approval_token: string };

    await expect(
      dispatch(
        "novada_proxy_account_create",
        { ...BASE, password: "differentpassword1", approval_token },
        "caller-key-1234",
      ),
    ).rejects.toThrow();
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
