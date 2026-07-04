import { z } from "zod";
export declare const SetupParamsSchema: z.ZodObject<{}, z.core.$strict>;
export type SetupParams = z.infer<typeof SetupParamsSchema>;
export declare function validateSetupParams(raw: Record<string, unknown>): SetupParams;
/**
 * Onboarding concierge — the first-run front door of the Novada MCP.
 *
 * AUTH-FREE by design: this is the tool that helps you GET a key, so a missing
 * key is the normal first-run state, never an error. It (1) reports whether your
 * key is present+valid / present-but-invalid / not set, (2) tells you the exact
 * next action, and (3) orients you on what you can do.
 */
export declare function novadaSetup(_params: SetupParams): Promise<string>;
//# sourceMappingURL=setup.d.ts.map