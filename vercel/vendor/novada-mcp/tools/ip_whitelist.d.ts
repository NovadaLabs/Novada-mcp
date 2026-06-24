import { z } from "zod";
export declare const IpWhitelistParamsSchema: z.ZodObject<{
    action: z.ZodEnum<{
        del: "del";
        list: "list";
        remark: "remark";
        add: "add";
    }>;
    product: z.ZodEnum<{
        1: "1";
        5: "5";
        4: "4";
    }>;
    ip: z.ZodOptional<z.ZodString>;
    remark: z.ZodOptional<z.ZodString>;
    start_time: z.ZodOptional<z.ZodString>;
    end_time: z.ZodOptional<z.ZodString>;
    lock: z.ZodOptional<z.ZodNumber>;
    ips: z.ZodOptional<z.ZodString>;
    id: z.ZodOptional<z.ZodString>;
    confirm: z.ZodOptional<z.ZodLiteral<true>>;
}, z.core.$strict>;
export type IpWhitelistParams = z.infer<typeof IpWhitelistParamsSchema>;
export declare function validateIpWhitelistParams(args: Record<string, unknown> | undefined): IpWhitelistParams;
export declare function novadaIpWhitelist(params: IpWhitelistParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=ip_whitelist.d.ts.map