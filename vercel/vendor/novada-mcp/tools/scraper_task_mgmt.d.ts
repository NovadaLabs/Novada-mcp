import { z } from "zod";
export declare const ScraperTaskMgmtParamsSchema: z.ZodObject<{
    action: z.ZodEnum<{
        status: "status";
        list: "list";
        download: "download";
        last_status: "last_status";
    }>;
    page: z.ZodOptional<z.ZodNumber>;
    limit: z.ZodOptional<z.ZodNumber>;
    task_ids: z.ZodOptional<z.ZodString>;
    task_id: z.ZodOptional<z.ZodString>;
    file_type: z.ZodDefault<z.ZodEnum<{
        json: "json";
        csv: "csv";
        xlsx: "xlsx";
    }>>;
}, z.core.$strict>;
export type ScraperTaskMgmtParams = z.infer<typeof ScraperTaskMgmtParamsSchema>;
export declare function validateScraperTaskMgmtParams(args: Record<string, unknown> | undefined): ScraperTaskMgmtParams;
export declare function novadaScraperTaskMgmt(params: ScraperTaskMgmtParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=scraper_task_mgmt.d.ts.map