import { z } from "zod";

export const SetupParamsSchema = z.object({}).strict();
export type SetupParams = z.infer<typeof SetupParamsSchema>;

export function validateSetupParams(raw: Record<string, unknown>): SetupParams {
  return SetupParamsSchema.parse(raw);
}

/**
 * Check environment configuration and return step-by-step setup instructions.
 * Does NOT require NOVADA_API_KEY — safe to call before the key is configured.
 */
export function novadaSetup(_params: SetupParams): string {
  const apiKey   = process.env.NOVADA_API_KEY?.trim();
  const browserWs = process.env.NOVADA_BROWSER_WS?.trim();
  const proxyUser = process.env.NOVADA_PROXY_USER?.trim();
  const proxyPass = process.env.NOVADA_PROXY_PASS?.trim();
  const proxyEndpoint = process.env.NOVADA_PROXY_ENDPOINT?.trim();

  const proxyConfigured = !!(proxyUser && proxyPass && proxyEndpoint);
  const allCoreReady = !!apiKey;

  const lines: string[] = ["## Novada MCP — Setup Status", ""];

  // ─── Environment variable status ──────────────────────────────────────────

  lines.push("### Environment Variables");
  lines.push("");

  const check = (label: string, value: string | boolean | undefined, note: string) => {
    const ok = typeof value === "boolean" ? value : !!value;
    const icon = ok ? "✓" : "✗";
    const masked = typeof value === "string" && value.length > 8
      ? `${value.slice(0, 4)}...${value.slice(-4)}`
      : value ? "(set)" : "(not set)";
    return `  ${icon} ${label.padEnd(28)}${ok ? masked : "(not set)"}  — ${note}`;
  };

  lines.push(check("NOVADA_API_KEY", apiKey, apiKey
    ? "covers search, extract, crawl, research, scrape, monitor, verify, unblock"
    : "REQUIRED — get at https://www.novada.com"));
  lines.push(check("NOVADA_BROWSER_WS", browserWs, browserWs
    ? "enables novada_browser and novada_browser_flow"
    : "optional — needed for novada_browser / novada_browser_flow"));
  lines.push(check("NOVADA_PROXY_USER/PASS/ENDPOINT", proxyConfigured, proxyConfigured
    ? "enables novada_proxy_* credential tools"
    : "optional — needed for novada_proxy_* credential generation"));

  lines.push("");

  // ─── Summary ──────────────────────────────────────────────────────────────

  if (allCoreReady) {
    lines.push("**Status: Ready.** Core tools are active.");
    const missing: string[] = [];
    if (!browserWs) missing.push("novada_browser, novada_browser_flow (need NOVADA_BROWSER_WS)");
    if (!proxyConfigured) missing.push("novada_proxy_* credential generation (need NOVADA_PROXY_USER/PASS/ENDPOINT)");
    if (missing.length) {
      lines.push("Optional tools not configured:");
      for (const m of missing) lines.push(`  - ${m}`);
    }
    lines.push("");
    lines.push("Confirm active products: call `novada_health`");
  } else {
    lines.push("**Status: Setup required.** NOVADA_API_KEY is missing.");
    lines.push("");
    lines.push("─── Step 1: Get your API key ─────────────────────────────────");
    lines.push("  https://www.novada.com  → sign up → copy your API key");
    lines.push("");
    lines.push("─── Step 2: Add the key to your MCP client ───────────────────");
    lines.push("");
    lines.push("**Claude Code** (terminal, one command):");
    lines.push("```");
    lines.push("claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp");
    lines.push("```");
    lines.push("");
    lines.push("**Claude Desktop** (~/Library/Application Support/Claude/claude_desktop_config.json):");
    lines.push("```json");
    lines.push("{");
    lines.push('  "mcpServers": {');
    lines.push('    "novada": {');
    lines.push('      "command": "npx",');
    lines.push('      "args": ["-y", "novada-mcp"],');
    lines.push('      "env": { "NOVADA_API_KEY": "your_key" }');
    lines.push("    }");
    lines.push("  }");
    lines.push("}");
    lines.push("```");
    lines.push("");
    lines.push("**Cursor / VS Code / Windsurf** (.cursor/mcp.json or .vscode/mcp.json):");
    lines.push("```json");
    lines.push("{");
    lines.push('  "mcpServers": {');
    lines.push('    "novada": {');
    lines.push('      "command": "npx",');
    lines.push('      "args": ["-y", "novada-mcp"],');
    lines.push('      "env": { "NOVADA_API_KEY": "your_key" }');
    lines.push("    }");
    lines.push("  }");
    lines.push("}");
    lines.push("```");
    lines.push("");
    lines.push("─── Step 3: Restart your MCP client ──────────────────────────");
    lines.push("  After saving the config, restart Claude Desktop / reload your IDE.");
    lines.push("  Then call `novada_health` to confirm the key is active.");
    lines.push("");
    lines.push("─── Optional: Browser automation ─────────────────────────────");
    lines.push("  To use novada_browser / novada_browser_flow, also set:");
    lines.push('  "NOVADA_BROWSER_WS": "wss://...@upg-scbr2.novada.com"');
    lines.push("  Get the WebSocket URL at https://www.novada.com → Browser API");
    lines.push("");
    lines.push("─── Optional: Proxy credential tools ──────────────────────────");
    lines.push("  To use novada_proxy_residential / novada_proxy_* tools, also set:");
    lines.push("  NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT");
    lines.push("  Get credentials at https://www.novada.com → Residential Proxies");
  }

  lines.push("");
  lines.push("## Agent Action");
  lines.push(`status: ${allCoreReady ? "ready" : "setup_required"}`);
  if (allCoreReady) {
    const available = ["search", "extract", "crawl", "research", "scrape", "monitor", "verify", "unblock", "map", "health"];
    lines.push(`configured_tools: ${available.join(", ")}`);
    const optMissing: string[] = [];
    if (!browserWs) optMissing.push("browser");
    if (!proxyConfigured) optMissing.push("proxy");
    if (optMissing.length) lines.push(`optional_not_configured: ${optMissing.join(", ")}`);
  } else {
    lines.push("next_step: Set NOVADA_API_KEY in your MCP client config and restart");
    lines.push("get_key: https://www.novada.com");
  }

  return lines.join("\n");
}
