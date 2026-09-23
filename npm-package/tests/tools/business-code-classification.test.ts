/**
 * B1 (+A2) — centralized upstream business-code → error-taxonomy mapping.
 *
 * Problem this pins: upstream envelope `code 11004` ("Insufficient balance") was
 * classified THREE different ways depending on which tool surfaced it:
 *   - scrape.ts fell through its generic `throw new Error(...)` → classifyError
 *     → UNKNOWN / permanent / "contact support" (no top-up instruction);
 *   - search.ts's generic throw was retried by withSingleSerpRetry when prose
 *     matching happened to tag it transient, and its entitlement regex could
 *     mislabel it as "SERP not activated";
 *   - browser_flow.ts returned a plain formatted string (no taxonomy at all);
 *   - proxy (proxy_preflight.ts) was CORRECT — PRODUCT_UNAVAILABLE with ledger
 *     evidence + a top-up instruction. That is the REFERENCE shape.
 *
 * Fix: ONE shared table (`BUSINESS_CODE_MAP` + `classifyBusinessCode()` in
 * _core/errors.ts) that every envelope-code fallback consults. 11004 maps to
 * the new INSUFFICIENT_BALANCE code: failure_class "permanent",
 * retry_recommended false, agent_instruction = top up at the dashboard.
 *
 * CLASS TEST: the table-driven suite below feeds {code:11004, msg:"Insufficient
 * balance"} through the scrape, search, AND browser_flow error paths — plus the
 * proxy reference path — and asserts ALL of them produce the same failure_class
 * ("permanent") and retry_recommended:false. One test enumerating every caller,
 * so a future caller of the envelope fallback is a new ROW here, not a new
 * bespoke classification.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
// plan_balance_all is mocked ONLY for the proxy reference leg
// (assertFlowLedgerActive reads the ledger through novadaPlanBalanceAll).
// importOriginal keeps FLOW_BALANCE_ENDPOINTS / deriveBalanceEvidence real so
// proxy_preflight's table-driven row lookup still works.
vi.mock("../../src/tools/plan_balance_all.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tools/plan_balance_all.js")>();
  return { ...actual, novadaPlanBalanceAll: vi.fn() };
});

import { novadaPlanBalanceAll } from "../../src/tools/plan_balance_all.js";
import {
  classifyBusinessCode,
  makeNovadaError,
  NovadaError,
  NovadaErrorCode,
} from "../../src/_core/errors.js";
import { submitScrapeTask } from "../../src/tools/scrape.js";
import { submitSearchScrapeTask, withSingleSerpRetry, novadaSearch } from "../../src/tools/search.js";
import { novadaBrowserFlow } from "../../src/tools/browser_flow.js";
import { assertFlowLedgerActive } from "../../src/tools/proxy_preflight.js";

const mockedAxios = vi.mocked(axios);
const mockedPlanBalance = vi.mocked(novadaPlanBalanceAll);

const API_KEY = "test-key-business-code";

/** The exact live envelope shape: HTTP 200 with a non-zero business code. */
function mockEnvelope(code: number, msg: string) {
  mockedAxios.post.mockResolvedValue({
    data: { code, msg, data: null },
    status: 200,
    headers: {},
    config: {} as never,
    statusText: "OK",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Unit: classifyBusinessCode table ────────────────────────────────────────

describe("classifyBusinessCode — the shared upstream-code table", () => {
  it("maps 11004 (Insufficient balance) to INSUFFICIENT_BALANCE", () => {
    expect(classifyBusinessCode(11004, "Insufficient balance")).toBe(NovadaErrorCode.INSUFFICIENT_BALANCE);
  });

  it("maps 11004 even without a message (structural code wins, no prose needed)", () => {
    expect(classifyBusinessCode(11004)).toBe(NovadaErrorCode.INSUFFICIENT_BALANCE);
  });

  it("falls back to the insufficient-balance prose signal for an unmapped code", () => {
    expect(classifyBusinessCode(99999, "Insufficient balance")).toBe(NovadaErrorCode.INSUFFICIENT_BALANCE);
  });

  it("maps 11006 / 11009 (not activated / not provisioned) to PRODUCT_UNAVAILABLE", () => {
    expect(classifyBusinessCode(11006)).toBe(NovadaErrorCode.PRODUCT_UNAVAILABLE);
    expect(classifyBusinessCode(11009)).toBe(NovadaErrorCode.PRODUCT_UNAVAILABLE);
  });

  it("maps 11000 / 50001-50003 (auth family) to INVALID_API_KEY", () => {
    for (const code of [11000, 50001, 50002, 50003]) {
      expect(classifyBusinessCode(code)).toBe(NovadaErrorCode.INVALID_API_KEY);
    }
  });

  it("maps 500 to API_DOWN (transient server error)", () => {
    expect(classifyBusinessCode(500)).toBe(NovadaErrorCode.API_DOWN);
  });

  it("returns UNKNOWN for unmapped codes with no balance prose — callers keep their existing fallback", () => {
    expect(classifyBusinessCode(77777, "some new upstream condition")).toBe(NovadaErrorCode.UNKNOWN);
  });

  it("deliberately does NOT map endpoint-ambiguous codes 10000/10001 (meanings conflict per endpoint)", () => {
    // 10000: browser_flow=auth failure, scrape download poll="not yet available".
    // 10001: search=invalid key, scrape submit=missing params, scrape download=file-type limit.
    expect(classifyBusinessCode(10000)).toBe(NovadaErrorCode.UNKNOWN);
    expect(classifyBusinessCode(10001)).toBe(NovadaErrorCode.UNKNOWN);
  });

  it("INSUFFICIENT_BALANCE is permanent + non-retryable with a top-up instruction (mirrors proxy's reference shape)", () => {
    const err = makeNovadaError(NovadaErrorCode.INSUFFICIENT_BALANCE, "Insufficient balance", undefined, 11004);
    expect(err.retryable).toBe(false);
    expect(err.businessCode).toBe(11004);
    const s = err.toAgentString();
    expect(s).toContain("failure_class: permanent");
    expect(s).toContain("retry_recommended: false");
    expect(s.toLowerCase()).toContain("top up");
    expect(s).toContain("dashboard.novada.com");
    expect(s).toContain('novada_account(section="plans")');
  });
});

// ─── THE CLASS TEST: 11004 classifies identically through EVERY caller ───────

interface CallerLeg {
  name: string;
  /** Runs the caller against a mocked {code:11004,msg:"Insufficient balance"} upstream and returns the thrown error. */
  run: () => Promise<unknown>;
}

const ENVELOPE_LEGS: CallerLeg[] = [
  {
    name: "scrape (submitScrapeTask envelope fallback)",
    run: async () => {
      mockEnvelope(11004, "Insufficient balance");
      return submitScrapeTask(API_KEY, "amazon.com", "amazon_product_by-keywords", { keyword: "iphone" });
    },
  },
  {
    name: "search (submitSearchScrapeTask envelope fallback)",
    run: async () => {
      mockEnvelope(11004, "Insufficient balance");
      return submitSearchScrapeTask(API_KEY, "google.com", "google_search", "class test query", 10);
    },
  },
  {
    name: "browser_flow (envelope business-code path)",
    run: async () => {
      mockEnvelope(11004, "Insufficient balance");
      return novadaBrowserFlow(
        { url: "https://example.com", actions: [{ type: "screenshot" }], country: "" },
        API_KEY,
      );
    },
  },
];

async function captureError(run: () => Promise<unknown>): Promise<NovadaError> {
  let thrown: unknown;
  try {
    await run();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, "caller must throw a typed NovadaError for code 11004").toBeInstanceOf(NovadaError);
  return thrown as NovadaError;
}

/** Extract the classification fields the class-invariant is about. */
function classificationOf(err: NovadaError): { failure_class: string; retry_recommended: string } {
  const s = err.toAgentString();
  const fc = /failure_class:\s*(\S+)/.exec(s)?.[1] ?? "(missing)";
  const rr = /retry_recommended:\s*(\S+)/.exec(s)?.[1] ?? "(missing)";
  return { failure_class: fc, retry_recommended: rr };
}

/** Proxy reference leg: exhausted ledger → assertFlowLedgerActive throws the reference shape. */
async function proxyReferenceError(): Promise<NovadaError> {
  mockedPlanBalance.mockResolvedValue(
    JSON.stringify({
      status: "ok",
      per_product: {
        residential: { status: "ok", balance: { balance: 0 }, exhausted: true, balance_human: "0.0 MB" },
      },
    }),
  );
  return captureError(() =>
    assertFlowLedgerActive("residential", { source: "auto_fetched", billingApiKey: API_KEY }),
  );
}

describe("CLASS invariant — {code:11004} produces ONE classification across every caller", () => {
  for (const leg of ENVELOPE_LEGS) {
    it(`${leg.name}: 11004 → INSUFFICIENT_BALANCE, permanent, no retry, businessCode preserved`, async () => {
      const err = await captureError(leg.run);
      expect(err.code).toBe(NovadaErrorCode.INSUFFICIENT_BALANCE);
      expect(err.retryable).toBe(false);
      expect(err.businessCode).toBe(11004);
      const s = err.toAgentString();
      expect(s).toContain("failure_class: permanent");
      expect(s).toContain("retry_recommended: false");
      // Actionable, mirrors proxy's reference shape: top up, don't "contact support".
      expect(s.toLowerCase()).toContain("top up");
    });
  }

  it("proxy (reference shape — must NOT regress): exhausted ledger → permanent + no-retry with ledger evidence", async () => {
    const err = await proxyReferenceError();
    expect(err.code).toBe(NovadaErrorCode.PRODUCT_UNAVAILABLE);
    expect(err.retryable).toBe(false);
    const s = err.toAgentString();
    expect(s).toContain("failure_class: permanent");
    expect(s).toContain("retry_recommended: false");
    // Ledger evidence + top-up path survive.
    expect(s).toContain("balance 0.0 MB");
    expect(s).toContain("dashboard.novada.com");
  });

  it("ENUMERATES every caller: scrape, search, browser_flow, proxy all yield the SAME failure_class + retry decision", async () => {
    const classifications: Array<{ caller: string; failure_class: string; retry_recommended: string }> = [];

    for (const leg of ENVELOPE_LEGS) {
      vi.clearAllMocks();
      const err = await captureError(leg.run);
      classifications.push({ caller: leg.name, ...classificationOf(err) });
    }
    vi.clearAllMocks();
    classifications.push({ caller: "proxy (ledger preflight)", ...classificationOf(await proxyReferenceError()) });

    // Every caller enumerated; all four must agree: permanent + no retry.
    expect(classifications).toHaveLength(4);
    for (const c of classifications) {
      expect(c, `caller "${c.caller}" diverged from the class`).toMatchObject({
        failure_class: "permanent",
        retry_recommended: "false",
      });
    }
  });
});

// ─── Blast radius: search's transient-retry machinery must NOT fire on 11004 ─

describe("blast radius — balance errors are never retried as API_DOWN", () => {
  it("withSingleSerpRetry does NOT retry an INSUFFICIENT_BALANCE error (op runs exactly once)", async () => {
    const balanceErr = makeNovadaError(NovadaErrorCode.INSUFFICIENT_BALANCE, "Insufficient balance", undefined, 11004);
    const op = vi.fn().mockRejectedValue(balanceErr);
    await expect(withSingleSerpRetry(op, 1)).rejects.toBe(balanceErr);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("novadaSearch surfaces 11004 as INSUFFICIENT_BALANCE with exactly ONE submit call — no retry, no false SERP_UNAVAILABLE", async () => {
    mockEnvelope(11004, "Insufficient balance");

    await expect(
      novadaSearch(
        { query: "balance-blast-radius-unique-11004", engine: "google", num: 10, country: "", language: "" },
        API_KEY,
      ),
    ).rejects.toMatchObject({
      code: NovadaErrorCode.INSUFFICIENT_BALANCE,
      retryable: false,
      businessCode: 11004,
    });
    // The old (wrong) transient classification triggered withSingleSerpRetry's
    // second submit; a balance error must fail on the first call.
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it("novadaSearch NEVER demotes INSUFFICIENT_BALANCE to SERP_UNAVAILABLE — even when the upstream msg contains entitlement prose like 'no permission'", async () => {
    // Review must-fix #2 (2026-09-21): the catch's isEntitlement regex over
    // err.message ran BEFORE the instanceof-NovadaError rethrow, so a typed
    // 11004 whose upstream msg carried "no permission" was swallowed into the
    // "Search Unavailable" (activate Scraper API) string — the wrong diagnosis
    // (the product IS active; the ledger is empty).
    mockEnvelope(11004, "Insufficient balance, no permission to consume");

    await expect(
      novadaSearch(
        { query: "balance-vs-entitlement-prose-unique-11004", engine: "google", num: 10, country: "", language: "" },
        API_KEY,
      ),
    ).rejects.toMatchObject({
      code: NovadaErrorCode.INSUFFICIENT_BALANCE,
      businessCode: 11004,
    });
  });
});

// ─── A2: browser_flow business-code handling specifics ───────────────────────

describe("novadaBrowserFlow — typed business-code errors (A2)", () => {
  const FLOW_PARAMS = { url: "https://example.com", actions: [{ type: "screenshot" as const }], country: "" };

  it("code 10001: generic INVALID_PARAMS — must NOT assert 'url/actions missing' (meaning is endpoint-specific and unverified)", async () => {
    mockEnvelope(10001, "");
    const err = await captureError(() => novadaBrowserFlow(FLOW_PARAMS, API_KEY));
    expect(err.code).toBe(NovadaErrorCode.INVALID_PARAMS);
    expect(err.businessCode).toBe(10001);
    expect(err.retryable).toBe(false);
    // The old guess ("Missing required parameters. Check that url and actions
    // are provided.") is proven wrong — it must be gone from every field.
    const s = err.toAgentString();
    expect(s).not.toContain("Missing required parameters");
    expect(s).not.toMatch(/url and actions are provided/i);
    // Instead: check product activation + params, without the false claim.
    expect(s.toLowerCase()).toContain("activat");
    expect(s.toLowerCase()).toContain("param");
    // Review cheap-win #4: retryable:false must not be contradicted by a
    // "retry once" instruction — a literal agent would obey the prose.
    expect(s).not.toMatch(/retry once/i);
  });

  it("code 11006 routes through the shared table → typed PRODUCT_UNAVAILABLE (was a plain formatted string)", async () => {
    mockEnvelope(11006, "not activated");
    const err = await captureError(() => novadaBrowserFlow(FLOW_PARAMS, API_KEY));
    expect(err.code).toBe(NovadaErrorCode.PRODUCT_UNAVAILABLE);
    expect(err.businessCode).toBe(11006);
    expect(err.retryable).toBe(false);
  });

  it("unmapped code → typed UNKNOWN NovadaError carrying the businessCode and a browser_flow fallback hint", async () => {
    mockEnvelope(77777, "mystery condition");
    const err = await captureError(() => novadaBrowserFlow(FLOW_PARAMS, API_KEY));
    expect(err.code).toBe(NovadaErrorCode.UNKNOWN);
    expect(err.businessCode).toBe(77777);
    const s = err.toAgentString();
    expect(s).toContain("novada_browser"); // actionable fallback survives the typed envelope
  });

  it("codes 10000/401 keep the deliberate non-throw formatted response (agent sees fallback instructions)", async () => {
    mockEnvelope(401, "auth failed");
    const result = await novadaBrowserFlow(FLOW_PARAMS, API_KEY);
    expect(typeof result).toBe("string");
    expect(result).toContain("Browser Flow — API Error");

    mockEnvelope(10000, "auth failed");
    const result2 = await novadaBrowserFlow(FLOW_PARAMS, API_KEY);
    expect(result2).toContain("Browser Flow — API Error");
  });
});

// ─── Scrape download-poll path: 11004 at download time classifies identically ─

describe("scrape download poll — 11004 from the download endpoint uses the same table", () => {
  it("novadaScrape rejects with INSUFFICIENT_BALANCE when the download endpoint returns code 11004", async () => {
    const { novadaScrape } = await import("../../src/tools/scrape.js");
    // Submit succeeds with a task_id; the download poll then hits the balance wall.
    mockedAxios.post.mockResolvedValue({
      data: { code: 0, data: { code: 200, data: { task_id: "task-balance-1" }, msg: "success" } },
      status: 200,
      headers: {},
      config: {} as never,
      statusText: "OK",
    });
    mockedAxios.get.mockResolvedValue({
      data: { code: 11004, msg: "Insufficient balance", data: null },
      status: 200,
      headers: {},
      config: {} as never,
      statusText: "OK",
    });

    await expect(
      novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
        API_KEY,
      ),
    ).rejects.toMatchObject({
      code: NovadaErrorCode.INSUFFICIENT_BALANCE,
      retryable: false,
      businessCode: 11004,
    });
  });

  it("classifies a STRING-typed download code (\"11004\") identically — the wire type is a cast, not a runtime guarantee", async () => {
    // Review cheap-win #3 (2026-09-21): pollForResult reads `bErr.code as
    // number | undefined` off raw upstream JSON — the cast does not make it a
    // number at runtime. A string "11004" must still land in the balance class.
    const { novadaScrape } = await import("../../src/tools/scrape.js");
    mockedAxios.post.mockResolvedValue({
      data: { code: 0, data: { code: 200, data: { task_id: "task-balance-str" }, msg: "success" } },
      status: 200,
      headers: {},
      config: {} as never,
      statusText: "OK",
    });
    mockedAxios.get.mockResolvedValue({
      data: { code: "11004", msg: "Insufficient balance", data: null },
      status: 200,
      headers: {},
      config: {} as never,
      statusText: "OK",
    });

    await expect(
      novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
        API_KEY,
      ),
    ).rejects.toMatchObject({
      code: NovadaErrorCode.INSUFFICIENT_BALANCE,
      businessCode: 11004,
    });
  });
});
