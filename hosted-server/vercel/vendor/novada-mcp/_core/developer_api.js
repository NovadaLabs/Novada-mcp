// Shared HTTP client for Novada developer-api endpoints (KR-6 account-management tools).
//
// Base URL: https://api-m.novada.com (the live API host).
// Note: https://developer-api.novada.com is the GitBook docs URL, NOT a callable
// endpoint — it's served by Next.js/GitBook and returns 405 on /v1/* paths.
// Verified by raw curl smoke test: GET https://api-m.novada.com/v1/wallet/balance
// returns {"code":0,"data":{"balance":254.4},"msg":"success",...}.
//
// Auth: Bearer ${NOVADA_DEVELOPER_API_KEY} (falls back to NOVADA_API_KEY for single-key setups).
//
// REQUEST FORMAT: `multipart/form-data` (NOT JSON).
// Confirmed by fudong 2026-06-05 + the docs at proxy-user-management.md state
// "Content-Type: multipart/form-data (all endpoints)". An earlier comment in
// this file claimed "JSON body" — that was wrong, and is the root cause of
// historical `code:10001 Invalid parameter` responses from /v1/proxy_account/*.
// All scalars are coerced to strings; nested objects/arrays are JSON.stringify'd
// per multipart field semantics.
//
// All boss-requested endpoints (wallet, proxy_account, *_flow, capture) return
// `{ code: 0, msg: "success", data: {...} }` on success. Any non-zero code is
// surfaced via NovadaError so agents get a uniform failure_class + agent_instruction.
import axios, { AxiosError } from "axios";
import FormData from "form-data";
import { makeNovadaError, NovadaErrorCode, sanitizeServerMsg } from "./errors.js";
export const DEVELOPER_API_BASE = "https://api-m.novada.com";
const DEFAULT_TIMEOUT_MS = 30_000;
/**
 * INC-189 (Security): the proxy_account API family returns sub-account passwords
 * in cleartext (both `list` and `create` echo the account object). Recursively
 * walk any dev-api response value and replace every `password`-like key
 * (password / passwd / pwd, case-insensitive) with "****" before it is surfaced
 * to an agent/user via the MCP transcript.
 *
 * Key-based (not shape-based) so a nested or renamed container still gets masked
 * — the sibling `list` masker only handled `data.list[].password`, which would
 * pass cleartext through if the server nested it differently (audit L11).
 *
 * Mutates in place AND returns the same reference for call-site convenience.
 * Guards against prototype-pollution keys and cyclic structures.
 */
const PASSWORD_KEY_RE = /^(?:password|passwd|pwd)$/i;
export function maskPasswords(value, seen = new WeakSet()) {
    if (value === null || typeof value !== "object")
        return value;
    if (seen.has(value))
        return value;
    seen.add(value);
    if (Array.isArray(value)) {
        for (const item of value)
            maskPasswords(item, seen);
        return value;
    }
    const obj = value;
    for (const key of Object.keys(obj)) {
        // Never touch prototype-pollution keys.
        if (key === "__proto__" || key === "constructor" || key === "prototype")
            continue;
        const v = obj[key];
        if (PASSWORD_KEY_RE.test(key) && typeof v === "string" && v.length > 0) {
            obj[key] = "****";
        }
        else if (v !== null && typeof v === "object") {
            maskPasswords(v, seen);
        }
    }
    return value;
}
/** Return the developer-api bearer token. Prefers NOVADA_DEVELOPER_API_KEY; falls back to NOVADA_API_KEY. */
export function getDeveloperApiKey() {
    const dev = process.env.NOVADA_DEVELOPER_API_KEY?.trim();
    if (dev)
        return dev;
    const fallback = process.env.NOVADA_API_KEY?.trim();
    if (fallback)
        return fallback;
    throw makeNovadaError(NovadaErrorCode.INVALID_API_KEY, "Neither NOVADA_DEVELOPER_API_KEY nor NOVADA_API_KEY is set. Account-management tools require a developer-api key from https://developer-api.novada.com/zh.");
}
/**
 * Some Novada developer-api endpoints accept a typo'd field `strat_time` (and
 * matching `end_time`). To stay forward-compatible if/when the typo is fixed,
 * we always emit BOTH `strat_time` and `start_time` when a caller provides a
 * date-range. Server reads whichever it understands; the unused key is ignored.
 */
export function withDateRangeCompat(body, opts) {
    const out = { ...body };
    if (opts.start !== undefined) {
        out.start_time = opts.start;
        out.strat_time = opts.start; // server-side typo compat
    }
    if (opts.end !== undefined) {
        out.end_time = opts.end;
    }
    return out;
}
/**
 * Build a `multipart/form-data` body from a plain object, applying multipart
 * field-encoding rules: skip undefined/null, JSON.stringify nested
 * objects/arrays, coerce scalars to strings.
 */
function toMultipart(body) {
    const form = new FormData();
    for (const [k, v] of Object.entries(body)) {
        if (v === undefined || v === null)
            continue;
        if (typeof v === "object") {
            // Nested objects / arrays — multipart only carries scalars + files, so
            // round-trip through JSON. Server side `json.loads(form["field"])` etc.
            form.append(k, JSON.stringify(v));
        }
        else {
            // string | number | boolean → string. `String(false)` → "false" etc.
            form.append(k, String(v));
        }
    }
    return form;
}
/**
 * POST to a developer-api endpoint and unwrap the standard `{code, msg, data}`
 * envelope. Body is encoded as `multipart/form-data` (NOT JSON) per the API
 * contract. Throws NovadaError on auth/transport/business failures.
 */
export async function devApiPost(path, body, opts = {}) {
    const apiKey = opts.apiKey ?? getDeveloperApiKey();
    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const url = path.startsWith("http") ? path : `${DEVELOPER_API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
    const form = toMultipart(body);
    let envelope;
    try {
        const resp = await axios.post(url, form, {
            headers: {
                // form.getHeaders() yields `Content-Type: multipart/form-data; boundary=...`
                // — we must NOT hard-code Content-Type or the boundary will be missing.
                ...form.getHeaders(),
                Authorization: `Bearer ${apiKey}`,
            },
            timeout,
            // Don't auto-throw on 4xx — we want to inspect the envelope ourselves.
            validateStatus: () => true,
            // multipart bodies can be larger; lift the default 10 MB cap modestly.
            maxBodyLength: 50 * 1024 * 1024,
        });
        if (resp.status === 401 || resp.status === 403) {
            throw makeNovadaError(NovadaErrorCode.INVALID_API_KEY, "Developer-api rejected the credential. Verify NOVADA_DEVELOPER_API_KEY is set to a valid developer-api token (different from Scraper/Unblocker keys).");
        }
        if (resp.status === 429) {
            throw makeNovadaError(NovadaErrorCode.RATE_LIMITED, "Developer-api rate limit hit. Back off 30s before retrying.");
        }
        if (resp.status >= 500) {
            throw makeNovadaError(NovadaErrorCode.API_DOWN, `Developer-api returned HTTP ${resp.status}. Treat as transient — retry after 30s.`);
        }
        // 404 = product not provisioned on this account OR endpoint not implemented
        // for this account tier. Distinct from "endpoint genuinely missing" — the
        // path is correct per docs; the server just doesn't expose it for this user.
        if (resp.status === 404) {
            throw makeNovadaError(NovadaErrorCode.PRODUCT_UNAVAILABLE, `Product not provisioned on this account or endpoint unavailable for this account tier (HTTP 404 at ${path}). Contact Novada support to enable the relevant product, or omit this product from \`products\` param.`);
        }
        // Hard guard: response MUST be a JSON object envelope. If the server returns
        // text/plain (e.g. 405 from a misrouted endpoint) treat as endpoint error,
        // do NOT silently fall through to empty data.
        if (typeof resp.data !== "object" || resp.data === null || Array.isArray(resp.data)) {
            const bodyPreview = typeof resp.data === "string"
                ? resp.data.slice(0, 200)
                : `(non-object ${typeof resp.data})`;
            throw makeNovadaError(NovadaErrorCode.API_DOWN, `Developer-api returned non-JSON body (HTTP ${resp.status}): ${bodyPreview}. Endpoint path or base URL may be wrong.`);
        }
        envelope = resp.data;
    }
    catch (err) {
        if (err instanceof AxiosError) {
            const msg = sanitizeServerMsg(err.message || "Network error reaching developer-api");
            throw makeNovadaError(NovadaErrorCode.API_DOWN, `Developer-api request failed: ${msg}`);
        }
        throw err;
    }
    if (envelope.code === 0 || envelope.code === undefined) {
        return (envelope.data ?? {});
    }
    // Non-zero business code — map known patterns, otherwise surface as INVALID_PARAMS.
    const serverMsg = sanitizeServerMsg(envelope.msg ?? envelope.message ?? `code=${envelope.code}`);
    // 11000 = invalid API key (definite auth). 10002 = unauthorized / key disabled.
    // 401  = HTTP-style auth failure sometimes returned as a business code (confirmed in browser_flow).
    // 10001 ("Invalid parameter") is NOT auth — server is telling us the request
    // body is wrong, even when the key works for sibling endpoints. Smoke-verified
    // 2026-06-03: same key works for wallet/* but returns 10001 on proxy_account/list.
    if (envelope.code === 11000 || envelope.code === 10002 || envelope.code === 401) {
        throw makeNovadaError(NovadaErrorCode.INVALID_API_KEY, `Developer-api auth failure (code=${envelope.code}): ${serverMsg}. Check NOVADA_DEVELOPER_API_KEY or rotate the key at https://developer-api.novada.com/zh.`);
    }
    throw makeNovadaError(NovadaErrorCode.INVALID_PARAMS, `Developer-api rejected request (code=${envelope.code}): ${serverMsg}`);
}
export async function devApiParallel(calls, opts = {}) {
    const settled = await Promise.allSettled(calls.map(c => devApiPost(c.path, c.body, opts)));
    return calls.map((c, i) => {
        const r = settled[i];
        if (r.status === "fulfilled") {
            return { key: c.key, ok: true, data: r.value };
        }
        const reason = r.reason;
        const msg = reason instanceof Error ? reason.message : String(reason);
        return { key: c.key, ok: false, error: msg };
    });
}
//# sourceMappingURL=developer_api.js.map