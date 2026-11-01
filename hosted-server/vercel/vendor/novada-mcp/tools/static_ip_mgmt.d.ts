import { z } from "zod";
export type ElicitConfirmFn = (message: string) => Promise<"accept" | "decline" | "cancel">;
export declare const StaticIpMgmtParamsSchema: z.ZodObject<{
    action: z.ZodEnum<{
        list: "list";
        open: "open";
        renew: "renew";
        export: "export";
        reveal_credentials: "reveal_credentials";
    }>;
    ip_type: z.ZodOptional<z.ZodEnum<{
        normal: "normal";
        premium: "premium";
    }>>;
    region: z.ZodOptional<z.ZodString>;
    duration: z.ZodOptional<z.ZodEnum<{
        week: "week";
        month: "month";
    }>>;
    num: z.ZodOptional<z.ZodNumber>;
    renew_ip_list: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
    status: z.ZodOptional<z.ZodEnum<{
        "": "";
        1: "1";
        2: "2";
        3: "3";
    }>>;
    key_word: z.ZodOptional<z.ZodString>;
    is_auto_renew: z.ZodOptional<z.ZodNumber>;
    confirm: z.ZodOptional<z.ZodLiteral<true>>;
    approval_token: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type StaticIpMgmtParams = z.infer<typeof StaticIpMgmtParamsSchema>;
export declare function validateStaticIpMgmtParams(args: Record<string, unknown> | undefined): StaticIpMgmtParams;
/**
 * Unified static ISP IP management tool.
 *
 * "open" and "renew" are WRITE actions gated behind a valid `approval_token`
 * (see ../utils/approval.ts) and refused outright on the hosted endpoint
 * (see assertActionAvailableOnRuntime above). "reveal_credentials" is a
 * LOCAL-ONLY action (2026-11-01 owner decision, final — refused on hosted by
 * the SAME assertActionAvailableOnRuntime guard, for its own reason): on the
 * local server it is confirmed either via live MCP elicitation (when
 * `elicitConfirm` is supplied — local stdio clients that advertise the
 * capability) or, as a fallback, the same `approval_token` flow as the WRITE
 * actions (shows real dial credentials on the execute call only). "list" and
 * "export" are read-only, ungated, and available on every runtime.
 *
 * `elicitConfirm` is `undefined` on every runtime/client that doesn't support
 * elicitation (including the hosted endpoint, always — moot there anyway
 * since "reveal_credentials" never reaches this far on hosted) and is
 * otherwise built by the caller (index.ts) from the live MCP Server's
 * negotiated client capabilities. Only "reveal_credentials" reads it; every
 * other action ignores it.
 */
export declare function novadaStaticIpMgmt(params: StaticIpMgmtParams, apiKey?: string, elicitConfirm?: ElicitConfirmFn): Promise<string>;
//# sourceMappingURL=static_ip_mgmt.d.ts.map