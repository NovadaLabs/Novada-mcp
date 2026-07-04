import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaResearch } from "../../src/tools/research.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-123";

beforeEach(() => {
  vi.clearAllMocks();
});

// Search envelope shape the current search.ts parser reads:
//   body.data.data.json[0].rest.organic
const searchEnvelope = (org: { title: string; url: string; description: string }[]) => ({
  data: { code: 0, data: { data: { json: [{ rest: { organic: org } }] } } },
  status: 200,
  headers: {},
  config: {} as never,
  statusText: "OK",
});

const extractResponse = (body: string) => ({
  data: `<html><body>${body}</body></html>`,
  status: 200,
  headers: {},
  config: {} as never,
  statusText: "OK",
});

function extractSummarySection(output: string): string {
  const match = output.match(/## Summary\n([\s\S]*?)(?=\n## |\n---\n|$)/);
  return match ? match[1].trim() : "";
}

describe("novadaResearch", () => {
  it("produces a research report with the current section contract", async () => {
    mockedAxios.post.mockResolvedValue(
      searchEnvelope([
        { title: "Source 1", url: "https://source1.com", description: "Info about topic" },
        { title: "Source 2", url: "https://source2.com", description: "More info" },
      ])
    );
    mockedAxios.get.mockResolvedValue(
      extractResponse("<article><p>AI agents work by combining a language model with tools and a planning loop that decides which action to take next based on observations.</p></article>")
    );

    const result = await novadaResearch({ question: "How do AI agents work?", depth: "quick" }, API_KEY);
    expect(result).toContain("## Research:");
    expect(result).toContain("How do AI agents work?");
    expect(result).toContain("## Summary");
    expect(result).toContain("## Key Findings");
    expect(result).toContain("## Sources");
    // quick = 3 queries
    expect(mockedAxios.post.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("reports failed searches in output", async () => {
    let callCount = 0;
    mockedAxios.post.mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) throw new Error("Network error");
      return searchEnvelope([{ title: "Success", url: "https://ok.com", description: "Worked and returned useful info about the subject" }]);
    });
    mockedAxios.get.mockResolvedValue(
      extractResponse("<article><p>The subject is well understood and this page explains it in detail with worked examples.</p></article>")
    );

    const result = await novadaResearch({ question: "Test with failures please", depth: "quick" }, API_KEY);
    // Some queries fail — the report must surface that (failed_queries / note).
    expect(result.toLowerCase()).toContain("fail");
  });

  it("deep mode generates more queries", async () => {
    mockedAxios.post.mockResolvedValue(
      searchEnvelope([{ title: "Result", url: "https://r.com", description: "Desc" }])
    );
    mockedAxios.get.mockResolvedValue(
      extractResponse("<article><p>This topic has many aspects worth comparing in depth across different dimensions.</p></article>")
    );

    const result = await novadaResearch({ question: "Complex topic with many aspects to compare", depth: "deep" }, API_KEY);
    expect(result).toContain("deep");
    // deep = 5-6 queries
    expect(mockedAxios.post.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("deduplicates sources across queries", async () => {
    mockedAxios.post.mockResolvedValue(
      searchEnvelope([
        { title: "Dedup Test Guide", url: "https://same.com/page", description: "A guide about dedup test query here" },
      ])
    );
    mockedAxios.get.mockResolvedValue(
      extractResponse("<article><p>A dedup test query is answered here with a clear and detailed explanation of the concept.</p></article>")
    );

    const result = await novadaResearch({ question: "Dedup test query here", depth: "quick" }, API_KEY);
    // Even though 3 queries all return the same URL, it appears a bounded number of times.
    const sourceMatches = result.match(/https:\/\/same\.com\/page/g);
    expect(sourceMatches).not.toBeNull();
    expect(sourceMatches!.length).toBeLessThanOrEqual(3);
  });
});

describe("novadaResearch source extraction + synthesis", () => {
  it("extracts top source URLs and synthesizes a cited answer", async () => {
    mockedAxios.post.mockResolvedValue(
      searchEnvelope([
        { title: "Deep Article", url: "https://example.com/article", description: "Covers the topic" },
      ])
    );
    // Rich, on-topic article body so full-content extraction + synthesis fires.
    mockedAxios.get.mockResolvedValue(
      extractResponse(
        "<article><h1>Quantum Computing</h1><p>Quantum computing uses qubits that can exist in superposition, unlike classical bits which are strictly 0 or 1. Entanglement lets qubits share state so that operating on one instantly affects another. These properties let quantum computers explore many solutions in parallel for certain problems.</p></article>"
      )
    );

    const result = await novadaResearch({ question: "What is quantum computing?", depth: "quick" }, "test-key");
    // Sources section present with the extracted source marked full.
    expect(result).toContain("## Sources");
    expect(result).toContain("full content extracted");
    // The synthesis must have run over the extracted body.
    expect(result).toMatch(/synthesis:(ok|weak)/);
    expect(result).toContain("answer_ready:true");
  });

  it("Summary is synthesized prose about the question, not a snippet dump or 'synthesis:weak' to-do", async () => {
    mockedAxios.post.mockResolvedValue(
      searchEnvelope([
        { title: "HTTP/3 explainer", url: "https://example.com/http3", description: "HTTP/3 over QUIC" },
      ])
    );
    mockedAxios.get.mockResolvedValue(
      extractResponse(
        "<article><p>The main difference between HTTP/2 and HTTP/3 is the transport layer. HTTP/2 runs over TCP while HTTP/3 runs over QUIC, which is built on UDP. QUIC removes the head-of-line blocking that affects HTTP/2 under packet loss, and it establishes secure connections in a single round trip.</p></article>"
      )
    );

    const result = await novadaResearch(
      { question: "What are the main differences between HTTP/2 and HTTP/3?", depth: "quick" },
      "test-key"
    );

    const summary = extractSummarySection(result);
    // Real synthesized prose that actually answers the question.
    expect(summary.length).toBeGreaterThan(40);
    expect(summary).toMatch(/QUIC/);
    expect(summary).toMatch(/TCP|UDP/);
    // NOT the honest-failure sentinel, NOT a bare "go extract yourself" dump.
    expect(summary).not.toMatch(/Could not synthesize/i);
    expect(summary).not.toMatch(/go extract/i);
    // No raw DOM / markdown-link debris in the headline deliverable.
    expect(summary).not.toContain("](/");
    expect(summary).not.toMatch(/^path:/m);
    // Cited into the Sources table via [n] markers.
    expect(summary).toMatch(/\[\d+\]/);
    // Success signal — the answer is ready to relay.
    expect(result).toContain("answer_ready:true");
  });

  it("degrades to snippet-grounded prose (not a to-do dump) when extraction yields no clean body", async () => {
    // Search snippets are clean; the extracted page is pure nav debris.
    mockedAxios.post.mockResolvedValue(
      searchEnvelope([
        {
          title: "Kubernetes autoscaling",
          url: "https://example.com/k8s",
          description: "Kubernetes horizontal pod autoscaling adjusts the replica count based on observed CPU and memory utilisation.",
        },
      ])
    );
    mockedAxios.get.mockResolvedValue(
      extractResponse("<nav><ul><li><a href='/support'>Support</a></li><li><a href='/pricing'>Pricing</a></li></ul></nav>")
    );

    const result = await novadaResearch(
      { question: "How does Kubernetes autoscaling work?", depth: "quick" },
      "test-key"
    );

    const summary = extractSummarySection(result);
    expect(summary.length).toBeGreaterThan(0);
    // Either a real snippet-grounded paragraph, or the honest sentinel — never nav debris.
    expect(summary).not.toContain("](/support)");
    expect(summary).not.toContain("[![");
    // If it synthesized, it must be about the question and cited; if it honestly
    // failed, it must point at Key Findings — but in NO case a bare snippet list header.
    const honest = /Could not synthesize/i.test(summary);
    const synthesized = /autoscal|kubernetes|replica|utilis/i.test(summary) && /\[\d+\]/.test(summary);
    expect(honest || synthesized).toBe(true);
  });
});

describe("novadaResearch progress notifications (NOV-319)", () => {
  const searchEnvelopeP = (org: { title: string; url: string; description: string }[]) => ({
    data: { code: 0, data: { data: { json: [{ rest: { organic: org } }] } } },
    status: 200,
    headers: {},
    config: {} as never,
    statusText: "OK",
  });

  it("emits 4 phase updates (search → collect → extract → synthesize) on the success path", async () => {
    mockedAxios.post.mockResolvedValue(
      searchEnvelopeP([{ title: "Src", url: "https://src.example.com", description: "About the topic" }])
    );
    mockedAxios.get.mockResolvedValue({
      data: "<html><body><h1>Src</h1><p>" + "body text ".repeat(30) + "</p></body></html>",
      status: 200,
      headers: {},
      config: {} as never,
      statusText: "OK",
    });

    const updates: { progress: number; total?: number; message?: string }[] = [];
    await novadaResearch(
      { question: "How do AI agents work?", depth: "quick" },
      "test-key",
      (info) => {
        updates.push(info);
      }
    );

    expect(updates.map((u) => u.progress)).toEqual([1, 2, 3, 4]);
    expect(updates.every((u) => u.total === 4)).toBe(true);
    expect(updates[0].message).toMatch(/Searching/i);
    expect(updates[3].message).toMatch(/Synthesiz/i);
  });

  it("is a no-op without a callback and swallows reporter errors", async () => {
    mockedAxios.post.mockResolvedValue(
      searchEnvelopeP([{ title: "S", url: "https://s.example.com", description: "x" }])
    );
    mockedAxios.get.mockResolvedValue({
      data: "<html><body><p>" + "w ".repeat(40) + "</p></body></html>",
      status: 200,
      headers: {},
      config: {} as never,
      statusText: "OK",
    });

    await expect(
      novadaResearch({ question: "test topic here", depth: "quick" }, "test-key")
    ).resolves.toBeTypeOf("string");

    await expect(
      novadaResearch(
        { question: "test topic here", depth: "quick" },
        "test-key",
        () => {
          throw new Error("reporter blew up");
        }
      )
    ).resolves.toBeTypeOf("string");
  });
});
