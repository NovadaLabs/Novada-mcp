import type { VerifyParams } from "./types.js";
/**
 * FIX-4: Sanitize a claim before embedding it into search query strings.
 * Strips CRLF, null bytes, and HTML/JS that could cause false 'supported' verdicts
 * via injection into SERP context, and removes leading javascript: scheme.
 */
export declare function sanitizeClaim(claim: string): string;
export declare function novadaVerify(params: VerifyParams, apiKey: string): Promise<string>;
//# sourceMappingURL=verify.d.ts.map