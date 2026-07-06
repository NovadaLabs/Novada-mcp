import { z } from "zod";
export declare const ProxyAccountListParamsSchema: z.ZodObject<{
    product: z.ZodPipe<z.ZodString, z.ZodEnum<{
        1: "1";
        7: "7";
        2: "2";
        3: "3";
        4: "4";
        9: "9";
    }>>;
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
    status: z.ZodOptional<z.ZodEnum<{
        1: "1";
        [-3]: "-3";
    }>>;
    account: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type ProxyAccountListParams = z.infer<typeof ProxyAccountListParamsSchema>;
export declare function validateProxyAccountListParams(args: Record<string, unknown> | undefined): ProxyAccountListParams;
/**
 * List proxy sub-accounts on api-m.novada.com (`/v1/proxy_account/list`).
 * Read-only — paginated; optional status + account-name filters.
 * Request body is multipart/form-data per the API contract.
 */
export declare function novadaProxyAccountList(params: ProxyAccountListParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=proxy_account_list.d.ts.map