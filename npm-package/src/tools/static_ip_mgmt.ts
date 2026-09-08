// Wraps static ISP IP management endpoints on api-m.novada.com (developer-api):
//   POST /v1/static_house/open   — purchase new static IPs
//   POST /v1/static_house/renew  — renew existing static IPs
//   POST /v1/static_house/export — export filtered IP list
//   POST /v1/static_house/list   — list static IPs with filters + pagination
//
// Combined into ONE tool with an `action` discriminator.
// "open" and "renew" are WRITE actions — gated behind the shared
// APPROVAL-TOKEN flow (F2-2/G-7 fix, 2026-09): first call (no
// `approval_token`) returns a preview + a signed, expiring, payload-bound
// token; only a second call carrying that exact token AND the exact same
// parameters executes. `confirm: true` alone is a deprecated no-op — see
// ../utils/approval.ts.
//
// Field names match the API spec (docs/novada-api/static-isp-proxies.md).

import { z } from "zod";
import { devApiPost } from "../_core/developer_api.js";
import { evaluateApprovalGate } from "../utils/approval.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const ACTIONS = ["open", "renew", "export", "list"] as const;
const IP_TYPES = ["normal", "premium"] as const;
const DURATIONS = ["week", "month"] as const;

const IP_TYPE_LABELS: Record<(typeof IP_TYPES)[number], string> = {
  normal: "Standard ISP IP",
  premium: "Premium ISP IP",
};

const DURATION_LABELS: Record<(typeof DURATIONS)[number], string> = {
  week: "1 week",
  month: "1 month",
};

// ─── Schema & Types ──────────────────────────────────────────────────────────

export const StaticIpMgmtParamsSchema = z
  .object({
    action: z
      .enum(ACTIONS)
      .describe(
        'Action to perform. "open" = purchase new static IPs (WRITE, requires approval_token). "renew" = renew existing IPs (WRITE, requires approval_token). "export" = export filtered IP list. "list" = list static IPs with pagination.',
      ),

    // ── "open" action fields ──────────────────────────────────────────────
    ip_type: z
      .enum(IP_TYPES)
      .optional()
      .describe('Required for "open". IP type: "normal" (Standard) or "premium" (Premium).'),
    region: z
      .string()
      // SECURITY (L3 review): flows into the HTTP request body — allowlist chars.
      .regex(/^[a-zA-Z0-9_-]{1,64}$/)
      .optional()
      .describe('Required for "open". Area/region code. Also optional filter for "list" and "export".'),
    duration: z
      .enum(DURATIONS)
      .optional()
      .describe('Required for "open" and "renew". Activation/renewal period: "week" or "month".'),
    num: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Required for "open". Number of static IPs to activate.'),

    // ── "renew" action fields ─────────────────────────────────────────────
    renew_ip_list: z
      .string()
      // SECURITY (L3 review): flows into the HTTP request body — restrict to IP list chars (digits, dots, commas).
      .regex(/^[\d.,]+$/)
      .optional()
      .describe('Required for "renew". Comma-separated list of IPs to renew.'),

    // ── "list" action fields ──────────────────────────────────────────────
    page: z
      .number()
      .int()
      .positive()
      .default(1)
      .describe('Page number for "list" action. Default 1.'),
    limit: z
      .number()
      .int()
      .positive()
      .max(200)
      .default(50)
      .describe('Entries per page for "list" action. Default 50, max 200.'),

    // ── Shared filter fields (list + export) ──────────────────────────────
    status: z
      .enum(["", "1", "2", "3"])
      .optional()
      .describe('Filter for "list"/"export". ""=All, "1"=In use, "2"=Expired, "3"=Released.'),
    key_word: z
      .string()
      // SECURITY (L3 review): flows into the HTTP request body — bound the length.
      .max(200)
      .optional()
      .describe('Search filter for "list"/"export". Searches remarks, order number, or IP.'),
    is_auto_renew: z
      .number()
      .int()
      .optional()
      .describe('Auto-renew filter for "list"/"export". 1=Yes, -1=No.'),

    // ── Confirm gate (deprecated flag; see approval_token below) ──────────
    confirm: z
      .literal(true)
      .optional()
      .describe(
        'DEPRECATED — ignored. Setting this alone no longer authorizes "open"/"renew" execution (closed 2026-09, finding F2-2: an agent could self-supply confirm:true with no prior human-reviewed preview, including a PURCHASE — see F2-eval R9). Use approval_token instead: call once WITHOUT approval_token to receive a preview and a token, then call again with the identical parameters plus approval_token.',
      ),
    approval_token: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Two-step approval token, required to execute "open"/"renew". Omit on the first call to receive a preview + a fresh approval_token (valid 10 minutes). Re-call with the EXACT SAME parameters plus this field set to that token to execute. Never invent a value — an invented or stale token is rejected.',
      ),
  })
  .strict();

export type StaticIpMgmtParams = z.infer<typeof StaticIpMgmtParamsSchema>;

export function validateStaticIpMgmtParams(
  args: Record<string, unknown> | undefined,
): StaticIpMgmtParams {
  return StaticIpMgmtParamsSchema.parse(args ?? {});
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertDefined<T>(value: T | undefined, field: string, action: string): T {
  if (value === undefined) {
    throw new Error(`"${field}" is required for action "${action}".`);
  }
  return value;
}

function optionalField(key: string, value: unknown): Record<string, unknown> {
  return value !== undefined ? { [key]: value } : {};
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Unified static ISP IP management tool.
 *
 * "open" and "renew" are WRITE actions gated behind a valid `approval_token`
 * (see ../utils/approval.ts). Without one, they return a preview payload
 * plus a fresh token and do NOT hit the API. "list" and "export" are read-only.
 */
export async function novadaStaticIpMgmt(
  params: StaticIpMgmtParams,
  apiKey?: string,
): Promise<string> {
  switch (params.action) {
    case "open":
      return handleOpen(params, apiKey);
    case "renew":
      return handleRenew(params, apiKey);
    case "export":
      return handleExport(params, apiKey);
    case "list":
      return handleList(params, apiKey);
  }
}

// ── open ─────────────────────────────────────────────────────────────────────

async function handleOpen(params: StaticIpMgmtParams, apiKey?: string): Promise<string> {
  const ip_type = assertDefined(params.ip_type, "ip_type", "open");
  const region = assertDefined(params.region, "region", "open");
  const duration = assertDefined(params.duration, "duration", "open");
  const num = assertDefined(params.num, "num", "open");

  const openGate = evaluateApprovalGate(params as Record<string, unknown>, "static_ip_open");
  if (!openGate.authorized) {
    return JSON.stringify(
      {
        status: "confirmation_required",
        action: "static_ip_open",
        preview: {
          ip_type,
          ip_type_label: IP_TYPE_LABELS[ip_type],
          region,
          duration,
          duration_label: DURATION_LABELS[duration],
          num,
        },
        approval_token: openGate.approvalToken,
        expires_at: new Date(openGate.expiresAt).toISOString(),
        expires_in_seconds: openGate.expiresInSeconds,
        agent_instruction:
          "This is a WRITE action that purchases static ISP IPs on the user's Novada account. Show the preview (IP type, region, duration, quantity) to the human user. To execute, call again with the EXACT SAME parameters plus `approval_token` set to the value above (valid 10 minutes). `confirm: true` alone does nothing — it is deprecated and ignored.",
      },
      null,
      2,
    );
  }

  const body: Record<string, unknown> = { ip_type, region, duration, num };
  const data = await devApiPost<unknown>("/v1/static_house/open", body, { apiKey });

  return JSON.stringify(
    {
      status: "opened",
      data,
      agent_instruction:
        "Static IPs purchased. Use novada_static_ip_mgmt with action='list' to confirm they appear.",
    },
    null,
    2,
  );
}

// ── renew ────────────────────────────────────────────────────────────────────

async function handleRenew(params: StaticIpMgmtParams, apiKey?: string): Promise<string> {
  const renew_ip_list = assertDefined(params.renew_ip_list, "renew_ip_list", "renew");
  const duration = assertDefined(params.duration, "duration", "renew");

  const renewGate = evaluateApprovalGate(params as Record<string, unknown>, "static_ip_renew");
  if (!renewGate.authorized) {
    const ipCount = renew_ip_list.split(",").filter(Boolean).length;
    return JSON.stringify(
      {
        status: "confirmation_required",
        action: "static_ip_renew",
        preview: {
          renew_ip_list,
          ip_count: ipCount,
          duration,
          duration_label: DURATION_LABELS[duration],
        },
        approval_token: renewGate.approvalToken,
        expires_at: new Date(renewGate.expiresAt).toISOString(),
        expires_in_seconds: renewGate.expiresInSeconds,
        agent_instruction:
          "This is a WRITE action that renews static ISP IPs on the user's Novada account. Show the preview (IP list, count, duration) to the human user. To execute, call again with the EXACT SAME parameters plus `approval_token` set to the value above (valid 10 minutes). `confirm: true` alone does nothing — it is deprecated and ignored.",
      },
      null,
      2,
    );
  }

  const body: Record<string, unknown> = { renew_ip_list, duration };
  const data = await devApiPost<unknown>("/v1/static_house/renew", body, { apiKey });

  return JSON.stringify(
    {
      status: "renewed",
      data,
      agent_instruction:
        "Static IPs renewed. Use novada_static_ip_mgmt with action='list' to verify updated expiry dates.",
    },
    null,
    2,
  );
}

// ── export ───────────────────────────────────────────────────────────────────

async function handleExport(params: StaticIpMgmtParams, apiKey?: string): Promise<string> {
  const body: Record<string, unknown> = {
    ...optionalField("status", params.status),
    ...optionalField("region", params.region),
    ...optionalField("key_word", params.key_word),
    ...optionalField("is_auto_renew", params.is_auto_renew),
  };

  const data = await devApiPost<unknown>("/v1/static_house/export", body, { apiKey });

  return JSON.stringify(
    {
      status: "ok",
      data,
      agent_instruction:
        "Export of static ISP IPs returned. Data includes all IPs matching the applied filters.",
    },
    null,
    2,
  );
}

// ── list ─────────────────────────────────────────────────────────────────────

async function handleList(params: StaticIpMgmtParams, apiKey?: string): Promise<string> {
  const body: Record<string, unknown> = {
    page: params.page,
    limit: params.limit,
    ...optionalField("status", params.status),
    ...optionalField("region", params.region),
    ...optionalField("key_word", params.key_word),
    ...optionalField("is_auto_renew", params.is_auto_renew),
  };

  const data = await devApiPost<unknown>("/v1/static_house/list", body, { apiKey });

  return JSON.stringify(
    {
      status: "ok",
      data,
      agent_instruction:
        "Paginated list of static ISP IPs. Use 'export' action for full unfiltered dump. Use 'open' to purchase new IPs or 'renew' to extend existing ones.",
    },
    null,
    2,
  );
}
