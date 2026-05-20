import { z } from "zod";
import {
  getBrowserWs,
  getWebUnblockerKey,
} from "../utils/credentials.js";
import {
  SCRAPER_API_BASE,
  WEB_UNBLOCKER_BASE,
} from "../config.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const PROBE_TIMEOUT_MS = 20000;

// ─── Types ────────────────────────────────────────────────────────────────────

type ProbeStatus = "active" | "not_activated" | "not_configured" | "misconfigured" | "error";

interface ProductProbeResult {
  product: string;
  status: ProbeStatus;
  latency: number | null;
  notes: string;
  activationLink?: string;
}

// ─── Zod Schema ───────────────────────────────────────────────────────────────

export const HealthAllParamsSchema = z.object({});
export type HealthAllParams = z.infer<typeof HealthAllParamsSchema>;

export function validateHealthAllParams(
  args: Record<string, unknown> | undefined
): HealthAllParams {
  return HealthAllParamsSchema.parse(args ?? {});
}

// ─── Probe Helpers ────────────────────────────────────────────────────────────

async function probeSearchAll(apiKey: string): Promise<ProductProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const start = Date.now();
  try {
    const form = new URLSearchParams();
    form.append("scraper_name", "google.com");
    form.append("scraper_id", "google_search");
    form.append("json", "1");
    form.append("scraper_errors", "true");
    form.append("is_auto_push", "false");
    const res = await fetch(`${SCRAPER_API_BASE}/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${apiKey}`,
      },
      body: form.toString(),
      signal: controller.signal,
    });
    const latency = Date.now() - start;
    let body: Record<string, unknown> | null = null;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch { /* ignore */ }
    const code = body?.code as number | undefined;
    if (code === 0) {
      return { product: "Search API", status: "active", latency, notes: "Google SERP probe OK" };
    }
    if (code === 11006) {
      return {
        product: "Search API",
        status: "not_activated",
        latency,
        notes: "code=11006 — contact support to enable Bearer token access",
        activationLink: "https://dashboard.novada.com/overview/scraper/",
      };
    }
    if (code === 11000) {
      return {
        product: "Search API",
        status: "error",
        latency,
        notes: "code=11000 — invalid API key",
      };
    }
    return {
      product: "Search API",
      status: "not_activated",
      latency,
      notes: `code=${code ?? res.status}`,
      activationLink: "https://dashboard.novada.com/overview/scraper/",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      product: "Search API",
      status: "error",
      latency: null,
      notes: msg.slice(0, 100),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeExtractAll(_apiKey: string): Promise<ProductProbeResult> {
  const unblockerKey = getWebUnblockerKey();
  if (!unblockerKey) {
    return {
      product: "Extract / Web Unblocker",
      status: "not_configured",
      latency: null,
      notes: "NOVADA_WEB_UNBLOCKER_KEY env var not set",
      activationLink: "https://dashboard.novada.com/overview/unblocker/",
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(`${WEB_UNBLOCKER_BASE}/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${unblockerKey}`,
      },
      body: JSON.stringify({
        target_url: "https://example.com",
        response_format: "html",
        js_render: false,
        country: "",
      }),
      signal: controller.signal,
    });
    const latency = Date.now() - start;
    let body: Record<string, unknown> | null = null;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch { /* ignore */ }
    const code = body?.code as number | undefined;
    if (code === 0) {
      return {
        product: "Extract / Web Unblocker",
        status: "active",
        latency,
        notes: "Static fetch probe OK",
      };
    }
    return {
      product: "Extract / Web Unblocker",
      status: "not_activated",
      latency,
      notes: `code=${code ?? res.status}`,
      activationLink: "https://dashboard.novada.com/overview/unblocker/",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      product: "Extract / Web Unblocker",
      status: "error",
      latency: null,
      notes: msg.slice(0, 100),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeScraperAll(apiKey: string): Promise<ProductProbeResult> {
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
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${apiKey}`,
      },
      body: form.toString(),
      signal: controller.signal,
    });
    const latency = Date.now() - start;
    let body: Record<string, unknown> | null = null;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch { /* ignore */ }
    const code = body?.code as number | undefined;
    if (code === 0) {
      return {
        product: "Scraper API (129 platforms)",
        status: "active",
        latency,
        notes: "google_search probe OK",
      };
    }
    if (code === 11006) {
      return {
        product: "Scraper API (129 platforms)",
        status: "not_activated",
        latency,
        notes: "code=11006 — contact support to enable Bearer token access",
        activationLink: "https://dashboard.novada.com/overview/scraper/",
      };
    }
    if (code === 11000) {
      return {
        product: "Scraper API (129 platforms)",
        status: "error",
        latency,
        notes: "code=11000 — invalid API key",
      };
    }
    return {
      product: "Scraper API (129 platforms)",
      status: "not_activated",
      latency,
      notes: `code=${code ?? res.status}`,
      activationLink: "https://dashboard.novada.com/overview/scraper/",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      product: "Scraper API (129 platforms)",
      status: "error",
      latency: null,
      notes: msg.slice(0, 100),
    };
  } finally {
    clearTimeout(timer);
  }
}

function probeProxyAll(): ProductProbeResult {
  const proxyUser = process.env.NOVADA_PROXY_USER;
  const proxyEndpoint = process.env.NOVADA_PROXY_ENDPOINT;
  if (!proxyUser) {
    return {
      product: "Proxy",
      status: "not_configured",
      latency: null,
      notes: "Set NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT",
      activationLink: "https://dashboard.novada.com/overview/proxy/",
    };
  }
  if (!proxyEndpoint || !proxyEndpoint.includes(":")) {
    return {
      product: "Proxy",
      status: "misconfigured",
      latency: null,
      notes: "NOVADA_PROXY_ENDPOINT missing or malformed — expected format: hostname:port",
      activationLink: "https://dashboard.novada.com/overview/proxy/",
    };
  }
  return {
    product: "Proxy",
    status: "active",
    latency: null,
    notes: "Credentials found in env",
  };
}

function probeBrowserAll(): ProductProbeResult {
  const ws = getBrowserWs();
  if (!ws) {
    return {
      product: "Browser API",
      status: "not_configured",
      latency: null,
      notes: "Set NOVADA_BROWSER_WS (wss://user:pass@host format)",
      activationLink: "https://dashboard.novada.com/overview/browser/",
    };
  }
  if (!ws.startsWith("wss://") || !ws.includes("@")) {
    return {
      product: "Browser API",
      status: "misconfigured",
      latency: null,
      notes: "NOVADA_BROWSER_WS must be wss://username:password@host — get from dashboard.novada.com/overview/browser/",
      activationLink: "https://dashboard.novada.com/overview/browser/",
    };
  }
  return {
    product: "Browser API",
    status: "active",
    latency: null,
    notes: "NOVADA_BROWSER_WS is set",
  };
}

async function probeUnblockAll(apiKey: string): Promise<ProductProbeResult> {
  // Unblock uses Web Unblocker internally — reuse the same probe but label differently
  const base = await probeExtractAll(apiKey);
  return {
    ...base,
    product: "Unblock API",
    notes: base.status === "active"
      ? "Web Unblocker OK (shared with Extract)"
      : base.notes,
  };
}

// ─── Status Formatting ────────────────────────────────────────────────────────

function statusIcon(status: ProbeStatus): string {
  switch (status) {
    case "active":         return "✅ Active";
    case "not_activated":  return "❌ Not activated";
    case "not_configured": return "⚠️ Not configured";
    case "misconfigured":  return "⚠️ Misconfigured";
    case "error":          return "❌ Error";
  }
}

function latencyStr(latency: number | null): string {
  return latency !== null ? `${latency}ms` : "—";
}

// ─── Tool Implementation ──────────────────────────────────────────────────────

/**
 * Extended health check that tests ALL Novada product endpoints in parallel.
 * Never hard-fails — if one product probe throws, others still return.
 * Returns per-product status table with activation links for PRODUCT_UNAVAILABLE results.
 */
export async function novadaHealthAll(apiKey: string): Promise<string> {
  const maskedKey = apiKey.length >= 4 ? `****${apiKey.slice(-4)}` : "****";

  // Run all HTTP probes in parallel; sync checks run inline
  const [
    searchSettled,
    extractSettled,
    scraperSettled,
    unblockSettled,
  ] = await Promise.allSettled([
    probeSearchAll(apiKey),
    probeExtractAll(apiKey),
    probeScraperAll(apiKey),
    probeUnblockAll(apiKey),
  ]);

  const errorFallback = (product: string): ProductProbeResult => ({
    product,
    status: "error",
    latency: null,
    notes: "probe threw unexpectedly",
  });

  const results: ProductProbeResult[] = [
    searchSettled.status  === "fulfilled" ? searchSettled.value  : errorFallback("Search API"),
    extractSettled.status === "fulfilled" ? extractSettled.value : errorFallback("Extract / Web Unblocker"),
    scraperSettled.status === "fulfilled" ? scraperSettled.value : errorFallback("Scraper API (129 platforms)"),
    probeProxyAll(),
    probeBrowserAll(),
    unblockSettled.status === "fulfilled" ? unblockSettled.value : errorFallback("Unblock API"),
  ];

  const activeCount        = results.filter(r => r.status === "active").length;
  const unavailableCount   = results.filter(r => r.status === "not_activated").length;
  const unconfiguredCount  = results.filter(r => r.status === "not_configured").length;
  const misconfiguredCount = results.filter(r => r.status === "misconfigured").length;
  const errorCount         = results.filter(r => r.status === "error").length;

  const lines: string[] = [
    "## Novada API — Extended Health Check",
    "",
    `api_key: ${maskedKey}`,
    `checked: ${new Date().toISOString()}`,
    "",
    "| Product | Status | Latency | Notes |",
    "|---------|--------|---------|-------|",
  ];

  for (const r of results) {
    lines.push(
      `| ${r.product} | ${statusIcon(r.status)} | ${latencyStr(r.latency)} | ${r.notes} |`
    );
  }

  lines.push("");
  lines.push("---");
  lines.push("## Summary");

  const parts: string[] = [];
  if (activeCount > 0)        parts.push(`${activeCount} active`);
  if (unavailableCount > 0)   parts.push(`${unavailableCount} not activated`);
  if (unconfiguredCount > 0)  parts.push(`${unconfiguredCount} not configured`);
  if (misconfiguredCount > 0) parts.push(`${misconfiguredCount} misconfigured`);
  if (errorCount > 0)         parts.push(`${errorCount} error`);
  lines.push(`- ${parts.join("  |  ")}`);

  const needsAction = results.filter(r => r.status !== "active");

  if (needsAction.length === 0) {
    lines.push("");
    lines.push("## Next Steps");
    lines.push("All products active — you're good to go.");
    lines.push("Call `novada_discover` to see the full tool catalog.");
  } else {
    lines.push("");
    lines.push("## Next Steps");
    for (const r of needsAction) {
      if (r.status === "not_activated") {
        const link = r.activationLink ?? "https://dashboard.novada.com/overview/scraper/";
        lines.push(
          `- **${r.product}** — Not activated. Activate at: ${link}`
        );
      } else if (r.status === "not_configured") {
        lines.push(`- **${r.product}** — Not configured. ${r.notes}`);
        if (r.activationLink) {
          lines.push(`  Get credentials: ${r.activationLink}`);
        }
      } else if (r.status === "misconfigured") {
        lines.push(`- **${r.product}** — Misconfigured. ${r.notes}`);
        if (r.activationLink) {
          lines.push(`  Get credentials: ${r.activationLink}`);
        }
      } else if (r.status === "error") {
        lines.push(`- **${r.product}** — Probe failed: ${r.notes}`);
      } else if (r.activationLink) {
        lines.push(
          `- **${r.product}** — Activate at: ${r.activationLink}`
        );
      }
    }

    lines.push("");
    lines.push(
      "> **agent_instruction:** Call `novada_health` for the quick overview. " +
      "For any PRODUCT_UNAVAILABLE result, visit the activation link above, " +
      "then re-run `novada_health_all` to confirm the product is now active. " +
      "For NOT_CONFIGURED products, export the required env vars and restart the MCP server."
    );
  }

  return lines.join("\n");
}
