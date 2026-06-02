import { z } from "zod";
export declare const ProxyDedicatedParamsSchema: z.ZodObject<{
    url: z.ZodOptional<z.ZodString>;
    session_id: z.ZodString;
    format: z.ZodDefault<z.ZodEnum<{
        url: "url";
        env: "env";
        curl: "curl";
    }>>;
}, z.core.$strip>;
export type ProxyDedicatedParams = z.infer<typeof ProxyDedicatedParamsSchema>;
export declare function validateProxyDedicatedParams(args: Record<string, unknown> | undefined): ProxyDedicatedParams;
/**
 * Return dedicated datacenter proxy configuration for use in HTTP clients.
 *
 * Dedicated datacenter proxies assign an exclusive IP that no other user shares.
 * Ideal for high-trust platforms where IP reputation matters, or workflows that
 * need a clean, exclusive IP with no risk of other users' activity affecting access.
 */
export declare function novadaProxyDedicated(params: ProxyDedicatedParams): Promise<string>;
//# sourceMappingURL=proxy_dedicated.d.ts.map