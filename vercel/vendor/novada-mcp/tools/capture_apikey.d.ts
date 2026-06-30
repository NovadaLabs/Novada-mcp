import { z } from "zod";
export declare const CaptureApikeyParamsSchema: z.ZodObject<{
    action: z.ZodEnum<{
        get: "get";
        reset: "reset";
    }>;
    confirm: z.ZodOptional<z.ZodLiteral<true>>;
}, z.core.$strict>;
export type CaptureApikeyParams = z.infer<typeof CaptureApikeyParamsSchema>;
export declare function validateCaptureApikeyParams(args: Record<string, unknown> | undefined): CaptureApikeyParams;
/**
 * Get or reset the capture (scraper/unblocker) API key.
 *
 * - `action: "get"` — read-only, returns current key immediately.
 * - `action: "reset"` — destructive, requires `confirm: true`. Without it,
 *   returns a warning preview instead of hitting the API.
 */
export declare function novadaCaptureApikey(params: CaptureApikeyParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=capture_apikey.d.ts.map