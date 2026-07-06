import { describe, it, expect, beforeEach } from "vitest";

import {
  novadaSessionStats,
  validateSessionStatsParams,
  recordToolCall,
  resetSessionStats,
} from "../../src/tools/session_stats.js";

beforeEach(() => {
  resetSessionStats();
});

describe("validateSessionStatsParams", () => {
  it("applies defaults (recent_limit=10, format=markdown)", () => {
    const p = validateSessionStatsParams(undefined);
    expect(p.recent_limit).toBe(10);
    expect(p.format).toBe("markdown");
  });

  it("rejects recent_limit out of range", () => {
    expect(() => validateSessionStatsParams({ recent_limit: 0 })).toThrow();
    expect(() => validateSessionStatsParams({ recent_limit: 101 })).toThrow();
  });

  it("rejects an unknown format", () => {
    expect(() => validateSessionStatsParams({ format: "xml" })).toThrow();
  });
});

describe("novadaSessionStats — markdown", () => {
  it("reports zero state cleanly when no calls recorded", async () => {
    const out = await novadaSessionStats(validateSessionStatsParams({}));
    expect(out).toContain("## Novada MCP — Session Stats");
    expect(out).toContain("total_calls: 0");
    expect(out).toContain("No tool calls recorded yet this session.");
  });

  it("counts recorded calls and tallies per-tool counts", async () => {
    recordToolCall("novada_search");
    recordToolCall("novada_search");
    recordToolCall("novada_extract");

    const out = await novadaSessionStats(validateSessionStatsParams({}));
    expect(out).toContain("total_calls: 3");
    expect(out).toContain("unique_tools: 2");
    expect(out).toContain("| `novada_search` | 2 |");
    expect(out).toContain("| `novada_extract` | 1 |");
  });

  it("lists recent calls newest-first and honors recent_limit", async () => {
    recordToolCall("novada_search");
    recordToolCall("novada_extract");
    recordToolCall("novada_map");

    const out = await novadaSessionStats(validateSessionStatsParams({ recent_limit: 2 }));
    expect(out).toContain("Recent calls (last 2, newest first)");
    // Scope the ordering assertion to the recent-calls section only — the
    // per-tool counts table above it also mentions these tool names.
    const recentSection = out.slice(out.indexOf("Recent calls"));
    // Newest (map) should appear before extract; search (oldest) excluded by limit.
    const mapIdx = recentSection.indexOf("novada_map");
    const extractIdx = recentSection.indexOf("novada_extract");
    expect(mapIdx).toBeGreaterThan(-1);
    expect(extractIdx).toBeGreaterThan(-1);
    expect(mapIdx).toBeLessThan(extractIdx);
    // search was pushed out by recent_limit=2.
    expect(recentSection).not.toContain("novada_search");
  });

  it("includes uptime and an ISO session_started timestamp", async () => {
    const out = await novadaSessionStats(validateSessionStatsParams({}));
    expect(out).toMatch(/session_started: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(out).toMatch(/uptime: .+\(\d+ms\)/);
  });
});

describe("novadaSessionStats — json", () => {
  it("returns a parseable JSON object with the expected shape", async () => {
    recordToolCall("novada_search");
    recordToolCall("novada_search");
    recordToolCall("novada_health");

    const out = await novadaSessionStats(validateSessionStatsParams({ format: "json" }));
    const parsed = JSON.parse(out);

    expect(parsed.status).toBe("ok");
    expect(parsed.scope).toBe("process");
    expect(parsed.total_calls).toBe(3);
    expect(parsed.unique_tools).toBe(2);
    expect(parsed.tool_counts.novada_search).toBe(2);
    expect(parsed.tool_counts.novada_health).toBe(1);
    expect(Array.isArray(parsed.recent_calls)).toBe(true);
    expect(parsed.recent_calls[0].tool).toBe("novada_health"); // newest first
    expect(typeof parsed.uptime_ms).toBe("number");
  });
});

describe("recordToolCall ring buffer", () => {
  it("caps retained recent calls at 100 while total_calls keeps growing", async () => {
    for (let i = 0; i < 150; i++) recordToolCall("novada_search");

    const out = await novadaSessionStats(validateSessionStatsParams({ format: "json", recent_limit: 100 }));
    const parsed = JSON.parse(out);

    expect(parsed.total_calls).toBe(150);
    expect(parsed.recent_calls.length).toBe(100); // buffer cap
  });
});
