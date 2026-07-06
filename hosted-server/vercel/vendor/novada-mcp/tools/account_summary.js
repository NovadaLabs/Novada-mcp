// Single-call account dashboard for Novada.
//
// Calls wallet_balance + plan_balance_all + capture_logs (last 1 day) in
// parallel and folds the three results into a single human-readable + agent-
// readable JSON summary. Designed for the most common prompt: "tell me my
// Novada account status" — agents shouldn't have to make 3 round-trips.
//
// Composition pattern: invokes existing tool functions and parses their JSON
// string outputs. All three already throw NovadaError on failure, so partial
// failures bubble up via Promise.allSettled isolation.
import { z } from "zod";
import { novadaWalletBalance } from "./wallet_balance.js";
import { novadaPlanBalanceAll } from "./plan_balance_all.js";
import { novadaCaptureLogs } from "./capture_logs.js";
// ─── Schema & Types ──────────────────────────────────────────────────────────
export const AccountSummaryParamsSchema = z.object({}).strict();
export function validateAccountSummaryParams(args) {
    return AccountSummaryParamsSchema.parse(args ?? {});
}
function tryParse(jsonText) {
    try {
        return JSON.parse(jsonText);
    }
    catch {
        return { _parse_error: true, raw: jsonText.slice(0, 200) };
    }
}
async function runSection(label, fn) {
    try {
        const raw = await fn();
        const parsed = tryParse(raw);
        if (parsed && typeof parsed === 'object' && '_parse_error' in parsed) {
            throw new Error('Failed to parse API response — raw: ' + String(raw).slice(0, 200));
        }
        return { ok: true, data: parsed };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `${label}: ${msg}` };
    }
}
/** Flatten the wallet envelope: {ok,data:{status,data:{balance}}} -> {status,balance}. */
function unwrapWallet(section) {
    if (!section.ok)
        return { status: "error", error: section.error };
    const payload = section.data;
    const balance = payload?.data?.balance;
    const currency = payload?.data?.currency;
    return {
        status: "ok",
        ...(typeof balance === "number" ? { balance } : {}),
        ...(currency ? { currency } : {}),
    };
}
/** Remove raw `expire_time` epoch from a per-product balance object — the human
 *  date is surfaced separately as `expires_at` (R7: one representation, not both). */
function stripEpoch(balance) {
    if (!balance || typeof balance !== "object")
        return balance;
    const clone = { ...balance };
    delete clone.expire_time;
    return clone;
}
/** Flatten the plans envelope. Drops the doubled error string from per_product
 *  (keeps it once in `errors[]`), and drops raw `expire_time` epoch in favour of
 *  the human date already computed by plan_balance_all (R6 + R7). */
function unwrapPlans(section) {
    if (!section.ok)
        return { status: "error", error: section.error };
    const payload = section.data ?? {};
    const rawPerProduct = payload.per_product ?? {};
    const perProduct = {};
    for (const [key, value] of Object.entries(rawPerProduct)) {
        if (value && typeof value === "object") {
            const v = value;
            if (v.status === "error") {
                // R6: don't repeat the 180-char error string here — point at errors[].
                perProduct[key] = {
                    status: "error",
                    ...(v.unavailable === true ? { unavailable: true } : {}),
                    see_errors: true,
                };
            }
            else {
                // R7: keep ONE timestamp representation — the human date; drop raw epoch.
                perProduct[key] = {
                    status: "ok",
                    balance: stripEpoch(v.balance),
                    ...(typeof v.expired === "boolean" ? { expired: v.expired } : {}),
                    ...(typeof v.expires_at_human === "string" ? { expires_at: v.expires_at_human } : {}),
                };
            }
        }
    }
    const status = payload.status ?? "ok";
    return {
        status,
        ...(payload.summary ? { summary: payload.summary } : {}),
        per_product: perProduct,
        ...(payload.errors && payload.errors.length ? { errors: payload.errors } : {}),
    };
}
/** Flatten the capture envelope: {ok,data:{status,data:{list}}} -> {status,recent}. */
function unwrapCapture(section) {
    if (!section.ok)
        return { status: "error", error: section.error };
    const payload = section.data;
    const inner = payload?.data;
    const list = inner && typeof inner === "object" && Array.isArray(inner.list)
        ? inner.list
        : undefined;
    return { status: "ok", ...(list ? { recent: list } : {}) };
}
/**
 * One-call account-status snapshot. Parallel-runs the three READ tools and
 * folds them into a single human-readable headline plus per-section detail.
 */
export async function novadaAccountSummary(_params, apiKey) {
    const t0 = Date.now();
    const [wallet, plans, capture] = await Promise.all([
        runSection("wallet_balance", () => novadaWalletBalance({}, apiKey)),
        runSection("plan_balance_all", () => novadaPlanBalanceAll({}, apiKey)),
        runSection("capture_logs", () => novadaCaptureLogs({ page: 1, page_size: 5 }, apiKey)),
    ]);
    // ─── Unwrap sub-tool envelopes (R8) ───────────────────────────────────────
    // Flatten each section so a value is reachable at one level (wallet.balance),
    // not wallet.data.data.balance. Aggregate error strings live once (R6).
    const walletSection = unwrapWallet(wallet);
    const plansSection = unwrapPlans(plans);
    const captureSection = unwrapCapture(capture);
    // ─── Headline derivation ────────────────────────────────────────────────
    const walletBalance = walletSection.balance;
    const planSummary = plans.ok ? plans.data?.summary : undefined;
    const allExpired = planSummary?.all_plans_expired === true;
    const activeCount = planSummary?.active_products?.length ?? 0;
    const expiredCount = planSummary?.expired_products?.length ?? 0;
    const unavailableCount = planSummary?.unavailable_products?.length ?? 0;
    const headline = [];
    if (walletBalance !== undefined) {
        headline.push(`Wallet: €${walletBalance.toFixed(2)}`);
    }
    else if (!wallet.ok) {
        headline.push(`Wallet: error`);
    }
    headline.push(`Plans: ${activeCount} active / ${expiredCount} expired / ${unavailableCount} unavailable`);
    if (allExpired)
        headline.push(`⚠️ ALL plans expired — buy at dashboard.novada.com`);
    // ─── Agent instruction ──────────────────────────────────────────────────
    let agent_instruction = "Account snapshot — wallet (currency), plans (per-product MB quotas), and recent capture activity.";
    if (allExpired && walletBalance && walletBalance > 0) {
        agent_instruction = `User has €${walletBalance.toFixed(2)} in wallet but ALL flow plans are expired. Suggest the user purchase a new plan at https://dashboard.novada.com to unlock proxy traffic again. Capture is funded separately.`;
    }
    else if (!wallet.ok || !plans.ok || !capture.ok) {
        agent_instruction = "Partial fetch — some sections errored. See sections.*.error for details. Call the individual tools directly to retry just the failing sections.";
    }
    // ─── Aggregate errors: one place, one copy (R6) ───────────────────────────
    // Collect fetch-level section errors + provisioning errors surfaced by
    // plan_balance_all. Deduped by (product|section + message) so a static-product
    // 404 appears exactly once, never in both per_product AND errors[].
    const errors = [];
    const seenErrors = new Set();
    const pushErr = (product, error) => {
        const key = `${product}::${error}`;
        if (seenErrors.has(key))
            return;
        seenErrors.add(key);
        errors.push({ product, error });
    };
    if (walletSection.status === "error" && walletSection.error)
        pushErr("wallet", walletSection.error);
    if (plansSection.status === "error" && plansSection.error)
        pushErr("plans", plansSection.error);
    if (captureSection.status === "error" && captureSection.error)
        pushErr("capture_recent", captureSection.error);
    for (const e of plansSection.errors ?? [])
        pushErr(e.product, e.error);
    // The per-section aggregate error strings now live in the top-level errors[];
    // strip the duplicate list from the plans section so it is not carried twice.
    const plansOut = { ...plansSection };
    delete plansOut.errors;
    return JSON.stringify({
        status: wallet.ok && plans.ok && capture.ok ? "ok" : "partial",
        latency_ms: Date.now() - t0,
        headline: headline.join(" · "),
        sections: {
            wallet: walletSection,
            plans: plansOut,
            capture_recent: captureSection,
        },
        ...(errors.length ? { errors } : {}),
        agent_instruction,
    }, null, 2);
}
//# sourceMappingURL=account_summary.js.map