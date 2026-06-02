import { z } from "zod";
export declare const SetupParamsSchema: z.ZodObject<{}, z.core.$strict>;
export type SetupParams = z.infer<typeof SetupParamsSchema>;
export declare function validateSetupParams(raw: Record<string, unknown>): SetupParams;
/**
 * Check environment configuration and return step-by-step setup instructions.
 * Does NOT require NOVADA_API_KEY — safe to call before the key is configured.
 */
export declare function novadaSetup(_params: SetupParams): string;
//# sourceMappingURL=setup.d.ts.map