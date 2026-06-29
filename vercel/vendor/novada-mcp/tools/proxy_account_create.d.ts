import { z } from "zod";
export declare const ProxyAccountCreateParamsSchema: z.ZodObject<{
    product: z.ZodEnum<{
        1: "1";
        7: "7";
        2: "2";
        3: "3";
        4: "4";
        9: "9";
    }>;
    account: z.ZodString;
    password: z.ZodString;
    status: z.ZodDefault<z.ZodEnum<{
        1: "1";
        [-3]: "-3";
    }>>;
    remark: z.ZodOptional<z.ZodString>;
    limit_flow: z.ZodOptional<z.ZodString>;
    confirm: z.ZodOptional<z.ZodLiteral<true>>;
}, z.core.$strict>;
export type ProxyAccountCreateParams = z.infer<typeof ProxyAccountCreateParamsSchema>;
export declare function validateProxyAccountCreateParams(args: Record<string, unknown> | undefined): ProxyAccountCreateParams;
/**
 * Create a proxy sub-account on api-m.novada.com (`/v1/proxy_account/create`).
 *
 * Two-step confirm gate: without `confirm: true`, the tool returns a preview
 * payload and does NOT hit the API. Agents MUST surface the preview to the
 * human user and only re-call with `confirm: true` after explicit approval.
 *
 * Request body is multipart/form-data per the API contract — handled centrally
 * by devApiPost. Fields posted: product, account, password, status,
 * remark?, limit_flow?.
 */
export declare function novadaProxyAccountCreate(params: ProxyAccountCreateParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=proxy_account_create.d.ts.map