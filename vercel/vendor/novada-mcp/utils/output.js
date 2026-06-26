/**
 * Output stub for Vercel Edge Runtime.
 * File saving is only meaningful in local/stdio mode.
 * On hosted/Edge, saveOutput is a no-op that returns a summary without writing files.
 */
export function toCsv(records) {
  if (records.length === 0) return "";
  const allKeys = new Set();
  for (const rec of records) for (const key of Object.keys(rec)) allKeys.add(key);
  const headers = [...allKeys];
  const escape = (val) => {
    const str = val === null || val === undefined ? "" : String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r"))
      return '"' + str.replace(/"/g, '""') + '"';
    return str;
  };
  return [headers.map(escape).join(","), ...records.map(r => headers.map(h => escape(r[h])).join(","))].join("\n");
}

export async function saveOutput(options) {
  // No-op on hosted/Edge — return summary without writing files
  const { tool, hint = "output", format, data, cosUrl } = options;
  let recordCount;
  if (format === "json" && Array.isArray(data)) recordCount = data.length;
  if (format === "csv" && Array.isArray(data)) recordCount = data.length;
  
  const parts = ["(hosted mode — file not saved locally)"];
  if (recordCount !== undefined) parts.push(`${recordCount} records`);
  if (cosUrl) parts.push(`Download: ${cosUrl}`);
  
  return {
    filePath: "(hosted — no local file)",
    cosUrl,
    recordCount,
    summary: parts.join(" | "),
  };
}
