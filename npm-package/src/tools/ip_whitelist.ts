// Wraps 4 IP whitelist endpoints on api-m.novada.com (developer-api):
//   POST /v1/white_list/add    — add IP to whitelist (WRITE)
//   POST /v1/white_list/list   — list whitelisted IPs (read-only)
//   POST /v1/white_list/del    — delete whitelisted IPs (WRITE)
//   POST /v1/white_list/remark — update remark on a whitelist entry (read-only-ish)
//
// Combined into a single tool with `action` discriminator per INC-111.
// "add" and "del" are WRITE actions — gated by the shared APPROVAL-TOKEN
// flow (F2-2/G-7 fix, 2026-09): first call (no `approval_token`) returns a
// preview + a signed, expiring, payload-bound token; only a second call
// carrying that exact token AND the exact same parameters executes.
// `confirm: true` alone is a deprecated no-op — see ../utils/approval.ts.
//
// Product codes for whitelist: 1=Residential, 4=Unlimited, 5=Static ISP
// (subset of the full proxy product codes).
//
// Request body is multipart/form-data per the API contract — handled by devApiPost.

import { z } from "zod";
import { devApiPost } from "../_core/developer_api.js";
import { evaluateApprovalGate } from "../utils/approval.js";

// ─── Whitelist-specific product codes ────────────────────────────────────────
const WL_PRODUCT_CODES = ["1", "4", "5"] as const;
const WL_PRODUCT_LABELS: Record<(typeof WL_PRODUCT_CODES)[number], string> = {
  "1": "Residential",
  "4": "Unlimited",
  "5": "Static ISP",
};

// ─── IP-format validation (NOV-578 #10) ──────────────────────────────────────
// `ip` / `ips` are user strings POSTed to the whitelist API. Bare z.string() lets
// garbage/injection payloads through (violates the "every z.string() → API MUST be
// format-validated" rule). Accept IPv4 (octet-bounded, optional CIDR) and basic IPv6;
// reject anything with spaces, letters (beyond hex), or injection punctuation.
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/([0-9]|[12]\d|3[0-2]))?$/;
const IPV6_RE = /^[0-9a-fA-F:]+(\/(\d|[1-9]\d|1[01]\d|12[0-8]))?$/;
function isValidIp(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return IPV4_RE.test(v) || (v.includes(":") && IPV6_RE.test(v));
}

// ─── Schema & Types ──────────────────────────────────────────────────────────

export const IpWhitelistParamsSchema = z
  .object({
    action: z
      .enum(["add", "list", "del", "remark"])
      .describe(
        'Action to perform. "add": add IP to whitelist (WRITE — requires approval_token). "list": list whitelisted IPs. "del": delete whitelisted IPs (WRITE — requires approval_token). "remark": update remark on a whitelist entry.',
      ),
    product: z
      .enum(WL_PRODUCT_CODES)
      .describe(
        "REQUIRED. Product type code as string: 1=Residential, 4=Unlimited, 5=Static ISP.",
      ),

    // ── "add" params ──
    ip: z
      .string()
      .trim()
      .refine(isValidIp, { message: 'ip must be a valid IPv4/IPv6 address (CIDR allowed), e.g. "203.0.113.4" or "203.0.113.0/24".' })
      .optional()
      .describe('IP address to whitelist (required for action="add"). For action="list", optional filter by specific IP.'),
    remark: z
      .string()
      .max(200)
      .optional()
      .describe('Optional remark/note. Used by action="add" and action="remark".'),

    // ── "list" params ──
    start_time: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe('Start datetime filter for action="list" (e.g. "2026-01-01").'),
    end_time: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe('End datetime filter for action="list" (e.g. "2026-12-31").'),
    lock: z
      .number()
      .int()
      .optional()
      .describe('Lock filter for action="list". 0=Unlocked, 1=Locked.'),

    // ── "del" params ──
    ips: z
      .string()
      .trim()
      .refine(
        v => { const parts = v.split(",").map(s => s.trim()).filter(Boolean); return parts.length > 0 && parts.every(isValidIp); },
        { message: 'ips must be a comma-separated list of valid IPv4/IPv6 addresses, e.g. "203.0.113.4,203.0.113.5".' },
      )
      .optional()
      .describe('Comma-separated list of IPs to remove (required for action="del").'),

    // ── "remark" params ──
    id: z
      .string()
      .optional()
      .describe('Whitelist entry ID (required for action="remark").'),

    // ── WRITE gate (deprecated flag; see approval_token below) ──
    confirm: z
      .literal(true)
      .optional()
      .describe(
        'DEPRECATED — ignored. Setting this alone no longer authorizes WRITE actions ("add"/"del") (closed 2026-09, finding F2-2: an agent could self-supply confirm:true with no prior human-reviewed preview). Use approval_token instead: call once WITHOUT approval_token to receive a preview and a token, then call again with the identical parameters plus approval_token.',
      ),
    approval_token: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Two-step approval token, required to execute "add"/"del". Omit on the first call to receive a preview + a fresh approval_token (valid 10 minutes). Re-call with the EXACT SAME parameters plus this field set to that token to execute. Never invent a value — an invented or stale token is rejected.',
      ),
  })
  .strict();

export type IpWhitelistParams = z.infer<typeof IpWhitelistParamsSchema>;

export function validateIpWhitelistParams(
  args: Record<string, unknown> | undefined,
): IpWhitelistParams {
  return IpWhitelistParamsSchema.parse(args ?? {});
}

// ─── Implementation ──────────────────────────────────────────────────────────

export async function novadaIpWhitelist(
  params: IpWhitelistParams,
  apiKey?: string,
): Promise<string> {
  switch (params.action) {
    case "add":
      return handleAdd(params, apiKey);
    case "list":
      return handleList(params, apiKey);
    case "del":
      return handleDel(params, apiKey);
    case "remark":
      return handleRemark(params, apiKey);
  }
}

// ─── add ─────────────────────────────────────────────────────────────────────

async function handleAdd(params: IpWhitelistParams, apiKey?: string): Promise<string> {
  if (!params.ip) {
    return JSON.stringify(
      {
        status: "error",
        error: 'Missing required parameter "ip" for action="add".',
        agent_instruction: "Re-call with the ip parameter set to the IP address to whitelist.",
      },
      null,
      2,
    );
  }

  const addGate = evaluateApprovalGate(params as Record<string, unknown>, "ip_whitelist_add");
  if (!addGate.authorized) {
    return JSON.stringify(
      {
        status: "confirmation_required",
        action: "ip_whitelist_add",
        preview: {
          product: params.product,
          product_label: WL_PRODUCT_LABELS[params.product],
          ip: params.ip,
          remark: params.remark ?? null,
        },
        approval_token: addGate.approvalToken,
        expires_at: new Date(addGate.expiresAt).toISOString(),
        expires_in_seconds: addGate.expiresInSeconds,
        agent_instruction:
          "This is a WRITE action that adds an IP to the user's proxy whitelist. Show the preview to the human user. To execute, call again with the EXACT SAME parameters plus `approval_token` set to the value above (valid 10 minutes). `confirm: true` alone does nothing — it is deprecated and ignored.",
      },
      null,
      2,
    );
  }

  const body: Record<string, unknown> = {
    product: params.product,
    ip: params.ip,
    ...(params.remark !== undefined ? { remark: params.remark } : {}),
  };

  const data = await devApiPost<unknown>("/v1/white_list/add", body, { apiKey });

  return JSON.stringify(
    {
      status: "added",
      data,
      agent_instruction:
        "IP added to the whitelist. Use novada_ip_whitelist with action=\"list\" and the same product code to confirm it appears.",
    },
    null,
    2,
  );
}

// ─── list ────────────────────────────────────────────────────────────────────

async function handleList(params: IpWhitelistParams, apiKey?: string): Promise<string> {
  const body: Record<string, unknown> = {
    product: params.product,
    ...(params.ip !== undefined ? { ip: params.ip } : {}),
    ...(params.start_time !== undefined ? { start_time: params.start_time } : {}),
    ...(params.end_time !== undefined ? { end_time: params.end_time } : {}),
    ...(params.lock !== undefined ? { lock: params.lock } : {}),
  };

  const data = await devApiPost<unknown>("/v1/white_list/list", body, { apiKey });

  return JSON.stringify(
    {
      status: "ok",
      data,
      agent_instruction:
        "Lists whitelisted IPs for the given product. Use action=\"add\" to add new IPs or action=\"del\" to remove them.",
    },
    null,
    2,
  );
}

// ─── del ─────────────────────────────────────────────────────────────────────

async function handleDel(params: IpWhitelistParams, apiKey?: string): Promise<string> {
  if (!params.ips) {
    return JSON.stringify(
      {
        status: "error",
        error: 'Missing required parameter "ips" for action="del".',
        agent_instruction:
          'Re-call with the ips parameter set to a comma-separated list of IPs to remove (e.g. "1.2.3.4,5.6.7.8").',
      },
      null,
      2,
    );
  }

  const delGate = evaluateApprovalGate(params as Record<string, unknown>, "ip_whitelist_del");
  if (!delGate.authorized) {
    return JSON.stringify(
      {
        status: "confirmation_required",
        action: "ip_whitelist_del",
        preview: {
          product: params.product,
          product_label: WL_PRODUCT_LABELS[params.product],
          ips: params.ips,
        },
        approval_token: delGate.approvalToken,
        expires_at: new Date(delGate.expiresAt).toISOString(),
        expires_in_seconds: delGate.expiresInSeconds,
        agent_instruction:
          "This is a WRITE action that removes IPs from the user's proxy whitelist. Show the preview to the human user. To execute, call again with the EXACT SAME parameters plus `approval_token` set to the value above (valid 10 minutes). `confirm: true` alone does nothing — it is deprecated and ignored.",
      },
      null,
      2,
    );
  }

  const body: Record<string, unknown> = {
    product: params.product,
    ips: params.ips,
  };

  const data = await devApiPost<unknown>("/v1/white_list/del", body, { apiKey });

  return JSON.stringify(
    {
      status: "deleted",
      data,
      agent_instruction:
        "IPs removed from whitelist. Use novada_ip_whitelist with action=\"list\" to confirm they are gone.",
    },
    null,
    2,
  );
}

// ─── remark ──────────────────────────────────────────────────────────────────

async function handleRemark(params: IpWhitelistParams, apiKey?: string): Promise<string> {
  if (!params.id) {
    return JSON.stringify(
      {
        status: "error",
        error: 'Missing required parameter "id" for action="remark".',
        agent_instruction:
          'Re-call with the id parameter set to the whitelist entry ID. Use action="list" first to find entry IDs.',
      },
      null,
      2,
    );
  }

  const body: Record<string, unknown> = {
    product: params.product,
    id: params.id,
    ...(params.remark !== undefined ? { remark: params.remark } : {}),
  };

  const data = await devApiPost<unknown>("/v1/white_list/remark", body, { apiKey });

  return JSON.stringify(
    {
      status: "updated",
      data,
      agent_instruction:
        "Remark updated on the whitelist entry. Use action=\"list\" to see the updated entry.",
    },
    null,
    2,
  );
}
