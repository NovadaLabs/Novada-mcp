import type { BrowserParams, BrowserAction } from "./types.js";

interface ActionResult {
  action: string;
  status: "ok" | "error";
  data?: string;
  error?: string;
}

/**
 * Interactive browser automation via Novada Browser API (CDP WebSocket).
 * Chain multiple actions in a single call: navigate → click → type → screenshot.
 * Each call creates a fresh browser context — no state persists between calls.
 */
export async function novadaBrowser(params: BrowserParams): Promise<string> {
  const wsEndpoint = process.env.NOVADA_BROWSER_WS;
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
      `    -- npx -y novada-mcp`,
      ``,
      `Get credentials at: https://dashboard.novada.com/overview/browser/`,
    ].join("\n");
  }

  // Dynamic import to avoid forcing playwright-core on users who don't need browser
  let chromium: typeof import("playwright-core").chromium;
  try {
    const pw = await import("playwright-core");
    chromium = pw.chromium;
  } catch {
    return [
      `## Browser API — Missing Dependency`,
      ``,
      `playwright-core is required for browser automation but not installed.`,
      `Run: npm install playwright-core`,
    ].join("\n");
  }

  const { actions, timeout } = params;
  const results: ActionResult[] = [];
  const startTime = Date.now();

  let browser;
  try {
    browser = await chromium.connectOverCDP(wsEndpoint);
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);

    for (const action of actions) {
      const elapsed = Date.now() - startTime;
      if (elapsed > timeout) {
        results.push({ action: action.action, status: "error", error: `Timeout: ${timeout}ms exceeded` });
        break;
      }

      try {
        const result = await executeAction(page, action);
        results.push(result);
      } catch (err) {
        results.push({
          action: action.action,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await context.close();
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  const elapsed = Date.now() - startTime;
  const succeeded = results.filter(r => r.status === "ok").length;
  const failed = results.length - succeeded;

  const lines: string[] = [
    `## Browser Session Results`,
    `actions: ${results.length} | succeeded: ${succeeded} | failed: ${failed} | time: ${elapsed}ms`,
    ``,
    `---`,
    ``,
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`### Action ${i + 1}: ${r.action} [${r.status}]`);
    if (r.error) {
      lines.push(`Error: ${r.error}`);
    } else if (r.data) {
      // Truncate large outputs
      const data = r.data.length > 10000 ? r.data.slice(0, 10000) + "\n<!-- truncated -->" : r.data;
      lines.push(data);
    }
    lines.push(``);
  }

  lines.push(`---`, `## Agent Hints`);
  lines.push(`- Each browser call starts fresh — no cookies or state from prior calls.`);
  lines.push(`- Chain actions to complete multi-step flows in one call.`);
  if (failed > 0) {
    lines.push(`- ${failed} action(s) failed. Check selectors and page state.`);
  }

  return lines.join("\n");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeAction(page: any, action: BrowserAction): Promise<ActionResult> {
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
      return { action: "screenshot", status: "ok", data: `data:image/png;base64,${b64.slice(0, 100)}... (${b64.length} chars)` };
    }

    case "snapshot": {
      const html = await page.content();
      const truncated = html.length > 30000 ? html.slice(0, 30000) + "\n<!-- truncated -->" : html;
      return { action: "snapshot", status: "ok", data: truncated };
    }

    case "evaluate": {
      const result = await page.evaluate(action.script);
      const serialized = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return { action: "evaluate", status: "ok", data: serialized };
    }

    case "wait": {
      if (action.selector) {
        await page.waitForSelector(action.selector, { timeout: action.timeout ?? 5000 });
        return { action: "wait", status: "ok", data: `Selector found: ${action.selector}` };
      }
      await page.waitForTimeout(action.timeout ?? 5000);
      return { action: "wait", status: "ok", data: `Waited ${action.timeout ?? 5000}ms` };
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

    default:
      return { action: "unknown", status: "error", error: `Unknown action: ${(action as { action: string }).action}` };
  }
}
