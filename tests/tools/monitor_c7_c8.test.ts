/**
 * Gap tests for C7 and C8 closure findings.
 *
 * C7: Requested-Fields block with conf:/source annotations remains in hashed region
 *     because stripVolatileMetadataHeader strips to FIRST `---`, not LAST.
 *
 * C8: Failed extractions (## Extract Failed / ## Extraction Error) are hashed
 *     as content and baselined. A varying error message falsely reports "changed".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/tools/extract.js", () => ({
  novadaExtract: vi.fn(),
}));

import { novadaMonitor, validateMonitorParams, resetMonitorStore } from "../../src/tools/monitor.js";
import { novadaExtract } from "../../src/tools/extract.js";

const mockedExtract = vi.mocked(novadaExtract);

beforeEach(() => {
  vi.clearAllMocks();
  resetMonitorStore();
});

// ─── C7: Requested Fields block with conf: annotation must be stripped ────────

/**
 * Build extract output that includes the ## Requested Fields block after the
 * first --- separator (as real extract.ts does when fields are requested).
 * The conf: annotation value may vary between calls (0.80 → 0.85) even when
 * the page body is unchanged.
 */
function makeExtractWithRequestedFields(opts: {
  source?: "live" | "cache";
  fetchedAt?: string;
  confScore?: number;
  sourceAnnotation?: string;
  body?: string;
}): string {
  const source = opts.source ?? "live";
  const fetchedAt = opts.fetchedAt ?? "2026-07-02T10:00:00.000Z";
  const conf = opts.confScore ?? 0.80;
  const sourceAnn = opts.sourceAnnotation ?? "json-ld";
  const body = opts.body ?? "# Example Domain\n\nThis domain is for use in illustrative examples.";

  // This mirrors the actual extract.ts output structure when fields are requested:
  // Header block → first --- → ## Requested Fields block → second --- → body
  return [
    `## Extracted Content`,
    `url: https://example.com`,
    `mode: static | source: ${source} | quality:72/100 (ok) | content_present:true | content_ok:true`,
    `quality_reasons: sufficient_text_length; has_title`,
    `fetched_at: ${fetchedAt}`,
    `title: Example Domain`,
    `chars:${body.length} | links:1`,
    ``,
    `---`,
    ``,
    `## Requested Fields`,
    `title: Example Domain *(${sourceAnn})* *(conf:${conf.toFixed(2)})*`,
    ``,
    `---`,
    ``,
    body,
  ].join("\n");
}

describe("C7: Requested Fields conf/source annotation flip must not cause false changed", () => {
  it("unchanged when only conf: score changes in Requested Fields block", async () => {
    // conf changes 0.80 → 0.85 — identical page body
    const first = makeExtractWithRequestedFields({ confScore: 0.80, fetchedAt: "2026-07-02T10:00:00.000Z" });
    const second = makeExtractWithRequestedFields({ confScore: 0.85, fetchedAt: "2026-07-02T10:01:00.000Z" });

    mockedExtract
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    const params = validateMonitorParams({ url: "https://example.com", fields: ["title"], format: "json" });

    const r1 = JSON.parse(await novadaMonitor(params, "test-key"));
    expect(r1.status).toBe("baseline_recorded");

    const r2 = JSON.parse(await novadaMonitor(params, "test-key"));
    expect(r2.status).toBe("unchanged");
  });

  it("unchanged when source annotation changes (json-ld → pattern) in Requested Fields block", async () => {
    const first = makeExtractWithRequestedFields({ sourceAnnotation: "json-ld", fetchedAt: "2026-07-02T10:00:00.000Z" });
    const second = makeExtractWithRequestedFields({ sourceAnnotation: "pattern", fetchedAt: "2026-07-02T10:01:00.000Z" });

    mockedExtract
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    const params = validateMonitorParams({ url: "https://example.com", fields: ["title"], format: "json" });

    await novadaMonitor(params, "test-key");
    const r2 = JSON.parse(await novadaMonitor(params, "test-key"));
    expect(r2.status).toBe("unchanged");
  });

  it("changed when body genuinely differs even with Requested Fields block present", async () => {
    const first = makeExtractWithRequestedFields({ body: "Original page content here." });
    const second = makeExtractWithRequestedFields({ body: "Updated page content — different now." });

    mockedExtract
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    const params = validateMonitorParams({ url: "https://example.com", fields: ["title"], format: "json" });

    await novadaMonitor(params, "test-key");
    const r2 = JSON.parse(await novadaMonitor(params, "test-key"));
    expect(r2.status).toBe("changed");
  });
});

// ─── C8: Extract failure sentinel strings must not be baselined ──────────────

describe("C8: extraction failure sentinels must not be hashed as content baseline", () => {
  it("returns error/unavailable status (NOT baseline_recorded) when extract returns ## Extract Failed sentinel", async () => {
    const failureOutput = [
      `## Extract Failed`,
      `url: https://this-host-does-not-exist-xyz.invalid`,
      ``,
      `Error: getaddrinfo ENOTFOUND this-host-does-not-exist-xyz.invalid`,
      ``,
      `## Agent Hints`,
      `- If the URL is unreachable, check the domain and try novada_map first.`,
      ``,
      `## Agent Action`,
      `agent_instruction: status:failed | verify_url_accessibility`,
    ].join("\n");

    mockedExtract.mockResolvedValueOnce(failureOutput);

    const params = validateMonitorParams({ url: "https://this-host-does-not-exist-xyz.invalid", format: "json" });
    const r1 = JSON.parse(await novadaMonitor(params, "test-key"));

    // Must NOT return baseline_recorded
    expect(r1.status).not.toBe("baseline_recorded");
    // Must return an error/unavailable status
    expect(["error", "unavailable", "extraction_failed"].some(s => r1.status === s)).toBe(true);
  });

  it("returns error/unavailable status when extract returns ## Extraction Error sentinel", async () => {
    const timeoutOutput = [
      `## Extraction Error`,
      `url: https://this-host-does-not-exist-xyz.invalid`,
      `error: Request exceeded the 60s total ceiling and was aborted.`,
      ``,
      `## Agent Action`,
      `agent_instruction: This URL took too long (>60s). Try render="static" to skip escalation.`,
    ].join("\n");

    mockedExtract.mockResolvedValueOnce(timeoutOutput);

    const params = validateMonitorParams({ url: "https://this-host-does-not-exist-xyz.invalid", format: "json" });
    const r1 = JSON.parse(await novadaMonitor(params, "test-key"));

    expect(r1.status).not.toBe("baseline_recorded");
    expect(["error", "unavailable", "extraction_failed"].some(s => r1.status === s)).toBe(true);
  });

  it("varying error message must NOT produce false changed (because error should never be baselined)", async () => {
    // Simulate two calls both returning failure but with different error text
    const fail1 = [
      `## Extract Failed`,
      `url: https://this-host-does-not-exist-xyz.invalid`,
      ``,
      `Error: getaddrinfo ENOTFOUND (attempt 1)`,
      ``,
      `## Agent Hints`,
      `- check the domain`,
    ].join("\n");

    const fail2 = [
      `## Extract Failed`,
      `url: https://this-host-does-not-exist-xyz.invalid`,
      ``,
      `Error: getaddrinfo ENOTFOUND (attempt 2, different message)`,
      ``,
      `## Agent Hints`,
      `- check the domain`,
    ].join("\n");

    mockedExtract
      .mockResolvedValueOnce(fail1)
      .mockResolvedValueOnce(fail2);

    const params = validateMonitorParams({ url: "https://this-host-does-not-exist-xyz.invalid", format: "json" });

    const r1 = JSON.parse(await novadaMonitor(params, "test-key"));
    expect(r1.status).not.toBe("baseline_recorded");

    const r2 = JSON.parse(await novadaMonitor(params, "test-key"));
    // Second call must also return error, NOT "changed"
    expect(r2.status).not.toBe("changed");
    expect(["error", "unavailable", "extraction_failed"].some(s => r2.status === s)).toBe(true);
  });

  it("markdown format also returns error status on ## Extract Failed", async () => {
    const failureOutput = [
      `## Extract Failed`,
      `url: https://this-host-does-not-exist-xyz.invalid`,
      ``,
      `Error: DNS lookup failed`,
    ].join("\n");

    mockedExtract.mockResolvedValueOnce(failureOutput);

    const params = validateMonitorParams({ url: "https://this-host-does-not-exist-xyz.invalid", format: "markdown" });
    const output = await novadaMonitor(params, "test-key");

    // Must include an error indicator, not baseline_recorded
    expect(output).not.toContain("status: baseline_recorded");
    expect(output.toLowerCase()).toMatch(/error|unavailable|failed/);
  });
});

// ─── D1: Trailer sections after body must NOT be hashed ──────────────────────

/**
 * Real extract.ts output structure — includes the full trailer after the body.
 * lastIndexOf("\n---\n") finds the LAST separator (before ## Agent Hints), so it
 * only hashes the trailer, missing body changes entirely.
 *
 * Real structure (abbreviated):
 *   Header → --- → ## Requested Fields → --- → body → --- → ## Same-Domain Links
 *   → --- → ## Extraction Diagnostics → ## Agent Memory → --- → ## Agent Hints
 *   → ## Agent Action
 */
function makeExtractWithFullTrailer(opts: {
  source?: "live" | "cache";
  fetchedAt?: string;
  confScore?: number;
  body?: string;
  agentHints?: string;
  diagnosticsFetchedAt?: string;
}): string {
  const source = opts.source ?? "live";
  const fetchedAt = opts.fetchedAt ?? "2026-07-02T10:00:00.000Z";
  const conf = opts.confScore ?? 0.80;
  const body = opts.body ?? "# Example Domain\n\nThis domain is for use in illustrative examples.";
  const agentHints = opts.agentHints ?? "- To discover more pages: novada_map with url=\"https://example.com\"";
  // Diagnostics include fetched_at which changes per call
  const diagFetchedAt = opts.diagnosticsFetchedAt ?? fetchedAt;

  return [
    `## Extracted Content`,
    `url: https://example.com`,
    `mode: static | source: ${source} | quality:72/100 (ok) | content_present:true | content_ok:true`,
    `quality_reasons: sufficient_text_length; has_title`,
    `fetched_at: ${fetchedAt}`,
    `title: Example Domain`,
    `chars:${body.length} | links:3`,
    ``,
    `---`,
    ``,
    `## Requested Fields`,
    `title: Example Domain *(json-ld)* *(conf:${conf.toFixed(2)})*`,
    ``,
    `---`,
    ``,
    body,
    ``,
    `---`,
    `## Same-Domain Links (2 of 3)`,
    `- https://example.com/page1`,
    `- https://example.com/page2`,
    ``,
    `---`,
    `## Extraction Diagnostics`,
    `- title: matched ✓ (via json-ld, conf:${conf.toFixed(2)})`,
    `- last_checked: ${diagFetchedAt}`,
    ``,
    `## Agent Memory`,
    `remember: Example Domain at https://example.com — ok quality, ${body.length} chars`,
    ``,
    `---`,
    `## Agent Hints`,
    agentHints,
    `- To discover more pages: novada_map with url="https://example.com"`,
    ``,
    `## Agent Action`,
    `agent_instruction: status:ok | content_ready | read_body`,
  ].join("\n");
}

describe("D1: full-trailer realistic mock — trailer changes must not affect hash", () => {
  it("[axis-a] unchanged when only trailer (Agent Hints / Diagnostics timestamp) changes but body is identical", async () => {
    const first = makeExtractWithFullTrailer({
      fetchedAt: "2026-07-02T10:00:00.000Z",
      agentHints: "- To discover more pages: novada_map with url=\"https://example.com\"",
      diagnosticsFetchedAt: "2026-07-02T10:00:00.000Z",
    });
    const second = makeExtractWithFullTrailer({
      fetchedAt: "2026-07-02T10:05:00.000Z",
      agentHints: "- To discover more pages: novada_map with url=\"https://example.com\"\n- Low quality on static mode",
      diagnosticsFetchedAt: "2026-07-02T10:05:00.000Z",
    });

    mockedExtract
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    const params = validateMonitorParams({ url: "https://example.com", fields: ["title"], format: "json" });

    const r1 = JSON.parse(await novadaMonitor(params, "test-key"));
    expect(r1.status).toBe("baseline_recorded");

    const r2 = JSON.parse(await novadaMonitor(params, "test-key"));
    expect(r2.status).toBe("unchanged");
  });

  it("[axis-b] changed when body changes but trailer is identical (the C7-regression axis)", async () => {
    const first = makeExtractWithFullTrailer({
      body: "# Example Domain\n\nThis domain is for use in illustrative examples in documents.",
      fetchedAt: "2026-07-02T10:00:00.000Z",
    });
    const second = makeExtractWithFullTrailer({
      body: "# Example Domain\n\nThis domain has been UPDATED with new content for testing purposes.",
      fetchedAt: "2026-07-02T10:00:00.000Z", // same timestamp, only body differs
    });

    mockedExtract
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    const params = validateMonitorParams({ url: "https://example.com", fields: ["title"], format: "json" });

    await novadaMonitor(params, "test-key");
    const r2 = JSON.parse(await novadaMonitor(params, "test-key"));
    expect(r2.status).toBe("changed");
  });
});

// ─── D1-followon: body-internal `---` must not spoof the header/body boundary ──

/**
 * Build extract output where the body contains a fenced code block that embeds
 * a bare `---` line (e.g. YAML front-matter style). Turndown preserves code
 * fences, so this is a realistic docs-page / GitHub README scenario.
 */
function makeExtractWithBodyInternalSeparator(opts: {
  fetchedAt?: string;
  aboveSection?: string;
  belowSection?: string;
}): string {
  const fetchedAt = opts.fetchedAt ?? "2026-07-02T10:00:00.000Z";
  const aboveSection = opts.aboveSection ?? "# Configuration Guide\n\nHere is the config example:";
  const belowSection = opts.belowSection ?? "## Usage\n\nAfter configuring, run the server.";

  // Body contains a fenced code block with bare --- inside (YAML front-matter style)
  const body = [
    aboveSection,
    ``,
    "```yaml",
    `---`,
    `title: My Project`,
    `version: 1.0`,
    "```",
    ``,
    belowSection,
  ].join("\n");

  return [
    `## Extracted Content`,
    `url: https://docs.example.com/config`,
    `mode: static | source: live | quality:72/100 (ok) | content_present:true | content_ok:true`,
    `quality_reasons: sufficient_text_length; has_title`,
    `fetched_at: ${fetchedAt}`,
    `title: Configuration Guide`,
    `chars:${body.length} | links:2`,
    ``,
    `---`,
    ``,
    `## Requested Fields`,
    `title: Configuration Guide *(json-ld)* *(conf:0.90)*`,
    ``,
    `---`,
    ``,
    body,
    ``,
    `---`,
    `## Same-Domain Links (1 of 2)`,
    `- https://docs.example.com/usage`,
    ``,
    `## Agent Memory`,
    `remember: Configuration Guide at https://docs.example.com/config — ok quality, ${body.length} chars`,
    ``,
    `---`,
    `## Agent Hints`,
    `- To discover more pages: novada_map with url="https://docs.example.com"`,
    ``,
    `## Agent Action`,
    `agent_instruction: status:ok | content_ready | read_body`,
  ].join("\n");
}

describe("D1-followon: body-internal `---` in fenced code block must not spoof header/body boundary", () => {
  it("[axis-c] changed when content ABOVE body-internal `---` changes but below-section and trailer are identical", async () => {
    const first = makeExtractWithBodyInternalSeparator({
      fetchedAt: "2026-07-02T10:00:00.000Z",
      aboveSection: "# Configuration Guide\n\nHere is the ORIGINAL config example:",
      belowSection: "## Usage\n\nAfter configuring, run the server.",
    });
    const second = makeExtractWithBodyInternalSeparator({
      fetchedAt: "2026-07-02T10:05:00.000Z",
      aboveSection: "# Configuration Guide\n\nHere is the UPDATED config example with new details:",
      belowSection: "## Usage\n\nAfter configuring, run the server.",
    });

    mockedExtract
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    const params = validateMonitorParams({ url: "https://docs.example.com/config", fields: ["title"], format: "json" });

    const r1 = JSON.parse(await novadaMonitor(params, "test-key"));
    expect(r1.status).toBe("baseline_recorded");

    const r2 = JSON.parse(await novadaMonitor(params, "test-key"));
    expect(r2.status).toBe("changed");
  });

  it("[axis-d] unchanged when neither above-section nor below-section changes (only timestamps change)", async () => {
    const first = makeExtractWithBodyInternalSeparator({
      fetchedAt: "2026-07-02T10:00:00.000Z",
      aboveSection: "# Configuration Guide\n\nHere is the config example:",
      belowSection: "## Usage\n\nAfter configuring, run the server.",
    });
    const second = makeExtractWithBodyInternalSeparator({
      fetchedAt: "2026-07-02T10:05:00.000Z",
      aboveSection: "# Configuration Guide\n\nHere is the config example:",
      belowSection: "## Usage\n\nAfter configuring, run the server.",
    });

    mockedExtract
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    const params = validateMonitorParams({ url: "https://docs.example.com/config", fields: ["title"], format: "json" });

    await novadaMonitor(params, "test-key");
    const r2 = JSON.parse(await novadaMonitor(params, "test-key"));
    expect(r2.status).toBe("unchanged");
  });
});

describe("D1-followon-generalize: multiple body-internal `---` lines must not prevent change detection", () => {
  it("[axis-e] changed when content between two body-internal `---` lines changes", async () => {
    const makeBodyWith2Separators = (middleContent: string) => [
      `# Multi-Section Doc`,
      ``,
      "```yaml",
      `---`,
      `section: first`,
      "```",
      ``,
      middleContent,
      ``,
      "```yaml",
      `---`,
      `section: second`,
      "```",
      ``,
      `## Conclusion`,
      `The end.`,
    ].join("\n");

    const bodyA = makeBodyWith2Separators("Middle content: original text here.");
    const bodyB = makeBodyWith2Separators("Middle content: CHANGED text between the two fences.");

    const makeExtractWithDoubleBodySep = (body: string, fetchedAt: string) => [
      `## Extracted Content`,
      `url: https://docs.example.com/multi`,
      `mode: static | source: live | quality:72/100 (ok) | content_present:true | content_ok:true`,
      `quality_reasons: sufficient_text_length; has_title`,
      `fetched_at: ${fetchedAt}`,
      `title: Multi-Section Doc`,
      `chars:${body.length} | links:1`,
      ``,
      `---`,
      ``,
      body,
      ``,
      `## Agent Memory`,
      `remember: Multi-Section Doc at https://docs.example.com/multi — ok quality, ${body.length} chars`,
      ``,
      `---`,
      `## Agent Hints`,
      `- To discover more pages: novada_map with url="https://docs.example.com"`,
      ``,
      `## Agent Action`,
      `agent_instruction: status:ok | content_ready | read_body`,
    ].join("\n");

    const first = makeExtractWithDoubleBodySep(bodyA, "2026-07-02T10:00:00.000Z");
    const second = makeExtractWithDoubleBodySep(bodyB, "2026-07-02T10:05:00.000Z");

    mockedExtract
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    const params = validateMonitorParams({ url: "https://docs.example.com/multi", format: "json" });

    const r1 = JSON.parse(await novadaMonitor(params, "test-key"));
    expect(r1.status).toBe("baseline_recorded");

    const r2 = JSON.parse(await novadaMonitor(params, "test-key"));
    expect(r2.status).toBe("changed");
  });
});
