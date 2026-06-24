import axios, { AxiosError } from "axios";
import { z } from "zod";
import { SCRAPER_DOWNLOAD_BASE } from "../config.js";
import { formatAsMarkdown } from "../utils/format.js";
import { saveOutput } from "../utils/output.js";
import { makeNovadaError, NovadaErrorCode } from "../_core/errors.js";
import { TASK_ID_REGEX, TASK_ID_REGEX_MSG } from "./types.js";
import { devApiPost } from "../_core/developer_api.js";
// ─── Schema & Types ──────────────────────────────────────────────────────────
export const ScraperResultParamsSchema = z.object({
    task_id: z
        .string()
        .min(1, "task_id is required")
        .regex(TASK_ID_REGEX, TASK_ID_REGEX_MSG)
        .describe("The task_id of a completed scraping task. Use novada_scraper_status first to confirm status is 'complete'."),
    format: z
        .enum(["markdown", "json", "raw"])
        .default("markdown")
        .describe("Output format for the scraped result. 'markdown' (default): human-readable table. 'json': structured JSON for programmatic use. 'raw': raw API response without formatting."),
});
export function validateScraperResultParams(args) {
    return ScraperResultParamsSchema.parse(args ?? {});
}
// ─── Result Endpoint ─────────────────────────────────────────────────────────
// Kept for legacy fallback path only
const RESULT_DOWNLOAD_ENDPOINT = `${SCRAPER_DOWNLOAD_BASE}/scraper_download`;
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
                const cap = 5;
                v.slice(0, cap).forEach((item, idx) => {
                    Object.assign(result, flattenRecord(item, `${key}.${idx}`, depth + 1));
                });
                if (v.length > cap)
                    result[`${key}._count`] = `${v.length} total (showing first ${cap})`;
            }
            else {
                const joined = v.map((x) => String(x ?? "")).join("; ");
                result[key] =
                    joined.length > 200 ? joined.slice(0, 200) + "...(truncated)" : joined;
            }
        }
        else {
            result[key] = String(v ?? "");
        }
    }
    return result;
}
function extractRecords(data) {
    if (Array.isArray(data)) {
        return data.map((item) => typeof item === "object" && item !== null
            ? item
            : { value: item });
    }
    if (data !== null && typeof data === "object") {
        const d = data;
        for (const key of [
            "organic_results",
            "organic",
            "results",
            "items",
            "records",
            "data",
            "products",
            "posts",
        ]) {
            if (Array.isArray(d[key]))
                return extractRecords(d[key]);
        }
        return [d];
    }
    return [];
}
/**
 * Fetch completed results for a scraping task by task_id.
 * Tries the confirmed download endpoint first; falls back to api-m.novada.com.
 */
export async function novadaScraperResult(params, apiKey) {
    const { task_id, format } = params;
    let rawData = null;
    let fetchedFromEndpoint = "unknown";
    // ── 2-step COS download ──
    // Step 1: POST /v1/scraper/task_download → get pre-signed COS URL
    // Step 2: GET the COS URL (no auth needed — it's pre-signed)
    try {
        const downloadResp = await devApiPost("/v1/scraper/task_download", { task_ids: task_id, file_type: "json" }, { apiKey });
        // Extract download URL: API returns array of { download, task_id }
        const downloadUrl = Array.isArray(downloadResp)
            ? downloadResp[0]?.download
            : downloadResp?.download;
        if (downloadUrl) {
            // Step 2: fetch the actual data from the pre-signed COS URL (no auth needed)
            const dataResp = await axios.get(downloadUrl, { timeout: 30000 });
            rawData = dataResp.data;
            fetchedFromEndpoint = "task_download";
        }
        else {
            // No COS URL returned — task may not be ready yet
            return JSON.stringify({
                status: "not_ready",
                task_id,
                agent_instruction: "Task is not yet complete. Use novada_scraper_status to poll until status is 'complete', then call novada_scraper_result again.",
            }, null, 2);
        }
    }
    catch (downloadErr) {
        if (downloadErr instanceof AxiosError) {
            const status = downloadErr.response?.status;
            if (status === 401 || status === 403) {
                throw makeNovadaError(NovadaErrorCode.INVALID_API_KEY, "Invalid NOVADA_API_KEY or insufficient permissions for Scraper API.");
            }
            // COS URL fetch failed — try legacy download endpoint as fallback
        }
        else {
            // NovadaError from devApiPost (e.g. task not ready, code 27202)
            // Fall through to legacy fallback
        }
        // Legacy fallback: GET /scraper_download?task_id=...&file_type=json&apikey=...
        try {
            const resp = await axios.get(RESULT_DOWNLOAD_ENDPOINT, {
                params: { task_id, file_type: "json", apikey: apiKey },
                timeout: 30000,
            });
            const body = resp.data;
            if (Array.isArray(body) && body.length > 0) {
                rawData = body;
                fetchedFromEndpoint = RESULT_DOWNLOAD_ENDPOINT;
            }
            else if (body !== null && typeof body === "object" && !Array.isArray(body)) {
                const bObj = body;
                if ("organic_results" in bObj || "organic" in bObj || "search_metadata" in bObj) {
                    rawData = body;
                    fetchedFromEndpoint = RESULT_DOWNLOAD_ENDPOINT;
                }
                if (bObj.code === 27202) {
                    return JSON.stringify({
                        status: "not_ready",
                        task_id,
                        agent_instruction: "Task is not yet complete. Use novada_scraper_status to poll until status is 'complete', then call novada_scraper_result again.",
                    }, null, 2);
                }
                if (bObj.code === 10002 || bObj.code === 10003) {
                    return JSON.stringify({
                        status: "failed",
                        task_id,
                        error: `Task failed (code ${bObj.code}): ${bObj.msg ?? "Server-side task execution error."}`,
                        agent_instruction: "The scraping task failed. Re-submit with novada_scraper_submit or try novada_extract as an alternative.",
                    }, null, 2);
                }
            }
        }
        catch (legacyErr) {
            if (legacyErr instanceof AxiosError) {
                const status = legacyErr.response?.status;
                if (status === 401 || status === 403) {
                    throw makeNovadaError(NovadaErrorCode.INVALID_API_KEY, "Invalid NOVADA_API_KEY or insufficient permissions for Scraper API.");
                }
                throw makeNovadaError(NovadaErrorCode.API_DOWN, `Download endpoint error (HTTP ${status ?? "network"}): ${legacyErr.message}`);
            }
            else {
                throw makeNovadaError(NovadaErrorCode.API_DOWN, legacyErr instanceof Error ? legacyErr.message : String(legacyErr));
            }
        }
    }
    // ── No data retrieved ──
    if (rawData === null) {
        return JSON.stringify({
            status: "unavailable",
            task_id,
            note: "Could not retrieve result from either the download endpoint or the status endpoint.",
            agent_instruction: "Result retrieval failed. Two possible causes: (1) Task is not yet complete — use novada_scraper_status first. (2) The result endpoint is not yet deployed for this scraper type — contact Novada support at support@novada.com with the task_id for manual result retrieval.",
        }, null, 2);
    }
    // ── Format the retrieved data ──
    const records = extractRecords(rawData);
    if (records.length === 0) {
        return JSON.stringify({
            status: "complete",
            task_id,
            records: 0,
            agent_instruction: "Task completed but returned no records. The scraped URL may have returned an empty response or the scraper found no matching data.",
        }, null, 2);
    }
    // Wire output save — best-effort, never breaks the tool
    let savedInfo = "";
    try {
        const outputResult = await saveOutput({
            tool: "scraper",
            hint: task_id.slice(0, 12),
            format: format === "json" ? "json" : "csv",
            data: records,
            cosUrl: undefined, // COS URL not captured in current flow; will surface when task_download returns it
        });
        savedInfo = outputResult.summary;
    }
    catch { /* file save is best-effort */ }
    let output;
    switch (format) {
        case "json":
            output = [
                "## Scraper Result",
                `task_id: ${task_id} | records: ${records.length} | fetched from: ${fetchedFromEndpoint}`,
                "",
                "```json",
                JSON.stringify(records, null, 2),
                "```",
                "",
                "---",
                "## Agent Hints",
                "- Use format='markdown' for a human-readable table.",
                "- Use format='raw' to see the unprocessed API response.",
                `- task_id: ${task_id}`,
            ].join("\n");
            break;
        case "raw":
            output = [
                "## Scraper Result (Raw)",
                `task_id: ${task_id} | fetched from: ${fetchedFromEndpoint}`,
                "",
                "```json",
                JSON.stringify(rawData, null, 2),
                "```",
                "",
                "---",
                "## Agent Hints",
                "- Use format='json' for extracted records array.",
                "- Use format='markdown' for a formatted table.",
            ].join("\n");
            break;
        case "markdown":
        default: {
            const flatRecords = records.map((r) => flattenRecord(r));
            output = [
                "## Scraper Result",
                `task_id: ${task_id} | records: ${records.length}`,
                "",
                "---",
                "",
                formatAsMarkdown(flatRecords),
                "",
                "---",
                "## Agent Hints",
                "- Use format='json' or format='raw' for downstream programmatic processing.",
                `- Use novada_scraper_status with task_id="${task_id}" to check if this was the full result.`,
                `- task_id: ${task_id}`,
            ].join("\n");
            break;
        }
    }
    if (savedInfo) {
        output += `\n\n## Output Saved\n${savedInfo}`;
    }
    return output;
}
//# sourceMappingURL=scraper_result.js.map