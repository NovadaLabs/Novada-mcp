/**
 * Tests for novada_ip_whitelist — caller apiKey forwarding (TOW2-249 review).
 *
 * Asserts the dispatch layer (core.ts) threads the caller apiKey through to
 * devApiPost opts, matching the established sibling pattern (proxy_account_list,
 * proxy_account_create, capture_apikey, static_ip_mgmt).
 *
 * Mocks devApiPost (network) so no real HTTP is made.
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
