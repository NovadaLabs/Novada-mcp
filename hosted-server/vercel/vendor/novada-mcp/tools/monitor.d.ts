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
/**
 * Reset the session-scoped monitor store. Exposed for unit tests only; not
 * part of the public MCP tool surface. The store resets automatically on
 * server restart (session-scoped / no durable state).
 */
export declare function resetMonitorStore(): void;
export declare function novadaMonitor(params: MonitorParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=monitor.d.ts.map