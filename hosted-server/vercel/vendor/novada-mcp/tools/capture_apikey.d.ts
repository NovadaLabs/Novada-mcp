import { z } from "zod";
export declare const CaptureApikeyParamsSchema: z.ZodObject<{
    action: z.ZodEnum<{
        get: "get";
        reset: "reset";
    }>;
    confirm: z.ZodOptional<z.ZodLiteral<true>>;
    approval_token: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type CaptureApikeyParams = z.infer<typeof CaptureApikeyParamsSchema>;
export declare function validateCaptureApikeyParams(args: Record<string, unknown> | undefined): CaptureApikeyParams;
/**
 * Get or reset the capture (scraper/unblocker) API key.
 *
 * - `action: "get"` — read-only, returns current key immediately.
 * - `action: "reset"` — destructive, requires a valid `approval_token`
 *   (see ../utils/approval.ts). Without one, returns a warning preview
 *   plus a fresh token instead of hitting the API.
 */
export declare function novadaCaptureApikey(params: CaptureApikeyParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=capture_apikey.d.ts.map