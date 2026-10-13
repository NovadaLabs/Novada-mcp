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
export declare const DEDICATED_PLATFORM_SLUGS: string[];
export declare const _TOOL_DEFINITIONS: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations: Record<string, boolean>;
}>;
/**
 * Round 4 (S1-connector, F1 — CLASS fix): builds the ListTools-shaped array for
 * ANY serving surface, given that surface's OWN real tool-name set
 * (`availableForSiblingMentions`) — used to resolve every description's
 * `{{sibling:toolName}}...{{/sibling}}` span (see _core/description_surface.ts)
 * so a description never recommends a sibling tool the CALLING surface can't
 * actually list/dispatch. The REGISTERED_TOOL_NAMES inclusion filter is NOT
 * parameterized — every surface starts from the same base registry; only
 * sibling-mention rendering differs per surface. One function, two real call
 * sites today: `TOOLS` below (npm-package's own surface, rendered against its
 * own REGISTERED_TOOL_NAMES — renders a no-op there, since npm hides nothing)
 * and hosted-server/vercel/api/mcp.ts's own ListTools assembly (rendered
 * against ITS hosted-visible name set). Never hand-edit a description per
 * surface — add/adjust the `{{sibling:}}` markup once in _TOOL_DEFINITIONS
 * above instead.
 */
export declare function buildToolsForSurface(availableForSiblingMentions: ReadonlySet<string>): {
    description: string;
    title: string;
    name: string;
    inputSchema: Record<string, unknown>;
    annotations: Record<string, boolean>;
}[];
export declare const TOOLS: {
    description: string;
    title: string;
    name: string;
    inputSchema: Record<string, unknown>;
    annotations: Record<string, boolean>;
}[];
export declare const HIDDEN_ALIASES: ReadonlySet<string>;
export declare const KNOWN_TOOL_NAMES: ReadonlySet<string>;
/**
 * Cheap close-name suggestion for an unknown tool name (F13).
 * Repairs a missing "novada_" prefix exactly, otherwise picks the nearest
 * known name within SUGGESTION_MAX_DISTANCE edits — visible tools are scanned
 * before hidden aliases so ties prefer a name the caller can see in ListTools.
 * Returns undefined when nothing is close (never guesses).
 */
export declare function suggestToolName(name: string): string | undefined;
/**
 * The ONE unknown-tool error builder — shared by dispatch()'s default case and
 * the stdio transport's pre-auth name-resolution check (index.ts), so the two
 * texts can never drift. The name echo is length-capped (untrusted input); the
 * Available/alias lists stay DERIVED from the live registry (F-5).
 */
export declare function makeUnknownToolError(name: string): Error;
export declare function dispatch(name: string, args: Record<string, unknown>, apiKey?: string, ctx?: {
    onProgress?: ProgressReporter;
    visibleTools?: ReadonlySet<string>;
}): Promise<string>;
//# sourceMappingURL=core.d.ts.map