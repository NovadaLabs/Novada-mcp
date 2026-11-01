/**
 * CLASS-NOT-INSTANCE regression (2026-10-30, account-tools-redaction, scope
 * addition #2): every novada_account(section=...) backward-compat alias in
 * core.ts's dispatch switch MUST forward the caller's args. novada_wallet_balance,
 * novada_capture_logs, and novada_account_summary used to hardcode
 * `{ section: "X" }` with NO `...args` spread — unlike their siblings
 * (wallet_usage_record/traffic_daily/plan_balance_all) — silently dropping even
 * `format:"json"` and forcing a card back regardless of what the caller asked
 * for. This is table-driven over ALL 6 account-aliases so a future alias can't
 * reintroduce the same class of bug as a "new instance".
 *
 * Mocks only ./tools/account.js (novadaAccount) — every other tool in dispatch
 * is untouched/real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/tools/account.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/tools/account.js")>();
  return {
    ...original,
    novadaAccount: vi.fn().mockResolvedValue(JSON.stringify({ status: "ok" })),
  };
});

import { novadaAccount } from "../../src/tools/account.js";
const mockedAccount = vi.mocked(novadaAccount);

beforeEach(() => {
  vi.clearAllMocks();
  mockedAccount.mockResolvedValue(JSON.stringify({ status: "ok" }));
});

/** Every alias in core.ts's switch that routes to novadaAccount, and the section it maps to. */
const ACCOUNT_ALIASES: Array<{ tool: string; section: string }> = [
  { tool: "novada_wallet_balance", section: "balance" },
  { tool: "novada_wallet_usage_record", section: "usage" },
  { tool: "novada_traffic_daily", section: "traffic" },
  { tool: "novada_plan_balance_all", section: "plans" },
  { tool: "novada_capture_logs", section: "summary" },
  { tool: "novada_account_summary", section: "summary" },
];

describe("dispatch — every novada_account alias forwards format (class, not instance)", () => {
  it.each(ACCOUNT_ALIASES)(
    '$tool forwards format:"json" through to novadaAccount(section="$section")',
    async ({ tool, section }) => {
      const { dispatch } = await import("../../src/core.js");
      await dispatch(tool, { format: "json" }, "caller-key");
      expect(mockedAccount).toHaveBeenCalledTimes(1);
      const [params] = mockedAccount.mock.calls[0];
      expect((params as { format?: string }).format).toBe("json");
      expect((params as { section?: string }).section).toBe(section);
    },
  );

  it("novada_wallet_usage_record also forwards page/page_size/start_time/end_time (sibling behavior, unchanged)", async () => {
    const { dispatch } = await import("../../src/core.js");
    await dispatch(
      "novada_wallet_usage_record",
      { page: 3, page_size: 10, start_time: "2026-01-01", end_time: "2026-01-31" },
      "caller-key",
    );
    const [params] = mockedAccount.mock.calls[0] as [Record<string, unknown>];
    expect(params.page).toBe(3);
    expect(params.page_size).toBe(10);
    expect(params.start_time).toBe("2026-01-01");
    expect(params.end_time).toBe("2026-01-31");
  });
});
