import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

// Must come after mock setup
const { checkTaskExists, novadaScraperStatus } = await import("../../src/tools/scraper_status.js");

const TASK_ID = "resume-task-abc123";

// devApiPost unwraps the {code, msg, data} envelope, so the parsed value
// checkTaskExists/novadaScraperStatus see is whatever we put in `data` here.
// LIVE API shape (verified 2026-08-03): POST /v1/scraper/task_status returns
// { list: [{ task_id, status }] } — NOT a flat { status }. That is the shape
// these tests must exercise to catch a regression to flat-only parsing.
function mockTaskStatusList(items: Array<{ task_id?: string; status?: string; msg?: string }>) {
  mockedAxios.post.mockResolvedValue({
    data: { code: 0, msg: "success", data: { list: items } },
    status: 200,
    headers: {},
    config: {} as never,
    statusText: "OK",
  });
}

// Legacy flat shape — must still work (backward-compat), per extractRawTaskStatus.
function mockTaskStatusFlat(status: string) {
  mockedAxios.post.mockResolvedValue({
    data: { code: 0, msg: "success", data: { task_id: TASK_ID, status } },
    status: 200,
    headers: {},
    config: {} as never,
    statusText: "OK",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkTaskExists — POST /v1/scraper/task_status list-shape parsing (TOW2-257 re-review)", () => {
  it('Running(list) → "exists" — would FAIL if flat-only parse were restored', async () => {
    mockTaskStatusList([{ task_id: TASK_ID, status: "Running" }]);
    const result = await checkTaskExists(TASK_ID, "test-key");
    expect(result).toBe("exists");
  });

  it('{list:[]} (empty list) → "not_found"', async () => {
    mockTaskStatusList([]);
    const result = await checkTaskExists(TASK_ID, "test-key");
    expect(result).toBe("not_found");
  });

  it('legacy flat {status:"Running"} → "exists" (backward-compat)', async () => {
    mockTaskStatusFlat("Running");
    const result = await checkTaskExists(TASK_ID, "test-key");
    expect(result).toBe("exists");
  });
});

describe("novadaScraperStatus — POST /v1/scraper/task_status list-shape parsing (TOW2-257 re-review)", () => {
  it('Running(list) → parsed status "running" — would FAIL if flat-only parse were restored', async () => {
    mockTaskStatusList([{ task_id: TASK_ID, status: "Running" }]);
    const result = await novadaScraperStatus({ task_id: TASK_ID }, "test-key");
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("running");
  });

  it('Ready(list) → "complete"', async () => {
    mockTaskStatusList([{ task_id: TASK_ID, status: "Ready" }]);
    const result = await novadaScraperStatus({ task_id: TASK_ID }, "test-key");
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("complete");
  });

  it('Failed(list, msg:"boom") → "failed" and error contains "boom"', async () => {
    mockTaskStatusList([{ task_id: TASK_ID, status: "Failed", msg: "boom" }]);
    const result = await novadaScraperStatus({ task_id: TASK_ID }, "test-key");
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("failed");
    expect(parsed.error).toContain("boom");
  });

  it('empty list → "not_found"', async () => {
    mockTaskStatusList([]);
    const result = await novadaScraperStatus({ task_id: TASK_ID }, "test-key");
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("not_found");
  });
});
