import { z, ZodError } from "zod";
// ─── NOV-321: novada_session_stats ───────────────────────────────────────────
// Per-process / per-session usage telemetry: tool-call counts, the last-N calls,
// and process uptime. Everything lives in module-scoped memory — nothing is
// persisted to disk and nothing leaves the process — so it is MCP-safe and the
// tool is annotated read-only. State resets when the MCP server restarts.
// ─── Zod Schema ───────────────────────────────────────────────────────────────
export const SessionStatsParamsSchema = z.object({
    recent_limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(10)
        .describe("How many of the most-recent tool calls to include in the recent_calls list. Default 10, max 100. Counts and totals always cover the whole session regardless of this value."),
    format: z
        .enum(["markdown", "json"])
        .default("markdown")
        .describe("Output format. 'markdown' (default): human-readable report. 'json': structured object for programmatic agent use."),
});
export function validateSessionStatsParams(args) {
    try {
        return SessionStatsParamsSchema.parse(args ?? {});
    }
    catch (e) {
        if (e instanceof ZodError) {
            const issues = e.issues.map(i => {
                let msg = `  ${i.path.join(".")}: ${i.message}`;
                if (i.code === "invalid_value" && "values" in i) {
                    msg += ` (valid values: ${i.values.map((v) => `'${v}'`).join(", ")})`;
                }
                return msg;
            }).join("\n");
            throw new Error(`Invalid parameters for novada_session_stats:\n${issues}\nagent_instruction: Fix the parameter(s) listed above and retry. Check the tool's inputSchema for required fields and valid values. Do NOT retry with identical params — at least one field must change.`);
        }
        throw e;
    }
}
/** Wall-clock time the process / session started, in epoch ms. */
const SESSION_STARTED_MS = Date.now();
/** Per-tool call counters. */
const callCounts = new Map();
/**
 * Ring buffer of the most-recent calls. Bounded so a long-running session can't
 * grow this without limit — we only ever need the last N for the report, and N
 * is capped at the schema max (100).
 */
const RECENT_CAP = 100;
const recentCalls = [];
let totalCalls = 0;
/**
 * Record one tool invocation. Called from the MCP dispatch path for every tool
 * (including novada_session_stats itself — the count reflects that this tool was
 * invoked). Cheap, synchronous, allocation-light.
 *
 * @param tool dispatched tool name
 */
export function recordToolCall(tool) {
    totalCalls += 1;
    callCounts.set(tool, (callCounts.get(tool) ?? 0) + 1);
    recentCalls.push({ tool, at: new Date().toISOString() });
    if (recentCalls.length > RECENT_CAP) {
        recentCalls.shift();
    }
}
/**
 * Reset all telemetry. Test-only helper — not wired to any tool. Lets unit tests
 * start from a clean slate without relying on module load order.
 */
export function resetSessionStats() {
    callCounts.clear();
    recentCalls.length = 0;
    totalCalls = 0;
}
// ─── Formatting helpers ───────────────────────────────────────────────────────
/** Render a millisecond duration as a compact human string (e.g. "1h 2m 3s"). */
function formatUptime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const parts = [];
    if (h > 0)
        parts.push(`${h}h`);
    if (m > 0)
        parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(" ");
}
/** Build a point-in-time snapshot, honoring recent_limit for the recent list. */
function buildSnapshot(recentLimit) {
    const now = Date.now();
    const uptimeMs = now - SESSION_STARTED_MS;
    // tool_counts sorted high → low for stable, useful ordering.
    const sortedCounts = [...callCounts.entries()].sort((a, b) => b[1] - a[1]);
    const toolCounts = {};
    for (const [tool, count] of sortedCounts) {
        toolCounts[tool] = count;
    }
    // recent_calls: last `recentLimit`, most-recent first.
    const recent = recentCalls.slice(-recentLimit).reverse();
    return {
        session_started: new Date(SESSION_STARTED_MS).toISOString(),
        uptime_ms: uptimeMs,
        uptime_human: formatUptime(uptimeMs),
        total_calls: totalCalls,
        unique_tools: callCounts.size,
        tool_counts: toolCounts,
        recent_calls: recent,
    };
}
// ─── Tool Implementation ──────────────────────────────────────────────────────
/**
 * Return per-process / per-session usage telemetry: tool-call counts, the
 * last-N calls, and uptime. In-memory only; resets on server restart.
 */
export async function novadaSessionStats(params) {
    const { recent_limit, format } = params;
    const snap = buildSnapshot(recent_limit);
    if (format === "json") {
        return JSON.stringify({
            status: "ok",
            scope: "process",
            note: "In-memory telemetry — resets when the MCP server restarts. Not persisted to disk.",
            ...snap,
        }, null, 2);
    }
    const lines = [
        "## Novada MCP — Session Stats",
        "",
        "> In-memory, per-process telemetry. Resets on server restart; nothing is persisted to disk.",
        "",
        `session_started: ${snap.session_started}`,
        `uptime: ${snap.uptime_human} (${snap.uptime_ms}ms)`,
        `total_calls: ${snap.total_calls}`,
        `unique_tools: ${snap.unique_tools}`,
        "",
    ];
    if (snap.unique_tools === 0) {
        lines.push("No tool calls recorded yet this session.");
        return lines.join("\n");
    }
    lines.push("### Tool call counts");
    lines.push("");
    lines.push("| Tool | Calls |");
    lines.push("|------|-------|");
    for (const [tool, count] of Object.entries(snap.tool_counts)) {
        lines.push(`| \`${tool}\` | ${count} |`);
    }
    lines.push("");
    lines.push(`### Recent calls (last ${snap.recent_calls.length}, newest first)`);
    lines.push("");
    if (snap.recent_calls.length === 0) {
        lines.push("_none_");
    }
    else {
        lines.push("| # | Tool | At |");
        lines.push("|---|------|----|");
        snap.recent_calls.forEach((c, i) => {
            lines.push(`| ${i + 1} | \`${c.tool}\` | ${c.at} |`);
        });
    }
    return lines.join("\n");
}
//# sourceMappingURL=session_stats.js.map