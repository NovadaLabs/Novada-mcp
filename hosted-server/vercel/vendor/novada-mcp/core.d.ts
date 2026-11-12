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
import { type ServingRuntime } from "./_core/description_surface.js";
import type { ProgressReporter } from "./tools/crawl.js";
import type { ElicitConfirmFn } from "./tools/static_ip_mgmt.js";
export declare const DEDICATED_PLATFORM_SLUGS: string[];
export declare const _TOOL_DEFINITIONS: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations: Record<string, boolean>;
}>;
/**
 * Every `HIDDEN_ALIASES` name that dispatch()'s switch forwards into ANOTHER
 * tool's real validator — mapped to that tool's name, so coercion runs
 * against the schema that's ACTUALLY validated. Derived from the SAME
 * alias relationships the switch itself encodes (`PROXY_ALIAS_MAP` for the
 * 6 proxy-type variants; the rest mirror the switch's own
 * `validateXParams({...args, ...})` forwarding calls) rather than a fresh
 * hand-list — `tests/alias-coercion-completeness.test.ts` asserts every
 * `HIDDEN_ALIASES` member is accounted for here, in `_ALIAS_DIRECT_SCHEMA`,
 * or correctly self-served by a direct `_INPUT_SCHEMA_BY_NAME` entry (the 3
 * scraper stubs below, whose dispatch case never reads `args` at all, so
 * coercing is a harmless no-op either way) — so a newly added alias that's
 * missed here fails a test instead of silently passing through uncoerced.
 */
export declare const _ALIAS_TARGET_TOOL: ReadonlyMap<string, string>;
/**
 * `HIDDEN_ALIASES` names validated against their OWN schema — one that
 * isn't any OTHER tool's `_TOOL_DEFINITIONS` entry, so `_ALIAS_TARGET_TOOL`
 * doesn't apply. `novada_health`/`novada_health_all` validate `args` with
 * `validateHealthParams` (`HealthParamsSchema`) before hardcoding
 * `{section:"summary"}` for the actual `novadaAccount` call underneath —
 * the account section is fixed, but `probe` (boolean) is real caller input.
 */
export declare const _ALIAS_DIRECT_SCHEMA: ReadonlyMap<string, Record<string, unknown>>;
/**
 * Resolve the schema to coerce `name`'s args against: an alias's real
 * target first (`_ALIAS_DIRECT_SCHEMA`, then `_ALIAS_TARGET_TOOL`), falling
 * back to a direct `_INPUT_SCHEMA_BY_NAME` lookup for every non-aliased
 * name (every visible tool, plus the 3 scraper-stub aliases whose own entry
 * is harmlessly unused). Exported for the completeness test.
 */
export declare function resolveToolSchema(name: string): Record<string, unknown> | undefined;
/**
 * Coerce `args` for tool `name` against the schema that is ACTUALLY
 * validated for it (see `resolveToolSchema` above). Used by `dispatch()`
 * below AND by the handful of call sites (stdio index.ts, hosted mcp.ts)
 * that validate a tool's params OUTSIDE dispatch() — novada_setup,
 * novada_session_stats, novada_search_feedback (auth-free, pre-key-gate on
 * stdio) and novada_discover (hosted's own early-return) — so every real
 * parse site in either transport runs the SAME coercion exactly once per
 * request. A tool name with no resolvable schema passes `args` through
 * unchanged.
 */
export declare function coerceToolArgs(name: string, args: Record<string, unknown> | undefined): Record<string, unknown> | undefined;
/**
 * Round 4 (S1-connector, F1 — CLASS fix): builds the ListTools-shaped array for
 * ANY serving surface, given that surface's OWN real tool-name set
 * (`availableForSiblingMentions`) — used to resolve every description's
 * `{{sibling:toolName}}...{{/sibling}}` span (see _core/description_surface.ts)
 * so a description never recommends a sibling tool the CALLING surface can't
 * actually list/dispatch. The REGISTERED_TOOL_NAMES inclusion filter is NOT
 * parameterized — every surface starts from the same base registry; only
 * sibling-mention rendering differs per surface; `runtime` selects which
 * `{{local}}`/`{{hosted}}` spans survive and, on hosted, drops the
 * HOSTED_INERT_PARAMS from each inputSchema. One function, two real call
 * sites today: `TOOLS` below (npm-package's own surface, rendered against its
 * own REGISTERED_TOOL_NAMES — renders a no-op there, since npm hides nothing)
 * and hosted-server/vercel/api/mcp.ts's own ListTools assembly (rendered
 * against ITS hosted-visible name set). Never hand-edit a description per
 * surface — add/adjust the `{{sibling:}}` markup once in _TOOL_DEFINITIONS
 * above instead.
 */
export declare function buildToolsForSurface(availableForSiblingMentions: ReadonlySet<string>, runtime: ServingRuntime): {
    description: string;
    inputSchema: Record<string, unknown>;
    title: string;
    name: string;
    annotations: Record<string, boolean>;
}[];
export declare const TOOLS: {
    description: string;
    inputSchema: Record<string, unknown>;
    title: string;
    name: string;
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
    /**
     * Confirms "novada_static_ip_mgmt" action="reveal_credentials" via MCP
     * elicitation instead of the approval_token flow. `undefined` on every
     * runtime/client without elicitation support (always undefined on
     * hosted — see static_ip_mgmt.ts's 2026-11-01 follow-up note). Ignored
     * by every other tool/action.
     */
    elicitConfirm?: ElicitConfirmFn;
}): Promise<string>;
//# sourceMappingURL=core.d.ts.map