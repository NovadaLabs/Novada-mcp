import { z } from "zod";
export declare const DiscoverParamsSchema: z.ZodObject<{
    category: z.ZodOptional<z.ZodEnum<{
        Proxy: "Proxy";
        "Content Retrieval": "Content Retrieval";
        "Scraping & Verification": "Scraping & Verification";
        "Browser & Rendering": "Browser & Rendering";
        "Health & Discovery": "Health & Discovery";
        Auth: "Auth";
    }>>;
}, z.core.$strip>;
export type DiscoverParams = z.infer<typeof DiscoverParamsSchema>;
export declare function validateDiscoverParams(args: Record<string, unknown> | undefined): DiscoverParams;
/**
 * List all available Novada tools, grouped by category.
 * Agents should call this first to understand what tools are available.
 */
export declare function novadaDiscover(params: DiscoverParams): Promise<string>;
//# sourceMappingURL=discover.d.ts.map