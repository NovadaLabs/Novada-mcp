/**
 * core.ts — side-effect-free shared catalog + dispatch.
 *
 * NO top-level server construction, no process.exit, no stdio boot.
 * Safe to import from any transport (stdio index.ts, hosted mcp.ts, tests).
 *
 * Exports:
 *   TOOLS          — the MCP tool catalog, DERIVED from REGISTERED_TOOL_NAMES so it can
 *                    never drift from registry.ts. Tools in _TOOL_DEFINITIONS whose name
 *                    is absent from the registry are dispatch-only (hidden from ListTools).
 *   HIDDEN_ALIASES — tool names dispatched but intentionally absent from TOOLS
 *   dispatch()     — name → validated → tool fn → string result
 *                    THROWS on unknown tool and on tool errors (no envelope, no catch)
 *
 * Single source of truth: registry.ts controls the visible set. Add a name there to
 * surface it; remove a name there to hide it. _TOOL_DEFINITIONS holds the full
 * MCP schema for every dispatchable tool (visible + hidden).
 */
import type { ProgressReporter } from "./tools/crawl.js";
export declare const _TOOL_DEFINITIONS: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations: Record<string, boolean>;
}>;
/**
 * TOOLS — the MCP ListTools surface, DERIVED from the registry.
 *
 * Only entries whose `name` appears in REGISTERED_TOOL_NAMES are exported here.
 * Everything else in _TOOL_DEFINITIONS remains dispatchable (the switch handles
 * all names) but is hidden from agents' tool lists — no ListTools drift possible.
 *
 * To surface a new tool: add it to TOOL_REGISTRY in registry.ts AND add its
 * definition to _TOOL_DEFINITIONS above. To hide one: remove it from TOOL_REGISTRY.
 * Never edit this export directly.
 */
export declare const TOOLS: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations: Record<string, boolean>;
}[];
export declare const HIDDEN_ALIASES: ReadonlySet<string>;
export declare function dispatch(name: string, args: Record<string, unknown>, apiKey?: string, ctx?: {
    onProgress?: ProgressReporter;
    visibleTools?: ReadonlySet<string>;
}): Promise<string>;
//# sourceMappingURL=core.d.ts.map