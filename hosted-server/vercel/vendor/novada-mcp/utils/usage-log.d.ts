export interface UsageEvent {
    /** The MCP tool name, e.g. "novada_scrape". */
    tool: string;
    status: "success" | "error";
    /** Wall-clock duration of the dispatch, in ms. */
    ms: number;
    /** Short, truncated descriptor of what was acted on (url/keyword/asin/…). Never a secret. */
    target?: string;
    /** Truncated error string, present only on status "error". */
    error?: string;
}
/**
 * Pull a short, human-useful descriptor from tool args WITHOUT dumping the whole object.
 * Only allowlisted keys are considered; the value is coerced to a string and truncated.
 * Returns undefined when nothing useful is present (e.g. account/discover tools).
 */
export declare function summarizeTarget(args: unknown): string | undefined;
/**
 * Append one usage line to today's local log. Fire-and-forget from the caller (`void logUsage(…)`);
 * it never throws and never rejects. Returns a Promise only so tests can await the write.
 */
export declare function logUsage(ev: UsageEvent): Promise<void>;
/** Delete usage-YYYY-MM-DD.jsonl files older than the retention window. Exported for tests;
 *  in production it's called once per process from logUsage. Best-effort, never throws. */
export declare function pruneOld(dir: string): Promise<void>;
//# sourceMappingURL=usage-log.d.ts.map