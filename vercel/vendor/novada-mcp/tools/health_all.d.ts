import { z } from "zod";
export declare const HealthAllParamsSchema: z.ZodObject<{}, z.core.$strip>;
export type HealthAllParams = z.infer<typeof HealthAllParamsSchema>;
export declare function validateHealthAllParams(args: Record<string, unknown> | undefined): HealthAllParams;
/**
 * Extended health check that tests ALL Novada product endpoints in parallel.
 * Never hard-fails — if one product probe throws, others still return.
 * Returns per-product status table with activation links for PRODUCT_UNAVAILABLE results.
 */
export declare function novadaHealthAll(apiKey: string): Promise<string>;
//# sourceMappingURL=health_all.d.ts.map