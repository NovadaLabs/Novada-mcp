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
// ─── Pure projection (TOW2-251) ────────────────────────────────────────────────
//
// The raw API returns ~55 fields per sub-account, most of them zero, PLUS a set
// of top-level `<product>_balance: 0` scalars that directly CONTRADICT the nested
// truth (`consumed_<product>_flow` / `limit_<product>_flow`). E.g. an account with
// residential_balance:0 but consumed_residential_flow:8302 is metered, not empty.
//
// This projection keeps ONLY what an AI consumer needs to reason about usage:
//   { account, status, remark?, products: { <name>: { used, limit?, percent? } } }
// — dropping every dead-zero field and never emitting a scalar that lies about the
// nested consumed/limit truth. Flow fields are BYTES → rendered in human units.
/**
 * Product suffixes in the raw payload → human label. Each maps to
 * `consumed_<suffix>_flow` and `limit_<suffix>_flow` byte counters.
 */
const FLOW_PRODUCTS = [
    { suffix: "residential", label: "residential" },
    { suffix: "mobile_agent", label: "mobile" },
    { suffix: "dc", label: "datacenter" },
    { suffix: "isp", label: "isp" },
    { suffix: "unblocker", label: "unblocker" },
    { suffix: "unlimited", label: "unlimited" },
    { suffix: "browser", label: "browser" },
];
/** Bytes → human units (MB when < 1 GB, else GB). Same divisor as account.ts mbToHuman (1024*1024) but 2 decimal places instead of 1. */
function bytesToHuman(bytes) {
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024)
        return `${(mb / 1024).toFixed(2)} GB`;
    return `${mb.toFixed(2)} MB`;
}
/**
 * Project one raw sub-account row into the pure, AI-legible shape.
 * A product row is included only when it carries real signal — i.e. `limit > 0`
 * (a provisioned quota) OR `consumed > 0` (metered usage). Everything else is noise.
 */
function projectAccount(raw) {
    const num = (k) => (typeof raw[k] === "number" ? raw[k] : 0);
    const products = {};
    for (const { suffix, label } of FLOW_PRODUCTS) {
        const consumed = num(`consumed_${suffix}_flow`);
        const limit = num(`limit_${suffix}_flow`);
        // Skip products with neither a quota nor any usage — pure dead-zero noise.
        if (limit <= 0 && consumed <= 0)
            continue;
        const row = { used: bytesToHuman(consumed) };
        if (limit > 0) {
            row.limit = bytesToHuman(limit);
            row.percent = `${((consumed / limit) * 100).toFixed(1)}%`;
        }
        // limit <= 0 with consumed > 0 → metered / pay-as-you-go: report used only,
        // never a fake limit and never a contradicting balance:0 scalar.
        products[label] = row;
    }
    const account = typeof raw.account === "string" ? raw.account : undefined;
    const statusCode = num("status");
    const status = statusCode === 1 ? "active" : statusCode === -3 ? "disabled" : String(raw.status ?? "unknown");
    const remark = typeof raw.remark === "string" && raw.remark.trim().length > 0
        ? raw.remark.trim()
        : undefined;
    return {
        account,
        status,
        ...(remark !== undefined ? { remark } : {}),
        // password is masked upstream by maskPasswords; carry the masked marker through
        // so an agent still sees the field exists without the plaintext.
        ...(typeof raw.password === "string" ? { password: raw.password } : {}),
        products,
    };
}
/**
 * Project the full masked API payload down to the pure shape. Preserves the
 * `list` / `page` / `total` envelope the API uses so pagination stays legible,
 * but replaces each ~55-field account row with its projected form.
 */
function projectPayload(masked) {
    if (!masked || typeof masked !== "object")
        return masked;
    const m = masked;
    if (!Array.isArray(m.list))
        return masked;
    const list = m.list.map((row) => row && typeof row === "object"
        ? projectAccount(row)
        : row);
    return {
        list,
        ...(typeof m.page !== "undefined" ? { page: m.page } : {}),
        ...(typeof m.total !== "undefined" ? { total: m.total } : {}),
    };
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
    // TOW2-251: pure projection — collapse the ~55-field mostly-zero rows into a
    // legible per-account usage shape and drop the contradicting `*_balance: 0`
    // scalars. Masking runs first so passwords stay masked through the projection.
    const projected = projectPayload(maskedData);
    return JSON.stringify({
        status: "ok",
        data: projected,
        agent_instruction: "Lists proxy sub-accounts for the given product code. Each account shows only products with a real quota or metered usage: `used` (and `limit`/`percent` when a cap exists). Products with no quota and no usage are omitted. Passwords are masked. To create one use novada_proxy_account_create with `confirm: true`. Repeat with different `product` codes to see other product tiers.",
    }, null, 2);
}
//# sourceMappingURL=proxy_account_list.js.map