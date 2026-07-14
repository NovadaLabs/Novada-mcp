import { z } from "zod";
export declare const DiscoverParamsSchema: z.ZodObject<{
    category: z.ZodOptional<z.ZodEnum<{
        Proxy: "Proxy";
        "Content Retrieval": "Content Retrieval";
        "Scraping & Verification": "Scraping & Verification";
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