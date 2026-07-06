/**
 * novada_account — unified account & billing tool.
 *
 * Folds 7 tools into one `section` param:
 *   summary  (default) — full dashboard: wallet + plans + capture logs + health entitlements
 *   balance             — wallet balance only
 *   usage               — paginated wallet usage record
 *   plans               — per-product plan balances (all 6 products)
 *   traffic             — daily traffic consumption (5 proxy products)
 *
 * Composes the EXISTING functions — does NOT re-implement any fetches.
 * Aliases (wallet_balance, wallet_usage_record, plan_balance_all, traffic_daily,
 * capture_logs, account_summary, health, health_all) route here in the dispatch
 * layer (src/index.ts + mcpserver mcp.ts).
 */

import { z } from "zod";
import { novadaAccountSummary } from "./account_summary.js";
import { novadaWalletBalance } from "./wallet_balance.js";
import { novadaWalletUsageRecord } from "./wallet_usage_record.js";
import { novadaPlanBalanceAll } from "./plan_balance_all.js";
import { novadaTrafficDaily } from "./traffic_daily.js";
import { novadaHealth } from "./health.js";
import { NovadaError, NovadaErrorCode, sanitizeServerMsg } from "../_core/errors.js";

// ─── Schema & Types ──────────────────────────────────────────────────────────

export const AccountParamsSchema = z
  .object({
    section: z
      .enum(["summary", "balance", "usage", "plans", "traffic"])
      .default("summary")
      .describe(
        "Which account data to fetch. " +
        "'summary' (default): full dashboard — wallet balance + plan balances + recent capture logs + health entitlements (proxy/browser). " +
        "'balance': master wallet balance (currency). " +
        "'usage': paginated wallet usage/transaction history. " +
        "'plans': per-product plan balances (residential/isp/mobile/datacenter/static/capture). " +
        "'traffic': daily proxy traffic consumption.",
      ),
    format: z
      .enum(["card", "json"])
      .default("card")
      .describe(
        "Output format. " +
        "'card' (default): human-readable markdown card — scannable headline, status table with icons, expired plans highlighted. " +
        "'json': clean flat structured object for programmatic use — no data.data nesting, human-readable values, errors[] aggregated.",
      ),
    // Deprecated no-op: 0.9.9–0.9.11 advertised `mode` (quick|full) on the summary
    // section. 0.9.12 removed it — the account card always shows full detail. Kept
    // here as an accepted-but-IGNORED optional so clients cached on the older schema
    // (and the novada_health alias) never hit a strict-mode "Unrecognized key" error.
    // Do NOT read this value anywhere.
    mode: z
      .enum(["quick", "full"])
      .optional()
      .describe("Deprecated and ignored — the account card always shows full detail. Accepted only for backward compatibility with older clients."),
    // Forwarded to the underlying tools when section != summary
    start_time: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Inclusive start date YYYY-MM-DD (usage/traffic sections only)."),
    end_time: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Inclusive end date YYYY-MM-DD (usage/traffic sections only)."),
    page: z
      .number()
      .int()
      .positive()
      .default(1)
      .describe("1-based page index (usage section only)."),
    page_size: z
      .number()
      .int()
      .positive()
      .max(200)
      .default(50)
      .describe("Page size, max 200 (usage section only)."),
    products: z
      .array(z.string())
      .optional()
      .describe(
        "Subset of products to query (plans/traffic sections only). " +
        "plans: residential|isp|mobile|datacenter|static|capture. " +
        "traffic: residential|isp|mobile|datacenter|static.",
      ),
  })
  .strict();

export type AccountParams = z.infer<typeof AccountParamsSchema>;

export function validateAccountParams(
  args: Record<string, unknown> | undefined,
): AccountParams {
  return AccountParamsSchema.parse(args ?? {});
}

// ─── Card renderers ──────────────────────────────────────────────────────────

/** Plan-status icon + label for a product row. */
function planIcon(
  expired: boolean | undefined,
  unavailable: boolean | undefined,
  isError: boolean,
  exhausted?: boolean,
): string {
  if (unavailable) return "⛔ not provisioned";
  if (isError) return "⛔ error";
  if (expired) return "⚠️ EXPIRED";
  if (exhausted) return "⚠️ exhausted";
  return "✅ active";
}

/** MB → human units: shows GB when ≥ 1024 */
function mbToHuman(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(1)} MB`;
}

/**
 * Normalize the polymorphic `balance` field returned by the developer API.
 *
 * Three shapes exist:
 *   1. Bare scalar (number)  — capture credits:  132.9091
 *   2. Request-count object  — mobile:            { balance, times, total, used }
 *   3. Bytes object          — residential/isp/datacenter/static: { balance: <bytes>, expire_time }
 *
 * Legacy test-fixture keys (balance_mb / remaining_mb / plan_mb) are still
 * handled so existing unit tests keep passing.
 */
function extractBalanceInfo(balance: unknown): { display: string; exhausted: boolean } {
  // ── 1. Bare scalar → capture credits ────────────────────────────────────
  if (typeof balance === "number") {
    const exhausted = balance <= 0;
    return { display: `${balance.toFixed(2)} credits`, exhausted };
  }

  if (!balance || typeof balance !== "object") {
    return { display: "—", exhausted: false };
  }

  const b = balance as Record<string, unknown>;

  // ── Legacy test-fixture keys (balance_mb / remaining_mb / plan_mb) ──────
  if (typeof b.balance_mb === "number") {
    const mb = b.balance_mb;
    return { display: mbToHuman(mb), exhausted: mb <= 0 };
  }
  if (typeof b.remaining_mb === "number") {
    const mb = b.remaining_mb;
    return { display: mbToHuman(mb), exhausted: mb <= 0 };
  }
  if (typeof b.plan_mb === "number") {
    const mb = b.plan_mb;
    return { display: mbToHuman(mb), exhausted: mb <= 0 };
  }

  // ── 2. Mobile: request-count exhaustion (used >= total) ──────────────────
  if (typeof b.total === "number" && typeof b.used === "number") {
    const exhausted = b.used >= b.total;
    let display: string;
    if (typeof b.balance === "number") {
      const mb = b.balance / (1024 * 1024);
      display = mb >= 1 ? `${mbToHuman(mb)} (${b.used}/${b.total} req)` : `${b.used}/${b.total} req`;
    } else {
      display = `${b.used}/${b.total} req`;
    }
    return { display, exhausted };
  }

  // ── 3. Standard proxy shape: { balance: <bytes>, expire_time: ... } ─────
  if (typeof b.balance === "number") {
    const bytes = b.balance;
    const mb = bytes / (1024 * 1024);
    const exhausted = bytes <= 0;
    return { display: mbToHuman(mb), exhausted };
  }

  return { display: "—", exhausted: false };
}

/**
 * @deprecated Use extractBalanceInfo instead.
 * Kept for the flattenSummaryJson caller that needs a raw MB number.
 */
function extractBalanceMb(balance: unknown): number | undefined {
  const { display } = extractBalanceInfo(balance);
  if (display === "—" || display.endsWith("credits") || display.includes("req")) return undefined;
  // Parse the human string back to a number (GB→MB if needed)
  const gbMatch = display.match(/^([\d.]+)\s*GB/);
  if (gbMatch) return parseFloat(gbMatch[1]) * 1024;
  const mbMatch = display.match(/^([\d.]+)\s*MB/);
  if (mbMatch) return parseFloat(mbMatch[1]);
  return undefined;
}

/** Render the summary section as a human card. */
function renderSummaryCard(summaryData: Record<string, unknown>): string {
  const headline = (summaryData.headline as string | undefined) ?? "";
  const sections = (summaryData.sections as Record<string, unknown> | undefined) ?? {};
  const wallet = sections.wallet as Record<string, unknown> | undefined;
  const plans = sections.plans as Record<string, unknown> | undefined;
  const capture = sections.capture_recent as Record<string, unknown> | undefined;
  const errors = (summaryData.errors as Array<{ product: string; error: string }> | undefined) ?? [];

  const lines: string[] = [];

  // ── Headline ────────────────────────────────────────────────────────────
  lines.push("## Novada Account");
  lines.push("");
  if (headline) {
    // Wallet balance from headline or wallet section
    const walletBalance = typeof wallet?.balance === "number" ? wallet.balance : undefined;
    // No currency field from the API → print bare number, do not invent €/$.
    const currency = typeof wallet?.currency === "string" ? wallet.currency : "";
    if (walletBalance !== undefined) {
      lines.push(`**Wallet:** ${currency}${walletBalance.toFixed(2)} *(currency as shown in your dashboard)*`);
    }
  }
  lines.push("");

  // ── Plan table ──────────────────────────────────────────────────────────
  const perProduct = (plans?.per_product as Record<string, unknown> | undefined) ?? {};
  const planSummary = (plans?.summary as Record<string, unknown> | undefined) ?? {};
  const expiredProducts = (planSummary.expired_products as string[] | undefined) ?? [];
  const hasExpired = expiredProducts.length > 0;

  if (hasExpired) {
    lines.push(`> ⚠️ **EXPIRED PLANS: ${expiredProducts.join(", ")}** — renew at https://dashboard.novada.com`);
    lines.push("");
  }

  const PLAN_LABELS: Record<string, string> = {
    residential: "Residential", isp: "ISP", mobile: "Mobile",
    datacenter: "Datacenter", static: "Static ISP", capture: "Capture",
  };

  lines.push("| Plan | Status | Balance | Expires |");
  lines.push("|------|--------|---------|---------|");

  for (const [key, val] of Object.entries(perProduct)) {
    const label = PLAN_LABELS[key] ?? key;
    if (!val || typeof val !== "object") continue;
    const v = val as Record<string, unknown>;
    const isErr = v.status === "error";
    const isUnavailable = v.unavailable === true;
    const isExpired = v.expired === true;
    const { display: balanceStr, exhausted } = typeof v.balance !== "undefined"
      ? extractBalanceInfo(v.balance)
      : { display: "—", exhausted: false };
    const icon = planIcon(isExpired, isUnavailable, isErr && !isUnavailable, !isExpired && !isErr && !isUnavailable && exhausted);
    const expiresStr = typeof v.expires_at === "string" ? v.expires_at : "—";
    lines.push(`| ${label} | ${icon} | ${balanceStr} | ${expiresStr} |`);
  }

  lines.push("");

  // ── Capture recent ──────────────────────────────────────────────────────
  if (capture?.status === "ok") {
    const recent = (capture.recent as unknown[] | undefined) ?? [];
    lines.push(`**Recent capture:** ${recent.length} log entries`);
    lines.push("");
  }

  // ── Errors (clean, no raw API text) ─────────────────────────────────────
  const realErrors = errors.filter(e => {
    // Suppress "not provisioned" product errors — already shown in table as ⛔
    return !e.error.toLowerCase().includes("not provisioned") &&
           !e.error.toLowerCase().includes("http 404") &&
           !e.error.includes("Product not provisioned");
  });
  if (realErrors.length > 0) {
    lines.push("**Issues:**");
    for (const e of realErrors) {
      lines.push(`- ${e.product}: service error (check API key or contact support)`);
    }
    lines.push("");
  }

  // ── Entitlements (from health section if present) ────────────────────────
  const entitlements = sections.entitlements as string | undefined;
  if (entitlements && typeof entitlements === "string") {
    // Extract only the plan table portion — skip the verbose health preamble
    const planTableStart = entitlements.indexOf("### Proxy Plan Balances");
    if (planTableStart === -1) {
      // No plan table — extract the product table from health
      const tableStart = entitlements.indexOf("| Product |");
      const tableEnd = entitlements.indexOf("\n---");
      if (tableStart !== -1) {
        lines.push("**Entitlements:**");
        lines.push(tableEnd !== -1
          ? entitlements.slice(tableStart, tableEnd).trim()
          : entitlements.slice(tableStart).trim());
        lines.push("");
      }
    }
  }

  lines.push(`*Checked: ${new Date().toISOString().slice(0, 19)}Z*`);

  return lines.join("\n");
}

/** Render wallet balance as a card. */
function renderBalanceCard(raw: Record<string, unknown>): string {
  const data = raw.data as Record<string, unknown> | undefined;
  const balance = typeof data?.balance === "number" ? data.balance : undefined;
  // No currency field from the API → print bare number, do not invent €/$.
  const currency = typeof data?.currency === "string" ? data.currency : "";
  if (balance === undefined) return "**Wallet balance:** unavailable";
  return `## Wallet Balance\n\n**${currency}${balance.toFixed(2)}** available *(currency as shown in your dashboard)*\n\n*Use \`section=plans\` for per-product MB quotas.*`;
}

/** Render wallet usage as a markdown table card. */
function renderUsageCard(raw: Record<string, unknown>): string {
  const data = raw.data as Record<string, unknown> | null | undefined;
  if (!data || typeof data !== "object") return "**Usage:** no records returned.";

  const list = Array.isArray((data as Record<string, unknown>).list)
    ? ((data as Record<string, unknown>).list as unknown[])
    : [];
  const count = typeof (data as Record<string, unknown>).count === "number"
    ? (data as Record<string, unknown>).count as number
    : list.length;

  const lines: string[] = [];
  lines.push("## Wallet Usage History");
  lines.push("");
  lines.push(`*${count} records total (showing ${list.length})*`);
  lines.push("");

  if (list.length === 0) {
    lines.push("No transactions found for the requested period.");
    return lines.join("\n");
  }

  lines.push("| Date | Description | Amount |");
  lines.push("|------|-------------|--------|");

  for (const item of list.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    const date = typeof t.created_at === "string" ? t.created_at.slice(0, 10)
                : typeof t.date === "string" ? t.date : "—";
    const desc = typeof t.remark === "string" ? t.remark
               : typeof t.description === "string" ? t.description
               : typeof t.type === "string" ? t.type : "—";
    const amtRaw = typeof t.amount === "number" ? t.amount
                 : typeof t.price === "number" ? t.price : undefined;
    const currency = typeof t.currency === "string" ? t.currency : "";
    const amt = amtRaw !== undefined ? `${currency}${amtRaw.toFixed ? amtRaw.toFixed(2) : amtRaw}` : "—";
    lines.push(`| ${date} | ${desc} | ${amt} |`);
  }

  if (list.length > 20) {
    lines.push(`*... and ${list.length - 20} more. Use \`page\`/\`page_size\` to paginate.*`);
  }

  return lines.join("\n");
}

/** Render plan balances as a markdown table card. */
function renderPlansCard(raw: Record<string, unknown>): string {
  const perProduct = (raw.per_product as Record<string, unknown> | undefined) ?? {};
  const planSummary = (raw.summary as Record<string, unknown> | undefined) ?? {};
  const expiredProducts = (planSummary.expired_products as string[] | undefined) ?? [];
  const activeProducts = (planSummary.active_products as string[] | undefined) ?? [];

  const lines: string[] = [];
  lines.push("## Plan Balances");
  lines.push("");
  lines.push(`${activeProducts.length} active / ${expiredProducts.length} expired`);
  lines.push("");

  if (expiredProducts.length > 0) {
    lines.push(`> ⚠️ **EXPIRED: ${expiredProducts.join(", ")}** — renew at https://dashboard.novada.com`);
    lines.push("");
  }

  const PLAN_LABELS: Record<string, string> = {
    residential: "Residential", isp: "ISP", mobile: "Mobile",
    datacenter: "Datacenter", static: "Static ISP", capture: "Capture",
  };

  lines.push("| Plan | Status | Balance | Expires |");
  lines.push("|------|--------|---------|---------|");

  for (const [key, val] of Object.entries(perProduct)) {
    const label = PLAN_LABELS[key] ?? key;
    if (!val || typeof val !== "object") continue;
    const v = val as Record<string, unknown>;
    const isErr = v.status === "error";
    const isUnavailable = v.unavailable === true;
    const isExpired = v.expired === true;
    const { display: balanceStr, exhausted } = typeof v.balance !== "undefined"
      ? extractBalanceInfo(v.balance)
      : { display: "—", exhausted: false };
    const icon = planIcon(isExpired, isUnavailable, isErr && !isUnavailable, !isExpired && !isErr && !isUnavailable && exhausted);
    const expiresStr = typeof v.expires_at === "string" ? v.expires_at : "—";
    lines.push(`| ${label} | ${icon} | ${balanceStr} | ${expiresStr} |`);
  }

  return lines.join("\n");
}

/** Render traffic data as a markdown table card. */
function renderTrafficCard(raw: Record<string, unknown>): string {
  const perProduct = (raw.per_product as Record<string, unknown> | undefined) ?? {};
  const totalMb = typeof raw.total_mb_across_products === "number" ? raw.total_mb_across_products : 0;
  const range = (raw.range as Record<string, unknown> | undefined) ?? {};

  const lines: string[] = [];
  lines.push("## Traffic Usage");
  lines.push("");
  lines.push(`**Total: ${mbToHuman(totalMb)}** — ${range.start_time ?? "?"} to ${range.end_time ?? "?"}`);
  lines.push("");
  lines.push("| Product | Consumed |");
  lines.push("|---------|----------|");

  for (const [key, val] of Object.entries(perProduct)) {
    if (!val || typeof val !== "object") continue;
    const v = val as Record<string, unknown>;
    if (v.status === "error") {
      lines.push(`| ${key} | ⛔ error |`);
    } else {
      const mb = typeof v.total_mb === "number" ? v.total_mb : 0;
      lines.push(`| ${key} | ${mbToHuman(mb)} |`);
    }
  }

  return lines.join("\n");
}

/** Flatten the summary JSON to a clean single-level structure. */
function flattenSummaryJson(summaryData: Record<string, unknown>): Record<string, unknown> {
  const sections = (summaryData.sections as Record<string, unknown> | undefined) ?? {};
  const wallet = sections.wallet as Record<string, unknown> | undefined;
  const plans = sections.plans as Record<string, unknown> | undefined;
  const capture = sections.capture_recent as Record<string, unknown> | undefined;
  const errors = (summaryData.errors as Array<{ product: string; error: string }> | undefined) ?? [];

  const planSummary = (plans?.summary as Record<string, unknown> | undefined) ?? {};
  const perProduct = (plans?.per_product as Record<string, unknown> | undefined) ?? {};

  // Flatten per-product into human-readable shape
  const flatPlans: Record<string, unknown> = {};
  const PLAN_LABELS: Record<string, string> = {
    residential: "Residential", isp: "ISP", mobile: "Mobile",
    datacenter: "Datacenter", static: "Static ISP", capture: "Capture",
  };
  for (const [key, val] of Object.entries(perProduct)) {
    if (!val || typeof val !== "object") continue;
    const v = val as Record<string, unknown>;
    const isErr = v.status === "error";
    const isUnavailable = v.unavailable === true;
    const isExpired = v.expired === true;
    const { display: balanceHuman, exhausted } = typeof v.balance !== "undefined"
      ? extractBalanceInfo(v.balance)
      : { display: null as unknown as string, exhausted: false };
    const balanceMb = typeof v.balance !== "undefined" ? extractBalanceMb(v.balance) : undefined;
    const derivedStatus = isUnavailable ? "not_provisioned"
      : isErr ? "error"
      : isExpired ? "expired"
      : exhausted ? "exhausted"
      : "active";
    flatPlans[key] = {
      name: PLAN_LABELS[key] ?? key,
      status: derivedStatus,
      balance_mb: balanceMb,
      balance_human: balanceHuman ?? null,
      expires_at: typeof v.expires_at === "string" ? v.expires_at : null,
    };
  }

  // Clean errors — omit "not provisioned" product 404s
  const cleanErrors = errors
    .filter(e => !e.error.includes("not provisioned") && !e.error.includes("HTTP 404") && !e.error.includes("Product not provisioned"))
    .map(e => ({ product: e.product, message: "service error" }));

  return {
    status: summaryData.status,
    wallet: {
      balance: typeof wallet?.balance === "number" ? wallet.balance : null,
      // API omits currency → report null, never an invented €/$.
      currency: typeof wallet?.currency === "string" ? wallet.currency : null,
      balance_human: typeof wallet?.balance === "number"
        ? `${typeof wallet?.currency === "string" ? wallet.currency : ""}${(wallet.balance as number).toFixed(2)}`
        : null,
    },
    plans: {
      active: (planSummary.active_products as string[] | undefined) ?? [],
      expired: (planSummary.expired_products as string[] | undefined) ?? [],
      not_provisioned: (planSummary.unavailable_products as string[] | undefined) ?? [],
      per_product: flatPlans,
    },
    capture_recent_count: Array.isArray(capture?.recent) ? (capture.recent as unknown[]).length : 0,
    errors: cleanErrors,
    agent_instruction: summaryData.agent_instruction,
  };
}

// ─── Graceful degradation helpers ────────────────────────────────────────────

const DASHBOARD_WALLET_URL = "https://dashboard.novada.com/wallet/";

/**
 * Determine whether a thrown error is a genuine auth failure (key rejected by
 * the server via HTTP 401/403 or a confirmed auth business code) vs. any other
 * kind of failure (undocumented business codes, network, 5xx, 404-product-not-
 * provisioned, "No approval received", etc.).
 *
 * Only true auth failures should surface as "key invalid" to the user.
 * Everything else is "data temporarily unavailable" — the key itself is fine.
 */
function isAuthFailure(err: unknown): boolean {
  if (!(err instanceof NovadaError) || err.code !== NovadaErrorCode.INVALID_API_KEY) {
    return false;
  }
  // M9: a MISSING dev-api key (the common "scraper-key-only" user) is NOT a
  // rejected-credential auth failure — it's "account data unavailable via this
  // key". Treat it as degrade-to-friendly-card, not rethrow. getDeveloperApiKey()
  // throws with this exact prefix when neither key is set.
  if (/Neither NOVADA_DEVELOPER_API_KEY/.test(err.message)) {
    return false;
  }
  return true;
}

/**
 * Build a concise, sanitized reason string from any thrown error.
 * Strips secrets, collapses to one line, caps at 120 chars.
 */
function shortReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return sanitizeServerMsg(raw).split("\n")[0]?.slice(0, 120) ?? "";
}

/**
 * The friendly dashboard-pointer card to show when developer-api can't return
 * account data for a non-auth reason. `isError=false` — this is a "data
 * temporarily unavailable" state, NOT a tool failure.
 */
function unavailableCard(reason?: string): string {
  const reasonLine = reason ? `\n> Reason: ${reason}` : "";
  return (
    `⚠️ Couldn't read your account via the API right now. ` +
    `Check your balance & usage at ${DASHBOARD_WALLET_URL}` +
    `\n(Your API key still works for search / extract / scrape / proxy / browser.)` +
    reasonLine
  );
}

/**
 * Wrap a section call so that dev-api business-code failures (including the
 * undocumented "No approval received") degrade gracefully to a dashboard-pointer
 * card instead of surfacing a raw scary error string.
 *
 * - Auth failures (HTTP 401/403, code 11000/10002) are re-thrown — they indicate
 *   the key itself is bad, which is different from an API data outage.
 * - Everything else (non-zero business codes, network, 5xx, 404-product) returns
 *   the friendly card with isError=false semantics in the returned string.
 */
async function withAccountFallback<T>(
  fn: () => Promise<T>,
  format: "card" | "json",
  sectionLabel: string,
): Promise<T | string> {
  try {
    return await fn();
  } catch (err) {
    if (isAuthFailure(err)) {
      // Auth failure: let it bubble — the key is genuinely invalid.
      throw err;
    }
    const reason = shortReason(err);
    if (format === "json") {
      return JSON.stringify({
        status: "unavailable",
        section: sectionLabel,
        message: `Account data temporarily unavailable. Check ${DASHBOARD_WALLET_URL}`,
        reason,
        note: "Your API key still works for search / extract / scrape / proxy / browser.",
        agent_instruction: `Account data is temporarily unavailable (not an auth failure). Direct the user to ${DASHBOARD_WALLET_URL} to check their balance and usage. Do NOT treat this as a key error.`,
      }, null, 2);
    }
    return unavailableCard(reason);
  }
}

// ─── Tool Implementation ─────────────────────────────────────────────────────

/**
 * Unified account & billing tool.
 * Routes to the appropriate underlying function based on `section`.
 */
export async function novadaAccount(
  params: AccountParams,
  apiKey?: string,
): Promise<string> {
  const section = params.section ?? "summary";
  const format = params.format ?? "card";

  switch (section) {
    case "summary": {
      // The summary merges account_summary (wallet+plans+capture) + health entitlements.
      // Always uses full mode — mode param has been removed; there is no lighter variant.
      // Both calls are wrapped: if dev-api returns a business error (e.g. "No approval
      // received"), we degrade gracefully to the dashboard-pointer card instead of
      // surfacing a raw scary error. Auth failures still bubble.
      let summaryResult: string;
      let healthResult: string;
      try {
        [summaryResult, healthResult] = await Promise.all([
          novadaAccountSummary({} as never, apiKey),
          novadaHealth(apiKey ?? "", "full"),
        ]);
      } catch (err) {
        if (isAuthFailure(err)) throw err;
        const reason = shortReason(err);
        if (format === "json") {
          return JSON.stringify({
            status: "unavailable",
            section: "summary",
            message: `Account data temporarily unavailable. Check ${DASHBOARD_WALLET_URL}`,
            reason,
            note: "Your API key still works for search / extract / scrape / proxy / browser.",
            agent_instruction: `Account data is temporarily unavailable (not an auth failure). Direct the user to ${DASHBOARD_WALLET_URL} to check their balance and usage. Do NOT treat this as a key error.`,
          }, null, 2);
        }
        return unavailableCard(reason);
      }
      // Parse the summary JSON
      let summaryData: Record<string, unknown>;
      try {
        summaryData = JSON.parse(summaryResult) as Record<string, unknown>;
      } catch {
        summaryData = { raw: summaryResult };
      }

      // Merge health into sections
      const merged: Record<string, unknown> = {
        ...summaryData,
        sections: {
          ...(typeof summaryData.sections === "object" && summaryData.sections !== null
            ? (summaryData.sections as Record<string, unknown>)
            : {}),
          entitlements: healthResult,
        },
        agent_instruction:
          (summaryData.agent_instruction as string | undefined) ??
          "Full account snapshot: wallet balance, plan quotas, recent capture activity, and product entitlements (proxy/browser/wallet-funded).",
      };

      if (format === "card") {
        return renderSummaryCard(merged);
      }

      // json: flatten into clean structure
      return JSON.stringify(flattenSummaryJson(merged), null, 2);
    }

    case "balance": {
      const result = await withAccountFallback(
        () => novadaWalletBalance({} as never, apiKey),
        format,
        "balance",
      );
      if (typeof result !== "string") return String(result);
      if (format === "card") {
        try {
          return renderBalanceCard(JSON.parse(result) as Record<string, unknown>);
        } catch {
          return result;
        }
      }
      // json: pass through (wallet_balance already returns clean single-level data)
      return result;
    }

    case "usage": {
      const result = await withAccountFallback(
        () => novadaWalletUsageRecord(
          {
            start_time: params.start_time,
            end_time: params.end_time,
            page: params.page ?? 1,
            page_size: params.page_size ?? 50,
          } as never,
          apiKey,
        ),
        format,
        "usage",
      );
      if (typeof result !== "string") return String(result);
      if (format === "card") {
        try {
          return renderUsageCard(JSON.parse(result) as Record<string, unknown>);
        } catch {
          return result;
        }
      }
      return result;
    }

    case "plans": {
      // Validate products subset (plan-specific values)
      const validPlanProducts = ["residential", "isp", "mobile", "datacenter", "static", "capture"] as const;
      type PlanProduct = typeof validPlanProducts[number];
      const products = params.products?.filter((p): p is PlanProduct =>
        (validPlanProducts as readonly string[]).includes(p),
      );
      const result = await withAccountFallback(
        () => novadaPlanBalanceAll(
          { products: products && products.length > 0 ? products : undefined } as never,
          apiKey,
        ),
        format,
        "plans",
      );
      if (typeof result !== "string") return String(result);
      if (format === "card") {
        try {
          return renderPlansCard(JSON.parse(result) as Record<string, unknown>);
        } catch {
          return result;
        }
      }
      return result;
    }

    case "traffic": {
      // Validate products subset (traffic-specific values)
      const validTrafficProducts = ["residential", "isp", "mobile", "datacenter", "static"] as const;
      type TrafficProduct = typeof validTrafficProducts[number];
      const products = params.products?.filter((p): p is TrafficProduct =>
        (validTrafficProducts as readonly string[]).includes(p),
      );
      const result = await withAccountFallback(
        () => novadaTrafficDaily(
          {
            start_time: params.start_time,
            end_time: params.end_time,
            products: products && products.length > 0 ? products : undefined,
          } as never,
          apiKey,
        ),
        format,
        "traffic",
      );
      if (typeof result !== "string") return String(result);
      if (format === "card") {
        try {
          return renderTrafficCard(JSON.parse(result) as Record<string, unknown>);
        } catch {
          return result;
        }
      }
      return result;
    }

    default: {
      // Exhaustiveness guard — TypeScript should prevent this, but guard at runtime too.
      const exhaustive: never = section;
      return JSON.stringify({
        status: "error",
        error: `Unknown section: ${String(exhaustive)}`,
        agent_instruction: "Valid sections: summary, balance, usage, plans, traffic.",
      }, null, 2);
    }
  }
}
