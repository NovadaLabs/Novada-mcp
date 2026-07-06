// Wraps POST /v1/proxy_account/list on api-m.novada.com (developer-api).
//
// Field names match the API spec exactly (per docs/novada-api/proxy-user-management.md):
// `product` (REQUIRED), `page`, `limit`, `status?`, `account?`. Earlier versions
// used `page_size` / `username` and omitted `product` — those were guesses and
// produced `code:10001 Invalid parameter`.
import { z } from "zod";
import { devApiPost, maskPasswords } from "../_core/developer_api.js";
const PRODUCT_CODES = ["1", "2", "3", "4", "7", "9"];
const STATUS_CODES = ["1", "-3"];
// ─── Schema & Types ──────────────────────────────────────────────────────────
export const ProxyAccountListParamsSchema = z
    .object({
    product: z
        // NOV-663: Explicitly require a string first so that integer inputs (e.g. product: 1)
        // are rejected with -32602 INVALID_PARAMS instead of being silently coerced to "1".
        // z.string() before z.enum() ensures the type error surfaces at the string layer.
        .string({ error: "product must be a string, not a number — use '1' not 1" })
        .pipe(z.enum(PRODUCT_CODES))
        .describe("REQUIRED. Product type code as string: 1=Residential, 2=Rotating ISP, 3=Rotating Datacenter, 4=Unlimited, 7=Unblocker, 9=Mobile. Must match a product provisioned on the account."),
    page: z
        .number()
        .int()
        .positive()
        .default(1)
        .describe("1-based page index."),
    limit: z
        .number()
        .int()
        .positive()
        .max(200)
        .default(50)
        .describe("Entries per page, max 200. (API field is `limit`, not `page_size`.)"),
    status: z
        .enum(STATUS_CODES)
        .optional()
        .describe('Optional filter: "1" = active, "-3" = disabled. Omit for both.'),
    account: z
        .string()
        .optional()
        .describe("Optional filter — exact-match account name. (API field is `account`, not `username`.)"),
})
    .strict();
export function validateProxyAccountListParams(args) {
    return ProxyAccountListParamsSchema.parse(args ?? {});
}
/**
 * List proxy sub-accounts on api-m.novada.com (`/v1/proxy_account/list`).
 * Read-only — paginated; optional status + account-name filters.
 * Request body is multipart/form-data per the API contract.
 */
export async function novadaProxyAccountList(params, apiKey) {
    const body = {
        product: params.product,
        page: params.page,
        limit: params.limit,
        ...(params.status !== undefined ? { status: params.status } : {}),
        ...(params.account !== undefined ? { account: params.account } : {}),
    };
    const data = await devApiPost("/v1/proxy_account/list", body, { apiKey });
    // INC-189 (Security): Mask plaintext passwords in API response.
    // The server returns `password` in cleartext for each sub-account — strip it
    // before surfacing to agents/users to prevent credential leakage via MCP transcript.
    // Recursive key-based masking (audit L11): resilient to nested/renamed containers,
    // not just the exact `data.list[].password` shape.
    const maskedData = maskPasswords(data);
    return JSON.stringify({
        status: "ok",
        data: maskedData,
        agent_instruction: "Lists proxy sub-accounts for the given product code. Passwords are masked for security. To create one use novada_proxy_account_create with `confirm: true`. Repeat with different `product` codes to see other product tiers.",
    }, null, 2);
}
//# sourceMappingURL=proxy_account_list.js.map