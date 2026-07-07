/**
 * Tests for novada_proxy_account_create — caller apiKey forwarding (TOW2-251).
 *
 * Confirm-gated WRITE tool: only forwards to devApiPost when `confirm: true`.
 * Asserts the dispatch layer (core.ts:725) threads the caller apiKey through to
 * devApiPost opts, matching the sibling proxy_account_list / capture_apikey.
 *
 * Mocks devApiPost (network) but keeps the REAL maskPasswords.
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
});

/** Minimal valid confirmed create args. */
const CONFIRMED = {
  product: "1",
  account: "svc_acct",
  password: "hunter2hunter2",
  status: "1",
  confirm: true,
} as const;

describe("novada_proxy_account_create — caller apiKey forwarding (dispatch)", () => {
  it("forwards an explicit caller apiKey through to devApiPost opts (confirmed create)", async () => {
    const { dispatch } = await import("../../src/core.js");
    await dispatch("novada_proxy_account_create", { ...CONFIRMED }, "caller-key-1234");
    const call = mockedPost.mock.calls.at(-1);
    expect(call).toBeTruthy();
    const opts = call![2] as { apiKey?: string } | undefined;
    expect(opts?.apiKey).toBe("caller-key-1234");
  });

  it("falls back to env resolution when no caller apiKey is supplied", async () => {
    const { dispatch } = await import("../../src/core.js");
    await dispatch("novada_proxy_account_create", { ...CONFIRMED });
    const call = mockedPost.mock.calls.at(-1);
    expect(call).toBeTruthy();
    const opts = call![2] as { apiKey?: string } | undefined;
    expect(opts?.apiKey).toBeUndefined();
  });

  it("without confirm=true it never hits the API (preview only) — no key leak path", async () => {
    const { dispatch } = await import("../../src/core.js");
    const { confirm, ...unconfirmed } = CONFIRMED;
    void confirm;
    const out = await dispatch("novada_proxy_account_create", unconfirmed, "caller-key-1234");
    expect(mockedPost).not.toHaveBeenCalled();
    const obj = JSON.parse(out) as { status: string };
    expect(obj.status).toBe("confirmation_required");
  });
});
