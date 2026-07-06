/**
 * Canonical tool registry — the SINGLE SOURCE OF TRUTH for Novada MCP tools.
 *
 * Every tool exposed by the server (the `TOOLS` array in src/index.ts) MUST have
 * exactly one entry here, keyed by `name`. `src/tools/discover.ts` DERIVES its
 * catalog from this list — it does NOT maintain its own copy — so the discover
 * output can never drift from the tools that are actually wired.
 *
 * Drift guards (see tests/tools/discover.test.ts):
 *   1. TOOL_REGISTRY names === TOOLS names in src/index.ts (exact set match).
 *   2. The discover catalog ⊆ TOOL_REGISTRY (no ghost tools).
 *
 * This module is intentionally side-effect-free (no server construction, no
 * top-level execution) so it can be imported by index.ts, discover.ts, the
 * hosted endpoint, and tests without booting the MCP server.
 */
export type ToolStatus = "active" | "todo";
/** Category buckets, in the order they should render in `novada_discover`. */
export declare const TOOL_CATEGORIES: readonly ["Content Retrieval", "Scraping & Verification", "Proxy", "Browser & Rendering", "Account & Billing", "Health & Discovery", "Auth"];
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];
export interface ToolMeta {
    name: string;
    description: string;
    category: ToolCategory;
    status: ToolStatus;
}
/**
 * One entry per registered tool. Descriptions here are the SHORT,
 * catalog-facing one-liners (the full multi-paragraph descriptions live on the
 * `TOOLS` array in src/index.ts, which the MCP client sees in inputSchema).
 * Order mirrors the `TOOLS` array for easy side-by-side review.
 */
export declare const TOOL_REGISTRY: readonly ToolMeta[];
/** Tool names in the canonical registry, as a Set for fast membership checks. */
export declare const REGISTERED_TOOL_NAMES: ReadonlySet<string>;
export declare const POPULATED_TOOL_CATEGORIES: [ToolCategory, ...ToolCategory[]];
//# sourceMappingURL=registry.d.ts.map