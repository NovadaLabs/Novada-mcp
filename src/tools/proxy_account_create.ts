// Wraps POST /v1/proxy_account/create on api-m.novada.com (developer-api).
// ⚠️ WRITE tool — creates a billable sub-account.
// Two-step gate: must be re-called with `confirm: true` after human approval.
// Without `confirm: true` the tool returns a preview and does NOT hit the API.
//
// Field names match the API spec exactly (verified against fudong screenshot 2026-06-05
// and docs/novada-api/proxy-user-management.md): `product`, `account`, `password`,
// `status`, `remark?`, `limit_flow?`. Earlier versions of this file used
// `username` / `traffic_limit` — those were guesses and produced
// `code:10001 Invalid parameter` responses against the live API.

import { z } from "zod";
import { devApiPost } from "../_core/developer_api.js";

// ─── Product code enum (per proxy-user-management.md docs) ───────────────────
// 1 = Residential, 2 = Rotating ISP, 3 = Rotating Datacenter,
// 4 = Unlimited, 7 = Unblocker, 9 = Mobile.
// Server expects the code as a STRING in the multipart field.
const PRODUCT_CODES = ["1", "2", "3", "4", "7", "9"] as const;
const PRODUCT_LABELS: Record<(typeof PRODUCT_CODES)[number], string> = {
  "1": "Residential",
  "2": "Rotating ISP",
  "3": "Rotating Datacenter",
  "4": "Unlimited",
  "7": "Unblocker",
  "9": "Mobile",
};

// Status: 1 = normal (active), -3 = personal disabled. String per multipart contract.
const STATUS_CODES = ["1", "-3"] as const;

// ─── Schema & Types ──────────────────────────────────────────────────────────

export const ProxyAccountCreateParamsSchema = z
  .object({
    product: z
      .enum(PRODUCT_CODES)
      .describe(
        "REQUIRED. Product type code as string: 1=Residential, 2=Rotating ISP, 3=Rotating Datacenter, 4=Unlimited, 7=Unblocker, 9=Mobile. Must match a product provisioned on the account.",
      ),
    account: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .describe("REQUIRED. Sub-account name. 3-64 chars, alphanumeric + underscore/hyphen only."),
    password: z
      .string()
      .min(8)
      .max(64)
      .describe("REQUIRED. Sub-account password. 8-64 chars. Will be sent to server in multipart body — caller decides storage."),
    status: z
      .enum(STATUS_CODES)
      .default("1")
      .describe('REQUIRED. Account status: "1" = active (default), "-3" = personal disabled.'),
    remark: z
      .string()
      .max(200)
      .optional()
      .describe("Optional note/label for this sub-account."),
    limit_flow: z
      .string()
      .optional()
      .describe(
        'Optional data cap in GB, as a string (e.g. "10" = 10 GB). Omit for no cap. Server expects string, not number.',
      ),
    confirm: z
      .literal(true)
      .optional()
      .describe(
        "REQUIRED for execution. Pass `true` ONLY after the human user has approved this account creation. If omitted, the tool returns a dry-run preview instead of calling the API.",
      ),
  })
  .strict();

export type ProxyAccountCreateParams = z.infer<typeof ProxyAccountCreateParamsSchema>;

export function validateProxyAccountCreateParams(
  args: Record<string, unknown> | undefined,
): ProxyAccountCreateParams {
  return ProxyAccountCreateParamsSchema.parse(args ?? {});
}

/**
 * Create a proxy sub-account on api-m.novada.com (`/v1/proxy_account/create`).
 *
 * Two-step confirm gate: without `confirm: true`, the tool returns a preview
 * payload and does NOT hit the API. Agents MUST surface the preview to the
 * human user and only re-call with `confirm: true` after explicit approval.
 *
 * Request body is multipart/form-data per the API contract — handled centrally
 * by devApiPost. Fields posted: product, account, password, status,
 * remark?, limit_flow?.
 */
export async function novadaProxyAccountCreate(
  params: ProxyAccountCreateParams,
  _apiKey?: string,
): Promise<string> {
  if (params.confirm !== true) {
    return JSON.stringify(
      {
        status: "confirmation_required",
        action: "create_proxy_sub_account",
        preview: {
          product: params.product,
          product_label: PRODUCT_LABELS[params.product],
          account: params.account,
          password: "********",
          status: params.status,
          remark: params.remark,
          limit_flow_gb: params.limit_flow ?? null,
        },
        agent_instruction:
          "This is a WRITE action that creates a billable proxy sub-account on the user's Novada plan. Show the preview (including product type and traffic cap) to the human user. Only re-call this tool with the same parameters PLUS `confirm: true` after the user explicitly approves.",
      },
      null,
      2,
    );
  }

  const body: Record<string, unknown> = {
    product: params.product,
    account: params.account,
    password: params.password,
    status: params.status,
    ...(params.remark !== undefined ? { remark: params.remark } : {}),
    ...(params.limit_flow !== undefined ? { limit_flow: params.limit_flow } : {}),
  };

  const data = await devApiPost<unknown>("/v1/proxy_account/create", body);

  return JSON.stringify(
    {
      status: "created",
      data,
      agent_instruction:
        "Sub-account created on the user's Novada plan. Use novada_proxy_account_list (with the same `product` code) to confirm it appears. Credentials are NOT logged here — the user already has them.",
    },
    null,
    2,
  );
}
