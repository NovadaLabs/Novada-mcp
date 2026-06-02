import { z } from "zod";
export declare const ProxyStaticParamsSchema: z.ZodObject<{
    url: z.ZodOptional<z.ZodString>;
    country: z.ZodString;
    session_id: z.ZodString;
    format: z.ZodDefault<z.ZodEnum<{
        url: "url";
        env: "env";
        curl: "curl";
    }>>;
}, z.core.$strip>;
export type ProxyStaticParams = z.infer<typeof ProxyStaticParamsSchema>;
export declare function validateProxyStaticParams(args: Record<string, unknown> | undefined): ProxyStaticParams;
/**
 * Return static ISP proxy configuration for use in HTTP clients.
 *
 * Static ISP proxies assign a dedicated IP that never changes for a given
 * session_id + country combination. Essential for accounts requiring consistent
 * identity (social media logins, platforms that track IP changes as suspicious activity).
 */
export declare function novadaProxyStatic(params: ProxyStaticParams): Promise<string>;
//# sourceMappingURL=proxy_static.d.ts.map