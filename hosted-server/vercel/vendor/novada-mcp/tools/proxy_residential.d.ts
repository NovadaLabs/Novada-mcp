import { z } from "zod";
export declare const ProxyResidentialParamsSchema: z.ZodObject<{
    url: z.ZodOptional<z.ZodString>;
    country: z.ZodOptional<z.ZodString>;
    city: z.ZodOptional<z.ZodString>;
    session_id: z.ZodOptional<z.ZodString>;
    format: z.ZodDefault<z.ZodEnum<{
        url: "url";
        env: "env";
        curl: "curl";
    }>>;
}, z.core.$strip>;
export type ProxyResidentialParams = z.infer<typeof ProxyResidentialParamsSchema>;
export declare function validateProxyResidentialParams(args: Record<string, unknown> | undefined): ProxyResidentialParams;
/**
 * Return residential proxy configuration for use in HTTP clients.
 *
 * Residential proxies route through real ISP-assigned home IPs (100M+ pool),
 * making them the best choice for anti-bot protected pages and geo-restricted content.
 */
export declare function novadaProxyResidential(params: ProxyResidentialParams): Promise<string>;
//# sourceMappingURL=proxy_residential.d.ts.map