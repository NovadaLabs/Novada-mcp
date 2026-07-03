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

function extractSummarySection(output: string): string {
  const match = output.match(/## Summary\n([\s\S]*?)(?=\n##|\n---\n|$)/);
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

describe("C-audit R9: research Summary is clean synthesis, never DOM debris", () => {
  it("debris-only extracts + clean snippets => Summary uses snippets, no path:/](/ debris", async () => {
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

    const summary = extractSummarySection(result);
    expect(summary).not.toContain("](/support)");
    expect(summary).not.toContain("](/");
    expect(summary).not.toMatch(/^path:/m);
    expect(summary).not.toContain("[![");
    expect(summary).not.toContain("Ably logo");
    expect(summary.length).toBeGreaterThan(0);
    const hasAnswer = /QUIC|TCP|UDP|transport/i.test(summary);
    const honestFail = /could not synthesize/i.test(summary);
    expect(hasAnswer || honestFail).toBe(true);
  });

  it("clean extracted prose => Summary is coherent answer prose (synthesis:ok/weak)", async () => {
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

    const summary = extractSummarySection(result);
    expect(summary).toMatch(/QUIC/);
    expect(summary).toMatch(/TCP|UDP/);
    expect(summary).not.toContain("](/");
    expect(summary).not.toMatch(/^path:/m);
    expect(result).toMatch(/synthesis:(ok|weak)/);
  });

  it("only debris everywhere (no usable snippets) => honest, not debris dump", async () => {
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

    const summary = extractSummarySection(result);
    expect(summary).not.toContain("](/support)");
    expect(summary).not.toContain("LM Community");
    expect(summary.length).toBeGreaterThan(0);
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
