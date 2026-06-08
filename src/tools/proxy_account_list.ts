// Wraps POST /v1/proxy_account/list on api-m.novada.com (developer-api).
//
// Field names match the API spec exactly (per docs/novada-api/proxy-user-management.md):
// `product` (REQUIRED), `page`, `limit`, `status?`, `account?`. Earlier versions
// used `page_size` / `username` and omitted `product` — those were guesses and
// produced `code:10001 Invalid parameter`.

import { z } from "zod";
import { devApiPost } from "../_core/developer_api.js";

const PRODUCT_CODES = ["1", "2", "3", "4", "7", "9"] as const;
const STATUS_CODES = ["1", "-3"] as const;

// ─── Schema & Types ──────────────────────────────────────────────────────────

export const ProxyAccountListParamsSchema = z
  .object({
    product: z
      .enum(PRODUCT_CODES)
      .describe(
        "REQUIRED. Product type code as string: 1=Residential, 2=Rotating ISP, 3=Rotating Datacenter, 4=Unlimited, 7=Unblocker, 9=Mobile. Must match a product provisioned on the account.",
      ),
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

export type ProxyAccountListParams = z.infer<typeof ProxyAccountListParamsSchema>;

export function validateProxyAccountListParams(
  args: Record<string, unknown> | undefined,
): ProxyAccountListParams {
  return ProxyAccountListParamsSchema.parse(args ?? {});
}

/**
 * List proxy sub-accounts on api-m.novada.com (`/v1/proxy_account/list`).
 * Read-only — paginated; optional status + account-name filters.
 * Request body is multipart/form-data per the API contract.
 */
export async function novadaProxyAccountList(
  params: ProxyAccountListParams,
  _apiKey?: string,
): Promise<string> {
  const body: Record<string, unknown> = {
    product: params.product,
    page: params.page,
    limit: params.limit,
    ...(params.status !== undefined ? { status: params.status } : {}),
    ...(params.account !== undefined ? { account: params.account } : {}),
  };

  const data = await devApiPost<unknown>("/v1/proxy_account/list", body);

  return JSON.stringify(
    {
      status: "ok",
      data,
      agent_instruction:
        "Lists proxy sub-accounts for the given product code. To create one use novada_proxy_account_create with `confirm: true`. Repeat with different `product` codes to see other product tiers.",
    },
    null,
    2,
  );
}
