import { z } from "zod";
export declare const FLOW_BALANCE_ENDPOINTS: readonly [{
    readonly key: "residential";
    readonly path: "/v1/residential_flow/balance";
    readonly label: "Residential";
    readonly proxy: true;
}, {
    readonly key: "isp";
    readonly path: "/v1/isp_flow/balance";
    readonly label: "ISP";
    readonly proxy: true;
}, {
    readonly key: "mobile";
    readonly path: "/v1/mobile_flow/mobile_flow_balance";
    readonly label: "Mobile";
    readonly proxy: true;
}, {
    readonly key: "datacenter";
    readonly path: "/v1/dc_flow/balance";
    readonly label: "Datacenter";
    readonly proxy: true;
}, {
    readonly key: "capture";
    readonly path: "/v1/capture/get_balance";
    readonly label: "Capture";
    readonly proxy: false;
}];
export declare const PlanBalanceAllParamsSchema: z.ZodObject<{
    products: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        static: "static";
        residential: "residential";
        datacenter: "datacenter";
        isp: "isp";
        mobile: "mobile";
        capture: "capture";
    }>>>;
}, z.core.$strict>;
export type PlanBalanceAllParams = z.infer<typeof PlanBalanceAllParamsSchema>;
export declare function validatePlanBalanceAllParams(args: Record<string, unknown> | undefined): PlanBalanceAllParams;
/**
 * Shape-aware "how much is left" derivation — the F11 evidence source. The
 * developer API returns three balance shapes (see account.ts's renderer for
 * the live-confirmed catalog):
 *   1. bare number                     — capture credits
 *   2. { total, used, ... }            — mobile request-count plans
 *   3. { balance: <bytes>, ... }       — residential/isp/datacenter bytes plans
 * `exhausted` means "zero remaining" — the ledger state that makes the gateway
 * accept auth and then refuse to route (HTTP 402, curl exit 56) while the
 * credentials themselves still look perfectly valid.
 */
export declare function deriveBalanceEvidence(raw: unknown): {
    exhausted?: boolean;
    balance_human?: string;
};
/**
 * Query balance endpoints across all (or a chosen subset of) Novada flow
 * products in parallel, plus a per-IP lifecycle summary for static ISP. Never
 * hard-fails — partial errors are surfaced in `errors[]` while successful
 * per-product balances are returned alongside.
 */
export declare function novadaPlanBalanceAll(params: PlanBalanceAllParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=plan_balance_all.d.ts.map