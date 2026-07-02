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
