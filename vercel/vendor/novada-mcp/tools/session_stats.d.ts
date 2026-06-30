import { z } from "zod";
export declare const SessionStatsParamsSchema: z.ZodObject<{
    recent_limit: z.ZodDefault<z.ZodNumber>;
    format: z.ZodDefault<z.ZodEnum<{
        json: "json";
        markdown: "markdown";
    }>>;
}, z.core.$strip>;
export type SessionStatsParams = z.infer<typeof SessionStatsParamsSchema>;
export declare function validateSessionStatsParams(args: Record<string, unknown> | undefined): SessionStatsParams;
/**
 * Record one tool invocation. Called from the MCP dispatch path for every tool
 * (including novada_session_stats itself — the count reflects that this tool was
 * invoked). Cheap, synchronous, allocation-light.
 *
 * @param tool dispatched tool name
 */
export declare function recordToolCall(tool: string): void;
/**
 * Reset all telemetry. Test-only helper — not wired to any tool. Lets unit tests
 * start from a clean slate without relying on module load order.
 */
export declare function resetSessionStats(): void;
/**
 * Return per-process / per-session usage telemetry: tool-call counts, the
 * last-N calls, and uptime. In-memory only; resets on server restart.
 */
export declare function novadaSessionStats(params: SessionStatsParams): Promise<string>;
//# sourceMappingURL=session_stats.d.ts.map