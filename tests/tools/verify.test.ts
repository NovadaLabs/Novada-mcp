import { describe, it, expect, vi, beforeEach } from "vitest";
import axios, { AxiosError } from "axios";
import { novadaVerify } from "../../src/tools/verify.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-123";

beforeEach(() => {
  vi.clearAllMocks();
});

/** Build a mock SERP response with n results */
function mockResults(n: number, prefix = "Result") {
  return {
    data: {
      code: 200,
      data: {
        organic_results: Array.from({ length: n }, (_, i) => ({
          title: `${prefix} ${i + 1}`,
          url: `https://example.com/${prefix.toLowerCase()}-${i + 1}`,
          description: `${prefix} snippet ${i + 1}`,
        })),
      },
    },
  };
}

describe("novadaVerify", () => {
  it("returns supported verdict when most results are from supporting query", async () => {
    // Query 1 (supporting): 5 results, Query 2 (skeptical): 1 result, Query 3 (neutral): 2 results
    mockedAxios.post
      .mockResolvedValueOnce(mockResults(5, "Support"))   // query 1
      .mockResolvedValueOnce(mockResults(1, "Contra"))    // query 2
      .mockResolvedValueOnce(mockResults(2, "Neutral"));  // query 3

    const result = await novadaVerify(
      { claim: "The Eiffel Tower is 330 meters tall" },
      API_KEY
    );

    expect(result).toContain("verdict: supported");
    expect(result).toContain("## Claim Verification");
    expect(result).toContain("## Sources Mentioning the Claim");
    expect(result).toContain("## Contradicting Evidence");
    expect(result).toContain("## Agent Hints");
  });

  it("returns unsupported verdict when most results are contradicting", async () => {
    // Query 1 (supporting): 1 result, Query 2 (skeptical): 5 results
    mockedAxios.post
      .mockResolvedValueOnce(mockResults(1, "Support"))
      .mockResolvedValueOnce(mockResults(5, "Contra"))
      .mockResolvedValueOnce(mockResults(2, "Neutral"));

    const result = await novadaVerify(
      { claim: "The Earth is flat and does not orbit the Sun" },
      API_KEY
    );

    expect(result).toContain("verdict: unsupported");
  });

  it("returns contested when results are evenly split", async () => {
    // Query 1 (supporting): 3 results, Query 2 (skeptical): 3 results
    mockedAxios.post
      .mockResolvedValueOnce(mockResults(3, "Support"))
      .mockResolvedValueOnce(mockResults(3, "Contra"))
      .mockResolvedValueOnce(mockResults(1, "Neutral"));

    const result = await novadaVerify(
      { claim: "Coffee is healthier than tea for most adults" },
      API_KEY
    );

    expect(result).toContain("verdict: contested");
  });

  it("returns insufficient_data when all queries return 0 results", async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { code: 200, data: { organic_results: [] } } })
      .mockResolvedValueOnce({ data: { code: 200, data: { organic_results: [] } } })
      .mockResolvedValueOnce({ data: { code: 200, data: { organic_results: [] } } });

    const result = await novadaVerify(
      { claim: "A completely obscure and unverifiable claim about nothing" },
      API_KEY
    );

    expect(result).toContain("verdict: insufficient_data");
    expect(result).toContain("confidence: 0");
  });

  it("handles SERP unavailable (404) gracefully", async () => {
    const err = new AxiosError("Not Found", "ERR_BAD_RESPONSE");
    Object.defineProperty(err, "response", { value: { status: 404, data: "404 page not found" } });
    mockedAxios.post.mockRejectedValue(err);

    const result = await novadaVerify(
      { claim: "The Eiffel Tower is in Paris, France" },
      API_KEY
    );

    expect(result).toContain("Verify: Search Unavailable");
    expect(result).toContain("novada_extract");
    expect(result).not.toContain("verdict:");
  });

  it("caps confidence at 60 when a key query fails (partial failure)", async () => {
    // Query 1 (supporting) fails with network error — only skeptical returns 5 results
    mockedAxios.post
      .mockRejectedValueOnce(new Error("network error"))   // query 1 fails
      .mockResolvedValueOnce(mockResults(5, "Contra"))     // query 2 returns 5
      .mockResolvedValueOnce(mockResults(2, "Neutral"));   // query 3 ok

    const result = await novadaVerify(
      { claim: "The Great Wall of China is visible from space" },
      API_KEY
    );

    // Would be "unsupported" with confidence 100 without the fix — now capped at 60
    expect(result).toContain("verdict: unsupported");
    const confidenceMatch = result.match(/confidence:\s*(\d+)/);
    expect(confidenceMatch).not.toBeNull();
    const confidence = parseInt(confidenceMatch![1]);
    expect(confidence).toBeLessThanOrEqual(60);
    expect(result).toContain("one search query failed");
  });

  it("runs all 3 queries in parallel (axios.post called 3 times)", async () => {
    mockedAxios.post
      .mockResolvedValueOnce(mockResults(3, "Support"))
      .mockResolvedValueOnce(mockResults(1, "Contra"))
      .mockResolvedValueOnce(mockResults(2, "Neutral"));

    await novadaVerify(
      { claim: "The Great Wall of China is visible from space" },
      API_KEY
    );

    expect(mockedAxios.post).toHaveBeenCalledTimes(3);

    // Verify the 3 queries are strategically different — check the serpapi_query.q body field
    type CallBody = { serpapi_query: { q: string } };
    const queries = mockedAxios.post.mock.calls.map(c => (c[1] as CallBody).serpapi_query.q);

    // Supporting: contains the claim text but NOT debunking terms
    const hasSupporting = queries.some(q =>
      (q.includes("Great Wall") || q.includes("visible from space")) &&
      !q.includes("false") && !q.includes("debunked") && !q.includes("fact check")
    );
    // Skeptical: contains "false" or "debunked" or "incorrect"
    const hasSkeptical = queries.some(q =>
      q.includes("false") || q.includes("debunked") || q.includes("incorrect")
    );
    // Neutral: contains "fact check"
    const hasFactCheck = queries.some(q => q.includes("fact check"));

    expect(hasSupporting).toBe(true);
    expect(hasSkeptical).toBe(true);
    expect(hasFactCheck).toBe(true);
  });
});
