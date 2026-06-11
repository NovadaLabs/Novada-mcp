// 🔴 HOSTED STUB — see utils/browser.js. novada_browser_flow is gated to
// NOT_AVAILABLE_ON_HOSTED in api/mcp.ts before any function here is called.
// We keep the schema export so api/mcp.ts's static imports resolve cleanly.

import { z } from "zod";

export const BrowserFlowParamsSchema = z.object({
  url: z.string().url(),
  actions: z.array(z.any()).default([]),
}).passthrough();

export function validateBrowserFlowParams(args) {
  return BrowserFlowParamsSchema.parse(args ?? {});
}

export async function novadaBrowserFlow(_params, _apiKey) {
  throw new Error("novada_browser_flow is not available on the hosted MCP server. Install the local MCP via `npx novada-mcp` for browser flows.");
}
