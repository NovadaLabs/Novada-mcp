// Wraps POST /v1/wallet/balance on developer-api.novada.com.
import { z } from "zod";
import { devApiPost } from "../_core/developer_api.js";
// ─── Schema & Types ──────────────────────────────────────────────────────────
export const WalletBalanceParamsSchema = z.object({}).strict();
export function validateWalletBalanceParams(args) {
    return WalletBalanceParamsSchema.parse(args ?? {});
}
/**
 * Fetch the master wallet balance for the current developer-api account.
 * Returns the unwrapped envelope `data` payload alongside an agent hint.
 */
export async function novadaWalletBalance(_params, apiKey) {
    const body = {};
    const data = await devApiPost("/v1/wallet/balance", body, { apiKey });
    return JSON.stringify({
        status: "ok",
        data,
        agent_instruction: "Wallet balance reflects your master wallet. For per-product (residential/isp/mobile/datacenter/static/capture) sub-balances call novada_plan_balance_all.",
    }, null, 2);
}
//# sourceMappingURL=wallet_balance.js.map