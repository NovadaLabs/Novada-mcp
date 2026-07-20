/**
 * zodToMcpSchema — Convert a Zod v4 schema to MCP-compatible JSON Schema.
 *
 * Extracted from src/core.ts (Tools-v2 factory refactor) so it can be shared by
 * BOTH core.ts's hand-written `_TOOL_DEFINITIONS` entries AND
 * src/tools/platform_scraper.ts's factory-generated per-platform scraper tool
 * definitions, without those two modules importing each other (core.ts spreads
 * the factory's generated defs into `_TOOL_DEFINITIONS`, so the factory must not
 * import back from core.ts — a shared leaf util avoids that cycle).
 *
 * Uses Zod's native .toJSONSchema() — zod-to-json-schema v3 does not support Zod v4.
 *
 * Two contract fixes applied here (single root-cause location):
 *
 * 1. required[] accuracy: Zod v4 .toJSONSchema() includes all object keys in required[],
 *    even those with a .default() (which makes them truly optional at runtime). We strip any
 *    key from required[] that has a corresponding "default" in its property definition, so
 *    the declared schema matches what Zod actually enforces. Covers ~25 tools in one fix.
 *
 * 2. additionalProperties policy: we previously declared additionalProperties:false but Zod
 *    strips unknown keys silently rather than rejecting them — so the declaration was a lie.
 *    We remove additionalProperties entirely; the actual behavior (strip-unknown) is handled
 *    by Zod's parseUnknown semantics, and we choose NOT to surface a rejection error for
 *    unknown params (MCP clients may add meta fields). Declare nothing, lie nothing.
 */
export declare function zodToMcpSchema(schema: any): Record<string, unknown>;
//# sourceMappingURL=mcp-schema.d.ts.map