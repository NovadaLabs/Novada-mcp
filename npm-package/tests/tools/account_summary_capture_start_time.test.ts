/**
 * TDD for the account_summary.ts capture_logs "no start_time" bug
 * (fix/account-not-provisioned, 3rd commit).
 *
 * ROOT CAUSE (confirmed live, not a guess): account_summary.ts called
 * novadaCaptureLogs({ page: 1, page_size: 5 }, apiKey) with NO start_time.
 * The endpoint /v1/capture/logs REQUIRES a start_time — with none it returns
 * `code 10000, "解析开始时间失败: parsing time \"\" ..."`, which then renders
 * as the misleading "capture_recent: service error (check API key or contact
 * support)" line in novada_account(section="summary"). Live-captured BOTH
 * "YYYY-MM-DD HH:MM:SS" and "YYYY-MM-DD" start_time formats -> both return
 * `code 0 success + data`. The file-header comment ("capture_logs (last 1
 * day)") was stale — the code never actually passed a range.
 *
 * FIX (account_summary.ts only): pass a start_time for a 7-day lookback
 * window, computed at request time (new Date()) so it's always valid
 * relative to TODAY — never a stale hardcoded date. Uses the tool's existing
 * public start_time param (YYYY-MM-DD), which flows through
 * withDateRangeCompat -> emits both start_time + strat_time.
 *
 * OUT OF SCOPE (not fixed here, per instruction): the "service error (check
 * API key)" wording itself is misleading for ANY capture error — a separate
 * honest-status polish. This fix only makes the capture_recent leg SUCCEED
 * when the account has a start_time it can parse; a genuine capture_logs
 * failure (guard test below) still renders the (unrelated, unfixed) generic
 * wording — that is expected, not a regression.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (before dynamic import) ────────────────────────────────────────────
// Isolate the capture_logs leg: wallet_balance / plan_balance_all / health are
// stubbed with harmless "ok" payloads (not the concern of this bug).

vi.mock("../../src/tools/wallet_balance.js", () => ({
  novadaWalletBalance: vi.fn().mockResolvedValue(
    JSON.stringify({ status: "ok", data: { balance: 100, currency: "€" } }),
  ),
}));
vi.mock("../../src/tools/plan_balance_all.js", () => ({
  novadaPlanBalanceAll: vi.fn().mockResolvedValue(
    JSON.stringify({
      status: "ok",
      summary: { active_products: [], expired_products: [], unavailable_products: [] },
      per_product: {},
    }),
  ),
}));
vi.mock("../../src/tools/health.js", () => ({
  novadaHealth: vi.fn().mockResolvedValue("## health\n"),
}));
vi.mock("../../src/tools/capture_logs.js", () => ({
  novadaCaptureLogs: vi.fn(),
}));

import { novadaCaptureLogs } from "../../src/tools/capture_logs.js";
import { novadaAccountSummary } from "../../src/tools/account_summary.js";
import { novadaAccount, validateAccountParams } from "../../src/tools/account.js";

const mockedCapture = vi.mocked(novadaCaptureLogs);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── 1. RED: account_summary must pass a valid, relative start_time ─────────

describe("account_summary — capture_logs is called WITH a start_time", () => {
  it("passes a non-empty YYYY-MM-DD start_time within a recent window (not omitted, not stale)", async () => {
    mockedCapture.mockResolvedValue(JSON.stringify({ status: "ok", data: { list: [] } }));

    await novadaAccountSummary({} as never);

    expect(mockedCapture).toHaveBeenCalledTimes(1);
    const [params] = mockedCapture.mock.calls[0] as [Record<string, unknown>, string | undefined];
    expect(typeof params.start_time).toBe("string");
    expect(params.start_time as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Must be a REAL relative window computed at request time (new Date()) —
    // never a hardcoded/stale date. Generous band (1-10 days) around the
    // intended 7-day lookback so the test isn't brittle to the exact number.
    const start = new Date(`${params.start_time as string}T00:00:00Z`);
    const diffDays = (Date.now() - start.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThanOrEqual(1);
    expect(diffDays).toBeLessThanOrEqual(10);
  });
});

// ─── 2. GREEN: capture_recent succeeds; summary card has zero "service error" ─

describe("account_summary — capture_recent succeeds once a valid start_time is supplied", () => {
  it("sections.capture_recent is status:ok with the recent list", async () => {
    mockedCapture.mockResolvedValue(JSON.stringify({
      status: "ok",
      data: { list: [{ id: "c1" }, { id: "c2" }] },
    }));

    const raw = await novadaAccountSummary({} as never);
    const parsed = JSON.parse(raw) as {
      status: string;
      sections: { capture_recent: { status: string; recent?: unknown[] } };
    };

    expect(parsed.status).toBe("ok");
    expect(parsed.sections.capture_recent.status).toBe("ok");
    expect(parsed.sections.capture_recent.recent).toHaveLength(2);
  });

  it("through the REAL account.ts summary card: zero 'service error' text anywhere", async () => {
    mockedCapture.mockResolvedValue(JSON.stringify({
      status: "ok",
      data: { list: [{ id: "c1" }] },
    }));

    const card = await novadaAccount(validateAccountParams({ section: "summary", format: "card" }));
    expect(card).not.toContain("service error");
    expect(card).toContain("Recent capture:");
  });
});

// ─── 3. Guard: a genuine capture_logs failure still degrades gracefully ──────

describe("account_summary — guard: a genuine capture_logs error does not crash the summary", () => {
  it("capture_recent surfaces status:error; overall summary status becomes 'partial'; no throw", async () => {
    mockedCapture.mockRejectedValue(
      new Error('Developer-api rejected request (code=10000): 解析开始时间失败: parsing time ""'),
    );

    const raw = await novadaAccountSummary({} as never);
    const parsed = JSON.parse(raw) as {
      status: string;
      sections: { capture_recent: { status: string; error?: string } };
    };

    expect(parsed.status).toBe("partial");
    expect(parsed.sections.capture_recent.status).toBe("error");
    expect(typeof parsed.sections.capture_recent.error).toBe("string");
  });

  it("account.ts summary card still renders (no crash) when capture_logs errors", async () => {
    mockedCapture.mockRejectedValue(new Error("Developer-api returned HTTP 503. Treat as transient"));

    await expect(
      novadaAccount(validateAccountParams({ section: "summary", format: "card" })),
    ).resolves.toContain("## Novada Account");
  });
});
