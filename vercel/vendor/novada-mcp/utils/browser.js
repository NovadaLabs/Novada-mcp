// 🔴 HOSTED STUB — original imports `playwright-core` which (with @napi-rs deps)
// would push the Vercel Function bundle over the 50 MB Hobby limit. Browser-based
// tools are gated to NOT_AVAILABLE_ON_HOSTED in api/mcp.ts, so this util is never
// reached at runtime. Stub preserves the export shape for static analysis.
//
// To restore: copy ~/Projects/novada-mcp/build/utils/browser.js back, re-add
// playwright-core to vercel/package.json, upgrade Vercel team to Pro (250 MB limit).

const NOT_AVAILABLE = () => {
  throw new Error("Browser utilities are not available on the hosted MCP server. Use the local MCP (`npx novada-mcp`) for browser-based tools.");
};

export function getSession(_sessionId) { return null; }
export function storeSession(_sessionId, _page, _browser, _context) { NOT_AVAILABLE(); }
export async function closeSession(_sessionId) { /* noop */ }
export function listSessions() { return []; }
export function isBrowserConfigured() { return false; }
export async function fetchViaBrowser(_url, _options = {}) { NOT_AVAILABLE(); }
