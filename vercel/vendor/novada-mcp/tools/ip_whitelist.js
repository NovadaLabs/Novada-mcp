// Wraps 4 IP whitelist endpoints on api-m.novada.com (developer-api):
//   POST /v1/white_list/add    — add IP to whitelist (WRITE)
//   POST /v1/white_list/list   — list whitelisted IPs (read-only)
//   POST /v1/white_list/del    — delete whitelisted IPs (WRITE)
//   POST /v1/white_list/remark — update remark on a whitelist entry (read-only-ish)
//
// Combined into a single tool with `action` discriminator per INC-111.
// "add" and "del" are WRITE actions — gated by `confirm: z.literal(true)`.
//
// Product codes for whitelist: 1=Residential, 4=Unlimited, 5=Static ISP
// (subset of the full proxy product codes).
//
// Request body is multipart/form-data per the API contract — handled by devApiPost.
import { z } from "zod";
import { devApiPost } from "../_core/developer_api.js";
// ─── Whitelist-specific product codes ────────────────────────────────────────
const WL_PRODUCT_CODES = ["1", "4", "5"];
const WL_PRODUCT_LABELS = {
    "1": "Residential",
    "4": "Unlimited",
    "5": "Static ISP",
};
// ─── Schema & Types ──────────────────────────────────────────────────────────
export const IpWhitelistParamsSchema = z
    .object({
    action: z
        .enum(["add", "list", "del", "remark"])
        .describe('Action to perform. "add": add IP to whitelist (WRITE — requires confirm). "list": list whitelisted IPs. "del": delete whitelisted IPs (WRITE — requires confirm). "remark": update remark on a whitelist entry.'),
    product: z
        .enum(WL_PRODUCT_CODES)
        .describe("REQUIRED. Product type code as string: 1=Residential, 4=Unlimited, 5=Static ISP."),
    // ── "add" params ──
    ip: z
        .string()
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
        .optional()
        .describe('Start datetime filter for action="list" (e.g. "2026-01-01").'),
    end_time: z
        .string()
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
        .optional()
        .describe('Comma-separated list of IPs to remove (required for action="del").'),
    // ── "remark" params ──
    id: z
        .string()
        .optional()
        .describe('Whitelist entry ID (required for action="remark").'),
    // ── WRITE gate ──
    confirm: z
        .literal(true)
        .optional()
        .describe('REQUIRED for WRITE actions ("add" and "del"). Pass `true` ONLY after the human user has approved. If omitted on a write action, the tool returns a dry-run preview instead of calling the API.'),
})
    .strict();
export function validateIpWhitelistParams(args) {
    return IpWhitelistParamsSchema.parse(args ?? {});
}
// ─── Implementation ──────────────────────────────────────────────────────────
export async function novadaIpWhitelist(params, apiKey) {
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
async function handleAdd(params, apiKey) {
    if (!params.ip) {
        return JSON.stringify({
            status: "error",
            error: 'Missing required parameter "ip" for action="add".',
            agent_instruction: "Re-call with the ip parameter set to the IP address to whitelist.",
        }, null, 2);
    }
    if (params.confirm !== true) {
        return JSON.stringify({
            status: "confirmation_required",
            action: "ip_whitelist_add",
            preview: {
                product: params.product,
                product_label: WL_PRODUCT_LABELS[params.product],
                ip: params.ip,
                remark: params.remark ?? null,
            },
            agent_instruction: "This is a WRITE action that adds an IP to the user's proxy whitelist. Show the preview to the human user. Only re-call with the same parameters PLUS `confirm: true` after explicit approval.",
        }, null, 2);
    }
    const body = {
        product: params.product,
        ip: params.ip,
        ...(params.remark !== undefined ? { remark: params.remark } : {}),
    };
    const data = await devApiPost("/v1/white_list/add", body, { apiKey });
    return JSON.stringify({
        status: "added",
        data,
        agent_instruction: "IP added to the whitelist. Use novada_ip_whitelist with action=\"list\" and the same product code to confirm it appears.",
    }, null, 2);
}
// ─── list ────────────────────────────────────────────────────────────────────
async function handleList(params, apiKey) {
    const body = {
        product: params.product,
        ...(params.ip !== undefined ? { ip: params.ip } : {}),
        ...(params.start_time !== undefined ? { start_time: params.start_time } : {}),
        ...(params.end_time !== undefined ? { end_time: params.end_time } : {}),
        ...(params.lock !== undefined ? { lock: params.lock } : {}),
    };
    const data = await devApiPost("/v1/white_list/list", body, { apiKey });
    return JSON.stringify({
        status: "ok",
        data,
        agent_instruction: "Lists whitelisted IPs for the given product. Use action=\"add\" to add new IPs or action=\"del\" to remove them.",
    }, null, 2);
}
// ─── del ─────────────────────────────────────────────────────────────────────
async function handleDel(params, apiKey) {
    if (!params.ips) {
        return JSON.stringify({
            status: "error",
            error: 'Missing required parameter "ips" for action="del".',
            agent_instruction: 'Re-call with the ips parameter set to a comma-separated list of IPs to remove (e.g. "1.2.3.4,5.6.7.8").',
        }, null, 2);
    }
    if (params.confirm !== true) {
        return JSON.stringify({
            status: "confirmation_required",
            action: "ip_whitelist_del",
            preview: {
                product: params.product,
                product_label: WL_PRODUCT_LABELS[params.product],
                ips: params.ips,
            },
            agent_instruction: "This is a WRITE action that removes IPs from the user's proxy whitelist. Show the preview to the human user. Only re-call with the same parameters PLUS `confirm: true` after explicit approval.",
        }, null, 2);
    }
    const body = {
        product: params.product,
        ips: params.ips,
    };
    const data = await devApiPost("/v1/white_list/del", body, { apiKey });
    return JSON.stringify({
        status: "deleted",
        data,
        agent_instruction: "IPs removed from whitelist. Use novada_ip_whitelist with action=\"list\" to confirm they are gone.",
    }, null, 2);
}
// ─── remark ──────────────────────────────────────────────────────────────────
async function handleRemark(params, apiKey) {
    if (!params.id) {
        return JSON.stringify({
            status: "error",
            error: 'Missing required parameter "id" for action="remark".',
            agent_instruction: 'Re-call with the id parameter set to the whitelist entry ID. Use action="list" first to find entry IDs.',
        }, null, 2);
    }
    const body = {
        product: params.product,
        id: params.id,
        ...(params.remark !== undefined ? { remark: params.remark } : {}),
    };
    const data = await devApiPost("/v1/white_list/remark", body, { apiKey });
    return JSON.stringify({
        status: "updated",
        data,
        agent_instruction: "Remark updated on the whitelist entry. Use action=\"list\" to see the updated entry.",
    }, null, 2);
}
//# sourceMappingURL=ip_whitelist.js.map