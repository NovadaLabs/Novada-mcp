import { z } from "zod";
export declare const CaptureLogsParamsSchema: z.ZodObject<{
    start_time: z.ZodOptional<z.ZodString>;
    end_time: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodNumber>;
    page_size: z.ZodDefault<z.ZodNumber>;
    status: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
        success: "success";
        failed: "failed";
        all: "all";
    }>>>;
}, z.core.$strict>;
export type CaptureLogsParams = z.infer<typeof CaptureLogsParamsSchema>;
export declare function validateCaptureLogsParams(args: Record<string, unknown> | undefined): CaptureLogsParams;
/**
 * Fetch paginated capture task logs. Date range is forwarded with the
 * `strat_time`/`start_time` typo-compat shim so this tool keeps working
 * whether or not Novada fixes the server-side spelling.
 */
export declare function novadaCaptureLogs(params: CaptureLogsParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=capture_logs.d.ts.map