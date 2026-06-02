import { getBrowserWs } from "../utils/credentials.js";
import { getSession, storeSession, closeSession, listSessions } from "../utils/browser.js";
import { makeNovadaError, NovadaErrorCode } from "../_core/errors.js";
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
export async function novadaBrowser(params) {
    const { actions, timeout, session_id: sessionId } = params;
    // Handle session management actions that don't need a browser connection
    if (actions.length === 1) {
        const action = actions[0];
        if (action.action === "close_session") {
            if (!sessionId) {
                return "Error: close_session requires a session_id parameter.";
            }
            const closed = await closeSession(sessionId);
            return [
                `## Session Closed`,
                `session_id: ${sessionId}`,
                `status: ${closed ? "closed" : "not_found"}`,
                ``,
                `## Agent Hints`,
                `- Session resources released. Next call with this session_id will start a fresh cold connection (~8s).`,
                `- Reuse active sessions across calls to avoid the cold-start cost (~1.5s warm vs ~8s cold).`,
            ].join("\n");
        }
        if (action.action === "list_sessions") {
            const ids = listSessions();
            return [
                `## Active Browser Sessions`,
                `count: ${ids.length}`,
                ``,
                ids.length > 0 ? ids.map(id => `- ${id}`).join("\n") : "No active sessions.",
                ``,
                `## Agent Hints`,
                `- Reuse sessions with session_id to avoid cold-start latency (~8s new session vs ~1.5s warm reuse).`,
                `- Sessions expire after 10 min of inactivity — use close_session to release early.`,
                `- Pass session_id across multiple browser calls to maintain login state (cookies, localStorage).`,
            ].join("\n");
        }
    }
    const wsEndpoint = getBrowserWs();
    if (!wsEndpoint) {
        return [
            `## Browser API — Not Configured`,
            ``,
            `Set the NOVADA_BROWSER_WS environment variable to enable browser automation.`,
            ``,
            `Example:`,
            `  claude mcp add novada \\`,
            `    -e NOVADA_API_KEY=your_key \\`,
            `    -e NOVADA_BROWSER_WS=wss://user:pass@upg-scbr2.novada.com \\`,
            `    -- npx -y novada`,
            ``,
            `Get credentials at: https://dashboard.novada.com/overview/browser/`,
        ].join("\n");
    }
    // Dynamic import to avoid forcing playwright-core on users who don't need browser
    let chromium;
    try {
        const pw = await import("playwright-core");
        chromium = pw.chromium;
    }
    catch {
        return [
            `## Browser API — Missing Dependency`,
            ``,
            `playwright-core is required for browser automation but not installed.`,
            `Run: npm install playwright-core`,
        ].join("\n");
    }
    const results = [];
    const startTime = Date.now();
    // Try to reuse existing session page
    const existingPage = sessionId ? getSession(sessionId) : null;
    if (existingPage) {
        // Reuse existing session — execute all actions on the same page
        try {
            existingPage.setDefaultTimeout(timeout);
            for (const action of actions) {
                const elapsed = Date.now() - startTime;
                if (elapsed > timeout) {
                    results.push({ action: action.action, status: "error", error: `Timeout: ${timeout}ms exceeded` });
                    break;
                }
                try {
                    const result = await executeAction(existingPage, action);
                    results.push(result);
                }
                catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    // Dead page: evict session so the next call gets a fresh connection
                    const isPageDead = /closed|crashed|detached|Target closed/i.test(errMsg);
                    if (isPageDead && sessionId) {
                        await closeSession(sessionId).catch(() => { });
                        results.push({
                            action: action.action,
                            status: "error",
                            error: `${errMsg} — session "${sessionId}" evicted. Call novada_browser again to start a fresh session.`,
                        });
                        break; // no point continuing on a dead page
                    }
                    results.push({
                        action: action.action,
                        status: "error",
                        error: errMsg,
                    });
                }
            }
        }
        catch (err) {
            // Only reaches here if setDefaultTimeout() itself throws (rare)
            results.push({ action: "session_reuse", status: "error", error: err instanceof Error ? err.message : String(err) });
        }
    }
    else {
        // No existing session — create new browser connection
        let browser;
        let newPage;
        try {
            // Validate wsEndpoint format before attempting CDP connection
            if (!wsEndpoint.startsWith("wss://")) {
                throw makeNovadaError(NovadaErrorCode.INVALID_PARAMS, `NOVADA_BROWSER_WS must start with wss:// — got: ${wsEndpoint.slice(0, 30)}... Format: wss://username:password@host`);
            }
            if (!wsEndpoint.includes("@")) {
                throw makeNovadaError(NovadaErrorCode.INVALID_PARAMS, "NOVADA_BROWSER_WS is missing credentials. Format: wss://username:password@host — get credentials from https://dashboard.novada.com/overview/browser/");
            }
            browser = await chromium.connectOverCDP(wsEndpoint);
            const context = await browser.newContext({
                userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            });
            newPage = await context.newPage();
            newPage.setDefaultTimeout(timeout);
            // Store page in session if session_id provided
            if (sessionId) {
                storeSession(sessionId, newPage, browser, context);
            }
            for (const action of actions) {
                const elapsed = Date.now() - startTime;
                if (elapsed > timeout) {
                    results.push({ action: action.action, status: "error", error: `Timeout: ${timeout}ms exceeded` });
                    break;
                }
                try {
                    const result = await executeAction(newPage, action);
                    results.push(result);
                }
                catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    const isPageDead = /closed|crashed|detached|Target closed/i.test(errMsg);
                    if (isPageDead && sessionId) {
                        await closeSession(sessionId).catch(() => { });
                        results.push({
                            action: action.action,
                            status: "error",
                            error: `${errMsg} — session "${sessionId}" evicted. Call novada_browser again to start a fresh session.`,
                        });
                        break;
                    }
                    results.push({ action: action.action, status: "error", error: errMsg });
                }
            }
            // Only close context/browser if NOT in a named session (session pages stay open)
            if (!sessionId) {
                await context.close();
            }
        }
        finally {
            if (browser && !sessionId) {
                await browser.close();
            }
        }
    }
    const elapsed = Date.now() - startTime;
    const succeeded = results.filter(r => r.status === "ok").length;
    const failed = results.length - succeeded;
    const lines = [
        `## Browser Session Results`,
        `actions: ${results.length} | succeeded: ${succeeded} | failed: ${failed} | time: ${elapsed}ms${sessionId ? ` | session_id: ${sessionId} | session_active: true` : ""}`,
        ``,
        `---`,
        ``,
    ];
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        lines.push(`### Action ${i + 1}: ${r.action} [${r.status}]`);
        if (r.error) {
            lines.push(`Error: ${r.error}`);
        }
        else if (r.data) {
            // Truncate large outputs
            const data = r.data.length > 10000 ? r.data.slice(0, 10000) + "\n<!-- truncated -->" : r.data;
            lines.push(data);
        }
        lines.push(``);
    }
    lines.push(`---`, `## Agent Hints`);
    if (sessionId) {
        lines.push(`- Session active: session_id="${sessionId}" — reuse this ID in subsequent calls to maintain state (~1.5s warm vs ~8s cold start).`);
        lines.push(`- Sessions expire after 10 minutes of inactivity — use close_session when done.`);
    }
    else {
        lines.push(`- Each browser call starts fresh (~8s cold start) — no cookies or state from prior calls.`);
        lines.push(`- Use session_id to maintain state (login, cookies) across calls and get ~5x faster warm reuse (~1.5s).`);
    }
    lines.push(`- Chain actions to complete multi-step flows in one call.`);
    lines.push(`- list_sessions shows all currently active session IDs.`);
    lines.push(`- Geo-restrictions: TikTok is banned in India — always pass country="us" for TikTok and other geo-restricted platforms.`);
    lines.push(`- SPA navigation: use wait_until="domcontentloaded" (default) for X/Twitter, TikTok, React apps. Never use "networkidle" for SPAs — they never reach networkidle and will timeout.`);
    if (failed > 0) {
        lines.push(`- Action failed. Recovery options:`);
        lines.push(`  1. Use aria_snapshot action to see the current accessibility tree and find correct selectors.`);
        lines.push(`  2. Use snapshot action to inspect the current HTML structure.`);
        lines.push(`  3. Use evaluate action with script="document.querySelector('<selector>')" to test if element exists.`);
    }
    return lines.join("\n");
}
async function executeAction(page, action) {
    switch (action.action) {
        case "navigate": {
            await page.goto(action.url, {
                waitUntil: action.wait_until ?? "domcontentloaded",
                timeout: 30000,
            });
            const title = await page.title();
            return { action: "navigate", status: "ok", data: `Navigated to: ${title}` };
        }
        case "click": {
            await page.click(action.selector);
            return { action: "click", status: "ok", data: `Clicked: ${action.selector}` };
        }
        case "type": {
            await page.fill(action.selector, action.text);
            return { action: "type", status: "ok", data: `Typed ${action.text.length} chars into: ${action.selector}` };
        }
        case "screenshot": {
            const buf = await page.screenshot({ fullPage: true, type: "png" });
            const b64 = buf.toString("base64");
            // Return full base64 for programmatic use; agents can decode or display as an image
            return { action: "screenshot", status: "ok", data: `data:image/png;base64,${b64}` };
        }
        case "snapshot": {
            const html = await page.content();
            const truncated = html.length > 30000 ? html.slice(0, 30000) + "\n<!-- truncated -->" : html;
            return { action: "snapshot", status: "ok", data: `${truncated}\n\n<!-- Tip: Use aria_snapshot for a semantic accessibility tree (~70% smaller, easier to parse) -->` };
        }
        case "aria_snapshot": {
            // Use Playwright's ariaSnapshot() — returns YAML accessibility tree (v1.46+)
            // Semantic stable refs by role+name, ~70% smaller than raw HTML
            const yaml = await page.ariaSnapshot();
            if (!yaml) {
                return { action: "aria_snapshot", status: "ok", data: "(no accessible content found on this page)" };
            }
            return { action: "aria_snapshot", status: "ok", data: yaml };
        }
        case "evaluate": {
            const result = await page.evaluate(action.script);
            const serialized = typeof result === "string" ? result : JSON.stringify(result, null, 2);
            return { action: "evaluate", status: "ok", data: serialized };
        }
        case "wait": {
            const waitMs = action.ms ?? action.timeout ?? 5000;
            if (action.selector) {
                await page.waitForSelector(action.selector, { timeout: waitMs });
                return { action: "wait", status: "ok", data: `Selector found: ${action.selector}` };
            }
            await page.waitForTimeout(waitMs);
            return { action: "wait", status: "ok", data: `Waited ${waitMs}ms` };
        }
        case "scroll": {
            const dir = action.direction ?? "down";
            const scrollScript = {
                down: "window.scrollBy(0, window.innerHeight)",
                up: "window.scrollBy(0, -window.innerHeight)",
                bottom: "window.scrollTo(0, document.body.scrollHeight)",
                top: "window.scrollTo(0, 0)",
            }[dir];
            await page.evaluate(scrollScript);
            return { action: "scroll", status: "ok", data: `Scrolled ${dir}` };
        }
        case "hover": {
            await page.hover(action.selector);
            return { action: "hover", status: "ok", data: `Hovered: ${action.selector}` };
        }
        case "press_key": {
            if (action.selector) {
                await page.focus(action.selector);
            }
            await page.keyboard.press(action.key);
            return { action: "press_key", status: "ok", data: `Pressed: ${action.key}${action.selector ? ` (focused: ${action.selector})` : ""}` };
        }
        case "select": {
            await page.selectOption(action.selector, action.value);
            return { action: "select", status: "ok", data: `Selected "${action.value}" in: ${action.selector}` };
        }
        case "close_session":
        case "list_sessions":
            // These are handled before reaching executeAction
            return { action: action.action, status: "error", error: "Session management actions must be the only action in the call." };
        default:
            return { action: "unknown", status: "error", error: `Unknown action: ${action.action}` };
    }
}
//# sourceMappingURL=browser.js.map