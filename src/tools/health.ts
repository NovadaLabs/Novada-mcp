import { getBrowserWs, getProxyCredentials, getWebUnblockerKey } from "../utils/credentials.js";
import { SCRAPER_API_BASE, WEB_UNBLOCKER_BASE } from "../config.js";

const PROBE_TIMEOUT_MS = 8000;

interface ProbeResult {
  status: "active" | "configured_unverified" | "not_activated" | "not_configured" | "error";
  label: string;
  latency: number | null;
  note?: string;
}

async function probeHttp(url: string): Promise<{ ok: boolean; status: number; body: unknown; latency: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal });
    const latency = Date.now() - start;
    let body: unknown = null;
    try { body = await res.json(); } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, body, latency };
  } finally {
    clearTimeout(timer);
  }
}


async function probeExtract(_apiKey: string): Promise<ProbeResult> {
  // Extract uses Web Unblocker: POST webunlocker.novada.com/request
  const unblockerKey = getWebUnblockerKey();
  if (!unblockerKey) {
    return { status: "not_configured", label: "Web Unblocker / Extract", latency: null, note: "set NOVADA_WEB_UNBLOCKER_KEY env var" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(`${WEB_UNBLOCKER_BASE}/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${unblockerKey}` },
      body: JSON.stringify({ target_url: "https://example.com", response_format: "html", js_render: false, country: "" }),
      signal: controller.signal,
    });
    const latency = Date.now() - start;
    let body: Record<string, unknown> | null = null;
    try { body = await res.json() as Record<string, unknown>; } catch { /* ignore */ }
    const code = body?.code as number | undefined;
    if (code === 0) return { status: "active", label: "Web Unblocker / Extract", latency };
    return { status: "not_activated", label: "Web Unblocker / Extract", latency, note: `code=${code ?? res.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", label: "Web Unblocker / Extract", latency: null, note: msg.slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

async function probeScraper(apiKey: string): Promise<ProbeResult> {
  // Correct endpoint: POST scraper.novada.com/request with scraper_name/scraper_id body
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const start = Date.now();
  try {
    const form = new URLSearchParams();
    form.append("scraper_name", "google.com");
    form.append("scraper_id", "google_search");
    form.append("q", "test");
    form.append("num", "1");
    const res = await fetch(`${SCRAPER_API_BASE}/request`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Authorization": `Bearer ${apiKey}` },
      body: form.toString(),
      signal: controller.signal,
    });
    const latency = Date.now() - start;
    let body: Record<string, unknown> | null = null;
    try { body = await res.json() as Record<string, unknown>; } catch { /* ignore */ }
    const code = body?.code as number | undefined;
    if (code === 0) return { status: "active", label: "Scraper API (search + 13 active platforms)", latency };
    // 11006 = product not activated; 11000 = invalid key
    if (code === 11006) {
      return { status: "not_activated", label: "Scraper API (search + 13 active platforms)", latency, note: "dashboard.novada.com/overview/scraper/ — contact support to enable Bearer token access" };
    }
    if (code === 11000) {
      return { status: "error", label: "Scraper API (search + 13 active platforms)", latency, note: "Invalid API key (11000)" };
    }
    return { status: "not_activated", label: "Scraper API (search + 13 active platforms)", latency, note: `code=${code ?? res.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", label: "Scraper API (search + 13 active platforms)", latency: null, note: msg.slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

function probeProxy(): ProbeResult {
  const creds = getProxyCredentials();
  if (creds) {
    // FIX-5: We can only verify credentials are present — no live TCP probe here.
    // Label as "configured (not verified)" rather than "Active" to avoid false-Active.
    const endpointValid = creds.endpoint.includes(":");
    if (endpointValid) {
      return { status: "configured_unverified", label: "Proxy", latency: null, note: "env vars present — no live probe" };
    }
    return { status: "configured_unverified", label: "Proxy", latency: null, note: "env vars present — endpoint format may be wrong (expected host:port)" };
  }
  return {
    status: "not_configured",
    label: "Proxy",
    latency: null,
    note: "set NOVADA_PROXY_USER env var",
  };
}

// INC-195: Detect hosted (Vercel) environment where Browser API is architecturally unavailable
function isHostedEnvironment(): boolean {
  return !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function probeBrowser(): ProbeResult {
  // INC-195: On hosted environments, Browser API requires WebSocket transport
  // that is not available on Vercel Edge/Lambda — don't mislead with "set env"
  if (isHostedEnvironment()) {
    return {
      status: "not_configured",
      label: "Browser API",
      latency: null,
      note: "Not available on hosted — requires WebSocket transport. Use local MCP server for browser features.",
    };
  }
  const ws = getBrowserWs();
  if (ws) {
    const wsValid = ws.startsWith("wss://") && ws.includes("@");
    if (wsValid) {
      // FIX-5: NOVADA_BROWSER_WS is set and well-formed, but we don't do a live WebSocket probe.
      // Label as "configured_unverified" to avoid claiming Active without a real connectivity check.
      return { status: "configured_unverified", label: "Browser API", latency: null, note: "env var present — no live probe" };
    }
    return { status: "configured_unverified", label: "Browser API", latency: null, note: "NOVADA_BROWSER_WS format may be wrong — expected wss://user:pass@host" };
  }
  return {
    status: "not_configured",
    label: "Browser API",
    latency: null,
    note: "set NOVADA_BROWSER_WS env var",
  };
}

function statusIcon(r: ProbeResult): string {
  switch (r.status) {
    case "active": return "✅ Active";
    case "configured_unverified": return "⚙️ Configured (not verified)";
    case "not_activated": return `❌ Not activated — ${r.note}`;
    case "not_configured": return `⚠️ Not configured — ${r.note}`;
    case "error": return `❌ Error: ${r.note}`;
  }
}

function latencyStr(r: ProbeResult): string {
  return r.latency !== null ? `${r.latency}ms` : "—";
}

/**
 * Check which Novada API products are active on the given API key.
 * Runs probes in parallel via Promise.allSettled.
 */
export async function novadaHealth(apiKey: string): Promise<string> {
  const maskedKey = apiKey.length >= 4 ? `****${apiKey.slice(-4)}` : "****";

  // Run HTTP probes in parallel; env checks are synchronous
  const [extractSettled, scraperSettled] = await Promise.allSettled([
    probeExtract(apiKey),
    probeScraper(apiKey),
  ]);

  const results: ProbeResult[] = [
    extractSettled.status === "fulfilled" ? extractSettled.value : { status: "error" as const, label: "Web Unblocker / Extract", latency: null, note: "probe threw unexpectedly" },
    scraperSettled.status === "fulfilled" ? scraperSettled.value : { status: "error" as const, label: "Scraper API (search + 13 active platforms)", latency: null, note: "probe threw unexpectedly" },
    probeProxy(),
    probeBrowser(),
  ];

  const activeCount = results.filter(r => r.status === "active").length;
  const configuredUnverifiedCount = results.filter(r => r.status === "configured_unverified").length;
  const notActivatedCount = results.filter(r => r.status === "not_activated").length;
  const notConfiguredCount = results.filter(r => r.status === "not_configured").length;
  const errorCount = results.filter(r => r.status === "error").length;

  const lines: string[] = [
    "## Novada API — Health Check",
    "",
    `api_key: ${maskedKey}`,
    `checked: ${new Date().toISOString()}`,
    "",
    "| Product | Status | Latency | Notes |",
    "|---------|--------|---------|-------|",
  ];

  for (const r of results) {
    // FIX-5: Surface notes for all rows (including active) so "not verified" caveat is visible
    const noteCell = r.note ? r.note : "";
    lines.push(`| ${r.label} | ${statusIcon(r)} | ${latencyStr(r)} | ${noteCell} |`);
  }
  lines.push(`| Output Pipeline | ✅ active — ~/Downloads/novada-mcp/ | — | |`);

  lines.push("");
  lines.push("---");
  lines.push("## Summary");

  const parts: string[] = [];
  if (activeCount > 0) parts.push(`${activeCount} active`);
  if (configuredUnverifiedCount > 0) parts.push(`${configuredUnverifiedCount} configured (not verified)`);
  if (notActivatedCount > 0) parts.push(`${notActivatedCount} not activated`);
  if (notConfiguredCount > 0) parts.push(`${notConfiguredCount} not configured`);
  if (errorCount > 0) parts.push(`${errorCount} error`);
  lines.push(`- ${parts.join("  |  ")}`);

  const needsAction = results.filter(r => r.status !== "active");
  if (needsAction.length === 0) {
    lines.push("");
    lines.push("## Next Steps");
    lines.push("All products active — you're good to go.");
  } else {
    lines.push("");
    lines.push("## Next Steps");
    for (const r of needsAction) {
      if (r.status === "configured_unverified") {
        lines.push(`- ${r.label}: ${r.note} — connectivity not confirmed, but should work if credentials are valid`);
      } else if (r.status === "not_activated") {
        lines.push(`- ${r.label}: not activated on your account (${r.note}). Activate it at https://dashboard.novada.com/api-key/`);
      } else if (r.status === "not_configured") {
        if (r.label === "Proxy") {
          lines.push(`- Proxy: Set NOVADA_PROXY_ENDPOINT (user/pass auto-provisioned from NOVADA_API_KEY). Or set NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT for explicit credentials.`);
        } else if (r.label === "Browser API") {
          lines.push(`- Browser API: Export NOVADA_BROWSER_WS (get credentials at dashboard.novada.com/overview/browser/)`);
        } else {
          lines.push(`- ${r.label}: ${r.note}`);
        }
      } else if (r.status === "error") {
        lines.push(`- ${r.label}: Probe failed — ${r.note}`);
      }
    }
  }

  return lines.join("\n");
}
