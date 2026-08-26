/**
 * TDD for the account_summary.ts capture_logs date-range bug
 * (fix/account-not-provisioned, 3rd + 4th commits).
 *
 * ROOT CAUSE, part 1 (3rd commit, cbee8cf): account_summary.ts called
 * novadaCaptureLogs({ page: 1, page_size: 5 }, apiKey) with NO start_time.
 * /v1/capture/logs REQUIRES a start_time — with none it returns
 * `code 10000, "解析开始时间失败: parsing time \"\" ..."`.
 *
 * ROOT CAUSE, part 2 (4th commit — THIS fix): cbee8cf added start_time but
 * NOT end_time. A live keyed probe against the real server proved that's
 * still not enough: `{start_time only}` -> `code 10000,
 * "解析结束时间失败: parsing time \"\" ..."` (parse END time failed — the
 * server requires end_time too). `{start_time + end_time}` -> `code 0
 * success`. Root: withDateRangeCompat (developer_api.ts) only emits end_time
 * when opts.end is provided; account_summary passed only start_time, so
 * end_time stayed empty and the server rejected.
 *
 * GREEN-BUT-BROKEN LESSON (why this file was rewritten, not just extended):
 * the 3rd-commit test only asserted "start_time was passed" — it passed
 * green in CI while the LIVE endpoint still errored, because the mock never
 * modeled the server's actual validation (BOTH dates required). This file
 * now uses a server-accurate fake (installServerAccurateCaptureLogsMock)
 * that FAILS exactly like the real endpoint does for ANY incomplete date
 * pair, so "capture_recent succeeds" can only go green when account_summary
 * genuinely sends both dates — not merely "a" date.
 *
 * FIX (account_summary.ts only, unchanged scope): pass BOTH
 * start_time: isoDateDaysAgo(7) and end_time: isoDateDaysAgo(0) (today)
 * through the tool's existing public "YYYY-MM-DD" params. Both are computed
 * at request time (new Date()), so the window is always valid relative to
 * TODAY, never a stale hardcoded date.
 *
 * OUT OF SCOPE (not fixed here, per instruction): the "service error (check
 * API key)" wording itself is misleading for ANY capture error — a separate
 * honest-status polish. This fix only makes the capture_recent leg SUCCEED
 * when the account has a date range the server can parse; a genuine
 * capture_logs failure (guard tests below) still renders the (unrelated,
 * unfixed) generic wording — that is expected, not a regression.
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

/**
 * Server-accurate fake for /v1/capture/logs, invoked wherever a test needs
 * capture_recent to actually SUCCEED. Replicates the live validation: reject
 * (exactly like the real devApiPost throw path) unless BOTH `start_time` AND
 * `end_time` are present, non-empty strings — matching the two distinct live
 * error codes actually observed (start-time-missing vs end-time-missing).
 * This is deliberately NOT "assert params then always resolve ok" — a mock
 * that ignores its own inputs can go green while the real endpoint 400s.
 */
function installServerAccurateCaptureLogsMock(successData: unknown): void {
  mockedCapture.mockImplementation(async (params?: unknown) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const start = typeof p.start_time === "string" ? p.start_time : "";
    const end = typeof p.end_time === "string" ? p.end_time : "";
    if (!start) {
      throw new Error('Developer-api rejected request (code=10000): 解析开始时间失败: parsing time ""');
    }
    if (!end) {
      throw new Error('Developer-api rejected request (code=10000): 解析结束时间失败: parsing time ""');
    }
    return JSON.stringify({ status: "ok", data: successData });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── 1. account_summary must pass BOTH start_time and end_time ──────────────

describe("account_summary — capture_logs is called WITH both start_time AND end_time", () => {
  it("passes non-empty YYYY-MM-DD start_time (recent past) and end_time (today), start <= end", async () => {
    installServerAccurateCaptureLogsMock({ list: [] });

    await novadaAccountSummary({} as never);

    expect(mockedCapture).toHaveBeenCalledTimes(1);
    const [params] = mockedCapture.mock.calls[0] as [Record<string, unknown>, string | undefined];

    expect(typeof params.start_time).toBe("string");
    expect(params.start_time as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof params.end_time).toBe("string");
    expect(params.end_time as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Relative window computed at request time (new Date()) — never a
    // hardcoded/stale date. Generous bands so the test isn't brittle to the
    // exact lookback number or to UTC/local day-boundary rounding.
    const start = new Date(`${params.start_time as string}T00:00:00Z`);
    const end = new Date(`${params.end_time as string}T00:00:00Z`);
    const startDiffDays = (Date.now() - start.getTime()) / (24 * 60 * 60 * 1000);
    const endDiffDays = (Date.now() - end.getTime()) / (24 * 60 * 60 * 1000);
    expect(startDiffDays).toBeGreaterThanOrEqual(1);
    expect(startDiffDays).toBeLessThanOrEqual(10);
    expect(endDiffDays).toBeGreaterThanOrEqual(0);
    expect(endDiffDays).toBeLessThan(2); // "today"
    expect(end.getTime()).toBeGreaterThanOrEqual(start.getTime());
  });
});

// ─── 2. capture_recent only succeeds when BOTH dates are genuinely sent ─────
// The critical strengthened check: a mock that models the REAL server
// contract (fails on either date missing), not just "was a param passed".

describe("account_summary — capture_recent succeeds ONLY when the server-accurate mock receives BOTH dates", () => {
  it("sections.capture_recent is status:ok with the recent list", async () => {
    installServerAccurateCaptureLogsMock({ list: [{ id: "c1" }, { id: "c2" }] });

    const raw = await novadaAccountSummary({} as never);
    const parsed = JSON.parse(raw) as {
      status: string;
      sections: { capture_recent: { status: string; recent?: unknown[]; error?: string } };
    };

    expect(parsed.status).toBe("ok");
    expect(parsed.sections.capture_recent.status).toBe("ok");
    expect(parsed.sections.capture_recent.recent).toHaveLength(2);
  });

  it("through the REAL account.ts summary card: zero 'service error' text anywhere", async () => {
    installServerAccurateCaptureLogsMock({ list: [{ id: "c1" }] });

    const card = await novadaAccount(validateAccountParams({ section: "summary", format: "card" }));
    expect(card).not.toContain("service error");
    expect(card).toContain("Recent capture:");
  });
});

// ─── 3. Guard: a genuine capture_logs failure still degrades gracefully ──────
// Unrelated to the date-parsing contract — a real 5xx/transient failure must
// still surface as an error, never silently hidden or crash the summary.

describe("account_summary — guard: a genuine capture_logs error does not crash the summary", () => {
  it("capture_recent surfaces status:error; overall summary status becomes 'partial'; no throw", async () => {
    mockedCapture.mockRejectedValue(
      new Error("Developer-api returned HTTP 503. Treat as transient — retry after 30s."),
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
