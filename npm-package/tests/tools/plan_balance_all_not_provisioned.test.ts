/**
 * TDD for the "not provisioned" misclassification bug (fix/account-not-provisioned).
 *
 * ROOT CAUSE (confirmed via a real live capture, residential + isp + datacenter):
 * a flow-balance endpoint for a plan the account LACKS returns HTTP 200 with
 * envelope `{ code: 11009, msg: "Failed to obtain user information" }`. Plans the
 * account HAS (mobile, capture) return `code: 0, "success"`.
 *
 * devApiPost's final branch throws INVALID_PARAMS for ANY non-{0,40002,11000,
 * 10002,401} code, so code=11009 was indistinguishable from a genuine parameter
 * error. plan_balance_all.ts's classifier only recognized the MESSAGE substrings
 * "Product not provisioned" / "HTTP 404" (the 404 path) — 11009's message
 * ("Developer-api rejected request (code=11009): Failed to obtain user
 * information") matches neither, so it fell through to a bare "error" — and
 * because plan_balance_all.ts ALSO unconditionally pushed every failing product
 * into `errors[]` (even ones later flagged `unavailable`), a not-provisioned
 * product produced a CONTRADICTORY double signal downstream: the plan table
 * showed "⛔ not provisioned" (once the classifier is fixed) while account.ts's
 * errors-list literally printed "service error" for the same product (since its
 * string-based suppression doesn't match a "code=11009" message either).
 *
 * THE CLASS: "not provisioned" = { HTTP 404 (existing), business code 11009
 * (new) }. 11009 is shared across all flow products, so ONE code check covers
 * residential/isp/mobile/datacenter (capture uses a different endpoint but the
 * same envelope shape would apply identically).
 *
 * This suite proves, through the REAL account.ts -> plan_balance_all.ts ->
 * devApiParallel chain (only devApiParallel/devApiPost are mocked — no tool-level
 * mocking of plan_balance_all.js or account.js):
 *   1. plan_balance_all classifies code=11009 as `unavailable`, not a bare error,
 *      and does NOT also list it in `errors[]` (single consistent signal).
 *   2. novadaAccount(section="plans"/"summary") renders "not provisioned" and
 *      never emits "service error" for the same product.
 *   3. A DIFFERENT non-zero code (10001) stays a genuine error — guards against
 *      over-broadening the classifier to the whole non-zero-code space.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (before dynamic import) ────────────────────────────────────────────
// Keep the REAL plan_balance_all.ts / account_summary.ts / account.ts business
// logic; stub only the network-facing devApiParallel/devApiPost calls.

vi.mock("../../src/_core/developer_api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/_core/developer_api.js")>();
  return {
    ...actual,
    devApiParallel: vi.fn(),
    // Only reached by plan_balance_all's static_house/list fallback when the
    // "summary" section queries ALL products (no `products` filter). Stub a
    // harmless empty-list response so that leg never hits the network.
    devApiPost: vi.fn().mockResolvedValue({ list: [], total: 0 }),
  };
});

// Sibling sections used by novadaAccount(section="summary") — stub these at the
// tool level (not the concern of this bug) so only the plan-balance leg is real.
vi.mock("../../src/tools/wallet_balance.js", () => ({
  novadaWalletBalance: vi.fn().mockResolvedValue(
    JSON.stringify({ status: "ok", data: { balance: 100, currency: "€" } }),
  ),
}));
vi.mock("../../src/tools/capture_logs.js", () => ({
  novadaCaptureLogs: vi.fn().mockResolvedValue(
    JSON.stringify({ status: "ok", data: { list: [] } }),
  ),
}));
vi.mock("../../src/tools/health.js", () => ({
  novadaHealth: vi.fn().mockResolvedValue("## health\n"),
}));

import { devApiParallel } from "../../src/_core/developer_api.js";
import { novadaPlanBalanceAll } from "../../src/tools/plan_balance_all.js";
import { novadaAccount, validateAccountParams } from "../../src/tools/account.js";

const mockedParallel = vi.mocked(devApiParallel);

beforeEach(() => {
  vi.clearAllMocks();
  mockedParallel.mockReset();
});

/** Real captured shape (2026-08, live capture): HTTP 200, business code 11009 —
 *  confirmed for residential/isp/datacenter when the account has no such plan. */
const CODE_11009_ERROR =
  "Developer-api rejected request (code=11009): Failed to obtain user information";

// ─── 1. plan_balance_all classifier ──────────────────────────────────────────

describe("plan_balance_all — code=11009 classified as unavailable, not a bare error", () => {
  it("residential (code=11009) -> unavailable:true, excluded from errors[]; mobile (ok) stays active", async () => {
    mockedParallel.mockResolvedValue([
      { key: "residential", ok: false, error: CODE_11009_ERROR, code: 11009 },
      { key: "mobile", ok: true, data: { balance: 0, times: 5, total: 100, used: 5 } },
    ]);

    const raw = await novadaPlanBalanceAll({ products: ["residential", "mobile"] });
    const parsed = JSON.parse(raw) as {
      summary: { unavailable_products: string[]; active_products: string[] };
      per_product: Record<string, { status: string; unavailable?: boolean }>;
      errors?: Array<{ product: string; error: string }>;
    };

    expect(parsed.summary.unavailable_products).toContain("residential");
    expect(parsed.per_product.residential.status).toBe("error");
    expect(parsed.per_product.residential.unavailable).toBe(true);
    expect(parsed.summary.active_products).toContain("mobile");

    // Class-sweep: a not-provisioned product must not ALSO appear as a generic
    // error — exactly one signal, not two contradictory ones.
    const errors = parsed.errors ?? [];
    expect(errors.some((e) => e.product === "residential")).toBe(false);
  });

  it("guard: a DIFFERENT non-zero code (10001) stays a genuine error, NOT unavailable", async () => {
    mockedParallel.mockResolvedValue([
      {
        key: "residential",
        ok: false,
        error: "Developer-api rejected request (code=10001): Invalid parameter",
        code: 10001,
      },
      { key: "mobile", ok: true, data: { balance: 0, times: 5, total: 100, used: 5 } },
    ]);

    const raw = await novadaPlanBalanceAll({ products: ["residential", "mobile"] });
    const parsed = JSON.parse(raw) as {
      summary: { unavailable_products: string[] };
      per_product: Record<string, { status: string; unavailable?: boolean }>;
      errors?: Array<{ product: string; error: string }>;
    };

    expect(parsed.summary.unavailable_products).not.toContain("residential");
    expect(parsed.per_product.residential.unavailable).toBeUndefined();
    expect(parsed.per_product.residential.status).toBe("error");
    // Must still surface as a real, actionable error — not silently swallowed.
    expect((parsed.errors ?? []).some((e) => e.product === "residential")).toBe(true);
  });
});

// ─── 2. novadaAccount end-to-end (real chain) ────────────────────────────────

describe("novadaAccount(section=plans) — end-to-end through the REAL chain", () => {
  it("json: residential unavailable:true and absent from errors[]", async () => {
    mockedParallel.mockResolvedValue([
      { key: "residential", ok: false, error: CODE_11009_ERROR, code: 11009 },
      { key: "mobile", ok: true, data: { balance: 0, times: 5, total: 100, used: 5 } },
    ]);

    const result = await novadaAccount(
      validateAccountParams({ section: "plans", format: "json", products: ["residential", "mobile"] }),
    );
    const parsed = JSON.parse(result) as {
      per_product: Record<string, { unavailable?: boolean }>;
      errors?: Array<{ product: string }>;
    };

    expect(parsed.per_product.residential.unavailable).toBe(true);
    expect((parsed.errors ?? []).some((e) => e.product === "residential")).toBe(false);
  });

  it("card: shows ⛔ not provisioned for residential, never ⛔ error", async () => {
    mockedParallel.mockResolvedValue([
      { key: "residential", ok: false, error: CODE_11009_ERROR, code: 11009 },
      { key: "mobile", ok: true, data: { balance: 0, times: 5, total: 100, used: 5 } },
    ]);

    const result = await novadaAccount(
      validateAccountParams({ section: "plans", format: "card", products: ["residential", "mobile"] }),
    );
    const residentialRow = result.split("\n").find((l) => l.startsWith("| Residential"));
    expect(residentialRow).toBeTruthy();
    expect(residentialRow).toContain("⛔ not provisioned");
    expect(residentialRow).not.toContain("⛔ error");
  });
});

describe("novadaAccount(section=summary) — end-to-end: no contradictory 'service error' line", () => {
  it("card: table shows 'not provisioned' AND the Issues list never says 'service error' for the same product", async () => {
    mockedParallel.mockResolvedValue([
      { key: "residential", ok: false, error: CODE_11009_ERROR, code: 11009 },
      { key: "isp", ok: true, data: { balance: 500_000_000, expire_time: 9_999_999_999 } },
      { key: "mobile", ok: true, data: { balance: 0, times: 5, total: 100, used: 5 } },
      { key: "datacenter", ok: true, data: { balance: 500_000_000, expire_time: 9_999_999_999 } },
      { key: "capture", ok: true, data: 50 },
    ]);

    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "card" }));

    expect(result).toContain("⛔ not provisioned");
    // The old bug: table says "not provisioned" but Issues list ALSO prints
    // "service error" for the same product — a contradictory double signal.
    expect(result).not.toContain("service error");
  });

  it("json: per_product.residential is not_provisioned, and errors[] carries zero entries for it", async () => {
    mockedParallel.mockResolvedValue([
      { key: "residential", ok: false, error: CODE_11009_ERROR, code: 11009 },
      { key: "isp", ok: true, data: { balance: 500_000_000, expire_time: 9_999_999_999 } },
      { key: "mobile", ok: true, data: { balance: 0, times: 5, total: 100, used: 5 } },
      { key: "datacenter", ok: true, data: { balance: 500_000_000, expire_time: 9_999_999_999 } },
      { key: "capture", ok: true, data: 50 },
    ]);

    const result = await novadaAccount(validateAccountParams({ section: "summary", format: "json" }));
    const parsed = JSON.parse(result) as {
      plans: { per_product: Record<string, { status: string }>; not_provisioned: string[] };
      errors: Array<{ product: string; message: string }>;
    };

    expect(parsed.plans.per_product.residential.status).toBe("not_provisioned");
    expect(parsed.plans.not_provisioned).toContain("residential");
    expect(parsed.errors.some((e) => e.product === "residential")).toBe(false);
  });
});
