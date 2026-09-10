/**
 * F10 — processing/resume progress semantics (battery 2026-09-10, P1-5 class).
 *
 * CONFIRMED live on hosted 0.9.37: novada_scrape_github returned a BYTE-IDENTICAL
 * "status: processing" reply after a resume round-trip (task_id=284fd32d…, previously
 * observed on amazon/x/tiktok) — an agent polling the task could not distinguish progress
 * from a stall. Class fix in the ONE shared envelope builder (processingEnvelope,
 * src/tools/scrape.ts) every processing/resume response funnels through:
 *
 *   - checked_at          — ISO timestamp of THIS poll (measure elapsed between your polls)
 *   - age_s/submitted_at  — time since the original submit (pre-existing, C-12)
 *   - poll_count          — processing responses served for this task_id by THIS server
 *                           process (per-process best-effort; the envelope itself says to
 *                           keep your own count on serverless hosting)
 *   - upstream_status     — the upstream-reported task state (pending/running/processing)
 *   - state_fingerprint   — stable hash of (task_id, upstream-reported state): SAME value
 *                           across two polls = no upstream-visible change; a DIFFERENT
 *                           value = the task state advanced (e.g. pending → running)
 *
 * CHOSEN MECHANISM (documented per the brief): the MCP server is stateless per call on
 * hosted, so "changed-vs-last-poll" cannot be a server-side diff. state_fingerprint gives
 * the agent a content-hash of the upstream-visible state to compare across its OWN polls,
 * and checked_at/age_s give it the fields to compute the time delta itself — the envelope
 * states this explicitly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

// Must come after mock setup
const { novadaScrape } = await import("../../src/tools/scrape.js");
const { PLATFORM_SCRAPER_TOOLS } = await import("../../src/tools/platform_scrapers.js");

function submitOkFor(taskId: string) {
  return {
    data: { code: 0, data: { code: 200, data: { task_id: taskId }, msg: "success" }, msg: "success" },
    status: 200, headers: {}, config: {} as never, statusText: "OK",
  };
}

const DOWNLOAD_PENDING = {
  data: { code: 27202, data: null, msg: "" },
  status: 200, headers: {}, config: {} as never, statusText: "OK",
};

/** Route axios.post by URL: fast task_status probe vs the (never-hit-on-resume) submit. */
function mockTaskStatus(taskId: string, status: string) {
  mockedAxios.post.mockImplementation(async (url: unknown) => {
    if (typeof url === "string" && url.includes("task_status")) {
      return {
        data: { code: 0, msg: "success", data: { list: [{ task_id: taskId, status }] } },
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      };
    }
    return submitOkFor("SHOULD-NOT-BE-CALLED");
  });
}

function fingerprintOf(envelope: string): string {
  const m = envelope.match(/state_fingerprint: ([0-9a-f]+)/);
  expect(m, `no state_fingerprint line in:\n${envelope}`).not.toBeNull();
  return m![1];
}

function pollCountOf(envelope: string): number {
  const m = envelope.match(/poll_count: (\d+)/);
  expect(m, `no poll_count line in:\n${envelope}`).not.toBeNull();
  return Number(m![1]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("F10 — fresh submit that rides out the sync ceiling exposes progress fields", () => {
  it("processing envelope carries checked_at / poll_count / upstream_status / state_fingerprint / age_s", async () => {
    vi.useFakeTimers();
    try {
      mockedAxios.post.mockResolvedValue(submitOkFor("f10-fresh-task-001"));
      mockedAxios.get.mockResolvedValue(DOWNLOAD_PENDING);

      const p = novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
        "test-key",
      );
      await vi.advanceTimersByTimeAsync(46_000);
      const result = await p;

      expect(result).toContain("status: processing");
      // The download endpoint (27202) does not distinguish pending from running.
      expect(result).toContain("upstream_status: processing");
      expect(result).toMatch(/checked_at: \d{4}-\d{2}-\d{2}T/);
      expect(pollCountOf(result)).toBe(1);
      expect(fingerprintOf(result)).toMatch(/^[0-9a-f]{12}$/);
      // Pre-existing C-12 fields survive.
      expect(result).toContain("submitted_at:");
      expect(result).toContain("age_s:");
      expect(result).toMatch(/agent_instruction: /);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("F10 observed fixture — github resume round-trip is never byte-identical again", () => {
  it("two consecutive resumes of a still-Running github task differ (poll_count advances), while state_fingerprint stays EQUAL (= no upstream-visible change)", async () => {
    // Exact task_id from the 2026-09-10 battery FAIL row for novada_scrape_github.
    const TASK_ID = "284fd32d82ac4a2b8209a4f11c6ad964";
    const github = PLATFORM_SCRAPER_TOOLS.find((t) => t.toolDefinition.name === "novada_scrape_github");
    expect(github, "novada_scrape_github missing from PLATFORM_SCRAPER_TOOLS").toBeDefined();
    const [opName] = Object.entries(github!.config.operations)[0]!;

    mockTaskStatus(TASK_ID, "Running");

    const first = await github!.dispatch({ operation: opName, params: {}, task_id: TASK_ID }, "test-key");
    const second = await github!.dispatch({ operation: opName, params: {}, task_id: TASK_ID }, "test-key");

    expect(first).toContain("status: processing");
    expect(second).toContain("status: processing");

    // The P1-5 bug: byte-identical replies across a resume round-trip. Now impossible —
    // poll_count (and checked_at) advance between polls.
    expect(second).not.toEqual(first);
    expect(pollCountOf(first)).toBe(1);
    expect(pollCountOf(second)).toBe(2);

    // Same upstream-reported state → SAME fingerprint: the agent can see "no upstream
    // change yet" (as opposed to merely "the reply text changed").
    expect(fingerprintOf(second)).toBe(fingerprintOf(first));

    // The resume path stays instant: the slow download endpoint is never hit.
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("state_fingerprint CHANGES when the upstream state advances (pending → running)", async () => {
    const TASK_ID = "f10-progress-task-002";

    mockTaskStatus(TASK_ID, "Pending");
    const whilePending = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_keywords", params: {}, format: "markdown", task_id: TASK_ID } as Parameters<typeof novadaScrape>[0],
      "test-key",
    );

    mockTaskStatus(TASK_ID, "Running");
    const whileRunning = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_keywords", params: {}, format: "markdown", task_id: TASK_ID } as Parameters<typeof novadaScrape>[0],
      "test-key",
    );

    expect(whilePending).toContain("upstream_status: pending");
    expect(whileRunning).toContain("upstream_status: running");
    expect(fingerprintOf(whileRunning)).not.toBe(fingerprintOf(whilePending));
  });
});

describe("F10 — the envelope documents the stateless-server delta mechanism for the agent", () => {
  it("tells the agent how to use state_fingerprint and to keep its own attempt count (serverless reset caveat)", async () => {
    const TASK_ID = "f10-doc-task-003";
    mockTaskStatus(TASK_ID, "Running");

    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_keywords", params: {}, format: "markdown", task_id: TASK_ID } as Parameters<typeof novadaScrape>[0],
      "test-key",
    );

    // The mechanism is stated IN the response, not just in code comments: compare
    // state_fingerprint across your own polls; compute time deltas from checked_at/age_s.
    expect(result).toContain("state_fingerprint");
    expect(result).toContain("your previous poll");
    // poll_count is per-server-process — agent must keep its own count on serverless.
    expect(result.toLowerCase()).toContain("keep your own");
    // Free-resume + billing honesty lines survive unchanged.
    expect(result).toContain("WITHOUT re-charging");
    expect(result).toContain("NEW billable task");
  });
});
