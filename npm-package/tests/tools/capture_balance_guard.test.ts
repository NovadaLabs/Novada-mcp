/**
 * TDD for the capture zero-balance guard (2026-09-22).
 *
 * BUG (live-verified): /v1/capture/get_balance INTERMITTENTLY returns a bare
 * `data: 0` for a FUNDED account (real balance ~68.76 credits). Proven
 * intermittent: a live scrape succeeded (billing saw the real balance) while
 * get_balance returned 0 in the SAME session — the 0 can persist, so a single
 * re-read alone is not sufficient. Untreated, plan_balance_all faithfully
 * derives `{exhausted:true, balance_human:"0.00 credits"}` from that 0 and
 * novada_account / novada_setup tell a paying customer "Capture exhausted /
 * top up". Root cause is the backend endpoint (out of scope) — this guard is
 * the MCP-side defense so a suspect 0 never produces a confident "exhausted".
 *
 * THE GUARD (implemented in plan_balance_all.ts — the class-wide chokepoint
 * every consumer flows through: account section=plans/summary, setup's B2
 * product readiness AND its scoped capture line, proxy_preflight for proxy
 * products [capture is proxy:false so preflight never reads it]):
 *   1. capture resolves to bare-number 0 → re-read get_balance ONCE after a
 *      short delay. Re-read > 0 → use it (transient resolved).
 *   2. still 0 → cross-signal: recent capture activity via the SAME
 *      /v1/capture/logs 7-day window account_summary's capture_recent uses.
 *      Activity present → `balance_unverified:true`, exhausted NOT set,
 *      softened balance_human.
 *   3. reverse-safety: still 0 + NO recent activity → `exhausted:true`
 *      exactly as today. Never tell a truly-empty account it has money.
 *   4. the >0 path makes ZERO extra calls (asserted via devApiPost call
 *      counts) and is byte-unchanged in behavior.
 *
 * Mock level: ONLY devApiParallel/devApiPost (the network edge) + the health
 * tool (summary-section sibling, not under test). plan_balance_all,
 * capture_logs, wallet_balance, account, account_summary, and setup all run
 * REAL so the guard and its rendering are exercised end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/_core/developer_api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/_core/developer_api.js")>();
  return {
    ...actual,
    devApiParallel: vi.fn(),
    devApiPost: vi.fn(),
  };
});

// Sibling section of novadaAccount(section="summary") — not under test, and it
// reaches out to credentials/render helpers beyond the devApi edge.
vi.mock("../../src/tools/health.js", () => ({
  novadaHealth: vi.fn().mockResolvedValue("## health\n"),
}));

import { devApiParallel, devApiPost } from "../../src/_core/developer_api.js";
import { novadaPlanBalanceAll } from "../../src/tools/plan_balance_all.js";
import { novadaAccount, validateAccountParams } from "../../src/tools/account.js";
import { novadaSetup } from "../../src/tools/setup.js";

const mockedParallel = vi.mocked(devApiParallel);
const mockedPost = vi.mocked(devApiPost);

const CAPTURE_BALANCE_PATH = "/v1/capture/get_balance";
const CAPTURE_LOGS_PATH = "/v1/capture/logs";
const STATIC_LIST_PATH = "/v1/static_house/list";
const WALLET_PATH = "/v1/wallet/balance";

const FUNDED = 68.76;

interface RouteOpts {
  /** What the get_balance RE-READ returns (bare number, per live shape). */
  reread?: unknown;
  /** Make the re-read throw instead. */
  rereadError?: Error;
  /** What /v1/capture/logs returns as data.list (recent activity). */
  logsList?: unknown[];
  /** Make the activity check throw instead. */
  logsError?: Error;
}

/** Route mocked devApiPost by endpoint path — one place, all legs. */
function routePost(opts: RouteOpts = {}): void {
  mockedPost.mockImplementation(async (path: string) => {
    if (path === CAPTURE_BALANCE_PATH) {
      if (opts.rereadError) throw opts.rereadError;
      return opts.reread ?? 0;
    }
    if (path === CAPTURE_LOGS_PATH) {
      if (opts.logsError) throw opts.logsError;
      return { list: opts.logsList ?? [] };
    }
    if (path === STATIC_LIST_PATH) return { list: [], total: 0 };
    if (path === WALLET_PATH) return { balance: 50.1 };
    throw new Error(`unexpected devApiPost path in test: ${path}`);
  });
}

function postCalls(path: string): number {
  return mockedPost.mock.calls.filter((c) => c[0] === path).length;
}

interface CapturePayload {
  summary: { active_products: string[]; expired_products: string[] };
  per_product: Record<
    string,
    {
      status: string;
      balance?: unknown;
      exhausted?: boolean;
      balance_unverified?: boolean;
      balance_human?: string;
    }
  >;
}

async function runCaptureOnly(firstRead: unknown): Promise<CapturePayload> {
  mockedParallel.mockResolvedValue([{ key: "capture", ok: true, data: firstRead }]);
  const raw = await novadaPlanBalanceAll({ products: ["capture"] });
  return JSON.parse(raw) as CapturePayload;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedParallel.mockReset();
  mockedPost.mockReset();
});

// ─── 1. Transient 0 resolved by the single re-read ────────────────────────────

describe("capture zero-balance guard — re-read resolves a transient 0", () => {
  it("get_balance 0 then 68.76 on re-read → final balance 68.76, no exhausted, no balance_unverified", async () => {
    routePost({ reread: FUNDED });

    const parsed = await runCaptureOnly(0);
    const entry = parsed.per_product.capture;

    expect(entry.status).toBe("ok");
    expect(entry.balance).toBe(FUNDED);
    expect(entry.balance_human).toBe(`${FUNDED.toFixed(2)} credits`);
    expect(entry.exhausted).not.toBe(true);
    expect(entry.balance_unverified).toBeUndefined();
    expect(parsed.summary.active_products).toContain("capture");

    // Exactly ONE re-read; the activity cross-signal is never consulted once
    // the re-read exonerates the 0.
    expect(postCalls(CAPTURE_BALANCE_PATH)).toBe(1);
    expect(postCalls(CAPTURE_LOGS_PATH)).toBe(0);
  });
});

// ─── 2. Persistent 0 CONTRADICTED by recent activity → unverified, not dead ──

describe("capture zero-balance guard — persistent 0 + recent activity → unverified", () => {
  it("0 both reads + recent capture logs → balance_unverified:true, exhausted NOT set, softened balance_human", async () => {
    routePost({ reread: 0, logsList: [{ task_id: "t1" }, { task_id: "t2" }] });

    const parsed = await runCaptureOnly(0);
    const entry = parsed.per_product.capture;

    expect(entry.status).toBe("ok");
    expect(entry.balance_unverified).toBe(true);
    expect(entry.exhausted).toBeUndefined();
    expect(entry.balance_human).toContain("UNVERIFIED");
    expect(entry.balance_human).toContain("dashboard.novada.com");
    // The raw 0 read is still reported honestly — only its INTERPRETATION softens.
    expect(entry.balance).toBe(0);
    // Unverified is still an active plan, never an expired one.
    expect(parsed.summary.active_products).toContain("capture");

    expect(postCalls(CAPTURE_BALANCE_PATH)).toBe(1);
    expect(postCalls(CAPTURE_LOGS_PATH)).toBe(1);
  });

  it("re-read THROWS (network blip) + recent activity → still degrades to unverified, never a crash or a false exhausted", async () => {
    routePost({ rereadError: new Error("Developer-api returned HTTP 503"), logsList: [{ task_id: "t1" }] });

    const parsed = await runCaptureOnly(0);
    const entry = parsed.per_product.capture;

    expect(entry.status).toBe("ok");
    expect(entry.balance_unverified).toBe(true);
    expect(entry.exhausted).toBeUndefined();
  });
});

// ─── 3. Reverse-safety: persistent 0 + NO activity → genuinely exhausted ─────

describe("capture zero-balance guard — reverse-safety", () => {
  it("0 both reads + NO recent activity → exhausted:true exactly as today (never tell an empty account it has money)", async () => {
    routePost({ reread: 0, logsList: [] });

    const parsed = await runCaptureOnly(0);
    const entry = parsed.per_product.capture;

    expect(entry.status).toBe("ok");
    expect(entry.exhausted).toBe(true);
    expect(entry.balance_unverified).toBeUndefined();
    expect(entry.balance_human).toBe("0.00 credits");
  });

  it("0 both reads + activity check THROWS → nothing contradicts the 0 → exhausted:true (fail toward today's behavior)", async () => {
    routePost({ reread: 0, logsError: new Error("Developer-api returned HTTP 503") });

    const parsed = await runCaptureOnly(0);
    const entry = parsed.per_product.capture;

    expect(entry.exhausted).toBe(true);
    expect(entry.balance_unverified).toBeUndefined();
  });
});

// ─── 4. Normal >0 path is byte-unchanged: ZERO extra calls ────────────────────

describe("capture zero-balance guard — funded first read makes no extra calls", () => {
  it("get_balance 68.76 on the first read → used directly; no re-read, no activity call", async () => {
    routePost();

    const parsed = await runCaptureOnly(FUNDED);
    const entry = parsed.per_product.capture;

    expect(entry.balance).toBe(FUNDED);
    expect(entry.balance_human).toBe(`${FUNDED.toFixed(2)} credits`);
    expect(entry.exhausted).toBe(false);
    expect(entry.balance_unverified).toBeUndefined();

    // The guard is gated to the ==0 case: the >0 path makes ZERO devApiPost calls
    // (capture-only query → no static leg either).
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("non-capture products are never guarded: a proxy product at 0 bytes stays plain exhausted with no extra calls", async () => {
    routePost();
    mockedParallel.mockResolvedValue([
      { key: "residential", ok: true, data: { balance: 0, expire_time: 9_999_999_999 } },
    ]);

    const raw = await novadaPlanBalanceAll({ products: ["residential"] });
    const parsed = JSON.parse(raw) as CapturePayload;

    expect(parsed.per_product.residential.exhausted).toBe(true);
    expect(parsed.per_product.residential.balance_unverified).toBeUndefined();
    expect(mockedPost).not.toHaveBeenCalled();
  });
});

// ─── 5. Rendering — novada_account honors balance_unverified ─────────────────

describe("novada_account rendering — unverified capture is never shown as exhausted", () => {
  it("section=plans card: Capture row says unverified, never exhausted, and no top-up push", async () => {
    routePost({ reread: 0, logsList: [{ task_id: "t1" }] });
    mockedParallel.mockResolvedValue([{ key: "capture", ok: true, data: 0 }]);

    const card = await novadaAccount(
      validateAccountParams({ section: "plans", format: "card", products: ["capture"] }),
    );

    const captureRow = card.split("\n").find((l) => l.startsWith("| Capture"));
    expect(captureRow).toBeTruthy();
    expect(captureRow).toContain("unverified");
    expect(captureRow).not.toContain("exhausted");
    expect(card.toLowerCase()).not.toContain("top up");
  });

  it("section=plans json passthrough carries balance_unverified for programmatic consumers", async () => {
    routePost({ reread: 0, logsList: [{ task_id: "t1" }] });
    mockedParallel.mockResolvedValue([{ key: "capture", ok: true, data: 0 }]);

    const result = await novadaAccount(
      validateAccountParams({ section: "plans", format: "json", products: ["capture"] }),
    );
    const parsed = JSON.parse(result) as CapturePayload;

    expect(parsed.per_product.capture.balance_unverified).toBe(true);
    expect(parsed.per_product.capture.exhausted).toBeUndefined();
  });

  it("section=summary: card shows unverified (not exhausted); json flat status is 'unverified'", async () => {
    routePost({ reread: 0, logsList: [{ task_id: "t1" }] });
    mockedParallel.mockResolvedValue([
      { key: "residential", ok: true, data: { balance: 500_000_000, expire_time: 9_999_999_999 } },
      { key: "isp", ok: true, data: { balance: 500_000_000, expire_time: 9_999_999_999 } },
      { key: "mobile", ok: true, data: { balance: 0, times: 5, total: 100, used: 5 } },
      { key: "datacenter", ok: true, data: { balance: 500_000_000, expire_time: 9_999_999_999 } },
      { key: "capture", ok: true, data: 0 },
    ]);

    const card = await novadaAccount(validateAccountParams({ section: "summary", format: "card" }));
    const captureRow = card.split("\n").find((l) => l.startsWith("| Capture"));
    expect(captureRow).toBeTruthy();
    expect(captureRow).toContain("unverified");
    expect(captureRow).not.toContain("exhausted");

    routePost({ reread: 0, logsList: [{ task_id: "t1" }] });
    const json = await novadaAccount(validateAccountParams({ section: "summary", format: "json" }));
    const parsed = JSON.parse(json) as {
      plans: { per_product: Record<string, { status: string }> };
    };
    expect(parsed.plans.per_product.capture.status).toBe("unverified");
    expect(parsed.plans.per_product.capture.status).not.toBe("exhausted");
  });
});

// ─── 6. Rendering — novada_setup readiness honors balance_unverified ─────────

describe("novada_setup readiness — unverified capture is active-but-unverified, not dead", () => {
  it("product_status line says capture=unverified, never capture=exhausted; human Products line matches", async () => {
    routePost({ reread: 0, logsList: [{ task_id: "t1" }] });
    mockedParallel.mockImplementation(async (calls) =>
      calls.map((c) =>
        c.key === "capture"
          ? { key: "capture", ok: true, data: 0 as unknown }
          : { key: c.key, ok: true, data: { balance: 500_000_000, expire_time: 9_999_999_999 } as unknown },
      ),
    );

    const result = await novadaSetup({} as never, "sk-test-GUARD001");

    expect(result).toContain("key_state: ready");
    expect(result).toContain("capture=unverified");
    expect(result).not.toContain("capture=exhausted");

    const productsLine = result.split("\n").find((l) => l.includes("Products:"));
    expect(productsLine).toBeTruthy();
    expect(productsLine).toMatch(/capture[^\n·]*unverified/);
    expect(productsLine).not.toMatch(/capture[^\n·]*exhausted/);
  });
});
