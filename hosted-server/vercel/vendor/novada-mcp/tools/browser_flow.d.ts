import { z } from "zod";
declare const BrowserFlowActionSchema: z.ZodObject<{
    type: z.ZodEnum<{
        type: "type";
        click: "click";
        screenshot: "screenshot";
        wait: "wait";
        scroll: "scroll";
    }>;
    selector: z.ZodOptional<z.ZodString>;
    value: z.ZodOptional<z.ZodString>;
    delay: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type BrowserFlowAction = z.infer<typeof BrowserFlowActionSchema>;
export declare const BrowserFlowParamsSchema: z.ZodObject<{
    url: z.ZodString;
    actions: z.ZodArray<z.ZodObject<{
        type: z.ZodEnum<{
            type: "type";
            click: "click";
            screenshot: "screenshot";
            wait: "wait";
            scroll: "scroll";
        }>;
        selector: z.ZodOptional<z.ZodString>;
        value: z.ZodOptional<z.ZodString>;
        delay: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    country: z.ZodDefault<z.ZodString>;
    session_id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type BrowserFlowParams = z.infer<typeof BrowserFlowParamsSchema>;
export declare function validateBrowserFlowParams(args: Record<string, unknown> | undefined): BrowserFlowParams;
/**
 * Execute a multi-step browser automation sequence via Novada's cloud browser.
 * Calls POST https://api-m.novada.com/v1/browser_flow/browser_flow_use with the
 * action sequence and returns per-action results as markdown.
 *
 * Supports sticky sessions via session_id for multi-call login flows.
 * On failure: returns agent_instruction with novada_browser as fallback.
 */
export declare function novadaBrowserFlow(params: BrowserFlowParams, apiKey: string): Promise<string>;
export {};
//# sourceMappingURL=browser_flow.d.ts.map