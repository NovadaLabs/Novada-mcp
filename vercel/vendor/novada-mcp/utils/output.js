import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
/**
 * Sanitize a string for safe use as a filename component.
 * Removes special chars, truncates to 40 chars.
 */
function sanitizeHint(hint) {
    return hint
        .replace(/^https?:\/\//, "")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 40)
        || "output";
}
/**
 * Get the output directory for today, creating it if needed.
 * Returns: ~/Downloads/novada-mcp/YYYY-MM-DD/
 */
async function getOutputDir() {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const dir = join(homedir(), "Downloads", "novada-mcp", today);
    await mkdir(dir, { recursive: true }); // idempotent, no need for existsSync guard
    return dir;
}
/**
 * Generate a unique filename.
 * Format: {tool}_{hint}_{HHmmss}.{format}
 */
function generateFileName(tool, hint, format) {
    const now = new Date();
    const time = now.toTimeString().slice(0, 8).replace(/:/g, "") + String(now.getMilliseconds()).padStart(3, "0"); // HHmmssSSS
    const safeHint = sanitizeHint(hint);
    return `${tool}_${safeHint}_${time}.${format}`;
}
/**
 * Convert an array of records to CSV string.
 */
export function toCsv(records) {
    if (records.length === 0)
        return "";
    // Collect all unique keys across all records
    const allKeys = new Set();
    for (const rec of records) {
        for (const key of Object.keys(rec)) {
            allKeys.add(key);
        }
    }
    const headers = [...allKeys];
    // Escape CSV field: wrap in quotes if contains comma, quote, or newline
    const escapeField = (val) => {
        const str = val === null || val === undefined ? "" : String(val);
        if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    };
    const headerLine = headers.map(escapeField).join(",");
    const dataLines = records.map(rec => headers.map(h => escapeField(rec[h])).join(","));
    return [headerLine, ...dataLines].join("\n");
}
/**
 * Save output to file. Returns metadata about the saved file.
 */
export async function saveOutput(options) {
    const { tool, hint = "output", format, data, cosUrl } = options;
    const dir = await getOutputDir();
    const fileName = generateFileName(tool, hint, format);
    const filePath = join(dir, fileName);
    let content;
    let recordCount;
    switch (format) {
        case "json": {
            content = JSON.stringify(data, null, 2);
            if (Array.isArray(data))
                recordCount = data.length;
            break;
        }
        case "csv": {
            const records = Array.isArray(data)
                ? data.map(item => typeof item === "object" && item !== null ? item : { value: item })
                : [typeof data === "object" && data !== null ? data : { value: data }];
            content = toCsv(records);
            recordCount = records.length;
            break;
        }
        case "md": {
            content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
            break;
        }
        default:
            content = String(data);
    }
    await writeFile(filePath, content, "utf-8");
    const sizeKB = Math.round(Buffer.byteLength(content) / 1024);
    const parts = [`Saved to: ${filePath} (${sizeKB}KB)`];
    if (recordCount !== undefined)
        parts.push(`${recordCount} records`);
    if (cosUrl)
        parts.push(`Download: ${cosUrl}`);
    return {
        filePath,
        cosUrl,
        recordCount,
        summary: parts.join(" | "),
    };
}
//# sourceMappingURL=output.js.map