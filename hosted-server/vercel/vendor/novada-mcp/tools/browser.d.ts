import type { BrowserParams } from "./types.js";
/**
 * Interactive browser automation via Novada Browser API (CDP WebSocket).
 * Chain multiple actions in a single call: navigate → click → type → screenshot.
 *
 * When session_id is provided, the browser page is reused across calls —
 * maintaining cookies, localStorage, and login state. Sessions expire after
 * 10 minutes of inactivity.
 *
 * Special actions:
 * - close_session: explicitly close a named session and release resources
 * - list_sessions: list all currently active session IDs
 */
export declare function novadaBrowser(params: BrowserParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=browser.d.ts.map