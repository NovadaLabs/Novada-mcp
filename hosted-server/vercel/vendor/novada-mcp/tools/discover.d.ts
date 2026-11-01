import { z } from "zod";
/**
 * Tools the hosted endpoint never lists. MIRRORS HOSTED_HIDDEN in
 * hosted-server/vercel/api/mcp.ts (same 8 names) — keep the two in sync.
 * Used only for the hosted-vs-local note in novada_discover's group listing.
 *
 * novada_static_ip_mgmt was REMOVED from this list 2026-11-01 (owner decision
 * option A): its read-only actions ("list"/"export"/"reveal_credentials") are
 * now served on hosted; only "open"/"renew" (billable WRITE actions) are
 * refused, at the ACTION level inside the tool itself (see static_ip_mgmt.ts's
 * assertActionAvailableOnRuntime) — not via this whole-tool hiding mechanism.
 */
export declare const HOSTED_HIDDEN_TOOLS: readonly string[];
export declare const DiscoverParamsSchema: z.ZodObject<{
    category: z.ZodOptional<z.ZodEnum<{
        "Scraping & Verification": "Scraping & Verification";
        "Content Retrieval": "Content Retrieval";
        Proxy: "Proxy";
        "Browser & Rendering": "Browser & Rendering";
        "Account & Billing": "Account & Billing";
        "Health & Discovery": "Health & Discovery";
        Auth: "Auth";
    }>>;
    platform: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type DiscoverParams = z.infer<typeof DiscoverParamsSchema>;
export declare function validateDiscoverParams(args: Record<string, unknown> | undefined): DiscoverParams;
/**
 * List all available Novada tools, grouped by category.
 * Agents should call this first to understand what tools are available.
 * The listing is derived from the canonical TOOL_REGISTRY.
 *
 * @param visibleTools Optional allowlist of tool names to include. When provided,
 *   only registered tools whose name is in the set are listed — used by the hosted
 *   endpoint so the catalog reflects only the tools actually exposed there (e.g.
 *   browser tools and disk-writing tools are excluded on hosted). Names not in the
 *   registry are ignored; omit the arg to list the full registry (local MCP).
 */
export declare function novadaDiscover(params: DiscoverParams, visibleTools?: ReadonlySet<string>): Promise<string>;
//# sourceMappingURL=discover.d.ts.map