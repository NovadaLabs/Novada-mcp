// Wraps POST /v1/proxy_account/create on api-m.novada.com (developer-api).
// ⚠️ WRITE tool — creates a billable sub-account.
// Two-step APPROVAL-TOKEN gate (F2-2/G-7 fix, 2026-09): the first call (no
// `approval_token`) returns a preview + a signed, expiring, payload-bound
// token and does NOT hit the API. Only a second call carrying that exact
// token AND the exact same parameters executes. `confirm: true` alone is a
// deprecated no-op — see ../utils/approval.ts for the shared implementation
// and the full rationale (this closes the self-supplied-confirm hole).
//
// Field names match the API spec exactly (verified against fudong screenshot 2026-06-05
// and docs/novada-api/proxy-user-management.md): `product`, `account`, `password`,
// `status`, `remark?`, `limit_flow?`. Earlier versions of this file used
// `username` / `traffic_limit` — those were guesses and produced
// `code:10001 Invalid parameter` responses against the live API.

import { z } from "zod";
import { devApiPost, maskPasswords } from "../_core/developer_api.js";
import { evaluateApprovalGate } from "../utils/approval.js";

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
        "DEPRECATED — ignored. Setting this alone no longer authorizes execution (closed 2026-09, finding F2-2: an agent could self-supply confirm:true with no prior human-reviewed preview). Use approval_token instead: call once WITHOUT approval_token to receive a preview and a token, then call again with the identical parameters plus approval_token.",
      ),
    approval_token: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Two-step approval token. Omit on the first call to receive a preview + a fresh approval_token (valid 10 minutes). Re-call with the EXACT SAME parameters plus this field set to that token to execute. Never invent a value — an invented or stale token is rejected.",
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
 * Two-step APPROVAL-TOKEN gate: without a valid `approval_token`, the tool
 * returns a preview payload plus a fresh token and does NOT hit the API.
 * Agents MUST surface the preview to the human user and only re-call with
 * the identical parameters plus that token after explicit approval.
 * `confirm: true` alone never authorizes execution (see ../utils/approval.ts).
 *
 * Request body is multipart/form-data per the API contract — handled centrally
 * by devApiPost. Fields posted: product, account, password, status,
 * remark?, limit_flow?.
 */
export async function novadaProxyAccountCreate(
  params: ProxyAccountCreateParams,
  apiKey?: string,
): Promise<string> {
  const gate = evaluateApprovalGate(params as Record<string, unknown>, "create_proxy_sub_account");
  if (!gate.authorized) {
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
        approval_token: gate.approvalToken,
        expires_at: new Date(gate.expiresAt).toISOString(),
        expires_in_seconds: gate.expiresInSeconds,
        agent_instruction:
          "This is a WRITE action that creates a billable proxy sub-account on the user's Novada plan. Show the preview (including product type and traffic cap) to the human user. To execute, call this tool again with the EXACT SAME parameters plus `approval_token` set to the value above (valid 10 minutes). `confirm: true` alone does nothing — it is deprecated and ignored.",
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

  const data = await devApiPost<unknown>("/v1/proxy_account/create", body, { apiKey });

  // INC-189 (Security): the create response echoes the account object, which the
  // proxy_account API family returns with a CLEARTEXT password. Recursively mask
  // every password-like key before surfacing so the credential never lands in the
  // MCP transcript (mirrors the masking on the sibling proxy_account_list tool).
  const maskedData = maskPasswords(data);

  return JSON.stringify(
    {
      status: "created",
      data: maskedData,
      agent_instruction:
        "Sub-account created on the user's Novada plan. Use novada_proxy_account_list (with the same `product` code) to confirm it appears. The password is masked in this response for security — the user set it and already has it.",
    },
    null,
    2,
  );
}
