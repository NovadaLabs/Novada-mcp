/**
 * Tests for novadaMonitor (F5) — stable hashing across volatile extract metadata.
 *
 * Root cause: novadaExtract prepends a metadata header block containing fields like
 *   mode: static | source: live | quality:72/100 ...
 *   quality_reasons: ...
 *   fetched_at: 2026-07-02T12:34:56.789Z
 * These lines flip between calls (live→cache, timestamp changes) even when the page
 * body is byte-identical. Before this fix, the hash covered the volatile lines, causing
 * false "changed" reports on subsequent calls.
 *
 * Fix: strip the volatile metadata header block before hashing so only stable page
 * content contributes to the hash.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock novadaExtract so we never hit the network ────────────────────────
vi.mock("../../src/tools/extract.js", () => ({
  novadaExtract: vi.fn(),
}));

import { novadaMonitor, validateMonitorParams, resetMonitorStore } from "../../src/tools/monitor.js";
import { novadaExtract } from "../../src/tools/extract.js";

const mockedExtract = vi.mocked(novadaExtract);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a realistic extract output where only the volatile header fields differ
 * between two calls (source: live → source: cache, fetched_at timestamp changes)
 * but the page body is identical.
 */
function makeExtractOutput(opts: {
  source?: "live" | "cache" | "wayback";
  fetchedAt?: string;
  quality?: number;
  body?: string;
}): string {
  const source = opts.source ?? "live";
  const fetchedAt = opts.fetchedAt ?? new Date().toISOString();
  const quality = opts.quality ?? 72;
  const body = opts.body ?? "# Example Domain\n\nThis domain is for use in illustrative examples.\n\n[More information...](https://www.iana.org/domains/reserved)";

  return [
    `## Extracted Content`,
    `url: https://example.com`,
    `mode: static | source: ${source} | quality:${quality}/100 (ok) | content_present:true | content_ok:true`,
    `quality_reasons: sufficient_text_length; has_title`,
    `fetched_at: ${fetchedAt}`,
    `title: Example Domain`,
    `chars:${body.length} | links:1`,
    ``,
    `---`,
    ``,
    body,
  ].join("\n");
}

/**
 * Build extract output where the page body genuinely changed.
 */
function makeExtractOutputWithDifferentBody(bodyVariant: string): string {
  return makeExtractOutput({ body: bodyVariant, source: "live", fetchedAt: new Date().toISOString() });
}

// ─── Reset store between tests ──────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  resetMonitorStore();
});

// ─── F5-a: Stable hash — volatile metadata flip must not cause false "changed" ─

describe("F5-a: stable hash across volatile metadata", () => {
  it("second call returns unchanged when only source: live→cache flips", async () => {
    const firstOutput = makeExtractOutput({ source: "live", fetchedAt: "2026-07-02T10:00:00.000Z" });
    const secondOutput = makeExtractOutput({ source: "cache", fetchedAt: "2026-07-02T10:05:00.000Z" });

    mockedExtract
      .mockResolvedValueOnce(firstOutput)
      .mockResolvedValueOnce(secondOutput);

    const params = validateMonitorParams({ url: "https://example.com", format: "json" });

    const first = await novadaMonitor(params, "test-key");
    const firstJson = JSON.parse(first);
    expect(firstJson.status).toBe("baseline_recorded");

    const second = await novadaMonitor(params, "test-key");
    const secondJson = JSON.parse(second);
    // Must NOT report changed — only metadata changed, body is identical
    expect(secondJson.status).toBe("unchanged");
    expect(secondJson.current_hash).toBe(secondJson.previous_hash ?? secondJson.current_hash);
  });

  it("second call returns unchanged when fetched_at timestamp changes", async () => {
    const t1 = "2026-07-02T09:00:00.000Z";
    const t2 = "2026-07-02T09:01:00.000Z"; // 1 minute later
    const first = makeExtractOutput({ fetchedAt: t1 });
    const second = makeExtractOutput({ fetchedAt: t2 });

    mockedExtract
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    const params = validateMonitorParams({ url: "https://example.com", format: "json" });

    const r1 = await novadaMonitor(params, "test-key");
    expect(JSON.parse(r1).status).toBe("baseline_recorded");

    const r2 = await novadaMonitor(params, "test-key");
    const r2json = JSON.parse(r2);
    expect(r2json.status).toBe("unchanged");
  });

  it("second call returns unchanged when quality score changes (same body)", async () => {
    const first = makeExtractOutput({ quality: 72, source: "live" });
    const second = makeExtractOutput({ quality: 85, source: "cache" }); // quality changes between calls

    mockedExtract
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    const params = validateMonitorParams({ url: "https://example.com", format: "json" });

    await novadaMonitor(params, "test-key");
    const r2 = JSON.parse(await novadaMonitor(params, "test-key"));
    expect(r2.status).toBe("unchanged");
  });
});

// ─── F5-a adjacent: REAL content change must still be detected ──────────────

describe("F5-a adjacent: real content change is reported", () => {
  it("changed status when page body genuinely differs", async () => {
    const firstBody = "Original content on the page.";
    const secondBody = "Updated content — the page was modified.";

    mockedExtract
      .mockResolvedValueOnce(makeExtractOutput({ body: firstBody, fetchedAt: "2026-07-02T10:00:00.000Z" }))
      .mockResolvedValueOnce(makeExtractOutputWithDifferentBody(secondBody));

    const params = validateMonitorParams({ url: "https://example.com", format: "json" });

    const r1 = JSON.parse(await novadaMonitor(params, "test-key"));
    expect(r1.status).toBe("baseline_recorded");

    const r2 = JSON.parse(await novadaMonitor(params, "test-key"));
    expect(r2.status).toBe("changed");
    // hashes must differ
    expect(r2.current_hash).not.toBe(r2.previous_hash);
  });
});

// ─── F5-a adjacent: fields mode — metadata flip alone must not produce changed ─

describe("F5-a adjacent: fields mode — metadata flip must not produce changed", () => {
  it("unchanged when only metadata flips with fields=['title']", async () => {
    const firstOutput = makeExtractOutput({ source: "live", fetchedAt: "2026-07-02T10:00:00.000Z" });
    const secondOutput = makeExtractOutput({ source: "cache", fetchedAt: "2026-07-02T10:05:00.000Z" });

    mockedExtract
      .mockResolvedValueOnce(firstOutput)
      .mockResolvedValueOnce(secondOutput);

    const params = validateMonitorParams({ url: "https://example.com", fields: ["title"], format: "json" });

    const r1 = JSON.parse(await novadaMonitor(params, "test-key"));
    expect(r1.status).toBe("baseline_recorded");

    const r2 = JSON.parse(await novadaMonitor(params, "test-key"));
    expect(r2.status).toBe("unchanged");
  });

  it("changed when title field actually changes with fields=['title']", async () => {
    const firstOutput = makeExtractOutput({ body: "## Old Title\n\nSome content." });
    // Different body where title: line would change
    const secondOutput = [
      `## Extracted Content`,
      `url: https://example.com`,
      `mode: static | source: live | quality:72/100 (ok) | content_present:true | content_ok:true`,
      `quality_reasons: sufficient_text_length; has_title`,
      `fetched_at: ${new Date().toISOString()}`,
      `title: Updated Page Title`,
      `chars:123 | links:1`,
      ``,
      `---`,
      ``,
      `## Updated Page Title\n\nDifferent content entirely.`,
    ].join("\n");

    mockedExtract
      .mockResolvedValueOnce(firstOutput)
      .mockResolvedValueOnce(secondOutput);

    const params = validateMonitorParams({ url: "https://example.com", fields: ["title"], format: "json" });

    await novadaMonitor(params, "test-key");
    const r2 = JSON.parse(await novadaMonitor(params, "test-key"));
    // The hash covers stable content; body changed so hash must differ → changed
    expect(r2.status).toBe("changed");
  });
});

// ─── F5-b: Session-scoped warning in first-check output ─────────────────────

describe("F5-b: session-scoped warning in first-check output", () => {
  it("markdown first-check output includes session-scoped/non-durable warning", async () => {
    mockedExtract.mockResolvedValueOnce(makeExtractOutput({}));
    const params = validateMonitorParams({ url: "https://example.com", format: "markdown" });
    const output = await novadaMonitor(params, "test-key");

    // Must mention session scope / non-durable nature
    const lower = output.toLowerCase();
    expect(
      lower.includes("session") || lower.includes("non-durable") || lower.includes("no durable"),
      `First-check output must include session-scoped/non-durable state warning. Got:\n${output.slice(0, 400)}`
    ).toBe(true);
  });

  it("json first-check output includes session-scoped/non-durable warning", async () => {
    mockedExtract.mockResolvedValueOnce(makeExtractOutput({}));
    const params = validateMonitorParams({ url: "https://example.com", format: "json" });
    const output = await novadaMonitor(params, "test-key");
    const lower = output.toLowerCase();
    expect(
      lower.includes("session") || lower.includes("non-durable") || lower.includes("no durable"),
      `JSON first-check output must include session-scoped warning. Got:\n${output.slice(0, 400)}`
    ).toBe(true);
  });
});
