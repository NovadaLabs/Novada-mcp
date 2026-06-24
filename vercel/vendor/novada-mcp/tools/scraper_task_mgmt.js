// Wraps POST /v1/scraper/task_{list,status,download} and /v1/scraper/last_task_status
// on api-m.novada.com (developer-api). These are management/monitoring endpoints
// for async scraper tasks — separate auth from the scraper.novada.com submission API.
import { z } from "zod";
import { devApiPost } from "../_core/developer_api.js";
// ─── Schema & Types ──────────────────────────────────────────────────────────
export const ScraperTaskMgmtParamsSchema = z
    .object({
    action: z
        .enum(["list", "status", "download", "last_status"])
        .describe("Action to perform. 'list': paginated task list. 'status': status by task_ids (comma-separated). 'download': download task result by task_id. 'last_status': status of most recent task."),
    // Used by "list" action
    page: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Page number for 'list' action. Defaults to server default (1)."),
    limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .describe("Max results per page for 'list' action. Max 100."),
    // Used by "status" action
    task_ids: z
        .string()
        .min(1)
        .optional()
        .describe("Comma-separated task IDs for 'status' action. Max 200 IDs. E.g. 'abc123,def456'."),
    // Used by "download" action
    task_id: z
        .string()
        .min(1)
        .optional()
        .describe("Single task ID for 'download' action."),
    // Used by "download" action — output format
    file_type: z
        .enum(["json", "csv", "xlsx"])
        .default("json")
        .describe("Output format for 'download' action. Default: 'json'."),
})
    .strict();
export function validateScraperTaskMgmtParams(args) {
    return ScraperTaskMgmtParamsSchema.parse(args ?? {});
}
// ─── Tool Implementation ─────────────────────────────────────────────────────
export async function novadaScraperTaskMgmt(params, apiKey) {
    switch (params.action) {
        case "list":
            return handleList(params, apiKey);
        case "status":
            return handleStatus(params, apiKey);
        case "download":
            return handleDownload(params, apiKey);
        case "last_status":
            return handleLastStatus(apiKey);
        default: {
            // Exhaustive check — TypeScript ensures this is unreachable
            const _exhaustive = params.action;
            return _exhaustive;
        }
    }
}
// ─── Action handlers ─────────────────────────────────────────────────────────
async function handleList(params, apiKey) {
    const body = {};
    if (params.page !== undefined)
        body.page = params.page;
    if (params.limit !== undefined)
        body.limit = params.limit;
    const data = await devApiPost("/v1/scraper/task_list", body, { apiKey });
    return JSON.stringify({
        status: "ok",
        action: "list",
        data,
        agent_instruction: "Paginated scraper task list. Use action='status' with specific task_ids for detailed status, " +
            "or action='download' with a task_id to retrieve results.",
    }, null, 2);
}
async function handleStatus(params, apiKey) {
    if (!params.task_ids) {
        return JSON.stringify({
            status: "error",
            error: "task_ids is required for action='status'. Provide comma-separated task IDs (max 200).",
            agent_instruction: "Re-call with task_ids parameter. Use action='list' first to discover task IDs if unknown.",
        }, null, 2);
    }
    const data = await devApiPost("/v1/scraper/task_status", {
        task_ids: params.task_ids,
    }, { apiKey });
    return JSON.stringify({
        status: "ok",
        action: "status",
        data,
        agent_instruction: "Task status retrieved. Tasks with status 'Ready' can be downloaded via action='download'. " +
            "Tasks still processing should be polled again after 10-20 seconds.",
    }, null, 2);
}
async function handleDownload(params, apiKey) {
    if (!params.task_id) {
        return JSON.stringify({
            status: "error",
            error: "task_id is required for action='download'. Provide a single task ID.",
            agent_instruction: "Re-call with task_id parameter. Use action='list' or action='status' first to find the task ID.",
        }, null, 2);
    }
    // API expects `task_ids` (plural) + `file_type` (required)
    const data = await devApiPost("/v1/scraper/task_download", {
        task_ids: params.task_id,
        file_type: params.file_type ?? "json",
    }, { apiKey });
    return JSON.stringify({
        status: "ok",
        action: "download",
        task_id: params.task_id,
        data,
        agent_instruction: "Task result retrieved. If 'data' contains a download URL, fetch it to get the actual content. " +
            "Use novada_extract on the download URL if further processing is needed.",
    }, null, 2);
}
async function handleLastStatus(apiKey) {
    const data = await devApiPost("/v1/scraper/last_task_status", {}, { apiKey });
    return JSON.stringify({
        status: "ok",
        action: "last_status",
        data,
        agent_instruction: "Most recent scraper task status. Use action='download' with the task_id to retrieve results if ready. " +
            "Use action='list' for a full paginated view of all tasks.",
    }, null, 2);
}
//# sourceMappingURL=scraper_task_mgmt.js.map