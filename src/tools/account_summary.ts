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
export type AccountSummaryParams = z.infer<typeof AccountSummaryParamsSchema>;

export function validateAccountSummaryParams(
  args: Record<string, unknown> | undefined,
): AccountSummaryParams {
  return AccountSummaryParamsSchema.parse(args ?? {});
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface SectionOk<T> { ok: true; data: T }
interface SectionErr { ok: false; error: string }
type Section<T> = SectionOk<T> | SectionErr;

function tryParse<T = unknown>(jsonText: string): T {
  try { return JSON.parse(jsonText) as T; }
  catch { return { _parse_error: true, raw: jsonText.slice(0, 200) } as unknown as T; }
}

async function runSection<T>(label: string, fn: () => Promise<string>): Promise<Section<T>> {
  try {
    const text = await fn();
    return { ok: true, data: tryParse<T>(text) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `${label}: ${msg}` };
  }
}

// ─── Tool Implementation ─────────────────────────────────────────────────────

interface WalletPayload {
  status?: string;
  data?: { balance?: number; currency?: string };
}
interface PlanPayload {
  status?: string;
  summary?: {
    active_products?: string[];
    expired_products?: string[];
    unavailable_products?: string[];
    all_plans_expired?: boolean;
  };
  per_product?: Record<string, unknown>;
}
interface CaptureLogsPayload {
  status?: string;
  data?: unknown;
}

/**
 * One-call account-status snapshot. Parallel-runs the three READ tools and
 * folds them into a single human-readable headline plus per-section detail.
 */
export async function novadaAccountSummary(
  _params: AccountSummaryParams,
  _apiKey?: string,
): Promise<string> {
  const t0 = Date.now();

  const [wallet, plans, capture] = await Promise.all([
    runSection<WalletPayload>("wallet_balance", () => novadaWalletBalance({} as never)),
    runSection<PlanPayload>("plan_balance_all", () => novadaPlanBalanceAll({} as never)),
    runSection<CaptureLogsPayload>("capture_logs", () =>
      novadaCaptureLogs({ page: 1, page_size: 5 } as never),
    ),
  ]);

  // ─── Headline derivation ────────────────────────────────────────────────
  const walletBalance = wallet.ok ? wallet.data?.data?.balance : undefined;
  const planSummary = plans.ok ? plans.data?.summary : undefined;
  const allExpired = planSummary?.all_plans_expired === true;
  const activeCount = planSummary?.active_products?.length ?? 0;
  const expiredCount = planSummary?.expired_products?.length ?? 0;
  const unavailableCount = planSummary?.unavailable_products?.length ?? 0;

  const headline: string[] = [];
  if (walletBalance !== undefined) {
    headline.push(`Wallet: €${walletBalance.toFixed(2)}`);
  } else if (!wallet.ok) {
    headline.push(`Wallet: error`);
  }
  headline.push(
    `Plans: ${activeCount} active / ${expiredCount} expired / ${unavailableCount} unavailable`,
  );
  if (allExpired) headline.push(`⚠️ ALL plans expired — buy at dashboard.novada.com`);

  // ─── Agent instruction ──────────────────────────────────────────────────
  let agent_instruction = "Account snapshot — wallet (currency), plans (per-product MB quotas), and recent capture activity.";
  if (allExpired && walletBalance && walletBalance > 0) {
    agent_instruction = `User has €${walletBalance.toFixed(2)} in wallet but ALL flow plans are expired. Suggest the user purchase a new plan at https://dashboard.novada.com to unlock proxy traffic again. Capture is funded separately.`;
  } else if (!wallet.ok || !plans.ok || !capture.ok) {
    agent_instruction = "Partial fetch — some sections errored. See sections.*.error for details. Call the individual tools directly to retry just the failing sections.";
  }

  return JSON.stringify(
    {
      status: wallet.ok && plans.ok && capture.ok ? "ok" : "partial",
      latency_ms: Date.now() - t0,
      headline: headline.join(" · "),
      sections: {
        wallet,
        plans,
        capture_recent: capture,
      },
      agent_instruction,
    },
    null,
    2,
  );
}
