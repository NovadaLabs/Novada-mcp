import axios, { AxiosError } from "axios";
import { SCRAPER_API_BASE, SCRAPER_DOWNLOAD_BASE, HOSTED_SAFE_CEILING_MS } from "../config.js";
import { formatAsMarkdown, formatAsCsv, formatAsXlsx, formatAsHtml } from "../utils/format.js";
import { saveOutput } from "../utils/output.js";
import { NovadaError, NovadaErrorCode, makeNovadaError, sanitizeServerMsg } from "../_core/errors.js";
const SCRAPE_ENDPOINT = `${SCRAPER_API_BASE}/request`;
// How long the SYNC novada_scrape path will poll before returning a structured
// (non-error) "still processing" result. 0.9.5: raised from 14s → 45s so slow
// platforms (Amazon, Walmart, LinkedIn) COMPLETE inside one synchronous call —
// the hosted function has a ~56s wall-clock, and staying at/under
// HOSTED_SAFE_CEILING_MS (50s) keeps us clear of the Vercel 504 kill while giving
// slow scrapers the time they actually need. For the rare task that runs longer
// than 45s, we return a CLEAN status (isError:false) telling the caller to retry —
// NOT a hard error — because a slow-but-valid task is not a failure.
const SYNC_POLL_CEILING_MS = 45_000;
// Guard: never exceed the hosted safe ceiling (50s). If the constant above is ever
// bumped past the ceiling, clamp so the tool always returns before the 504 kill.
const POLL_TIMEOUT_MS = Math.min(SYNC_POLL_CEILING_MS, HOSTED_SAFE_CEILING_MS);
const POLL_INTERVAL_MS = 2_000;
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Submit a scraper task. Returns a discriminated SubmitOutcome:
 *   - inline records (skip poll), empty serp (graceful no-results), or a task_id to poll.
 * 0.9.5 (NOV-697): previously returned only a task_id and ALWAYS polled; that both
 * wasted a round-trip on inline-result platforms and threw isError on empty serps.
 */
export async function submitScrapeTask(apiKey, scraper_name, scraper_id, params) {
    const file_name = `novada_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const form = new URLSearchParams();
    form.append("scraper_name", scraper_name);
    form.append("scraper_id", scraper_id);
    form.append("scraper_errors", "true");
    form.append("is_auto_push", "false");
    form.append("file_name", file_name);
    // Two param formats exist in the Novada Scraper API:
    //   A) Search engines (google, bing, duckduckgo, yandex) — flat form fields + json=1
    //   B) All other platforms — scraper_params=[{...}] JSON array
    // Verified from dashboard playground 2026-05-18.
    const SEARCH_ENGINES = new Set(["google.com", "bing.com", "duckduckgo.com", "yandex.com"]);
    const RESERVED = new Set(["scraper_name", "scraper_id", "apikey", "api_key", "authorization",
        "scraper_errors", "is_auto_push"]);
    // H-4: Block prototype-pollution keys from flowing to form/JSON
    const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
    const opParams = {};
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && !RESERVED.has(k.toLowerCase()) && !BLOCKED_KEYS.has(k)) {
            opParams[k] = v;
        }
    }
    if (SEARCH_ENGINES.has(scraper_name)) {
        // Format A: flat form fields for search engines
        if (!("json" in opParams))
            opParams["json"] = 1; // request JSON output format
        for (const [k, v] of Object.entries(opParams)) {
            form.append(k, String(v));
        }
    }
    else {
        // Format B: scraper_params array for all other platforms
        // Always include scraper_params even when empty — backend requires this field
        form.append("scraper_params", JSON.stringify([opParams]));
    }
    const resp = await axios.post(SCRAPE_ENDPOINT, form, {
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 60000,
    });
    const body = resp.data;
    // Auth error codes returned as HTTP 200 with non-zero body code
    if (body.code === 50001 || body.code === 50002 || body.code === 50003) {
        throw makeNovadaError(NovadaErrorCode.INVALID_API_KEY, `Scraper API auth error (code: ${body.code})`);
    }
    if (body.code === 500) {
        throw makeNovadaError(NovadaErrorCode.API_DOWN, `Scraper API server error`);
    }
    if (body.code !== 0) {
        // H5: throw typed NovadaError for 11006/11008 — no brittle string matching needed at catch site
        if (body.code === 11006) {
            throw makeNovadaError(NovadaErrorCode.PRODUCT_UNAVAILABLE, `Scraper returned code 11006 for operation '${scraper_id}'. This means either: (1) the operation ID is invalid or unsupported for this account, or (2) Scraper API access is not activated. Verify the operation ID against novada://scraper-platforms before assuming it is an account issue.`, "code 11006");
        }
        if (body.code === 11008) {
            throw makeNovadaError(NovadaErrorCode.INVALID_PARAMS, `Unknown platform '${scraper_name}'. Use the exact domain (e.g. 'amazon.com', 'reddit.com'). To find valid operation IDs: read the novada://scraper-platforms resource — operation names are exact and cannot be guessed.`, "code 11008");
        }
        const errorMessages = {
            10001: "Missing required parameters. Check platform and operation fields.",
            11000: "Invalid API key.",
        };
        const msg = errorMessages[body.code] ?? body.msg ?? "Unknown scraper error";
        throw new Error(`Scraper error (code ${body.code}): ${sanitizeServerMsg(msg)}`);
    }
    // Real upstream shapes (verified live 2026-07-04 against scraper.novada.com/request):
    //   Normal search : body.data = { code:200, msg:"success", data:{ json:[{spider_code:200, rest:{...}}], task_id:"..." } }
    //   Empty serp    : body.data = { code:400, msg:"serp returns empty", data:null }
    //   Slow platform : body.data = { code:200, msg:"success", data:{ task_id:"..." } }  (no json)
    const inner = body.data;
    const innerData = inner?.data;
    // (1) Empty serp / no-results — inner.code 400 with msg "serp returns empty",
    //     or a null inner.data payload. This is a GRACEFUL outcome, not an error.
    const innerCode = inner?.code;
    const innerMsg = typeof inner?.msg === "string" ? inner.msg : "";
    const isEmptySerp = innerCode === 400 ||
        /serp\s+returns?\s+empty|empty\s+serp|no\s+results?/i.test(innerMsg);
    if (isEmptySerp || (inner != null && "data" in inner && innerData == null)) {
        return { kind: "empty", message: innerMsg || "serp returns empty" };
    }
    // (2) Inline results — data.data.json is a non-empty array of result items.
    //     Skip the poll round-trip entirely and use these records directly.
    const inlineJson = innerData?.json;
    if (Array.isArray(inlineJson) && inlineJson.length > 0) {
        return { kind: "inline", items: inlineJson };
    }
    // (3) task_id only (slow platforms) — poll the download endpoint.
    //     Accept both flat { data:{task_id} } and legacy nested shapes.
    const taskId = (inner?.task_id ??
        innerData?.task_id);
    if (taskId) {
        return { kind: "task", taskId };
    }
    // No inline json, no task_id, not an empty serp → treat as graceful no-results
    // rather than a hard error. Some platforms legitimately return an empty payload
    // for a valid-but-unmatched query; surfacing isError:true here misleads agents.
    return { kind: "empty", message: innerMsg || "no results returned" };
}
/** Poll the download endpoint until the task completes or the sync ceiling elapses. */
async function pollForResult(apiKey, taskId) {
    const url = `${SCRAPER_DOWNLOAD_BASE}/scraper_download?task_id=${encodeURIComponent(taskId)}&file_type=json&apikey=${encodeURIComponent(apiKey)}`;
    // H3: safe version of URL for error messages — strips the apikey value to prevent key exposure
    const safeUrl = url.replace(/apikey=[^&]+/, "apikey=***");
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const resp = await axios.get(url, { timeout: 30000 });
        const body = resp.data;
        // Pending: { code: 27202, data: null, msg: "" }
        if (body !== null &&
            typeof body === "object" &&
            !Array.isArray(body) &&
            body.code === 27202) {
            await sleep(POLL_INTERVAL_MS);
            continue;
        }
        // Complete: array of result items
        if (Array.isArray(body)) {
            return { kind: "done", items: body };
        }
        // Known error codes from the download endpoint
        if (body !== null &&
            typeof body === "object" &&
            !Array.isArray(body)) {
            const bErr = body;
            const errCode = bErr.code;
            const errMsg = bErr.msg ?? "";
            if (errCode === 10001) {
                // M2: at DOWNLOAD time, 10001 ("invalid file type") comes from THIS tool's
                // own file_type=json download request (see pollForResult URL) — this
                // operation can't return JSON server-side. It is NOT a bad platform/
                // operation from the caller (submit-time 10001 is separately mapped to
                // "missing parameters"), so do not steer the agent to change the operation.
                throw makeNovadaError(NovadaErrorCode.API_DOWN, `Scraper download error 10001: this operation cannot return its result as JSON server-side. This is a result-format limitation, not a bad platform/operation. Retry once; if it persists, this operation may not support JSON download.`, "download_code:10001");
            }
            if (errCode === 10002 || errCode === 10003) {
                // API_DOWN (transient) so the customer gets a retryable envelope AND the
                // hosted dispatch catch treats it as upstream weather (breadcrumb, not alert)
                // rather than an UNKNOWN permanent bug.
                throw makeNovadaError(NovadaErrorCode.API_DOWN, `Scraper task error (code ${errCode}): ${errMsg || "Task failed on the server side."} This is usually transient — retry once, or retry with different parameters.`, `error_code:${errCode}`);
            }
            if (errCode === 27203) {
                throw makeNovadaError(NovadaErrorCode.API_DOWN, `Scraper task failed (code 27203): Server-side task execution error. ${errMsg}. This is a transient error — retry once.`, "error_code:27203");
            }
            // code 10000 from the legacy proxy download endpoint means "result not yet available"
            // (equivalent to 27202 from task_status). Continue polling — do NOT throw.
            // Only throw if we've already seen 27202 confirmed Ready from task_status.
            if (errCode === 10000) {
                await sleep(POLL_INTERVAL_MS);
                continue;
            }
            // Direct result object — Google SERP and similar formats return organic/search_metadata at top level
            if ("organic_results" in bErr || "organic" in bErr || "search_metadata" in bErr) {
                return { kind: "done", items: [{ spider_code: 200, rest: bErr }] };
            }
            throw new Error(`Unexpected download response (code ${errCode ?? "?"}): ${sanitizeServerMsg(errMsg || JSON.stringify(bErr).slice(0, 150))}`);
        }
        throw new Error(`Unexpected download response: ${sanitizeServerMsg(JSON.stringify(body).slice(0, 200))}`);
    }
    // 0.9.5: sync ceiling elapsed and the task is still running server-side. This is
    // NOT an error — return a clean "pending" outcome so novadaScrape renders a
    // non-error status. The task continues server-side; the caller should simply
    // retry novada_scrape shortly (the download is idempotent by task_id, so no
    // duplicate work is triggered on the completed side).
    return { kind: "pending", taskId };
}
/** Flatten a potentially nested object for tabular display.
 *  M-1: depth limit prevents stack overflow on deeply nested server responses. */
function flattenRecord(obj, prefix = "", depth = 0) {
    if (obj === null || obj === undefined)
        return {};
    if (typeof obj !== "object" || Array.isArray(obj)) {
        return { [prefix || "value"]: String(obj) };
    }
    if (depth > 10) {
        return { [prefix || "value"]: JSON.stringify(obj).slice(0, 200) };
    }
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v !== null && typeof v === "object" && !Array.isArray(v)) {
            Object.assign(result, flattenRecord(v, key, depth + 1));
        }
        else if (Array.isArray(v)) {
            if (v.length > 0 && typeof v[0] === "object" && v[0] !== null) {
                // Array of objects — flatten first 5; add truncation hint if more exist
                const cap = 5;
                v.slice(0, cap).forEach((item, idx) => {
                    Object.assign(result, flattenRecord(item, `${key}.${idx}`, depth + 1));
                });
                if (v.length > cap)
                    result[`${key}._count`] = `${v.length} total (showing first ${cap})`;
            }
            else {
                // Item 5 (TOW2-241): join primitives with "; ". The upstream API may return
                // values that already contain "、" (Chinese ideographic comma) — that is
                // upstream-origin, not our separator. We use ASCII "; " for our own joins.
                // Truncate at a word boundary to avoid cutting mid-token (e.g. "In Stock"→"In").
                const joined = v.map(x => String(x ?? "")).join("; ");
                if (joined.length > 200) {
                    // Find last space at or before char 197 to avoid mid-word cuts.
                    const cutAt = joined.lastIndexOf(" ", 197);
                    const truncAt = cutAt > 100 ? cutAt : 197; // fall back to hard cut if no space nearby
                    result[key] = joined.slice(0, truncAt) + "...(truncated)";
                }
                else {
                    result[key] = joined;
                }
            }
        }
        else {
            result[key] = String(v ?? "");
        }
    }
    return result;
}
/** Coerce a value to a positive finite number, or null. Accepts "$8.97"/"8.97"/8.97. */
function toPositiveNumber(v) {
    if (typeof v === "number")
        return Number.isFinite(v) && v > 0 ? v : null;
    if (typeof v === "string") {
        // Strip currency symbols / thousands separators, keep digits + decimal point.
        const cleaned = v.replace(/[^0-9.]/g, "");
        if (cleaned === "")
            return null;
        const n = Number.parseFloat(cleaned);
        return Number.isFinite(n) && n > 0 ? n : null;
    }
    return null;
}
/** Truthy in-stock signal from a free-text availability string ("In Stock", "Only 3 left"). */
function availabilityStringInStock(s) {
    if (typeof s !== "string")
        return false;
    const t = s.toLowerCase();
    // Negatives FIRST — the bare word "available" in the positive regex below would
    // otherwise match "Not available", "Pre-order available", "Available from other
    // sellers" and wrongly report in-stock. Guard those before the positive check.
    if (/out\s+of\s+stock|unavailable|currently\s+unavailable|sold\s+out/.test(t))
        return false;
    if (/\bnot\s+available|\bpre.?order/i.test(t))
        return false;
    return /in\s+stock|only\s+\d+\s+left|available|ships?\s|leaves?\s+warehouse|usually\s+ships/.test(t);
}
/**
 * Derive a usable LISTING price for a single product record, preferring the most
 * accurate source. Precedence:
 *   1. existing flat final_price > 0            (upstream already correct — untouched)
 *   2. existing flat initial_price > 0          (list price when final is empty)
 *   3. buybox_prices.final_price > 0
 *   4. variation whose .asin === record.asin    (exact listed-item price)
 *   5. first variation with a price > 0
 * Returns null when NO positive LISTING price is anywhere in the record.
 *
 * NOTE: buybox_prices.unit_price is deliberately NOT a source here — it is a
 * PER-UNIT price (per-cable / per-item in a multipack), not the listing price
 * a shopper pays. Promoting it (e.g. $4.33 for a 2-pack whose listing is ~$8.67)
 * misleads agents that rank by price — worse than leaving 0. The unit price is
 * surfaced separately by normalizeProductRecord on `_unit_price_only`.
 */
function derivePrice(r) {
    const flatFinal = toPositiveNumber(r.final_price);
    if (flatFinal !== null)
        return flatFinal;
    const flatInitial = toPositiveNumber(r.initial_price);
    if (flatInitial !== null)
        return flatInitial;
    const buybox = (r.buybox_prices && typeof r.buybox_prices === "object")
        ? r.buybox_prices
        : null;
    if (buybox) {
        const bbFinal = toPositiveNumber(buybox.final_price);
        if (bbFinal !== null)
            return bbFinal;
    }
    const variations = Array.isArray(r.variations) ? r.variations : [];
    if (variations.length > 0) {
        const selfAsin = r.asin;
        const match = variations.find(v => v && v.asin !== undefined && v.asin === selfAsin);
        const matchPrice = match ? toPositiveNumber(match.price) : null;
        if (matchPrice !== null)
            return matchPrice;
        for (const v of variations) {
            const p = v ? toPositiveNumber(v.price) : null;
            if (p !== null)
                return p;
        }
    }
    return null;
}
/**
 * Reconcile price + availability on a product record in place-safe fashion
 * (returns a NEW object; never mutates the input). Fills `final_price` (and
 * `price`) from derivePrice ONLY when the flat field is currently empty/zero, and
 * makes `is_available` agree with the `availability` string when the two disagree.
 * A `_price_source` breadcrumb records where the surfaced price came from so agents
 * (and QA) can see when a value was reconciled vs passed through untouched.
 */
export function normalizeProductRecord(raw) {
    // Only touch records that actually look like product records (have at least one
    // of the price/availability fields we know how to reconcile). Search/social
    // records pass through untouched.
    const hasPriceShape = "final_price" in raw || "initial_price" in raw || "buybox_prices" in raw || "variations" in raw;
    const hasAvailShape = "availability" in raw || "is_available" in raw;
    if (!hasPriceShape && !hasAvailShape)
        return raw;
    const out = { ...raw };
    // ── Price ──
    const flatFinalOk = toPositiveNumber(raw.final_price) !== null;
    if (!flatFinalOk) {
        const derived = derivePrice(raw);
        if (derived !== null) {
            out.final_price = derived;
            // Keep `price` consistent when it is the empty/null the bug leaves behind.
            if (toPositiveNumber(raw.price) === null)
                out.price = derived;
            out._price_source = "reconciled";
        }
        else {
            // No real LISTING price anywhere → leave final_price as-is (do NOT invent a
            // value). If a per-unit price exists, surface it on a SEPARATE breadcrumb so
            // agents can see it without ever mistaking it for the listing price.
            const buybox = (raw.buybox_prices && typeof raw.buybox_prices === "object")
                ? raw.buybox_prices
                : null;
            const unit = buybox ? toPositiveNumber(buybox.unit_price) : null;
            if (unit !== null)
                out._unit_price_only = unit;
        }
    }
    else {
        out._price_source = "upstream";
    }
    // ── Availability ── reconcile the boolean to the human-readable string when they
    // disagree. The string is the trustworthy signal for these product scrapers.
    if (hasAvailShape) {
        const strInStock = availabilityStringInStock(raw.availability);
        if (strInStock && raw.is_available !== true) {
            out.is_available = true;
        }
    }
    // ── subcategory_rank (S3) — upstream pollution + dedup (TOW2-238) ──────────
    // Root cause: UPSTREAM. The scraper API sends polluted entries already in the
    // raw JSON (JS artifacts like `"languageCode":"en_US"`, review text, "ASIN B"
    // trailing page content). Entries are also duplicated 4–16× by the upstream
    // parser. We apply a defensive filter here — pure projection of the raw JSON:
    // keep only rows whose name looks like a real category (short, no JSON syntax,
    // no prose sentences) and deduplicate by (rank, name) pair.
    if (Array.isArray(raw.subcategory_rank) && raw.subcategory_rank.length > 0) {
        out.subcategory_rank = filterSubcategoryRank(raw.subcategory_rank);
    }
    // ── description (S4) — prefer `features` when description has UI chrome ────
    // Root cause: UPSTREAM. The `description` field is a full-page text dump that
    // includes "Add to Cart", navigation text, comparison tables, FAQs etc.
    // The `features` array is the upstream's clean, structured product highlight
    // bullets. When `description` contains known UI-chrome markers, replace it with
    // the joined features bullets. If features is also empty, strip the chrome from
    // description as a last resort rather than fabricating content.
    if (typeof raw.description === "string" && descriptionHasChrome(raw.description)) {
        const features = raw.features;
        if (Array.isArray(features) && features.length > 0) {
            out.description = features
                .filter((f) => typeof f === "string" && f.trim().length > 0)
                .join(" | ");
            out._description_source = "features";
        }
        else {
            // No clean alternative — strip known UI chrome patterns and mark it
            out.description = stripDescriptionChrome(raw.description);
            out._description_source = "stripped";
        }
    }
    return out;
}
// ── subcategory_rank helpers ────────────────────────────────────────────────
/**
 * Returns true when a subcategory_name value is clearly polluted with upstream
 * page artefacts: JSON syntax characters, long prose, review sentences, or the
 * "ASIN B..." trailing page text pattern.
 */
function isSubcategoryNamePolluted(name) {
    if (name.length > 80)
        return true; // real category names are short
    if (name.includes('":"'))
        return true; // JSON fragment
    if (name.includes("languageCode"))
        return true; // JS i18n artefact
    if (/ASIN\s+B[0-9A-Z]{9}/i.test(name))
        return true; // trailing ASIN page text
    if (/\bASIN\b/i.test(name))
        return true; // any "ASIN" word (page leak)
    if (/Best Sellers Rank/i.test(name))
        return true; // BSR label leaked into name
    // Sentence-like prose (contains typical sentence chars mid-string)
    if (/[.!?]\s+[A-Z]/.test(name))
        return true;
    return false;
}
/**
 * Filter and deduplicate a raw subcategory_rank array.
 * Keeps only rows with a plausible short category name and a numeric rank.
 * Deduplicates by (rank, normalized-name) pair.
 */
export function filterSubcategoryRank(rows) {
    const seen = new Set();
    const result = [];
    for (const row of rows) {
        const name = typeof row.subcategory_name === "string" ? row.subcategory_name.trim() : null;
        const rank = row.subcategory_rank;
        if (!name || name.length === 0)
            continue;
        if (isSubcategoryNamePolluted(name))
            continue;
        // Rank must be a numeric string or number
        const rankStr = String(rank ?? "").trim();
        if (!rankStr || !/^\d+$/.test(rankStr))
            continue;
        const key = `${rankStr}:${name.toLowerCase()}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push({ subcategory_name: name, subcategory_rank: rankStr });
    }
    return result;
}
// ── description helpers ─────────────────────────────────────────────────────
/** UI-chrome markers that indicate the description is a full-page dump.
 *  Note: upstream sometimes concatenates navigation tokens without whitespace
 *  (e.g. "Previous pageNext page"), so we do NOT require a trailing word-boundary
 *  on multi-word phrases like "Previous page".
 */
const DESCRIPTION_CHROME_PATTERNS = [
    /\bAdd to Cart\b/i,
    /\bPrevious page/i, // no trailing \b — upstream omits space before "Next"
    /\bNext page\b/i,
    /\bAdd to Wish List\b/i,
];
/** Returns true if the description contains known UI-chrome patterns. */
export function descriptionHasChrome(description) {
    return DESCRIPTION_CHROME_PATTERNS.some(p => p.test(description));
}
/** Strip known UI-chrome tokens from description when no clean alternative exists. */
function stripDescriptionChrome(description) {
    let out = description;
    for (const p of DESCRIPTION_CHROME_PATTERNS) {
        out = out.replace(new RegExp(p.source, "gi"), "");
    }
    // Collapse whitespace left behind
    return out.replace(/\s{2,}/g, " ").trim();
}
function extractRecords(data) {
    if (Array.isArray(data)) {
        return data.map(item => typeof item === "object" && item !== null ? item : { value: item });
    }
    if (data !== null && typeof data === "object") {
        const d = data;
        for (const key of ["organic_results", "organic", "results", "items", "records", "data", "products", "posts"]) {
            if (Array.isArray(d[key]))
                return extractRecords(d[key]);
        }
        return [d];
    }
    return [];
}
// ─── Tabular column curation (csv / excel / html) ────────────────────────────
// Hosted QA: raw scrape records inline base64 favicon/image blobs as cell values.
// In a spreadsheet those are useless, they bloat the file, and the unescaped
// commas inside base64 make naive CSV parsers choke. For the *tabular* human
// formats (csv/excel/html) we drop base64-blob columns and lead with meaningful
// key columns. This is a display-only transform — json/toon keep the full record.
/** True when a value is a base64 data URI or a long unbroken base64-looking blob. */
function isBase64Blob(v) {
    if (typeof v !== "string")
        return false;
    const s = v.trim();
    // data:image/png;base64,.... or data:application/...;base64,....
    if (/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,/i.test(s))
        return true;
    // A long, unbroken token (no whitespace) made only of base64 alphabet chars.
    // 200-char floor avoids nuking normal ids/hashes (asin, sha, short tokens).
    if (s.length >= 200 && !/\s/.test(s) && /^[A-Za-z0-9+/=_-]+$/.test(s))
        return true;
    return false;
}
// Curated key columns that a human opening a spreadsheet actually wants, in
// priority order. Matched case-insensitively against the *leaf* of a flattened
// dot-path key (e.g. "price.value" → leaf "value" also checks the full key).
const KEY_COLUMN_PRIORITY = [
    "title", "name", "product_name", "headline",
    "price", "current_price", "price.value", "rating", "reviews", "review_count", "stars",
    "url", "link", "product_url", "permalink", "href",
    "description", "snippet", "summary", "content", "text",
    "author", "brand", "seller", "date", "published", "location", "asin", "sku", "id",
];
/** Rank a column header for key-first ordering. Lower rank = earlier column. */
function columnRank(header) {
    const h = header.toLowerCase();
    const leaf = h.split(".").pop() ?? h;
    for (let i = 0; i < KEY_COLUMN_PRIORITY.length; i++) {
        const k = KEY_COLUMN_PRIORITY[i];
        if (h === k || leaf === k)
            return i;
    }
    return KEY_COLUMN_PRIORITY.length; // unmatched → after all key columns, stable
}
/**
 * Curate flattened records for tabular display (csv / excel / html):
 *   1. Drop columns whose non-empty values are majority base64 blobs (useless + fragile).
 *   2. Reorder so curated key columns (title/price/rating/url/…) lead.
 * Returns NEW record objects with the curated column set/order — never mutates input.
 * If every column would be dropped (degenerate input) the original columns are kept,
 * so we never hand back empty rows.
 */
export function curateTabularRecords(records) {
    if (records.length === 0)
        return records;
    // Union all keys across records so heterogeneous rows don't lose columns.
    const allHeaders = new Set();
    for (const r of records)
        Object.keys(r).forEach(k => allHeaders.add(k));
    // Drop a column if the MAJORITY (≥50%) of its non-empty values are base64 blobs.
    const kept = [];
    for (const h of allHeaders) {
        let nonEmpty = 0;
        let blobs = 0;
        for (const r of records) {
            const v = r[h];
            if (v === null || v === undefined || String(v) === "")
                continue;
            nonEmpty++;
            if (isBase64Blob(v))
                blobs++;
        }
        const isBlobColumn = nonEmpty > 0 && blobs / nonEmpty >= 0.5;
        if (!isBlobColumn)
            kept.push(h);
    }
    // Degenerate guard: if curation nuked everything, fall back to original headers.
    const headers = kept.length > 0 ? kept : Array.from(allHeaders);
    // Stable key-first ordering.
    const ordered = headers
        .map((h, idx) => ({ h, idx, rank: columnRank(h) }))
        .sort((a, b) => (a.rank - b.rank) || (a.idx - b.idx))
        .map(x => x.h);
    return records.map(r => {
        const out = {};
        for (const h of ordered)
            out[h] = r[h];
        return out;
    });
}
// Aliases for stale or non-canonical operation IDs that appeared in old docs/examples.
// Maps a near-miss op ID an agent might guess → the canonical op ID the backend accepts.
// H-1: null-prototype object prevents __proto__/constructor/toString lookup pollution.
export const OPERATION_ALIASES = Object.assign(Object.create(null), {
    "amazon_product_by-keywords": "amazon_product_keywords",
    "amazon_product_by-asin": "amazon_product_asin",
    "google_shopping": "google_shopping_keywords",
    "google_shopping_by-keyword": "google_shopping_keywords",
});
function freezeOpMap(obj) {
    return Object.assign(Object.create(null), obj);
}
// For search-engine platforms the query key varies (q / keyword); accept any of these.
const SEARCH_QUERY_KEYS = ["q", "keyword", "query"];
export const PLATFORM_OPERATIONS = Object.assign(Object.create(null), {
    "amazon.com": freezeOpMap({
        "amazon_product_asin": ["asin"],
        "amazon_product_url": ["url"],
        "amazon_product_keywords": ["keyword"],
        "amazon_product_category-url": ["url"],
        "amazon_product_best-sellers": ["url"],
        "amazon_global-product_url": ["url"],
        "amazon_global-product_category-url": ["url"],
        "amazon_global-product_seller-url": ["url"],
        "amazon_global-product_keywords": ["keyword"],
        "amazon_global-product_keywords-brand": ["keyword"],
        "amazon_comment_url": ["url"],
        "amazon_seller_url": ["url"],
        "amazon_product-list_keywords-domain": ["keyword"],
    }),
    "walmart.com": freezeOpMap({
        "walmart_product_url": ["url"],
        "walmart_product_category-url": ["url"],
        "walmart_product_sku": ["sku"],
        "walmart_product_keywords": ["keyword"],
        "walmart_product_zipcodes": ["url"],
    }),
    "google.com": freezeOpMap({
        "google_search": SEARCH_QUERY_KEYS,
        "google_serp_web": SEARCH_QUERY_KEYS,
        "google_serp_videos": SEARCH_QUERY_KEYS,
        "google_serp_hotels": SEARCH_QUERY_KEYS,
        "google_serp_jobs": SEARCH_QUERY_KEYS,
        "google_map-details_url": ["url"],
        "google_map-details_cid": ["cid"],
        "google_map-details_location": ["location"],
        "google_map-details_placeid": ["place_id"],
        "google_shopping_keywords": ["keyword"],
        "google_comment_url": ["url"],
    }),
    "bing.com": freezeOpMap({
        "bing_search": SEARCH_QUERY_KEYS,
        "bing_maps": SEARCH_QUERY_KEYS,
        "bing_images": SEARCH_QUERY_KEYS,
        "bing_videos": SEARCH_QUERY_KEYS,
        "bing_news": SEARCH_QUERY_KEYS,
        "bing_shopping": SEARCH_QUERY_KEYS,
    }),
    "duckduckgo.com": freezeOpMap({ "duckduckgo": SEARCH_QUERY_KEYS }),
    "yandex.com": freezeOpMap({ "yandex": SEARCH_QUERY_KEYS }),
    "x.com": freezeOpMap({
        "twitter_profile_profileurl": ["url"],
        "twitter_profile_username": ["username"],
        "twitter_post_posturl": ["url"],
    }),
    "tiktok.com": freezeOpMap({
        "tiktok_posts_url": ["url"],
        "tiktok_posts_profileurl": ["url"],
        "tiktok_posts_listurl": ["url"],
        "tiktok_profiles_url": ["url"],
        "tiktok_profiles_listurl": ["url"],
    }),
    "instagram.com": freezeOpMap({
        "ins_profiles_username": ["username"],
        "ins_profiles_profileurl": ["url"],
        "ins_reel_url": ["url"],
        "ins_allreel_url": ["url"],
        "ins_posts_profileurl": ["url"],
        "ins_posts_posturl": ["url"],
        "ins_comment_posturl": ["url"],
    }),
    "facebook.com": freezeOpMap({
        "facebook_event_eventlist-url": ["url"],
        "facebook_event_search-url": ["url"],
        "facebook_event_events-url": ["url"],
        "facebook_post_posts-url": ["url"],
        "facebook_comment_comments-url": ["url"],
        "facebook_profile_profiles-url": ["url"],
    }),
    "youtube.com": freezeOpMap({
        "youtube_video-post_url": ["url"],
        "youtube_video-post_search_filters": ["keyword"],
        "youtube_video_search_label": ["label"],
        "youtube_video-post-podcast-url": ["url"],
        "youtube_video-post-keyword": ["keyword"],
        "youtube_video-post_explore": ["keyword"],
        "youtube_product-videoid": ["video_id"],
        "youtube_video-url": ["url"],
        "youtube_audio_url": ["url"],
        "youtube_comment_id": ["video_id"],
        "youtube_transcript_id": ["url"],
        "youtube_profiles_keyword": ["keyword"],
        "youtube_profiles_url": ["url"],
    }),
    "linkedin.com": freezeOpMap({
        "linkedin_company_information_url": ["url"],
        "linkedin_job_listings_information_job-listing-url": ["url"],
        "linkedin_job_listings_information_job-url": ["url"],
        "linkedin_job_listings_information_keyword": ["keyword"],
    }),
    "github.com": freezeOpMap({
        "github_repository_repo-url": ["url"],
        "github_repository_search-url": ["url"],
        "github_repository_url": ["url"],
    }),
});
// x.com is the canonical platform; twitter.com is a common alias agents try.
const PLATFORM_ALIASES = Object.assign(Object.create(null), { "twitter.com": "x.com" });
/** Resolve a platform alias (twitter.com → x.com) with a pollution-safe lookup. */
function resolvePlatform(platform) {
    return Object.prototype.hasOwnProperty.call(PLATFORM_ALIASES, platform)
        ? PLATFORM_ALIASES[platform]
        : platform;
}
/**
 * #6 pre-flight: reject an unknown platform, an unknown operation for a known
 * platform, or a missing required param BEFORE any backend round-trip. Returns a
 * structured NovadaError (INVALID_PARAMS) whose agent_instruction lists the valid
 * operations — so the agent self-corrects without a 60s hang → 504. Returns null
 * when the platform is not in the active map (unknown/inactive platforms fall
 * through to the existing 11006/11008 backend handling — the map only covers the
 * 13 platforms that have live operations).
 */
export function preflightScrape(platform, operation, params) {
    const ops = Object.prototype.hasOwnProperty.call(PLATFORM_OPERATIONS, platform)
        ? PLATFORM_OPERATIONS[platform]
        : undefined;
    // Unknown platform → defer to backend (11008). The map is the active-platform
    // allowlist, not an exhaustive domain registry, so we don't hard-reject here.
    if (!ops)
        return null;
    const validOps = Object.keys(ops);
    if (!Object.prototype.hasOwnProperty.call(ops, operation)) {
        const opList = validOps.join(", ");
        return new NovadaError({
            code: NovadaErrorCode.INVALID_PARAMS,
            message: `Unknown operation '${operation}' for platform '${platform}'. Operation IDs are exact and cannot be guessed. ` +
                `Valid operations for ${platform}: ${opList}`,
            agent_instruction: `Use one of the valid operations for ${platform}: ${opList}. ` +
                `Read novada://scraper-platforms for the full list with required params. Do not retry with the same operation id.`,
            retryable: false,
            detail: `preflight:unknown_operation`,
        });
    }
    // Required-param check: at least one of the operation's accepted keys must be
    // present and non-empty. (Most ops take exactly one; search ops accept several.)
    const required = ops[operation];
    const hasOne = required.some((k) => {
        const v = params[k];
        return v !== undefined && v !== null && String(v).trim().length > 0;
    });
    if (!hasOne) {
        const keyList = required.length === 1 ? `'${required[0]}'` : `one of ${required.map((k) => `'${k}'`).join(", ")}`;
        return new NovadaError({
            code: NovadaErrorCode.INVALID_PARAMS,
            message: `Operation '${operation}' on '${platform}' requires ${keyList} in params, but none was provided.`,
            agent_instruction: `Add ${keyList} to the params object, e.g. novada_scrape({ platform: "${platform}", operation: "${operation}", params: { ${required[0]}: "<value>" } }). ` +
                `Read novada://scraper-platforms for the exact param shape.`,
            retryable: false,
            detail: `preflight:missing_param`,
        });
    }
    return null;
}
export async function novadaScrape(params, apiKey) {
    const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
    const { params: opParams, format } = params;
    const platform = resolvePlatform(params.platform);
    // H-1: safe lookup — null-prototype + hasOwnProperty guard
    const hasAlias = Object.prototype.hasOwnProperty.call(OPERATION_ALIASES, params.operation);
    const operation = hasAlias ? OPERATION_ALIASES[params.operation] : params.operation;
    // displayOperation echoes the operation the CALLER passed, so the results header
    // reflects what the user actually asked for. When we auto-resolved a near-miss
    // alias we surface both forms (requested → canonical) rather than silently
    // swapping in the canonical id — transparent, not misleading. Used only in the
    // human-facing header lines; the canonical `operation` still drives the API call,
    // preflight, source_url, and the chainable "remember" hint (downstream tooling
    // needs the exact backend id).
    const displayOperation = hasAlias ? `${params.operation} (→ ${operation})` : operation;
    // Resume path: if task_id is provided, skip submit entirely (NOV-689).
    // No new task is submitted, no new charge is incurred — we go straight to polling.
    // platform/operation are still validated for display; preflight is skipped because
    // the task is already running server-side and the op params are irrelevant at this point.
    const resumeTaskId = params.task_id;
    if (!resumeTaskId) {
        // #6: pre-flight validation — fail fast on a bad op id / missing required param
        // BEFORE the backend round-trip, so a typo can't hang ~60s and 504. Reuses the
        // existing 11006-style typed-error contract (NovadaError → index.ts isError:true).
        const preflightErr = preflightScrape(platform, operation, (opParams ?? {}));
        if (preflightErr)
            throw preflightErr;
    }
    try {
        // Step 1: Submit task OR resume from a previously-returned task_id.
        //   - If task_id is provided: skip submit entirely (no billable task created).
        //   - Otherwise: submit a new task → resolves to inline records, empty-serp, or a task_id.
        let submitOutcome;
        if (resumeTaskId) {
            // Resume: go straight to polling with the caller-supplied task_id.
            submitOutcome = { kind: "task", taskId: resumeTaskId };
        }
        else {
            try {
                submitOutcome = await submitScrapeTask(apiKey, platform, operation, opParams);
            }
            catch (error) {
                if (error instanceof AxiosError) {
                    const status = error.response?.status;
                    const body = error.response?.data;
                    // M1: classify honestly. 401 is a real, permanent auth failure (bad/missing
                    // key). 403 at a scraper edge is frequently transient — geo/WAF/rate
                    // shielding — NOT proof the key is invalid; bundling the two made agents
                    // conclude a permanent auth problem when a retry might succeed. Emit typed
                    // NovadaErrors so downstream classifyError can tag retryability correctly.
                    if (status === 401) {
                        throw makeNovadaError(NovadaErrorCode.INVALID_API_KEY, "Invalid or missing NOVADA_API_KEY for platform scrapers.", "HTTP 401");
                    }
                    if (status === 403) {
                        throw makeNovadaError(NovadaErrorCode.API_DOWN, "Scraper request was blocked (HTTP 403) — often a transient geo/WAF/rate block at the scraper edge rather than an invalid key. Retry once; if it persists on every call, verify the key has scraper permission via novada_account(section=\"summary\").", "HTTP 403");
                    }
                    throw new Error(`Scraper API error (HTTP ${status}): ${JSON.stringify(body)}`);
                }
                throw error;
            }
        }
        // Empty serp / no-results → GRACEFUL success (status ok, NOT isError). The query
        // was valid; it simply matched nothing. Returning a plain string keeps isError:false.
        if (submitOutcome.kind === "empty") {
            return [
                `## Scrape Results`,
                `platform: ${platform} | operation: ${operation} | records: 0 | source: live`,
                ``,
                `status: ok`,
                `_No results found for this query._ (upstream: ${sanitizeServerMsg(submitOutcome.message)})`,
                ``,
                `---`,
                `## Agent Hints`,
                `- This is not an error — the query returned zero results. Try a broader or differently-worded query.`,
                `- Verify the parameter value (keyword/url/asin) is spelled correctly and is a real, indexable target.`,
                `- Read novada://scraper-platforms to confirm the operation matches your intent.`,
            ].join("\n");
        }
        // Step 2: Obtain result items — inline (skip poll) or by polling the task_id.
        let resultItems;
        if (submitOutcome.kind === "inline") {
            // NOV-697: results were already in the submit response — no poll round-trip.
            resultItems = submitOutcome.items;
        }
        else {
            let pollOutcome;
            try {
                pollOutcome = await pollForResult(apiKey, submitOutcome.taskId);
            }
            catch (error) {
                if (error instanceof AxiosError) {
                    throw new Error(`Failed to retrieve scraper results: ${sanitizeServerMsg(error.message)}`);
                }
                throw error;
            }
            // Still processing after the sync ceiling → CLEAN pending status (NOT isError).
            // A slow-but-valid task is not a failure; return an honest message with the task_id
            // so the caller can resume WITHOUT re-submitting (and without a new charge).
            if (pollOutcome.kind === "pending") {
                return [
                    `## Scrape Results`,
                    `platform: ${platform} | operation: ${operation} | records: 0 | source: live`,
                    ``,
                    `status: processing`,
                    `⏳ Task still running (task_id="${pollOutcome.taskId}") after ${POLL_TIMEOUT_MS / 1000}s.`,
                    `To fetch the result WITHOUT re-charging, call novada_scrape again with task_id="${pollOutcome.taskId}" (skips re-submit).`,
                    `A plain retry with the same params starts a NEW billable task.`,
                    ``,
                    `---`,
                    `## Agent Hints`,
                    `- Pass task_id="${pollOutcome.taskId}" to novada_scrape in ~10-20s to resume for free.`,
                    `- platform and operation are still required when resuming (used for display only).`,
                    `- Do not treat this as a failure — the task is finishing server-side.`,
                ].join("\n");
            }
            resultItems = pollOutcome.items;
        }
        // Step 3: Extract records — handle two response formats from the download endpoint:
        //   Format A (flat): array of direct record objects, e.g. [{title:"...", error:null, success:true}, ...]
        //   Format B (wrapped): [{spider_code:200, rest:{...}}, ...] or [{error:"msg", error_code:N}]
        const firstItem = resultItems[0];
        if (!firstItem) {
            return `## Scrape Results\nplatform: ${platform} | operation: ${operation}\n\n_No records returned._`;
        }
        const firstAsRecord = firstItem;
        let rawRecords;
        if ("spider_code" in firstAsRecord || "rest" in firstAsRecord) {
            // Format B: wrapped envelope
            const itemError = firstAsRecord.error;
            if (typeof itemError === "string" && itemError.length > 0) {
                const errCode = firstAsRecord.error_code;
                // API_DOWN (transient): scraper reached the backend but the task failed —
                // retryable envelope for the customer + suppressed from Sentry alerts.
                throw makeNovadaError(NovadaErrorCode.API_DOWN, `Scraper task failed (${errCode ?? "unknown"}): ${itemError}. This is usually transient — retry once or try a different operation.`, `error_code:${errCode ?? "unknown"}`);
            }
            rawRecords = extractRecords(firstAsRecord.rest);
        }
        else {
            // Format A: flat array — separate successful items from error items
            const errorItems = resultItems.filter(item => {
                const err = item.error;
                return typeof err === "string" && err.length > 0;
            });
            rawRecords = resultItems
                .filter(item => {
                const err = item.error;
                return typeof err !== "string" || err.length === 0;
            })
                .map(item => item);
            // INC-190: When ALL items have errors, surface the error details instead of
            // misleading "No records returned". The underlying error_code (e.g. 300 = parse failure)
            // is the real root cause the agent needs.
            if (rawRecords.length === 0 && errorItems.length > 0) {
                const firstErr = errorItems[0];
                const errCode = firstErr.error_code ?? "unknown";
                const errMsg = firstErr.error ?? "Unknown scraper error";
                // INC-190: error_code 300 = the page was reached but extraction failed
                // (parser/blocked). That is transient upstream weather, not a permanent bug —
                // classify as API_DOWN so the customer gets a retryable envelope with a hint
                // AND the hosted dispatch catch records a breadcrumb instead of paging us.
                throw makeNovadaError(NovadaErrorCode.API_DOWN, `Scraper collected ${errorItems.length} result(s) but all failed. ` +
                    `error_code: ${errCode} — ${sanitizeServerMsg(String(errMsg))}. ` +
                    `This means the target page was reached but data extraction failed (parser error, empty page, or access blocked). ` +
                    `This is usually transient — retry once, or try a different operation / verify the target URL.`, `error_code:${errCode}`);
            }
        }
        // TOW2-237: reconcile price + availability BEFORE any format derives from the
        // records, so json / markdown / csv / excel / html / toon all surface the real
        // price and a trustworthy is_available. Pure projection of the API json — no-op
        // for platforms (e.g. Walmart) whose flat fields are already populated.
        rawRecords = rawRecords.map(r => normalizeProductRecord(r));
        const records = rawRecords.slice(0, limit).map(r => flattenRecord(r));
        if (records.length === 0) {
            return `## Scrape Results\nplatform: ${platform} | operation: ${operation}\n\n_No records returned._`;
        }
        const title = `${platform} — ${displayOperation}`;
        // For json we want clean structured records (not the flattened dot-path display version).
        // rawRecords are already sliced by limit above via `rawRecords.slice(0, limit)`.
        // `records` is the flattenRecord'd version used for markdown/toon tabular display.
        const cleanRecords = rawRecords.slice(0, limit);
        // For the human tabular formats (csv/excel/html): drop base64-blob columns
        // (favicon/image data URIs — useless in a spreadsheet + fragile in CSV) and
        // lead with curated key columns (title/price/rating/url/…). Display-only.
        const tabularRecords = curateTabularRecords(records);
        let output;
        switch (format) {
            case "json":
                // Clean JSON: surface key fields prominently. rawRecords are the upstream objects;
                // they may still have deep nesting, but agents can navigate them. We emit them as-is
                // (not flattenRecord'd), keeping structure and avoiding the 70-column flat-object problem.
                output = [
                    `## Scrape Results`,
                    `platform: ${platform} | operation: ${displayOperation} | records: ${cleanRecords.length} | source: live`,
                    ``,
                    "```json",
                    JSON.stringify(cleanRecords, null, 2),
                    "```",
                    ``,
                    `---`,
                    `## Agent Hints`,
                    `- Increase limit (max 100) to retrieve more records.`,
                    `- For human-readable output: use format='markdown'. For spreadsheets: format='csv' or format='excel'.`,
                    `- Read novada://scraper-platforms resource to discover other operations on this platform.`,
                ].join("\n");
                break;
            case "csv": {
                // Inline CSV — header row + one row per record. Curated columns (base64 blobs
                // dropped, key fields first). formatAsCsv RFC-4180 quotes any cell with a
                // comma/quote/newline, so it round-trips in any spreadsheet or CSV parser.
                const csvText = formatAsCsv(tabularRecords);
                output = [
                    `## Scrape Results`,
                    `platform: ${platform} | operation: ${displayOperation} | records: ${tabularRecords.length} | source: live | format: csv`,
                    ``,
                    "```csv",
                    csvText,
                    "```",
                    ``,
                    `---`,
                    `## Agent Hints`,
                    `- Copy the CSV block above and paste into Excel, Google Sheets, or any spreadsheet app.`,
                    `- Increase limit (max 100) to retrieve more records.`,
                    `- Use format='excel' to get a real .xlsx file instead.`,
                ].join("\n");
                break;
            }
            case "excel":
            case "xlsx": {
                // Real .xlsx via exceljs — inline base64 so no disk writes (serverless-safe).
                // Curated columns (base64 blobs dropped, key fields first) so the spreadsheet
                // opens with clean, meaningful columns instead of favicon/image data URIs.
                const xlsxBuf = await formatAsXlsx(tabularRecords, operation.slice(0, 31));
                const b64 = xlsxBuf.toString("base64");
                output = [
                    `## Scrape Results`,
                    `platform: ${platform} | operation: ${displayOperation} | records: ${tabularRecords.length} | source: live | format: excel`,
                    ``,
                    `**Excel file (base64-encoded .xlsx)** — ${tabularRecords.length} rows, ${Object.keys(tabularRecords[0] ?? {}).length} columns`,
                    `Decode and save as \`${operation}.xlsx\` to open in Excel or Google Sheets.`,
                    ``,
                    "```",
                    b64,
                    "```",
                    ``,
                    `---`,
                    `## Agent Hints`,
                    `- Base64 → xlsx: \`echo "<base64>" | base64 -d > data.xlsx\` or use any online base64-to-file converter.`,
                    `- Increase limit (max 100) to retrieve more records.`,
                    `- Use format='csv' for a smaller inline text alternative.`,
                ].join("\n");
                break;
            }
            case "html": {
                // Inline HTML <table> — header <th> row + one <tr> per record. Curated columns
                // (base64 blobs dropped, key fields first). Ready to drop into a page or open in a browser.
                const htmlTable = formatAsHtml(tabularRecords, title);
                output = [
                    `## Scrape Results`,
                    `platform: ${platform} | operation: ${displayOperation} | records: ${tabularRecords.length} | source: live | format: html`,
                    ``,
                    htmlTable,
                    ``,
                    `---`,
                    `## Agent Hints`,
                    `- The HTML above is a standalone <table> document — save it as .html and open in a browser, or embed the <table> element in a page.`,
                    `- Increase limit (max 100) to retrieve more records.`,
                    `- Use format='csv' or format='excel' for spreadsheet-ready output, format='json' for code.`,
                ].join("\n");
                break;
            }
            case "toon": {
                // TOON: headers declared once, then pipe-separated rows — 40-65% token savings vs JSON/markdown
                // Union all keys across records to avoid dropping columns from heterogeneous rows
                const headerSet = new Set();
                for (const r of records)
                    Object.keys(r).forEach(k => headerSet.add(k));
                const headers = Array.from(headerSet);
                const toonRows = [
                    `HEADERS: ${headers.join(" | ")}`,
                    ...records.map(r => headers.map(h => String(r[h] ?? "")).join(" | ")),
                ];
                output = [
                    `## Scrape Results`,
                    `platform: ${platform} | operation: ${displayOperation} | records: ${records.length} | source: live | format: toon`,
                    ``,
                    toonRows.join("\n"),
                    ``,
                    `---`,
                    `## Agent Hints`,
                    `- TOON format: first line starts with "HEADERS:" listing columns, subsequent lines are pipe-separated values.`,
                    `- Use format='json' for downstream code processing, format='markdown' for human-readable output.`,
                    `- Increase limit (max 100) to retrieve more records.`,
                    ``,
                    `## Agent Memory`,
                    `remember: ${platform}/${operation} — ${records.length} records retrieved`,
                ].join("\n");
                break;
            }
            case "markdown":
            default:
                output = [
                    `## Scrape Results`,
                    `platform: ${platform} | operation: ${displayOperation} | records: ${records.length} | source: live${records.length >= limit ? ` (limit:${limit})` : ""}`,
                    ``,
                    `---`,
                    ``,
                    formatAsMarkdown(records),
                    ``,
                    `---`,
                    `## Agent Hints`,
                    `- Use format='json' or format='csv' for downstream processing. Use format='excel' for a .xlsx spreadsheet.`,
                    `- Increase limit (max 100) to retrieve more records.`,
                    `- For structured scraping of other platforms, change platform and operation.`,
                    `- Discover all 13 supported platforms and their operations: read novada://scraper-platforms resource.`,
                    ``,
                    `## Chainable Output`,
                    `source_url: ${platform}/${operation}`,
                    `agent_instruction: Scrape complete. To read a related URL use novada_extract. To crawl multiple pages use novada_crawl. To search for related content use novada_search.`,
                    ``,
                    `## Agent Memory`,
                    `remember: ${platform}/${operation} — ${records.length} records retrieved`,
                ].join("\n");
                break;
        }
        // Wire output save — best-effort, never breaks the tool
        try {
            const domain = platform || "scrape";
            const outputResult = await saveOutput({
                tool: "scrape",
                hint: domain,
                format: format === "json" ? "json" : "csv",
                data: rawRecords.slice(0, limit),
                project: params.project,
            });
            output += `\n\n## Output Saved\n${outputResult.summary}`;
        }
        catch { /* file save is best-effort */ }
        return output;
    }
    catch (err) {
        // H5: use typed NovadaError.code instead of brittle string matching
        if (err instanceof NovadaError && err.code === NovadaErrorCode.PRODUCT_UNAVAILABLE) {
            // Surface any known canonical aliases for the operation the agent tried, so the
            // agent can self-correct a near-miss op ID without a second round-trip. Most 11006
            // errors are malformed/non-canonical op IDs, NOT a deactivated Scraper API.
            // H-7: Re-throw as NovadaError so index.ts sets isError: true
            const aliasHint = hasAlias
                ? `The operation '${params.operation}' was auto-resolved to '${OPERATION_ALIASES[params.operation]}' but still rejected. The canonical ID itself may be wrong for this platform.`
                : `The operation '${operation}' was rejected. Operation IDs are exact and cannot be guessed.`;
            throw new NovadaError({
                code: NovadaErrorCode.PRODUCT_UNAVAILABLE,
                message: `Scraper code 11006 for '${operation}' on '${platform}'. ${aliasHint}`,
                agent_instruction: `${aliasHint} Read novada://scraper-platforms to confirm the exact operation ID. ` +
                    `Alternatives: novada_extract (general pages), novada_extract with render="render" (bot-protected), novada_crawl (multi-page). ` +
                    `Only treat as an activation issue if the operation ID is confirmed correct. Do not retry with the same ID.`,
                retryable: false,
                detail: hasAlias ? `alias:${params.operation}→${OPERATION_ALIASES[params.operation]}` : "code 11006",
            });
        }
        // H-7: Re-throw 11008 as NovadaError so index.ts sets isError: true
        if (err instanceof NovadaError && err.code === NovadaErrorCode.INVALID_PARAMS && err.detail === "code 11008") {
            throw err;
        }
        // All other errors (network, timeout, poll failure, missing task_id): re-throw
        // index.ts will handle them via classifyError and return isError: true
        throw err;
    }
}
//# sourceMappingURL=scrape.js.map