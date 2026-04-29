import { getBrowserWs, getProxyCredentials, getWebUnblockerKey } from "../utils/credentials.js";
import { SCRAPER_API_BASE, SCRAPERAPI_BASE, WEB_UNBLOCKER_BASE } from "../config.js";

const PROBE_TIMEOUT_MS = 8000;

interface ProbeResult {
  status: "active" | "not_activated" | "not_configured" | "error";
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

async function probeSearch(apiKey: string): Promise<ProbeResult> {
  // Correct endpoint: POST scraperapi.novada.com/search with { serpapi_query: { ... } }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(`${SCRAPERAPI_BASE}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serpapi_query: { q: "test", engine: "google", num: "1", api_key: apiKey } }),
      signal: controller.signal,
    });
    const latency = Date.now() - start;
    let body: Record<string, unknown> | null = null;
    try { body = await res.json() as Record<string, unknown>; } catch { /* ignore */ }
    const code = body?.code as number | undefined;
    if (code === 0) return { status: "active", label: "Search API", latency };
    // 402 = key lacks SERP quota; 400 = API key not found in body
    if (code === 402 || code === 400) {
      return { status: "not_activated", label: "Search API", latency, note: "visit dashboard.novada.com/overview/scraper/ — request SERP access" };
    }
    return { status: "not_activated", label: "Search API", latency, note: `code=${code ?? res.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", label: "Search API", latency: null, note: msg.slice(0, 80) };
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
    const res = await fetch(`${SCRAPER_API_BASE}/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ scraper_name: "google.com", scraper_id: "google_search_by-keywords", keyword: "test", num: 1 }),
      signal: controller.signal,
    });
    const latency = Date.now() - start;
    let body: Record<string, unknown> | null = null;
    try { body = await res.json() as Record<string, unknown>; } catch { /* ignore */ }
    const code = body?.code as number | undefined;
    if (code === 0) return { status: "active", label: "Scraper API (129 platforms)", latency };
    // 11006 = product not activated; 11000 = invalid key
    if (code === 11006) {
      return { status: "not_activated", label: "Scraper API (129 platforms)", latency, note: "visit dashboard.novada.com/overview/scraper/ — contact support to enable Bearer token access" };
    }
    if (code === 11000) {
      return { status: "error", label: "Scraper API (129 platforms)", latency, note: "Invalid API key (11000)" };
    }
    return { status: "not_activated", label: "Scraper API (129 platforms)", latency, note: `code=${code ?? res.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", label: "Scraper API (129 platforms)", latency: null, note: msg.slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

function probeProxy(): ProbeResult {
  const creds = getProxyCredentials();
  if (creds) {
    return { status: "active", label: "Proxy", latency: null };
  }
  return {
    status: "not_configured",
    label: "Proxy",
    latency: null,
    note: "set NOVADA_PROXY_USER env var",
  };
}

function probeBrowser(): ProbeResult {
  const ws = getBrowserWs();
  if (ws) {
    return { status: "active", label: "Browser API", latency: null };
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
  const [searchSettled, extractSettled, scraperSettled] = await Promise.allSettled([
    probeSearch(apiKey),
    probeExtract(apiKey),   // reads NOVADA_WEB_UNBLOCKER_KEY internally
    probeScraper(apiKey),
  ]);

  const results: ProbeResult[] = [
    searchSettled.status === "fulfilled" ? searchSettled.value : { status: "error" as const, label: "Search API", latency: null, note: "probe threw unexpectedly" },
    extractSettled.status === "fulfilled" ? extractSettled.value : { status: "error" as const, label: "Web Unblocker / Extract", latency: null, note: "probe threw unexpectedly" },
    scraperSettled.status === "fulfilled" ? scraperSettled.value : { status: "error" as const, label: "Scraper API (65+ platforms)", latency: null, note: "probe threw unexpectedly" },
    probeProxy(),
    probeBrowser(),
  ];

  const activeCount = results.filter(r => r.status === "active").length;
  const notActivatedCount = results.filter(r => r.status === "not_activated").length;
  const notConfiguredCount = results.filter(r => r.status === "not_configured").length;
  const errorCount = results.filter(r => r.status === "error").length;

  const lines: string[] = [
    "## Novada API — Health Check",
    "",
    `api_key: ${maskedKey}`,
    `checked: ${new Date().toISOString()}`,
    "",
    "| Product | Status | Latency |",
    "|---------|--------|---------|",
  ];

  for (const r of results) {
    lines.push(`| ${r.label} | ${statusIcon(r)} | ${latencyStr(r)} |`);
  }

  lines.push("");
  lines.push("---");
  lines.push("## Summary");

  const parts: string[] = [];
  if (activeCount > 0) parts.push(`${activeCount} active`);
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
      if (r.status === "not_activated") {
        lines.push(`- ${r.label}: Go to ${r.note} to activate`);
      } else if (r.status === "not_configured") {
        if (r.label === "Proxy") {
          lines.push(`- Proxy: Export NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT`);
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
