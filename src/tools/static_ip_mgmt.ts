// Wraps static ISP IP management endpoints on api-m.novada.com (developer-api):
//   POST /v1/static_house/open   — purchase new static IPs
//   POST /v1/static_house/renew  — renew existing static IPs
//   POST /v1/static_house/export — export filtered IP list
//   POST /v1/static_house/list   — list static IPs with filters + pagination
//
// Combined into ONE tool with an `action` discriminator.
// "open" and "renew" are WRITE actions — gated behind `confirm: true`.
//
// Field names match the API spec (docs/novada-api/static-isp-proxies.md).

import { z } from "zod";
import { devApiPost } from "../_core/developer_api.js";

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
        'Action to perform. "open" = purchase new static IPs (WRITE, requires confirm). "renew" = renew existing IPs (WRITE, requires confirm). "export" = export filtered IP list. "list" = list static IPs with pagination.',
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
      .string()
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

    // ── Confirm gate (open + renew) ───────────────────────────────────────
    confirm: z
      .literal(true)
      .optional()
      .describe(
        'REQUIRED for "open" and "renew" execution. Pass `true` ONLY after the human user has approved. If omitted, returns a dry-run preview without hitting the API.',
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
 * "open" and "renew" are WRITE actions gated behind `confirm: true`.
 * Without confirm, they return a preview payload and do NOT hit the API.
 * "list" and "export" are read-only.
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

  if (params.confirm !== true) {
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
        agent_instruction:
          "This is a WRITE action that purchases static ISP IPs on the user's Novada account. Show the preview (IP type, region, duration, quantity) to the human user. Only re-call with the same parameters PLUS `confirm: true` after explicit approval.",
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

  if (params.confirm !== true) {
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
        agent_instruction:
          "This is a WRITE action that renews static ISP IPs on the user's Novada account. Show the preview (IP list, count, duration) to the human user. Only re-call with the same parameters PLUS `confirm: true` after explicit approval.",
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
