import { z } from "zod";
export declare const MonitorParamsSchema: z.ZodObject<{
    url: z.ZodString;
    fields: z.ZodOptional<z.ZodArray<z.ZodString>>;
    format: z.ZodDefault<z.ZodEnum<{
        json: "json";
        markdown: "markdown";
    }>>;
}, z.core.$strip>;
export type MonitorParams = z.infer<typeof MonitorParamsSchema>;
export declare function validateMonitorParams(args: Record<string, unknown> | undefined): MonitorParams;
export declare function novadaMonitor(params: MonitorParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=monitor.d.ts.map