/**
 * TOW2-240 / search-C: guard against dangling novada_search_feedback references.
 *
 * novada_search (JSON format) emits an agent_instruction that tells the agent to
 * call novada_search_feedback. On the HOSTED endpoint that tool is NOT in the
 * 15-tool whitelist, so following the instruction fails.
 *
 * Fix: pass options.feedbackToolAvailable=false → the instruction must NOT
 * contain "novada_search_feedback". When true (or omitted) it may still appear.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaSearch } from "../../src/tools/search.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-tow2-240";

/** Wire a minimal Google scraper flow returning one result. */
function mockOneResult() {
  mockedAxios.post.mockResolvedValue({
    data: { code: 0, data: { task_id: "task-tow2-240" } },
  });
  mockedAxios.get.mockResolvedValue({
    data: {
      organic_results: [
        { title: "Example", url: "https://example.com/", description: "An example site." },
      ],
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TOW2-240 — search agent_instruction feedback guard (JSON format)", () => {
  it("omits novada_search_feedback from agent_instruction when feedbackToolAvailable=false", async () => {
    mockOneResult();
    const out = await novadaSearch(
      // Unique query per test to avoid the module-level 60s search cache colliding
      { query: "tow2240 feedback false query", format: "json" },
      API_KEY,
      { feedbackToolAvailable: false },
    );
    const parsed = JSON.parse(out);
    expect(parsed.agent_instruction).toBeDefined();
    expect(parsed.agent_instruction).not.toContain("novada_search_feedback");
    // Must still mention actionable next steps
    expect(parsed.agent_instruction).toContain("novada_extract");
  });

  it("includes novada_search_feedback in agent_instruction when feedbackToolAvailable=true", async () => {
    mockOneResult();
    const out = await novadaSearch(
      { query: "tow2240 feedback true query", format: "json" },
      API_KEY,
      { feedbackToolAvailable: true },
    );
    const parsed = JSON.parse(out);
    expect(parsed.agent_instruction).toContain("novada_search_feedback");
  });

  it("includes novada_search_feedback in agent_instruction when options is omitted (backward compat)", async () => {
    mockOneResult();
    const out = await novadaSearch(
      { query: "tow2240 feedback omit query", format: "json" },
      API_KEY,
    );
    const parsed = JSON.parse(out);
    expect(parsed.agent_instruction).toContain("novada_search_feedback");
  });
});
