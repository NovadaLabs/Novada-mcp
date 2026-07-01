import axios, { AxiosError } from "axios";
import { z } from "zod";
import { SCRAPER_DOWNLOAD_BASE } from "../config.js";
import { formatAsMarkdown } from "../utils/format.js";
import { saveOutput } from "../utils/output.js";
import { makeNovadaError, NovadaErrorCode } from "../_core/errors.js";
import { TASK_ID_REGEX, TASK_ID_REGEX_MSG } from "./types.js";
import { devApiPost } from "../_core/developer_api.js";
import { checkTaskExists } from "./scraper_status.js";
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
            // No COS URL returned — task_download returned code:0 but empty download URL.
            // This happens for BOTH:
            //   (a) bogus/unknown task_ids — API returns {code:0, data:[{download:"", task_id:bogus}]}
            //   (b) newly-submitted real tasks — for ~30s after submit the status endpoint hasn't
            //       propagated yet, so checkTaskExists returns "not_found" even though the task exists.
            // Disambiguate via a lightweight status existence check, but be honest about the
            // propagation window: "not_found" from checkTaskExists CANNOT definitively distinguish
            // bogus from just-submitted-and-not-yet-propagated.
            // NOV-666: this is now the primary disambiguation site for empty-downloadUrl paths.
            const existence = await checkTaskExists(task_id, apiKey);
            if (existence === "exists") {
                // Status endpoint confirms task exists — definitely not_ready (still running).
                return JSON.stringify({
                    status: "not_ready",
                    task_id,
                    agent_instruction: "Task exists but result is not yet available. " +
                        "Use novada_scraper_status to poll until status is 'complete', then call novada_scraper_result again. " +
                        "Do NOT call novada_scraper_result again until novada_scraper_status returns 'complete'.",
                }, null, 2);
            }
            if (existence === "not_found") {
                // Status endpoint returned 404 — task is either invalid/expired OR just submitted
                // and not yet propagated (~30s API lag, live-confirmed). Cannot tell the difference.
                return JSON.stringify({
                    status: "not_found",
                    task_id,
                    agent_instruction: "Task not found on the status endpoint. Two possibilities: " +
                        "(1) You JUST submitted this task (within the last ~30 seconds) — this is normal API propagation lag. Wait 30 seconds and retry novada_scraper_status; if it returns pending/running, the task exists. " +
                        "(2) The task_id is invalid or expired (tasks expire after 24 hours). " +
                        "If novada_scraper_status still returns not_found after 30s, stop polling and re-submit with novada_scraper_submit.",
                }, null, 2);
            }
            // existence === "unknown": status check failed (network/auth). Be honest.
            return JSON.stringify({
                status: "not_ready",
                task_id,
                note: "Result not yet available and task existence could not be confirmed (status endpoint unreachable).",
                agent_instruction: "Could not retrieve result and could not confirm task existence. " +
                    "Call novada_scraper_status to check task status. " +
                    "If it returns not_found after ~30s from submission, stop polling and re-submit. " +
                    "If it returns pending/running/complete, act accordingly.",
            }, null, 2);
        }
    }
    catch (downloadErr) {
        if (downloadErr instanceof AxiosError) {
            const status = downloadErr.response?.status;
            if (status === 401 || status === 403) {
                throw makeNovadaError(NovadaErrorCode.INVALID_API_KEY, "Invalid NOVADA_API_KEY or insufficient permissions for Scraper API.");
            }
            // NOV-666: HTTP 404 on the COS / task_download endpoint means this task_id
            // does not exist (never submitted or already expired). Return not_found
            // immediately rather than falling through to a legacy path that would return
            // not_ready (misleading the caller into thinking the task is still running).
            if (status === 404) {
                return JSON.stringify({
                    status: "not_found",
                    task_id,
                    agent_instruction: "Task not found. The task_id is invalid, was never submitted, or has expired (tasks expire after 24 hours). " +
                        "Do NOT poll further — re-submit with novada_scraper_submit or use novada_extract as an alternative.",
                }, null, 2);
            }
            // COS URL fetch failed for another reason — try legacy download endpoint as fallback
        }
        else {
            // NovadaError from devApiPost (e.g. task not ready, non-zero code)
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
                    // NOV-666: code 27202 from the legacy download endpoint is ambiguous — it means
                    // "result not yet available" for both real pending tasks AND unknown/bogus task_ids.
                    // Disambiguate by doing a lightweight existence check via the status endpoint
                    // (which returns HTTP 404 definitively for unknown ids).
                    const existence = await checkTaskExists(task_id, apiKey);
                    if (existence === "not_found") {
                        return JSON.stringify({
                            status: "not_found",
                            task_id,
                            agent_instruction: "Task not found. The task_id is invalid, was never submitted, or has expired (tasks expire after 24 hours). " +
                                "Do NOT poll further — re-submit with novada_scraper_submit or use novada_extract as an alternative.",
                        }, null, 2);
                    }
                    if (existence === "exists") {
                        return JSON.stringify({
                            status: "not_ready",
                            task_id,
                            agent_instruction: "Task exists but result is not yet available. " +
                                "Use novada_scraper_status to poll until status is 'complete', then call novada_scraper_result again. " +
                                "Do NOT call novada_scraper_result again until novada_scraper_status returns 'complete'.",
                        }, null, 2);
                    }
                    // existence === "unknown": both checks failed (network/auth issue).
                    // Be honest — don't fabricate either verdict.
                    return JSON.stringify({
                        status: "not_ready",
                        task_id,
                        note: "Could not confirm task existence — status endpoint unreachable during disambiguation check.",
                        agent_instruction: "Result not yet available (code 27202) and task existence could not be confirmed. " +
                            "Call novada_scraper_status to check task status. " +
                            "If novada_scraper_status returns 'not_found', stop polling and re-submit. " +
                            "If it returns 'pending'/'running'/'complete', act accordingly.",
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
                // NOV-666: code 10000 from the legacy download endpoint means "task not exist"
                // (live-confirmed: msg:"task not exist"). Distinct from 27202 (pending) — this
                // is an explicit server signal that the task_id is unknown.
                // Apply the same propagation-aware messaging: a just-submitted task also looks
                // not-found for ~30s, so we cannot claim "definitely invalid" without that caveat.
                if (bObj.code === 10000) {
                    return JSON.stringify({
                        status: "not_found",
                        task_id,
                        agent_instruction: "Task not found (code 10000). Two possibilities: " +
                            "(1) You JUST submitted this task (within the last ~30 seconds) — this is normal API propagation lag. Wait 30 seconds and check novada_scraper_status; if it returns pending/running, the task exists. " +
                            "(2) The task_id is invalid or expired (tasks expire after 24 hours). " +
                            "If novada_scraper_status still returns not_found after 30s, stop polling and re-submit with novada_scraper_submit.",
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
                // NOV-666: HTTP 404 from legacy download endpoint = task_id not found.
                // Distinct from not_ready — stop polling and inform the agent clearly.
                if (status === 404) {
                    return JSON.stringify({
                        status: "not_found",
                        task_id,
                        agent_instruction: "Task not found. The task_id is invalid, was never submitted, or has expired (tasks expire after 24 hours). " +
                            "Do NOT poll further — re-submit with novada_scraper_submit or use novada_extract as an alternative.",
                    }, null, 2);
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