import { z } from "zod";
export declare const ProxyDatacenterParamsSchema: z.ZodObject<{
    url: z.ZodOptional<z.ZodString>;
    country: z.ZodOptional<z.ZodString>;
    session_id: z.ZodOptional<z.ZodString>;
    format: z.ZodDefault<z.ZodEnum<{
        url: "url";
        env: "env";
        curl: "curl";
    }>>;
}, z.core.$strip>;
export type ProxyDatacenterParams = z.infer<typeof ProxyDatacenterParamsSchema>;
export declare function validateProxyDatacenterParams(args: Record<string, unknown> | undefined): ProxyDatacenterParams;
/**
 * Return datacenter proxy configuration for use in HTTP clients.
 *
 * Datacenter proxies are the fastest and most cost-effective option.
 * Best for high-volume scraping of targets without aggressive anti-bot protection
 * (APIs, public data feeds, non-protected pages).
 */
export declare function novadaProxyDatacenter(params: ProxyDatacenterParams): Promise<string>;
//# sourceMappingURL=proxy_datacenter.d.ts.map