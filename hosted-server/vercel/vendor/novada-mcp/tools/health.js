/**
 * novada_health — account-facts health check.
 *
 * Reports authoritative account state (wallet balance + proxy/browser entitlement
 * + plan balances) via the same billing API endpoints already used by
 * novada_account_summary / novada_plan_balance_all / novada_wallet_balance.
 *
 * DEFAULT (no probe): entitlement/provisioning status only — does NOT verify live
 * render capability. No credit cost. Pass probe:true for a real render test.
 *
 * probe:true: performs ONE minimal real render call billed to your account against
 * https://example.com via the Novada Web Unblocker. Reports the OBSERVED result.
 */
import { novadaWalletBalance } from "./wallet_balance.js";
import { novadaPlanBalanceAll } from "./plan_balance_all.js";
import { fetchProxySubAccountCredentials, fetchBrowserSubAccountCredentials, getProxyCredentials, getBrowserWs, } from "../utils/credentials.js";
import { fetchWithRender } from "../utils/http.js";
// ─── Shared prose helpers (re-used by health.ts output and core.ts dispatch) ─
/**
 * Disclaimer appended to every health output (default + probe paths).
 * Exported so the dispatch layer in core.ts can append it to novadaAccount
 * output without duplicating the wording.
 */
export const HEALTH_PROBE_DISCLAIMER = "> ⚠️ Entitlement/provisioning status only — does NOT verify live render capability.\n> Pass `probe:true` for a real test (billed 1 render call to your account).";
/**
 * Format the render probe section appended when probe:true.
 * Exported so core.ts can reuse the exact same wording.
 */
export function formatProbeSection(result) {
    const lines = [
        "",
        "### Render Probe",
        "",
        "> ⚠️ probe performed 1 real render call billed to your account",
        "",
        "render_probe:",
        "  attempted: true",
        `  ok: ${result.ok}`,
        `  detail: ${result.detail}`,
    ];
    if (!result.ok) {
        lines.push("", "> ❌ Render probe FAILED — do not assume live render capability is working.", `> Detail: ${result.detail}`);
    }
    return lines.join("\n");
}
// ─── Render probe (opt-in, billed) ───────────────────────────────────────────
/**
 * Performs ONE minimal real render call through the caller's Novada key against
 * https://example.com via the Web Unblocker. Exported so unit tests can mock it
 * via vi.mock("../../src/utils/http.js").
 *
 * This function MUST NOT be called unless probe:true is explicitly passed — it
 * is billed to the caller's account.
 */
export async function _performRenderProbe(apiKey) {
    try {
        const response = await fetchWithRender("https://example.com", apiKey, {
            tool: "health_probe",
            timeout: 10000,
        });
        const ok = response.status >= 200 && response.status < 300;
        return { ok, detail: `HTTP ${response.status}` };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, detail: msg.slice(0, 120) };
    }
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
function statusIcon(s) {
    switch (s) {
        case "available": return "✅ Available";
        case "needs_topup": return "⚠️ Needs top-up";
        case "needs_renewal": return "⚠️ Needs renewal";
        case "not_entitled": return "❌ Not entitled";
        case "not_configured": return "⚙️ Not configured";
        case "error": return "❌ Error";
    }
}
/**
 * Derive wallet-funded product status from wallet balance.
 * wallet > 0 → available; wallet === 0 → needs top-up; unknown → error.
 */
function walletFundedStatus(balance, error) {
    if (error)
        return "error";
    if (balance === undefined)
        return "error";
    return balance > 0 ? "available" : "needs_topup";
}
// ─── Per-product fact readers (no synthetic probes) ───────────────────────────
/** Proxy: check explicit env creds first, then auto-provision via API key. */
async function proxyStatus(apiKey) {
    const direct = getProxyCredentials();
    if (direct) {
        return {
            product: "Proxy",
            status: "available",
            note: "Explicit env creds (NOVADA_PROXY_USER/PASS/ENDPOINT configured)",
        };
    }
    // No env creds → check if account has a proxy sub-account (product=1)
    try {
        const creds = await fetchProxySubAccountCredentials(apiKey);
        if (creds) {
            return {
                product: "Proxy",
                status: "available",
                note: "Auto-provisioned from API key (proxy.novada.pro:7777, zone-res)",
            };
        }
        return {
            product: "Proxy",
            status: "not_entitled",
            note: "No proxy sub-account on this account — enable at https://dashboard.novada.com/overview/proxy/",
        };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { product: "Proxy", status: "error", note: `Account API error: ${msg.slice(0, 80)}` };
    }
}
/** Browser API: check explicit env creds first, then auto-provision via API key. */
async function browserStatus(apiKey) {
    const ws = getBrowserWs();
    if (ws) {
        return {
            product: "Browser API",
            status: "available",
            note: "NOVADA_BROWSER_WS env var configured",
        };
    }
    // No env var → check if account has a Browser API sub-account (product=10)
    try {
        const wsUrl = await fetchBrowserSubAccountCredentials(apiKey);
        if (wsUrl) {
            return {
                product: "Browser API",
                status: "available",
                note: "Auto-provisioned from API key (one-shot CDP via upg-scbr2.novada.com)",
            };
        }
        return {
            product: "Browser API",
            status: "not_entitled",
            note: "No Browser API sub-account on this account — enable at https://dashboard.novada.com/overview/browser/",
        };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { product: "Browser API", status: "error", note: `Account API error: ${msg.slice(0, 80)}` };
    }
}
// ─── Main export ──────────────────────────────────────────────────────────────
/**
 * Account-facts health check.
 *
 * mode="quick": wallet balance + proxy/browser entitlement only (fast, no plan details).
 * mode="full" : quick + per-product proxy plan balances with expiry dates.
 * probe       : when true, performs ONE real render call (billed) to verify live
 *               render capability. Defaults to false (entitlement-only, no billing).
 *
 * novada_health_all is an alias for novada_health(mode="full").
 */
export async function novadaHealth(apiKey, mode = "quick", probe = false) {
    const maskedKey = apiKey.length >= 4 ? `****${apiKey.slice(-4)}` : "****";
    // ── 1. Fetch wallet and (if full) plan balances in parallel ──────────────
    const walletPromise = novadaWalletBalance({}, apiKey)
        .then(raw => {
        const parsed = JSON.parse(raw);
        const balance = parsed?.data?.balance;
        const currency = parsed?.data?.currency;
        return { balance: typeof balance === "number" ? balance : undefined, currency, error: undefined };
    })
        .catch((e) => ({
        balance: undefined,
        currency: undefined,
        error: e instanceof Error ? e.message : String(e),
    }));
    const planPromise = mode === "full"
        ? novadaPlanBalanceAll({}, apiKey)
            .then(raw => JSON.parse(raw))
            .catch(() => null)
        : Promise.resolve(null);
    const [wallet, planData, proxy, browser] = await Promise.all([
        walletPromise,
        planPromise,
        proxyStatus(apiKey),
        browserStatus(apiKey),
    ]);
    // ── 2. Derive wallet-funded product statuses ──────────────────────────────
    const walletStatus = walletFundedStatus(wallet.balance, wallet.error);
    const walletNote = wallet.error
        ? `Error fetching balance: ${wallet.error.slice(0, 80)}`
        : wallet.balance !== undefined
            ? wallet.balance > 0
                ? `${wallet.currency ?? ""}${wallet.balance.toFixed(2)} — funds Search, Extract, Scraper, Unblock (pay-per-use)`
                : `${wallet.currency ?? ""}0.00 — top up at https://dashboard.novada.com to re-enable pay-per-use tools`
            : "Balance unknown";
    const walletFundedProducts = [
        {
            product: "Search / Extract / Scraper / Unblock",
            status: walletStatus,
            note: walletNote,
        },
    ];
    // ── 3. Build status rows ──────────────────────────────────────────────────
    const allProducts = [
        ...walletFundedProducts,
        proxy,
        browser,
    ];
    // ── 4a. Optional render probe (probe:true only — billed) ─────────────────
    let probeResult = null;
    if (probe) {
        probeResult = await _performRenderProbe(apiKey);
    }
    // ── 4b. Format markdown output ────────────────────────────────────────────
    const lines = [
        "## Novada API — Account Status",
        "",
        `api_key: ${maskedKey}`,
        `checked: ${new Date().toISOString()}`,
        "",
        // Reuse shared disclaimer constant — same wording as core.ts dispatch path.
        ...HEALTH_PROBE_DISCLAIMER.split("\n"),
        "",
        "| Product | Status | Notes |",
        "|---------|--------|-------|",
    ];
    for (const p of allProducts) {
        lines.push(`| ${p.product} | ${statusIcon(p.status)} | ${p.note} |`);
    }
    // Add plan balance rows (full mode only)
    if (mode === "full" && planData?.per_product) {
        lines.push("");
        lines.push("### Proxy Plan Balances");
        lines.push("");
        lines.push("| Plan | Status | Balance | Expires |");
        lines.push("|------|--------|---------|---------|");
        const PLAN_LABELS = {
            residential: "Residential",
            isp: "ISP",
            mobile: "Mobile",
            datacenter: "Datacenter",
            static: "Static ISP",
            capture: "Capture",
        };
        for (const [key, val] of Object.entries(planData.per_product)) {
            const label = PLAN_LABELS[key] ?? key;
            if (val.status === "error") {
                // Check if it's a missing product (not provisioned) vs actual error
                const isUnavailable = val.unavailable === true;
                if (isUnavailable) {
                    lines.push(`| ${label} | ❌ Not on account | — | — |`);
                }
                else {
                    lines.push(`| ${label} | ❌ Error | — | — |`);
                }
            }
            else {
                const planExpired = val.expired === true;
                const planStatus = planExpired ? "⚠️ Expired" : "✅ Active";
                // Extract balance_mb if present
                const balanceRaw = val.balance;
                const balanceMb = typeof balanceRaw?.balance_mb === "number" ? `${balanceRaw.balance_mb} MB` : "—";
                const expiresAt = val.expires_at ?? val.expires_at_human ?? "—";
                lines.push(`| ${label} | ${planStatus} | ${balanceMb} | ${expiresAt} |`);
            }
        }
    }
    // ── 4c. Render probe results (probe:true only) ────────────────────────────
    if (probeResult !== null) {
        // Reuse shared formatProbeSection — same wording as core.ts dispatch path.
        lines.push(...formatProbeSection(probeResult).split("\n"));
    }
    // ── 5. Summary + headline ──────────────────────────────────────────────────
    const availableCount = allProducts.filter(p => p.status === "available").length;
    const actionNeeded = allProducts.filter(p => p.status !== "available");
    lines.push("");
    lines.push("---");
    lines.push("## Summary");
    const headline = `${availableCount}/${allProducts.length} product groups available`;
    lines.push(`- ${headline}`);
    if (wallet.balance !== undefined) {
        const suffix = wallet.balance > 0 ? `(${wallet.currency ?? ""}${wallet.balance.toFixed(2)} wallet)` : "(empty wallet)";
        lines.push(`- Pay-per-use tools (Search/Extract/Scraper/Unblock): ${walletStatus === "available" ? "funded" : "needs top-up"} ${suffix}`);
    }
    if (actionNeeded.length > 0) {
        lines.push("");
        lines.push("## Action Required");
        for (const p of actionNeeded) {
            lines.push(`- **${p.product}**: ${p.note}`);
        }
    }
    if (mode === "full" && planData?.summary) {
        const summary = planData.summary;
        if (summary.expired_products && summary.expired_products.length > 0) {
            lines.push("");
            lines.push(`> Expired proxy plans: ${summary.expired_products.join(", ")}. Purchase new plan at https://dashboard.novada.com`);
        }
    }
    return lines.join("\n");
}
//# sourceMappingURL=health.js.map