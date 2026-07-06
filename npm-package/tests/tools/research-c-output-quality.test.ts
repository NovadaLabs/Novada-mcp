/**
 * C-audit regression: novada_research ## Summary must be clean synthesized prose,
 * never raw scraped nav/DOM debris (contract R9).
 *
 * Reproduces the hosted failure captured in /tmp/hfc/qa/out/research.raw where the
 * Summary opened with `path: ... ](/support) ... LM Community ... [![Ably logo]`.
 * The extracted pages were LINK/NAV debris; the search SNIPPETS were clean. The fix
 * must strip inline markdown/URL debris, fall back to the clean snippets, or honestly
 * report "could not synthesize" — never emit the debris.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaResearch } from "../../src/tools/research.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-c-output";

beforeEach(() => {
  vi.clearAllMocks();
});

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

const LOGICMONITOR_DEBRIS = `
<nav>
  <ul>
    <li><a href="/support">Release notes, and support resources.</a></li>
    <li><a href="https://community.logicmonitor.com">LM Community Join the community to learn from peers, ask questions, and connect with experts.</a></li>
  </ul>
</nav>
`;
const ABLY_DEBRIS = `<div><img src="https://voltaire.ably.com/static/ably-logo.png" alt="Ably logo"><a href="/pricing">Pricing</a></div>`;

const CLEAN_HTTP3 = `<article><p>The main distinction between HTTP/2 and HTTP/3 lies in their underlying transport protocols. HTTP/2 runs over TCP while HTTP/3 runs over QUIC, which itself runs over UDP. QUIC eliminates head-of-line blocking that affects HTTP/2 over TCP. This makes HTTP/3 more resilient on lossy networks and faster to establish connections.</p></article>`;

describe("C-audit R9: research source material is clean, never DOM debris, honestly framed", () => {
  it("output is framed as cited SOURCE MATERIAL, never claims 'synthesized'", async () => {
    mockedAxios.post.mockResolvedValue(
      searchEnvelope([
        { title: "HTTP/3 vs HTTP/2", url: "https://example.com/http3", description: "HTTP/3 uses QUIC over UDP." },
      ])
    );
    mockedAxios.get.mockResolvedValue(extractResponse(CLEAN_HTTP3));

    const result = await novadaResearch(
      { question: "What are the main differences between HTTP/2 and HTTP/3?", depth: "quick" },
      API_KEY
    );

    // Honest framing: the tool assembles source material; it does NOT claim to have
    // synthesized/written the answer. The consuming agent does that.
    expect(result).toContain("## Researched source material for:");
    expect(result).toMatch(/material:(grounded|snippets)/);
    expect(result).not.toContain("## Summary");
    expect(result).not.toMatch(/synthesis:(ok|weak)/);
    expect(result).not.toMatch(/\bsynthesized\b/i);
  });

  it("debris-only extracts + clean snippets => material uses snippets, no path:/](/ debris", async () => {
    mockedAxios.post.mockResolvedValue(
      searchEnvelope([
        { title: "HTTP/3 vs HTTP/2", url: "https://www.logicmonitor.com/deep-dive/http3-vs-http2/introduction", description: "The main distinction between HTTP/2 and HTTP/3 lies in their underlying transport protocols, TCP and QUIC." },
        { title: "HTTP/2 vs HTTP/3: A Comparison", url: "https://ably.com/topic/http-2-vs-http-3", description: "The fundamental difference is that HTTP/3 runs over QUIC, and QUIC runs over connectionless UDP instead of the connection-oriented TCP." },
      ])
    );
    mockedAxios.get.mockResolvedValue(extractResponse(LOGICMONITOR_DEBRIS + ABLY_DEBRIS));

    const result = await novadaResearch(
      { question: "What are the main differences between HTTP/2 and HTTP/3?", depth: "quick" },
      API_KEY
    );

    const material = extractMaterialSection(result);
    expect(material).not.toContain("](/support)");
    expect(material).not.toContain("](/");
    expect(material).not.toMatch(/^path:/m);
    expect(material).not.toContain("[![");
    expect(material).not.toContain("Ably logo");
    expect(material.length).toBeGreaterThan(0);
    // Falls back to the clean snippets — real material about the question.
    const hasAnswer = /QUIC|TCP|UDP|transport/i.test(material);
    const honest = /no clean source material|no clean extract/i.test(material);
    expect(hasAnswer || honest).toBe(true);
  });

  it("clean extracted prose => material is a substantive per-source extract (material:grounded)", async () => {
    mockedAxios.post.mockResolvedValue(
      searchEnvelope([
        { title: "HTTP/3 vs HTTP/2", url: "https://example.com/http3", description: "HTTP/3 uses QUIC over UDP." },
      ])
    );
    mockedAxios.get.mockResolvedValue(extractResponse(CLEAN_HTTP3));

    const result = await novadaResearch(
      { question: "What are the main differences between HTTP/2 and HTTP/3?", depth: "quick" },
      API_KEY
    );

    const material = extractMaterialSection(result);
    expect(material).toMatch(/QUIC/);
    expect(material).toMatch(/TCP|UDP/);
    expect(material).not.toContain("](/");
    expect(material).not.toMatch(/^path:/m);
    // Cited per-source extract, tagged as grounded (full-body) material.
    expect(material).toMatch(/### \[1\]/);
    expect(result).toMatch(/material:grounded/);
    expect(result).toContain("answer_ready:true");
    // The material must be substantive (not a one-line snippet) — the clean body has
    // multiple relevant sentences; expect more than a single short line.
    expect(material.length).toBeGreaterThan(120);
  });

  it("only debris everywhere (no usable snippets) => honest insufficiency, not debris dump", async () => {
    mockedAxios.post.mockResolvedValue(
      searchEnvelope([
        { title: "Nav page", url: "https://nav.example.com", description: "" },
      ])
    );
    mockedAxios.get.mockResolvedValue(extractResponse(LOGICMONITOR_DEBRIS));

    const result = await novadaResearch(
      { question: "What are the main differences between HTTP/2 and HTTP/3?", depth: "quick" },
      API_KEY
    );

    const material = extractMaterialSection(result);
    expect(material).not.toContain("](/support)");
    expect(material).not.toContain("LM Community");
    expect(material.length).toBeGreaterThan(0);
    // No debris masquerading as material — either honest insufficiency or a clean placeholder.
    expect(result).toMatch(/material:(insufficient|snippets)/);
  });

  it("R1: no dangling 'Research saved:' line when no file is written (hosted)", async () => {
    const prev = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      mockedAxios.post.mockResolvedValue(
        searchEnvelope([
          { title: "HTTP/3 vs HTTP/2", url: "https://example.com/http3", description: "HTTP/3 uses QUIC over UDP." },
        ])
      );
      mockedAxios.get.mockResolvedValue(extractResponse(CLEAN_HTTP3));

      const result = await novadaResearch(
        { question: "What are the main differences between HTTP/2 and HTTP/3?", depth: "quick" },
        API_KEY
      );
      expect(result).not.toMatch(/Research saved:\s*$/);
      expect(result).not.toContain("Research saved: \n");
    } finally {
      if (prev === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prev;
    }
  });
});
