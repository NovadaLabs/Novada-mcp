import { z } from "zod";
export declare const TrafficDailyParamsSchema: z.ZodObject<{
    start_time: z.ZodOptional<z.ZodString>;
    end_time: z.ZodOptional<z.ZodString>;
    products: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        static: "static";
        residential: "residential";
        datacenter: "datacenter";
        isp: "isp";
        mobile: "mobile";
    }>>>;
}, z.core.$strict>;
export type TrafficDailyParams = z.infer<typeof TrafficDailyParamsSchema>;
export declare function validateTrafficDailyParams(args: Record<string, unknown> | undefined): TrafficDailyParams;
/**
 * Fan out daily traffic consumption queries across the 4 flow-metered Novada
 * proxy products (residential, isp, mobile, datacenter) in parallel, then
 * aggregate totals. Partial failures are tolerated — each product's outcome
 * is reported independently in per_product[<name>] and errors[]. "static" is
 * never queried — it's billed per-IP, not by traffic — and is reported as
 * inapplicable instead.
 */
export declare function novadaTrafficDaily(params: TrafficDailyParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=traffic_daily.d.ts.map