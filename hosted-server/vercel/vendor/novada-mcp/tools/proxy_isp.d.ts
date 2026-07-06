import { z } from "zod";
export declare const ProxyIspParamsSchema: z.ZodObject<{
    url: z.ZodOptional<z.ZodString>;
    country: z.ZodOptional<z.ZodString>;
    session_id: z.ZodOptional<z.ZodString>;
    format: z.ZodDefault<z.ZodEnum<{
        url: "url";
        env: "env";
        curl: "curl";
    }>>;
}, z.core.$strip>;
export type ProxyIspParams = z.infer<typeof ProxyIspParamsSchema>;
export declare function validateProxyIspParams(args: Record<string, unknown> | undefined): ProxyIspParams;
/**
 * Return ISP proxy configuration for use in HTTP clients.
 *
 * ISP proxies are assigned to real Internet Service Providers — they look like
 * genuine home users and are ideal for social media, ecommerce, and any platform
 * that distinguishes real users from datacenter IPs.
 */
export declare function novadaProxyIsp(params: ProxyIspParams): Promise<string>;
//# sourceMappingURL=proxy_isp.d.ts.map