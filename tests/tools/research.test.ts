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

function extractMaterialSection(output: string): string {
  const match = output.match(/## Researched source material for:[^\n]*\n([\s\S]*?)(?=\n## Key Findings|\n---\n|$)/);
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
    // Honest framing: cited source material, not a fake "synthesized" summary.
    expect(result).toContain("## Researched source material for:");
    expect(result).not.toContain("## Summary");
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
    // The dedup invariant: 3 queries returning the same URL must collapse to ONE
    // source. Canonical check = exactly one row in the Sources table for that URL
    // (not 3). The URL is then referenced once per output section (material Source
    // line, Key Findings, Sources-table link+column) — a small fixed count, never
    // multiplied by the query count.
    const sourceTableRows = result.match(/^\| \d+ \| \[[^\]]*\]\(https:\/\/same\.com\/page\)/gm);
    expect(sourceTableRows, "the deduped URL must appear in exactly one Sources-table row").toHaveLength(1);
    const sourceMatches = result.match(/https:\/\/same\.com\/page/g);
    expect(sourceMatches).not.toBeNull();
    expect(sourceMatches!.length).toBeLessThanOrEqual(4); // material + finding + 2 table cells
  });
});

describe("novadaResearch source-material assembly", () => {
  it("extracts top source URLs and assembles cited source material", async () => {
    mockedAxios.post.mockResolvedValue(
      searchEnvelope([
        { title: "Deep Article", url: "https://example.com/article", description: "Covers the topic" },
      ])
    );
    // Rich, on-topic article body so full-content extraction fires.
    mockedAxios.get.mockResolvedValue(
      extractResponse(
        "<article><h1>Quantum Computing</h1><p>Quantum computing uses qubits that can exist in superposition, unlike classical bits which are strictly 0 or 1. Entanglement lets qubits share state so that operating on one instantly affects another. These properties let quantum computers explore many solutions in parallel for certain problems.</p></article>"
      )
    );

    const result = await novadaResearch({ question: "What is quantum computing?", depth: "quick" }, "test-key");
    // Sources section present with the extracted source marked full.
    expect(result).toContain("## Sources");
    expect(result).toContain("full content extracted");
    // Honest framing: grounded cited source material, not a claimed synthesis.
    expect(result).toMatch(/material:grounded/);
    expect(result).not.toMatch(/synthesis:(ok|weak)/);
    expect(result).toContain("answer_ready:true");
  });

  it("assembles substantive cited per-source material an agent can answer from in one call", async () => {
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

    const material = extractMaterialSection(result);
    // Substantive relevant material (multi-sentence, not a one-liner) that answers the question.
    expect(material.length).toBeGreaterThan(120);
    expect(material).toMatch(/QUIC/);
    expect(material).toMatch(/TCP|UDP/);
    // Per-source cited extract, tagged as grounded full-body material.
    expect(material).toMatch(/### \[1\]/);
    expect(material).toMatch(/Source: https:\/\/example\.com\/http3/);
    // Honest framing — NEVER claims "synthesized".
    expect(result).not.toMatch(/synthesis:(ok|weak)/);
    expect(result).not.toMatch(/\bsynthesized\b/i);
    // No raw DOM / markdown-link debris in the material.
    expect(material).not.toContain("](/");
    expect(material).not.toMatch(/^path:/m);
    // Agent Action tells the consuming agent to compose the answer — no follow-up calls.
    expect(result).toContain("answer_ready:true");
    expect(result).toMatch(/no further calls needed/i);
  });

  it("degrades to snippet-grounded material (not a to-do dump) when extraction yields no clean body", async () => {
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

    const material = extractMaterialSection(result);
    expect(material.length).toBeGreaterThan(0);
    // Never nav debris in the material section.
    expect(material).not.toContain("](/support)");
    expect(material).not.toContain("[![");
    // Falls back to the clean on-topic snippet (material:snippets), and it is cited —
    // NOT a bare "go extract yourself" to-do.
    expect(result).toMatch(/material:snippets/);
    expect(material).toMatch(/autoscal|kubernetes|replica|utilis/i);
    expect(result).not.toMatch(/go extract yourself/i);
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

  it("emits 4 phase updates (search → collect → extract → assemble) on the success path", async () => {
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
    // Phase 4 assembles cited source material (honest framing — not "synthesizing").
    expect(updates[3].message).toMatch(/Assembling|source material/i);
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
