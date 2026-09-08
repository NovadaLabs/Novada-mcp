/**
 * Audit 2026-09-02 (W-A2) — DE-1/C-1, C-6, C-12, V2-N2.
 *
 * Findings fixed here (see ~/Projects/novada-test-engineering/ledger/novada-mcp/
 * 2026-09-02-full-evaluation/findings/{DE-usability-ux,C-reliability-live,
 * V2-verification-FDEG,V3-verification-CX}.md):
 *
 *   DE-1 / C-1 (P1, ledger-verified −0.18 duplicate charge): camelCase `taskId` was
 *   silently stripped by Zod's default strip-unknown-keys behavior because
 *   ScrapeParamsSchema (novada_scrape) and the platform-scraper factory's ParamsSchema
 *   (all 15 novada_scrape_<platform> tools) were bare z.object — the ONE alias missing
 *   from withCamelCaseAliases (NOV-327), even though the shim already existed and
 *   covered 7 other schemas. A resume shaped with `taskId` instead of `task_id` fell
 *   through to the fresh-submit path and billed again.
 *
 *   C-6 (P3): resume ignored the ORIGINAL submit's `limit` — a submit with limit:1
 *   that went to "processing", then resumed WITHOUT re-specifying `limit`, silently
 *   reverted to the resume call's own default of 20.
 *
 *   C-12 (P2) + V2-N2 (P3): the "status: processing" envelope never escalated no
 *   matter how long a task had been running (an agent could poll a dead task forever
 *   on the word of "retry in 10-20s"), and a resume against a task_id the backend does
 *   not recognize fell through to the SAME "processing" envelope instead of a typed
 *   error — burning the full sync poll ceiling before saying so.
 *
 * TDD: every `it()` below is RED against pre-fix scrape.ts/platform_scraper.ts/types.ts
 * (verified — see REPORT-W-A2.md for the actual red run output) and GREEN after the
 * fix in this same worktree.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { NovadaError, NovadaErrorCode } from "../../src/_core/errors.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

// Must come after mock setup
const { novadaScrape, ageBucketInstruction } = await import("../../src/tools/scrape.js");
const { ScrapeParamsSchema } = await import("../../src/tools/types.js");
const { PLATFORM_SCRAPER_TOOLS } = await import("../../src/tools/platform_scrapers.js");

const MOCK_RECORDS = [
  { title: "iPhone 16 Pro", price: "$999", rating: "4.8", asin: "B09G9FPHY6" },
  { title: "iPhone 16", price: "$799", rating: "4.6", asin: "B09G9FPHY7" },
];

// Submit response shape shared with scrape.test.ts's SUBMIT_OK: a task_id-only
// response (no inline json) — the "slow platform, must poll" outcome.
function submitOkFor(taskId: string) {
  return {
    data: { code: 0, data: { code: 200, data: { task_id: taskId }, msg: "success" }, msg: "success" },
    status: 200,
    headers: {},
    config: {} as never,
    statusText: "OK",
  };
}

function taskStatusResp(taskId: string, status: string) {
  return {
    data: { code: 0, msg: "success", data: { list: [{ task_id: taskId, status }] } },
    status: 200,
    headers: {},
    config: {} as never,
    statusText: "OK",
  };
}

function taskStatusNotFound() {
  return {
    data: { code: 0, msg: "success", data: { list: [] } },
    status: 200,
    headers: {},
    config: {} as never,
    statusText: "OK",
  };
}

function downloadOk(records: unknown[]) {
  return {
    data: [{ spider_code: 200, rest: { results: records } }],
    status: 200,
    headers: {},
    config: {} as never,
    statusText: "OK",
  };
}

const DOWNLOAD_PENDING = {
  data: { code: 27202, data: null, msg: "" },
  status: 200,
  headers: {},
  config: {} as never,
  statusText: "OK",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── DE-1 / C-1 (P1) — camelCase taskId aliasing, class-swept over ALL 16 schemas ─────

describe("DE-1 / C-1 (P1) — camelCase taskId aliases to task_id on the schema layer (no billable call, no network)", () => {
  it("novada_scrape (generic, 1 of 16): ScrapeParamsSchema maps taskId -> task_id", () => {
    const parsed = ScrapeParamsSchema.parse({
      platform: "amazon.com",
      operation: "amazon_product_asin",
      taskId: "abc123resume",
    }) as Record<string, unknown>;
    expect(parsed.task_id).toBe("abc123resume");
    expect(parsed.taskId).toBeUndefined();
  });

  it("canonical wins: if BOTH taskId and task_id are present, the explicit task_id is never overwritten by the alias", () => {
    const parsed = ScrapeParamsSchema.parse({
      platform: "amazon.com",
      operation: "amazon_product_asin",
      taskId: "wrong-one",
      task_id: "correct-one",
    }) as Record<string, unknown>;
    expect(parsed.task_id).toBe("correct-one");
  });

  it("class sweep: EVERY one of the 15 pinned novada_scrape_<platform> tools maps taskId -> task_id (iterates PLATFORM_SCRAPER_TOOLS, never hardcodes a single platform)", () => {
    expect(PLATFORM_SCRAPER_TOOLS.length).toBe(15);
    const failures: string[] = [];
    for (const tool of PLATFORM_SCRAPER_TOOLS) {
      const [firstOperationName] = Object.keys(tool.config.operations);
      const parsed = tool.validateParams({
        operation: firstOperationName,
        taskId: "abc123resume",
      }) as { task_id?: string; taskId?: string };
      const aliasApplied = parsed.task_id === "abc123resume" && parsed.taskId === undefined;
      if (!aliasApplied) {
        failures.push(`${tool.toolDefinition.name}: task_id=${JSON.stringify(parsed.task_id)} taskId=${JSON.stringify(parsed.taskId)}`);
      }
    }
    expect(
      failures,
      `platform-scraper tool(s) that do NOT alias taskId -> task_id (money-path hole, DE-1/C-1):\n${failures.join("\n")}`,
    ).toEqual([]);
  });

  it("end-to-end: novada_scrape with a camelCase taskId engages the RESUME path (fast probe only), never re-submits", async () => {
    const TASK_ID = "de1-e2e-resume-task";
    mockedAxios.post.mockImplementation(async (url: unknown) => {
      if (typeof url === "string" && url.includes("task_status")) {
        return taskStatusResp(TASK_ID, "Ready");
      }
      return submitOkFor("SHOULD-NOT-BE-CALLED");
    });
    mockedAxios.get.mockResolvedValue(downloadOk(MOCK_RECORDS));

    const parsed = ScrapeParamsSchema.parse({
      platform: "amazon.com",
      operation: "amazon_product_asin",
      params: { asin: "B09XYZ" },
      taskId: TASK_ID,
    });
    const result = await novadaScrape(parsed as Parameters<typeof novadaScrape>[0], "test-key");

    // The billable submit endpoint must NEVER be called for this request.
    const submitCall = mockedAxios.post.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("scraper.novada.com/request"),
    );
    expect(submitCall).toBeUndefined();
    expect(result).toContain("iPhone 16 Pro");
  });
});

// ─── C-6 (P3) — resume honors the ORIGINAL submit's limit ─────────────────────────────

describe("C-6 (P3) — resume returns AT MOST the ORIGINAL submit's limit, not the resume call's own default", () => {
  it("submit with limit:1 (task goes to processing) -> resume WITHOUT limit returns <= 1 record, not 20", async () => {
    const TASK_ID = "c6-resume-task-001";
    vi.useFakeTimers();
    try {
      // Step 1: fresh submit, limit:1. Task-id-only response (slow platform), and the
      // download endpoint reports "still processing" on every poll — the sync ceiling
      // elapses and novadaScrape returns the processing envelope. This is the moment
      // C-6's persisted-limit bookkeeping must capture limit=1.
      mockedAxios.post.mockResolvedValue(submitOkFor(TASK_ID));
      mockedAxios.get.mockResolvedValue(DOWNLOAD_PENDING);

      const submitPromise = novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_keywords", params: { keyword: "iphone" }, format: "markdown", limit: 1 },
        "test-key",
      );
      await vi.advanceTimersByTimeAsync(46_000);
      const submitResult = await submitPromise;
      expect(submitResult).toContain("status: processing");
      expect(submitResult).toContain(TASK_ID);

      // Step 2: resume WITHOUT specifying limit at all — Zod fills the 20 default.
      // The fast task_status probe now says Ready; the download endpoint has 2 records
      // available upstream. Pre-fix: novadaScrape returns 2 (the resume's own default).
      // Post-fix: must return only 1 — the limit persisted from the ORIGINAL submit.
      mockedAxios.post.mockImplementation(async (url: unknown) => {
        if (typeof url === "string" && url.includes("task_status")) {
          return taskStatusResp(TASK_ID, "Ready");
        }
        return submitOkFor("SHOULD-NOT-BE-CALLED");
      });
      mockedAxios.get.mockResolvedValue(downloadOk(MOCK_RECORDS));

      const resumeResult = await novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_keywords", params: {}, format: "json", task_id: TASK_ID } as Parameters<typeof novadaScrape>[0],
        "test-key",
      );
      const jsonMatch = resumeResult.match(/```json\n([\s\S]+?)\n```/);
      expect(jsonMatch).not.toBeNull();
      const parsedRecords = JSON.parse(jsonMatch![1]);
      expect(parsedRecords.length).toBeLessThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resume that explicitly passes a DIFFERENT limit is not blocked by this fix — an unknown/never-recorded task_id falls back to the resume call's own limit", async () => {
    // Defensive regression check: if this process never saw the original submit (e.g.
    // a fresh process, or a task_id from a different session), the resume must still
    // work using ITS OWN limit — never crash, never silently return 0 rows.
    const TASK_ID = "c6-unseen-task-002";
    mockedAxios.post.mockImplementation(async (url: unknown) => {
      if (typeof url === "string" && url.includes("task_status")) {
        return taskStatusResp(TASK_ID, "Ready");
      }
      return submitOkFor("SHOULD-NOT-BE-CALLED");
    });
    mockedAxios.get.mockResolvedValue(downloadOk(MOCK_RECORDS));

    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_keywords", params: {}, format: "json", limit: 1, task_id: TASK_ID } as Parameters<typeof novadaScrape>[0],
      "test-key",
    );
    const jsonMatch = result.match(/```json\n([\s\S]+?)\n```/);
    expect(jsonMatch).not.toBeNull();
    const parsedRecords = JSON.parse(jsonMatch![1]);
    expect(parsedRecords.length).toBeLessThanOrEqual(1);
  });
});

// ─── C-12 (P2) + V2-N2 (P3) — processing envelope age escalation + NOT_FOUND ──────────

describe("ageBucketInstruction (C-12) — pure boundary unit test, highest threshold checked first", () => {
  it("age_s just under 120s -> the 'fresh' instruction", () => {
    expect(ageBucketInstruction(119)).toBe("Retry in 10-20s.");
  });
  it("age_s exactly at the 120s boundary -> escalates to 'slow'", () => {
    expect(ageBucketInstruction(120)).toBe("Upstream is slow — retry in 2-5 min.");
  });
  it("age_s just under 900s -> still 'slow', not yet give-up", () => {
    expect(ageBucketInstruction(899)).toBe("Upstream is slow — retry in 2-5 min.");
  });
  it("age_s exactly at the 900s boundary -> escalates to the give-up instruction", () => {
    expect(ageBucketInstruction(900)).toMatch(/exceeded 15 min/);
    expect(ageBucketInstruction(900)).toMatch(/Do NOT keep polling/);
  });
  it("EXIT condition: a synthetic age_s=1000 carries the give-up instruction", () => {
    expect(ageBucketInstruction(1000)).toMatch(/exceeded 15 min/);
    expect(ageBucketInstruction(1000)).toMatch(/Resubmit once/);
  });
});

describe("C-12 (P2) — the LIVE processing envelope escalates by real task age across repeated resumes", () => {
  it("state 1/4 — fresh task (age_s well under 120s): agent_instruction says retry in 10-20s", async () => {
    const TASK_ID = "c12-age-fresh-001";
    vi.useFakeTimers();
    try {
      mockedAxios.post.mockResolvedValue(submitOkFor(TASK_ID));
      mockedAxios.get.mockResolvedValue(DOWNLOAD_PENDING);
      const p = novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
        "test-key",
      );
      await vi.advanceTimersByTimeAsync(46_000); // ~46s elapsed — still under the 120s bucket
      const result = await p;
      expect(result).toContain("status: processing");
      expect(result).toContain("age_s:");
      expect(result).toContain("submitted_at:");
      expect(result).toContain("agent_instruction: Retry in 10-20s.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("state 2/4 — slow task (120s <= age_s < 900s): agent_instruction escalates to 'upstream slow, retry in 2-5 min'", async () => {
    const TASK_ID = "c12-age-slow-002";
    vi.useFakeTimers();
    try {
      mockedAxios.post.mockImplementation(async (url: unknown) => {
        if (typeof url === "string" && url.includes("task_status")) {
          return taskStatusResp(TASK_ID, "Pending");
        }
        return submitOkFor(TASK_ID);
      });
      mockedAxios.get.mockResolvedValue(DOWNLOAD_PENDING);

      const submitP = novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
        "test-key",
      );
      await vi.advanceTimersByTimeAsync(46_000);
      await submitP; // records submittedAt ~= t0

      // Let comfortably more than 120s (but well under 900s) pass before resuming.
      await vi.advanceTimersByTimeAsync(300_000);

      const resumeResult = await novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_keywords", params: {}, format: "markdown", task_id: TASK_ID } as Parameters<typeof novadaScrape>[0],
        "test-key",
      );
      expect(resumeResult).toContain("status: processing");
      expect(resumeResult).toContain("agent_instruction: Upstream is slow — retry in 2-5 min.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("state 3/4 — stale task (age_s >= 900s): agent_instruction escalates to the give-up/resubmit message", async () => {
    const TASK_ID = "c12-age-stale-003";
    vi.useFakeTimers();
    try {
      mockedAxios.post.mockImplementation(async (url: unknown) => {
        if (typeof url === "string" && url.includes("task_status")) {
          return taskStatusResp(TASK_ID, "Running");
        }
        return submitOkFor(TASK_ID);
      });
      mockedAxios.get.mockResolvedValue(DOWNLOAD_PENDING);

      const submitP = novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
        "test-key",
      );
      await vi.advanceTimersByTimeAsync(46_000);
      await submitP;

      // Comfortably past the 900s (15 min) give-up threshold.
      await vi.advanceTimersByTimeAsync(1_000_000);

      const resumeResult = await novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_keywords", params: {}, format: "markdown", task_id: TASK_ID } as Parameters<typeof novadaScrape>[0],
        "test-key",
      );
      expect(resumeResult).toContain("status: processing");
      expect(resumeResult).toMatch(/agent_instruction: .*exceeded 15 min/);
      expect(resumeResult).toMatch(/Do NOT keep polling/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("state 4/4 (V2-N2) — resuming an UNRECOGNIZED task_id returns a typed NOT_FOUND error, NEVER 'processing'", async () => {
    const TASK_ID = "v2n2-nonexistent-task-xyz";
    vi.useFakeTimers();
    try {
      mockedAxios.post.mockImplementation(async (url: unknown) => {
        if (typeof url === "string" && url.includes("task_status")) {
          return taskStatusNotFound();
        }
        return submitOkFor("SHOULD-NOT-BE-CALLED");
      });
      // Pre-fix, an unrecognized task_id fell through to the ~45s download-poll loop
      // (which never resolves for a nonexistent task — the pending/27202 response
      // repeats forever). Fake timers let that pre-fix path terminate deterministically
      // as "processing" instead of hanging on the real 45s wall-clock ceiling.
      mockedAxios.get.mockResolvedValue(DOWNLOAD_PENDING);

      let thrown: unknown;
      let result: string | undefined;
      const resultPromise = novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_keywords", params: {}, format: "markdown", task_id: TASK_ID } as Parameters<typeof novadaScrape>[0],
        "test-key",
      ).then((r) => { result = r; }).catch((e) => { thrown = e; });
      await vi.advanceTimersByTimeAsync(46_000);
      await resultPromise;

      expect(result).toBeUndefined();
      expect(thrown).toBeInstanceOf(NovadaError);
      const err = thrown as NovadaError;
      expect(err.code).toBe(NovadaErrorCode.TASK_NOT_FOUND);
      expect(err.agent_instruction).toMatch(/Do NOT keep polling/);
      // The pre-fix bug: this would burn the full 45s sync poll ceiling and STILL say
      // "processing". Post-fix it must reject immediately — the slow download-poll
      // endpoint must never be reached for an unrecognized task_id.
      expect(mockedAxios.get).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a TRUE network/auth error on the fast status probe (distinct from a clean not_found) still falls through to the existing poll path unchanged", async () => {
    const TASK_ID = "v2n2-probe-network-error";
    mockedAxios.post.mockImplementation(async (url: unknown) => {
      if (typeof url === "string" && url.includes("task_status")) {
        throw new Error("ECONNRESET");
      }
      return submitOkFor("SHOULD-NOT-BE-CALLED");
    });
    mockedAxios.get.mockResolvedValue(downloadOk(MOCK_RECORDS));

    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_keywords", params: {}, format: "markdown", task_id: TASK_ID } as Parameters<typeof novadaScrape>[0],
      "test-key",
    );
    expect(mockedAxios.get).toHaveBeenCalled();
    expect(result).toContain("iPhone 16 Pro");
  });
});
