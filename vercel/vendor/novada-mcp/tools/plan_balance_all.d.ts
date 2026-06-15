import { z } from "zod";
export declare const PlanBalanceAllParamsSchema: z.ZodObject<{
    products: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        static: "static";
        residential: "residential";
        mobile: "mobile";
        isp: "isp";
        datacenter: "datacenter";
        capture: "capture";
    }>>>;
}, z.core.$strict>;
export type PlanBalanceAllParams = z.infer<typeof PlanBalanceAllParamsSchema>;
export declare function validatePlanBalanceAllParams(args: Record<string, unknown> | undefined): PlanBalanceAllParams;
/**
 * Query balance endpoints across all (or a chosen subset of) Novada flow
 * products in parallel. Never hard-fails — partial errors are surfaced in
 * `errors[]` while successful per-product balances are returned alongside.
 */
export declare function novadaPlanBalanceAll(params: PlanBalanceAllParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=plan_balance_all.d.ts.map