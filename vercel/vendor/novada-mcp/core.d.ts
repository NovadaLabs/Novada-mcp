/**
 * core.ts — side-effect-free shared catalog + dispatch.
 *
 * NO top-level server construction, no process.exit, no stdio boot.
 * Safe to import from any transport (stdio index.ts, hosted mcp.ts, tests).
 *
 * Exports:
 *   TOOLS          — the MCP tool catalog (array literal, verbatim from index.ts)
 *   HIDDEN_ALIASES — tool names dispatched but intentionally absent from TOOLS
 *   dispatch()     — name → validated → tool fn → string result
 *                    THROWS on unknown tool and on tool errors (no envelope, no catch)
 */
import type { ProgressReporter } from "./tools/crawl.js";
export declare const TOOLS: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations: {
        readOnlyHint: boolean;
        idempotentHint: boolean;
        destructiveHint: boolean;
        openWorldHint: boolean;
    };
}[];
export declare const HIDDEN_ALIASES: ReadonlySet<string>;
export declare function dispatch(name: string, args: Record<string, unknown>, apiKey?: string, ctx?: {
    onProgress?: ProgressReporter;
    visibleTools?: ReadonlySet<string>;
}): Promise<string>;
//# sourceMappingURL=core.d.ts.map