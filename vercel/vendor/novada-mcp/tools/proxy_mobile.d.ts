import { z } from "zod";
export declare const ProxyMobileParamsSchema: z.ZodObject<{
    url: z.ZodOptional<z.ZodString>;
    country: z.ZodOptional<z.ZodString>;
    carrier: z.ZodOptional<z.ZodString>;
    session_id: z.ZodOptional<z.ZodString>;
    format: z.ZodDefault<z.ZodEnum<{
        url: "url";
        env: "env";
        curl: "curl";
    }>>;
}, z.core.$strip>;
export type ProxyMobileParams = z.infer<typeof ProxyMobileParamsSchema>;
export declare function validateProxyMobileParams(args: Record<string, unknown> | undefined): ProxyMobileParams;
/**
 * Return mobile proxy configuration for use in HTTP clients.
 *
 * Mobile proxies use 4G/5G IPs from real mobile devices — ideal for accessing
 * mobile-targeted content, mobile apps, and platforms that serve different
 * content to mobile vs. desktop users.
 */
export declare function novadaProxyMobile(params: ProxyMobileParams): Promise<string>;
//# sourceMappingURL=proxy_mobile.d.ts.map