// Wraps POST /v1/wallet/balance on developer-api.novada.com.

import { z } from "zod";
import { devApiPost } from "../_core/developer_api.js";

// ─── Schema & Types ──────────────────────────────────────────────────────────

export const WalletBalanceParamsSchema = z.object({}).strict();

export type WalletBalanceParams = z.infer<typeof WalletBalanceParamsSchema>;

export function validateWalletBalanceParams(
  args: Record<string, unknown> | undefined
): WalletBalanceParams {
  return WalletBalanceParamsSchema.parse(args ?? {});
}

/**
 * Fetch the master wallet balance for the current developer-api account.
 * Returns the unwrapped envelope `data` payload alongside an agent hint.
 */
export async function novadaWalletBalance(
  _params: WalletBalanceParams,
  apiKey?: string
): Promise<string> {
  const body: Record<string, unknown> = {};
  const data = await devApiPost("/v1/wallet/balance", body, { apiKey });

  return JSON.stringify(
    {
      status: "ok",
      data,
      agent_instruction:
        "Wallet balance reflects your master wallet. For per-product (residential/isp/mobile/datacenter/static/capture) sub-balances call novada_plan_balance_all.",
    },
    null,
    2
  );
}
