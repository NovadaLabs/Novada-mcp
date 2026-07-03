import { z } from "zod";
import { getBrowserWs, getWebUnblockerKey, getProxyCredentials, fetchProxySubAccountCredentials, fetchBrowserSubAccountCredentials, } from "../utils/credentials.js";
import { SCRAPER_API_BASE, WEB_UNBLOCKER_BASE, } from "../config.js";
// ─── Constants ────────────────────────────────────────────────────────────────
const PROBE_TIMEOUT_MS = 20000;
// ─── Zod Schema ───────────────────────────────────────────────────────────────
export const HealthAllParamsSchema = z.object({});
export function validateHealthAllParams(args) {
    return HealthAllParamsSchema.parse(args ?? {});
}
// ─── Probe Helpers ────────────────────────────────────────────────────────────
async function probeSearchAll(apiKey) {
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
        let body = null;
        try {
            body = (await res.json());
        }
        catch { /* ignore */ }
        const code = body?.code;
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
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            product: "Search API",
            status: "error",
            latency: null,
            notes: msg.slice(0, 100),
        };
    }
    finally {
        clearTimeout(timer);
    }
}
async function probeExtractAll(_apiKey) {
    // NOVADA_API_KEY covers Web Unblocker (unified key) — no separate key needed.
    const unblockerKey = getWebUnblockerKey();
    if (!unblockerKey) {
        return {
            product: "Extract / Web Unblocker",
            status: "not_configured",
            latency: null,
            notes: "NOVADA_API_KEY env var not set (covers Web Unblocker — no separate key needed)",
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
                // js_render:true is required — js_render:false returns code=5001 (false-negative)
                js_render: true,
                country: "",
            }),
            signal: controller.signal,
        });
        const latency = Date.now() - start;
        let body = null;
        try {
            body = (await res.json());
        }
        catch { /* ignore */ }
        const code = body?.code;
        if (code === 0) {
            return {
                product: "Extract / Web Unblocker",
                status: "active",
                latency,
                notes: "JS-render probe OK",
            };
        }
        // code=5001 is the definitive "product not activated" signal
        if (code === 5001) {
            return {
                product: "Extract / Web Unblocker",
                status: "not_activated",
                latency,
                notes: "code=5001 — product not activated",
                activationLink: "https://dashboard.novada.com/overview/unblocker/",
            };
        }
        // Any other non-zero code is an error (auth failure, quota, etc.) — not "not_activated"
        return {
            product: "Extract / Web Unblocker",
            status: "error",
            latency,
            notes: `code=${code ?? res.status}`,
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            product: "Extract / Web Unblocker",
            status: "error",
            latency: null,
            notes: msg.slice(0, 100),
        };
    }
    finally {
        clearTimeout(timer);
    }
}
async function probeScraperAll(apiKey) {
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
        let body = null;
        try {
            body = (await res.json());
        }
        catch { /* ignore */ }
        const code = body?.code;
        if (code === 0) {
            return {
                product: "Scraper API (13 platforms)",
                status: "active",
                latency,
                notes: "google_search probe OK",
            };
        }
        if (code === 11006) {
            return {
                product: "Scraper API (13 platforms)",
                status: "not_activated",
                latency,
                notes: "code=11006 — contact support to enable Bearer token access",
                activationLink: "https://dashboard.novada.com/overview/scraper/",
            };
        }
        if (code === 11000) {
            return {
                product: "Scraper API (13 platforms)",
                status: "error",
                latency,
                notes: "code=11000 — invalid API key",
            };
        }
        return {
            product: "Scraper API (13 platforms)",
            status: "not_activated",
            latency,
            notes: `code=${code ?? res.status}`,
            activationLink: "https://dashboard.novada.com/overview/scraper/",
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            product: "Scraper API (13 platforms)",
            status: "error",
            latency: null,
            notes: msg.slice(0, 100),
        };
    }
    finally {
        clearTimeout(timer);
    }
}
async function probeProxyAll(apiKey) {
    // Local mode: explicit env credentials present → report configured.
    if (getProxyCredentials()) {
        return { product: "Proxy", status: "configured_unverified", latency: null, notes: "env vars present — no live probe" };
    }
    // NOV-689/hosted: no env vars — probe the auto-provision path (product=1 sub-account
    // fetched with the caller's key). If it returns, proxy IS usable from just the key
    // (universal gateway proxy.novada.pro:7777 + -zone-res). This is the reality on hosted;
    // the old code reported "not configured" here, which was false.
    const start = Date.now();
    try {
        const fetched = await fetchProxySubAccountCredentials(apiKey);
        const latency = Date.now() - start;
        if (fetched) {
            return { product: "Proxy", status: "active", latency, notes: "Auto-provisioned from API key (proxy.novada.pro:7777, zone-res)" };
        }
        return { product: "Proxy", status: "not_activated", latency, notes: "No proxy sub-account on this account — enable at dashboard.novada.com/overview/proxy/", activationLink: "https://dashboard.novada.com/overview/proxy/" };
    }
    catch (e) {
        return { product: "Proxy", status: "error", latency: Date.now() - start, notes: `Proxy probe failed: ${e instanceof Error ? e.message : String(e)}` };
    }
}
async function probeBrowserAll(apiKey) {
    // Local/explicit mode: NOVADA_BROWSER_WS set → report configured.
    const ws = getBrowserWs();
    if (ws) {
        if (!ws.startsWith("wss://") || !ws.includes("@")) {
            return { product: "Browser API", status: "misconfigured", latency: null, notes: "NOVADA_BROWSER_WS must be wss://username:password@host", activationLink: "https://dashboard.novada.com/overview/browser/" };
        }
        return { product: "Browser API", status: "configured_unverified", latency: null, notes: "env var present — no live probe" };
    }
    // Hosted: Browser API works via connectOverCDP to Novada's REMOTE cloud browser
    // (one-shot task, ~5s, verified 2026-07-03). Credentials auto-provision from the key
    // (product=10 sub-account, -zone-browser zone). Probe that path. The old code hard-coded
    // "not available on hosted — WebSocket not supported", which was FALSE (a one-shot CDP
    // session completes well inside the serverless budget).
    const start = Date.now();
    try {
        const wsUrl = await fetchBrowserSubAccountCredentials(apiKey);
        const latency = Date.now() - start;
        if (wsUrl) {
            return { product: "Browser API", status: "active", latency, notes: "Auto-provisioned from API key (one-shot CDP; use novada_browser)" };
        }
        return { product: "Browser API", status: "not_activated", latency, notes: "No Browser API sub-account on this account — enable at dashboard.novada.com/overview/browser/", activationLink: "https://dashboard.novada.com/overview/browser/" };
    }
    catch (e) {
        return { product: "Browser API", status: "error", latency: Date.now() - start, notes: `Browser probe failed: ${e instanceof Error ? e.message : String(e)}` };
    }
}
async function probeUnblockAll(apiKey) {
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
function statusIcon(status) {
    switch (status) {
        case "active": return "✅ Active";
        case "configured_unverified": return "⚙️ Configured (not verified)";
        case "not_activated": return "❌ Not activated";
        case "not_configured": return "⚠️ Not configured";
        case "misconfigured": return "⚠️ Misconfigured";
        case "error": return "❌ Error";
    }
}
function latencyStr(latency) {
    return latency !== null ? `${latency}ms` : "—";
}
// ─── Tool Implementation ──────────────────────────────────────────────────────
/**
 * Extended health check that tests ALL Novada product endpoints in parallel.
 * Never hard-fails — if one product probe throws, others still return.
 * Returns per-product status table with activation links for PRODUCT_UNAVAILABLE results.
 */
export async function novadaHealthAll(apiKey) {
    const maskedKey = apiKey.length >= 4 ? `****${apiKey.slice(-4)}` : "****";
    // Run all HTTP probes in parallel; sync checks run inline
    const [searchSettled, extractSettled, scraperSettled, unblockSettled, proxySettled, browserSettled,] = await Promise.allSettled([
        probeSearchAll(apiKey),
        probeExtractAll(apiKey),
        probeScraperAll(apiKey),
        probeUnblockAll(apiKey),
        probeProxyAll(apiKey),
        probeBrowserAll(apiKey),
    ]);
    const errorFallback = (product) => ({
        product,
        status: "error",
        latency: null,
        notes: "probe threw unexpectedly",
    });
    const results = [
        searchSettled.status === "fulfilled" ? searchSettled.value : errorFallback("Search API"),
        extractSettled.status === "fulfilled" ? extractSettled.value : errorFallback("Extract / Web Unblocker"),
        scraperSettled.status === "fulfilled" ? scraperSettled.value : errorFallback("Scraper API (13 platforms)"),
        proxySettled.status === "fulfilled" ? proxySettled.value : errorFallback("Proxy"),
        browserSettled.status === "fulfilled" ? browserSettled.value : errorFallback("Browser API"),
        unblockSettled.status === "fulfilled" ? unblockSettled.value : errorFallback("Unblock API"),
    ];
    const activeCount = results.filter(r => r.status === "active").length;
    const configuredUnverifiedCount = results.filter(r => r.status === "configured_unverified").length;
    const unavailableCount = results.filter(r => r.status === "not_activated").length;
    const unconfiguredCount = results.filter(r => r.status === "not_configured").length;
    const misconfiguredCount = results.filter(r => r.status === "misconfigured").length;
    const errorCount = results.filter(r => r.status === "error").length;
    const lines = [
        "## Novada API — Extended Health Check",
        "",
        `api_key: ${maskedKey}`,
        `checked: ${new Date().toISOString()}`,
        "",
        "| Product | Status | Latency | Notes |",
        "|---------|--------|---------|-------|",
    ];
    for (const r of results) {
        lines.push(`| ${r.product} | ${statusIcon(r.status)} | ${latencyStr(r.latency)} | ${r.notes} |`);
    }
    lines.push("");
    lines.push("---");
    lines.push("## Summary");
    const parts = [];
    if (activeCount > 0)
        parts.push(`${activeCount} active`);
    if (configuredUnverifiedCount > 0)
        parts.push(`${configuredUnverifiedCount} configured (not verified)`);
    if (unavailableCount > 0)
        parts.push(`${unavailableCount} not activated`);
    if (unconfiguredCount > 0)
        parts.push(`${unconfiguredCount} not configured`);
    if (misconfiguredCount > 0)
        parts.push(`${misconfiguredCount} misconfigured`);
    if (errorCount > 0)
        parts.push(`${errorCount} error`);
    lines.push(`- ${parts.join("  |  ")}`);
    const needsAction = results.filter(r => r.status !== "active");
    if (needsAction.length === 0) {
        lines.push("");
        lines.push("## Next Steps");
        lines.push("All products active — you're good to go.");
        lines.push("Call `novada_discover` to see the full tool catalog.");
    }
    else {
        lines.push("");
        lines.push("## Next Steps");
        for (const r of needsAction) {
            if (r.status === "configured_unverified") {
                lines.push(`- **${r.product}** — ${r.notes} — connectivity not confirmed, but should work if credentials are valid`);
            }
            else if (r.status === "not_activated") {
                const link = r.activationLink ?? "https://dashboard.novada.com/overview/scraper/";
                lines.push(`- **${r.product}** — Not activated. Activate at: ${link}`);
            }
            else if (r.status === "not_configured") {
                lines.push(`- **${r.product}** — Not configured. ${r.notes}`);
                if (r.activationLink) {
                    lines.push(`  Get credentials: ${r.activationLink}`);
                }
            }
            else if (r.status === "misconfigured") {
                lines.push(`- **${r.product}** — Misconfigured. ${r.notes}`);
                if (r.activationLink) {
                    lines.push(`  Get credentials: ${r.activationLink}`);
                }
            }
            else if (r.status === "error") {
                lines.push(`- **${r.product}** — Probe failed: ${r.notes}`);
            }
            else if (r.activationLink) {
                lines.push(`- **${r.product}** — Activate at: ${r.activationLink}`);
            }
        }
        lines.push("");
        lines.push("> **agent_instruction:** Call `novada_health` for the quick overview. " +
            "For any PRODUCT_UNAVAILABLE result, visit the activation link above, " +
            "then re-run `novada_health_all` to confirm the product is now active. " +
            "For NOT_CONFIGURED products, export the required env vars and restart the MCP server.");
    }
    return lines.join("\n");
}
//# sourceMappingURL=health_all.js.map