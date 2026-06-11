// 🔴 HOSTED STUB — see utils/browser.js. novada_browser is gated to
// NOT_AVAILABLE_ON_HOSTED in api/mcp.ts before this function is ever called.

export async function novadaBrowser(_params) {
  throw new Error("novada_browser is not available on the hosted MCP server. Install the local MCP via `npx novada-mcp` to use browser tools.");
}
