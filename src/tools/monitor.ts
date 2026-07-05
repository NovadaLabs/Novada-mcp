import { createHash } from "crypto";
import { z } from "zod";
import { novadaExtract } from "./extract.js";
import { redactSecrets } from "../_core/errors.js";
import { isExtractionFailureSentinel } from "../utils/runtime.js";

/**
 * Extract the stable page body from novadaExtract output for change detection.
 *
 * Real extract.ts output structure (abbreviated):
 *
 *   ## Extracted Content                       ← volatile header block
 *   url: <url>
 *   mode: static | source: live | quality:72/100 ...
 *   quality_reasons: ...
 *   fetched_at: 2026-07-02T12:34:56.789Z      ← volatile
 *   title: ...
 *   chars:1234 | links:3
 *
 *   ---                                        ← separator 1 (after header)
 *
 *   ## Requested Fields                        ← volatile (conf: / source: flip)
 *   title: Example Domain *(json-ld)* *(conf:0.80)*
 *
 *   ---                                        ← separator 2 (after Req. Fields)
 *
 *   <STABLE PAGE BODY>                         ← only this is hashed
 *
 *   ---                                        ← separator 3 (trailer starts)
 *   ## Same-Domain Links                       ← trailer (volatile / structural)
 *   ...
 *   ---
 *   ## Extraction Diagnostics                  ← volatile (conf: changes)
 *   ...
 *   ## Agent Memory                            ← volatile
 *   ...
 *   ---
 *   ## Agent Hints                             ← volatile (changes per call)
 *   ...
 *   ## Agent Action                            ← volatile
 *   ...
 *
 * D1 Fix: isolate the page body by finding the region BETWEEN the last
 * header-side separator (after ## Requested Fields / ## Structured Data) and
 * the first trailer section marker. The trailer is identified by the first
 * occurrence of any of these lines: `## Same-Domain Links`, `## Extraction
 * Diagnostics`, `## Agent Memory`, `## Agent Hints`, `## Agent Action`.
 *
 * When there are no trailer sections (simple/truncated output), the body
 * extends to the end of the string — this handles the no-fields, no-links
 * edge case correctly.
 *
 * Also strips the legacy `path: /abs/path` prefix (FIX-1 original).
 */

// Trailer section headings that begin the volatile tail of extract output.
// Order matters: check all of them to find the earliest occurrence.
const TRAILER_HEADINGS = [
  "## Same-Domain Links",
  "## Extraction Diagnostics",
  "## Agent Memory",
  "## Agent Hints",
  "## Agent Action",
] as const;

// Known annotation block headings that occupy the header zone of extract output.
// A `---`-separated block is part of the header/annotation region IFF its
// trimmed content starts with one of these headings. Once a block is found
// whose content does NOT start with one of these, the header zone has ended
// and the body begins right there.
//
// Matches (all sourced from extract.ts):
//   ## Extracted Content  — always the first block
//   ## Requested Fields   — optional, when fields: param is set
//   ## Structured Data    — optional, when JSON-LD/microdata found
// Kufer blocks (NOV-668) have no stable heading prefix and are treated as body
// content intentionally — they appear after the last annotation --- separator
// and before the body in practice, but their heading is dynamic. Including them
// would over-engineer the guard; they are stable between calls.
const ANNOTATION_BLOCK_HEADINGS = [
  "## Extracted Content",
  "## Requested Fields",
  "## Structured Data",
] as const;

function stripVolatileMetadataHeader(content: string): string {
  // Strip the legacy path: /abs/path header from FIX-1
  const withoutPathHeader = content.replace(/^(?:path|📁)[^\n]*\n\n?/, "");

  // ── Step 1: anchor bodyStart to the end of the known header/annotation region ──
  //
  // Strategy: walk `---`-separated blocks from the start of the string. Each
  // block is the content between two consecutive `\n---\n` separators (or
  // between the start and the first separator). A block is an "annotation
  // block" if its trimmed content STARTS WITH a known ANNOTATION_BLOCK_HEADING.
  // Advance bodyStart past each annotation-block separator. Stop at the first
  // block that is NOT an annotation block (= the body starts there) OR at the
  // first separator whose following content is a known trailer heading (body is
  // empty or absent).
  //
  // This is robust against body-internal `---` lines (e.g. bare `---` inside
  // a fenced code block representing YAML front-matter) because we look at the
  // PRECEDING block's heading, not the content that follows the separator.
  // Body content can never satisfy ANNOTATION_BLOCK_HEADINGS, so once we enter
  // the body the scan stops — regardless of how many `---` the body contains.
  const SEP = "\n---\n";
  let bodyStart = -1;
  let blockStart = 0; // start of the current block (character index)
  let sepIdx = withoutPathHeader.indexOf(SEP, 0);

  while (sepIdx !== -1) {
    // Content of the block that ENDS at this separator
    const blockContent = withoutPathHeader.slice(blockStart, sepIdx).replace(/^\n+/, "");
    const isAnnotationBlock = ANNOTATION_BLOCK_HEADINGS.some(h => blockContent.startsWith(h));

    if (isAnnotationBlock) {
      // This separator closes an annotation block → body starts after it
      bodyStart = sepIdx + SEP.length;
      blockStart = bodyStart;
      sepIdx = withoutPathHeader.indexOf(SEP, blockStart);
    } else {
      // First non-annotation block found → the body starts at blockStart.
      // bodyStart was already set to the correct position by the previous
      // iteration (or remains -1 if there were no annotation separators at all).
      break;
    }
  }

  // ── Step 2: anchor trailerStart to the FIRST known trailer heading ──
  //
  // Look for the earliest occurrence of any trailer heading (with or without a
  // preceding `---` separator). We check the headings directly to avoid any
  // dependency on separator scanning inside the body region.
  let trailerStart = withoutPathHeader.length; // default: no trailer found

  for (const heading of TRAILER_HEADINGS) {
    // Headings that appear after a `---\n` separator (## Same-Domain Links,
    // ## Extraction Diagnostics, ## Agent Hints, ## Agent Action)
    const withSep = withoutPathHeader.indexOf(`\n---\n${heading}`);
    if (withSep !== -1 && withSep < trailerStart) {
      trailerStart = withSep;
    }
    // Headings that appear inline without a preceding separator (## Agent Memory)
    const inline = withoutPathHeader.indexOf(`\n${heading}\n`);
    if (inline !== -1 && inline < trailerStart) {
      trailerStart = inline;
    }
  }

  if (bodyStart !== -1) {
    // Slice out the body: from bodyStart to trailerStart, stripping leading/trailing blanks
    return withoutPathHeader.slice(bodyStart, trailerStart).replace(/^\n+/, "").replace(/\n+$/, "");
  }

  // Fallback: no `---` separators found (truncated / summary output).
  // Strip individual volatile metadata lines and trailer headings.
  return withoutPathHeader
    .replace(/^## Extracted Content\n/m, "")
    .replace(/^mode:.*$/m, "")
    .replace(/^quality_reasons:.*$/m, "")
    .replace(/^fetched_at:.*$/m, "")
    .replace(/^extraction_quality:.*$/m, "")
    .replace(/^source:.*$/m, "")
    // Strip trailer headings and everything after
    .replace(/\n## (?:Same-Domain Links|Extraction Diagnostics|Agent Memory|Agent Hints|Agent Action)[\s\S]*$/, "")
    .trim();
}

/** @deprecated Alias kept for internal callers that only needed the old path-strip. */
const stripExtractPathHeader = stripVolatileMetadataHeader;

// ─── URL Safety (duplicated from types.ts — safeUrl is not exported) ────────

const BLOCKED_HOSTS = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|::1|::ffff:.+|fe80:.*|0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:0*1)$/i;

const safeUrl = z.string()
  .url("A valid URL is required")
  .refine(
    (url) => /^https?:\/\//i.test(url),
    "Only HTTP and HTTPS URLs are supported"
  )
  .refine(
    (url) => {
      try {
        let host = new URL(url).hostname;
        if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
        if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return false;
        return !BLOCKED_HOSTS.test(host);
      }
      catch { return false; }
    },
    "URLs pointing to localhost or private network ranges are not allowed"
  )
  .refine(
    (url) => !url.includes("\n") && !url.includes("\r"),
    "URL must not contain newline characters"
  );

// ─── Zod Schema ─────────────────────────────────────────────────────────────

export const MonitorParamsSchema = z.object({
  url: safeUrl
    .describe("URL to monitor for changes. E.g. a product page, pricing page, or any content page."),
  fields: z.array(z.string().min(1)).max(20).optional()
    .describe("Specific fields to track for changes (e.g. ['price', 'availability', 'rating']). When provided, change detection focuses on these fields. Without fields, tracks full page content hash."),
  format: z.enum(["markdown", "json"]).default("markdown")
    .describe("Output format. 'markdown' (default): human-readable change report. 'json': structured object for programmatic agent use."),
});

export type MonitorParams = z.infer<typeof MonitorParamsSchema>;

export function validateMonitorParams(args: Record<string, unknown> | undefined): MonitorParams {
  return MonitorParamsSchema.parse(args ?? {});
}

// ─── Session-scoped store ───────────────────────────────────────────────────

interface MonitorEntry {
  hash: string;
  fields: Record<string, string>;
  timestamp: string;
  content_preview: string;
  check_count: number;
  checks_since_change: number;
}

const monitorStore = new Map<string, MonitorEntry>();

/**
 * Reset the session-scoped monitor store. Exposed for unit tests only; not
 * part of the public MCP tool surface. The store resets automatically on
 * server restart (session-scoped / no durable state).
 */
export function resetMonitorStore(): void {
  monitorStore.clear();
}

// ─── Field extraction helpers ───────────────────────────────────────────────

/** Extract field values from markdown content using simple heading/label matching */
function extractFieldValues(content: string, fields?: string[]): Record<string, string> {
  if (!fields || fields.length === 0) return {};

  const result: Record<string, string> = {};

  for (const field of fields) {
    const fieldLower = field.toLowerCase();

    // Try "field: value" pattern (common in extracted markdown)
    const labelPattern = new RegExp(`(?:^|\\n)\\s*${escapeRegex(field)}\\s*[:=]\\s*(.+)`, "im");
    const labelMatch = content.match(labelPattern);
    if (labelMatch) {
      result[field] = labelMatch[1].trim();
      continue;
    }

    // Try "## Field" heading followed by content
    const headingPattern = new RegExp(`(?:^|\\n)#{1,4}\\s*${escapeRegex(field)}[^\\n]*\\n+([^#\\n][^\\n]*)`, "im");
    const headingMatch = content.match(headingPattern);
    if (headingMatch) {
      result[field] = headingMatch[1].trim();
      continue;
    }

    // Try common price/currency patterns for price-related fields
    if (fieldLower.includes("price") || fieldLower.includes("cost")) {
      const priceMatch = content.match(/[\$\u00A3\u20AC\u00A5]\s*[\d,]+\.?\d*/);
      if (priceMatch) {
        result[field] = priceMatch[0].trim();
        continue;
      }
    }

    result[field] = "(not found)";
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Diff computation ───────────────────────────────────────────────────────

interface FieldDiff {
  field: string;
  previous: string;
  current: string;
  annotation: string;
}

function computeFieldDiffs(
  prevFields: Record<string, string>,
  currFields: Record<string, string>,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const allKeys = new Set([...Object.keys(prevFields), ...Object.keys(currFields)]);

  for (const key of allKeys) {
    const prev = prevFields[key] ?? "(not tracked)";
    const curr = currFields[key] ?? "(not tracked)";
    if (prev !== curr) {
      diffs.push({
        field: key,
        previous: prev,
        current: curr,
        annotation: computeAnnotation(prev, curr),
      });
    }
  }

  return diffs;
}

/** Try to compute a numeric change annotation (e.g. price drop) */
function computeAnnotation(prev: string, curr: string): string {
  const prevNum = parseFloat(prev.replace(/[^0-9.\-]/g, ""));
  const currNum = parseFloat(curr.replace(/[^0-9.\-]/g, ""));

  if (!isNaN(prevNum) && !isNaN(currNum) && prevNum !== 0) {
    const pctChange = ((currNum - prevNum) / Math.abs(prevNum)) * 100;
    const direction = pctChange > 0 ? "\u2191" : "\u2193";
    return `${direction} ${Math.abs(pctChange).toFixed(1)}%`;
  }

  return "changed";
}

// ─── Main function ──────────────────────────────────────────────────────────

export async function novadaMonitor(params: MonitorParams, apiKey?: string): Promise<string> {
  const now = new Date().toISOString();

  // 1. Extract current content via novadaExtract
  let content: string;
  try {
    content = await novadaExtract({
      url: params.url,
      fields: params.fields,
      format: "markdown",
      render: "auto",
    }, apiKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return formatError(params.url, now, redactSecrets(message), params.format);
  }

  // C8 Fix: Detect extraction failure sentinels BEFORE baselining.
  // novadaExtract returns "## Extract Failed" / "## Extraction Error" /
  // "## Browser Mode Unavailable" as a string (not a throw) for certain failure
  // modes (DNS failure, timeout, hosted browser-tier unavailable, etc.).
  // Without this guard, the error string gets hashed and stored as a baseline;
  // a varying error message on the next call falsely reports "changed".
  // Sentinel list is single-sourced in utils/runtime.ts so a future 4th sentinel
  // can't slip through here again.
  if (isExtractionFailureSentinel(content)) {
    // Surface the error text directly. The extraction already formatted a full
    // agent-oriented error block; re-use it rather than duplicating the message.
    const firstLine = content.split("\n").find((l) => l.startsWith("Error:") || l.startsWith("error:")) ?? "";
    const errorMsg = firstLine ? firstLine.replace(/^[Ee]rror:\s*/, "") : "extraction returned a failure sentinel";
    return formatError(params.url, now, redactSecrets(errorMsg), params.format);
  }

  // F5+C7+D1: Strip volatile metadata header AND trailer sections, keeping only the
  // stable page body. stripVolatileMetadataHeader uses a two-pass scan to isolate
  // the body between the last header-side separator and the first trailer heading
  // (## Same-Domain Links / ## Extraction Diagnostics / ## Agent Memory / etc.).
  // This prevents fetched_at, conf: annotations, and Agent Hints from causing false
  // "changed" reports on identical page bodies.
  const cleanContent = stripVolatileMetadataHeader(content);

  // 2. Hash the content (use cleanContent so path changes don't cause false change detection)
  const hash = createHash("sha256").update(cleanContent).digest("hex").slice(0, 16);

  // 3. Extract field values from the content
  const currentFields = extractFieldValues(cleanContent, params.fields);

  // 4. Check previous state
  const prev = monitorStore.get(params.url);

  // 5. Update store
  const checkCount = prev ? prev.check_count + 1 : 1;
  const hasChanged = prev ? prev.hash !== hash : false;
  const checksSinceChange = hasChanged ? 0 : (prev ? prev.checks_since_change + 1 : 0);
  // FIX-1: Store cleanContent (no path header) in preview, then redact any remaining paths.
  const safePreview = redactSecrets(cleanContent.slice(0, 500));

  monitorStore.set(params.url, {
    hash,
    fields: currentFields,
    timestamp: now,
    content_preview: safePreview,
    check_count: checkCount,
    checks_since_change: checksSinceChange,
  });

  // 6. Format response based on state
  if (params.format === "json") {
    return formatJson(params, prev, { hash, fields: currentFields, timestamp: now, content_preview: safePreview, check_count: checkCount, checks_since_change: checksSinceChange });
  }

  if (!prev) {
    return formatFirstCheck(params, hash, now, currentFields, cleanContent);
  }

  if (!hasChanged) {
    return formatNoChange(params, hash, prev.timestamp, now, checksSinceChange, checkCount);
  }

  const fieldDiffs = computeFieldDiffs(prev.fields, currentFields);
  return formatChanged(params, prev, { hash, timestamp: now, fields: currentFields }, fieldDiffs, checkCount);
}

// ─── Output formatters ──────────────────────────────────────────────────────

function formatFirstCheck(
  params: MonitorParams,
  hash: string,
  timestamp: string,
  fields: Record<string, string>,
  content: string,
): string {
  const trackedFields = params.fields?.join(", ") ?? "full page content";
  const fieldBlock = Object.keys(fields).length > 0
    ? [``, `## Tracked Fields`, ...Object.entries(fields).map(([k, v]) => `- ${k}: ${v}`), ``]
    : [];

  return [
    `## Monitor: First Check`,
    `url: ${params.url}`,
    `status: baseline_recorded`,
    `hash: ${hash}`,
    `fields_tracked: ${trackedFields}`,
    `timestamp: ${timestamp}`,
    `session_scoped: true | no_durable_state: baseline is lost when the MCP server restarts`,
    `content_preview: ${content.slice(0, 300).replace(/\n/g, " ")}`,
    ...fieldBlock,
    ``,
    `## Agent Instruction`,
    `agent_status: baseline_set | action: call_again_later_to_detect_changes`,
    `This is the first check for this URL. Call novada_monitor again later to detect changes.`,
    `Note: Session-scoped only — state is not persisted to disk. For durable monitoring, schedule recurring calls from your own job runner and store diffs externally.`,
  ].join("\n");
}

function formatNoChange(
  params: MonitorParams,
  hash: string,
  lastChecked: string,
  currentCheck: string,
  checksSinceChange: number,
  totalChecks: number,
): string {
  return [
    `## Monitor: No Changes`,
    `url: ${params.url}`,
    `status: unchanged`,
    `hash: ${hash}`,
    `last_checked: ${lastChecked}`,
    `current_check: ${currentCheck}`,
    `checks_since_change: ${checksSinceChange}`,
    `total_checks: ${totalChecks}`,
    ``,
    `## Agent Instruction`,
    `agent_status: no_change | action: check_again_later`,
    `No changes detected since last check. Call novada_monitor again later to continue monitoring.`,
  ].join("\n");
}

function formatChanged(
  params: MonitorParams,
  prev: MonitorEntry,
  curr: { hash: string; timestamp: string; fields: Record<string, string> },
  fieldDiffs: FieldDiff[],
  totalChecks: number,
): string {
  const lines = [
    `## Monitor: Changes Detected`,
    `url: ${params.url}`,
    `status: changed`,
    `previous_hash: ${prev.hash} \u2192 current_hash: ${curr.hash}`,
    `previous_check: ${prev.timestamp}`,
    `current_check: ${curr.timestamp}`,
    `total_checks: ${totalChecks}`,
  ];

  if (fieldDiffs.length > 0) {
    lines.push(``, `## Changed Fields`);
    for (const diff of fieldDiffs) {
      lines.push(`- ${diff.field}: ${diff.previous} \u2192 ${diff.current} (${diff.annotation})`);
    }
  } else {
    lines.push(``, `## Content Changed`);
    lines.push(`The page content hash changed but no specific field-level diff was computed.`);
    lines.push(`Previous preview: ${prev.content_preview.slice(0, 200).replace(/\n/g, " ")}`);
  }

  lines.push(
    ``,
    `## Agent Instruction`,
    `agent_status: changes_found | action: process_changes_or_alert_user`,
    `Changes detected on the monitored page. Process the changes above or alert the user.`,
  );

  return lines.join("\n");
}

function formatError(url: string, timestamp: string, message: string, format: "markdown" | "json" = "markdown"): string {
  if (format === "json") {
    return JSON.stringify({
      url,
      status: "error",
      timestamp,
      error: message,
      agent_instruction: "status:error | action: retry_later_or_check_url — failed to extract content from the URL. Check if the URL is accessible, then retry.",
    }, null, 2);
  }
  return [
    `## Monitor: Error`,
    `url: ${url}`,
    `status: error`,
    `timestamp: ${timestamp}`,
    `error: ${message}`,
    ``,
    `## Agent Instruction`,
    `agent_status: error | action: retry_later_or_check_url`,
    `Failed to extract content from the URL. Check if the URL is accessible, then retry.`,
  ].join("\n");
}

function formatJson(
  params: MonitorParams,
  prev: MonitorEntry | undefined,
  curr: MonitorEntry,
): string {
  const hasChanged = prev ? prev.hash !== curr.hash : false;
  const fieldDiffs = prev ? computeFieldDiffs(prev.fields, curr.fields) : [];

  const isFirstCheck = !prev;
  const result: Record<string, unknown> = {
    url: params.url,
    status: isFirstCheck ? "baseline_recorded" : hasChanged ? "changed" : "unchanged",
    current_hash: curr.hash,
    previous_hash: prev?.hash ?? null,
    previous_check: prev?.timestamp ?? null,
    current_check: curr.timestamp,
    total_checks: curr.check_count,
    checks_since_change: curr.checks_since_change,
    fields_tracked: params.fields ?? null,
    current_fields: Object.keys(curr.fields).length > 0 ? curr.fields : null,
    changed_fields: fieldDiffs.length > 0
      ? fieldDiffs.map(d => ({ field: d.field, previous: d.previous, current: d.current, annotation: d.annotation }))
      : null,
    content_preview: curr.content_preview.slice(0, 300),
    // F5-b: Surface session-scoped / non-durable state on first check so agents understand
    // that the baseline is lost on server restart. Subsequent calls omit this field.
    ...(isFirstCheck ? { session_scoped: true, no_durable_state: "Session-scoped only — baseline lost on server restart. Schedule from your own job runner for durable monitoring." } : {}),
    agent_instruction: isFirstCheck
      ? "Baseline recorded. Session-scoped only — no durable state. Call novada_monitor again later to detect changes."
      : hasChanged
        ? "Changes detected. Process the changed_fields or alert the user."
        : "No changes detected. Call novada_monitor again later.",
  };

  return JSON.stringify(result, null, 2);
}
