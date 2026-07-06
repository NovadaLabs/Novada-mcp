/**
 * NOV-334: opt-in structured request logging.
 *
 * Logs one JSON line per upstream request to STDERR — never stdout, which carries the
 * MCP JSON-RPC stream and would be corrupted by stray log lines.
 *
 * Silent by default. Enabled only when NOVADA_LOG is set to a level that includes
 * "debug" (case-insensitive): `NOVADA_LOG=debug` or `NOVADA_LOG=trace`. Any other
 * value (or unset) → no output, zero overhead beyond a string compare.
 *
 * Security: the URL and any error text are run through redactSecrets() before they
 * leave the process, so URL userinfo (user:pass@host), the NOVADA_BROWSER_WS value,
 * and internal *.novada.com hosts never appear in logs. We do NOT log headers,
 * request bodies, or API keys at all — only the safe (tool, url, status, ms) tuple.
 */

import { redactSecrets } from "./errors.js";

/** Levels that turn logging on. trace implies debug. */
const DEBUG_LEVELS = new Set(["debug", "trace"]);

/**
 * Read the gate live (not cached at module load) so tests — and operators toggling
 * the env between runs — see the current value. The check is a cheap set lookup.
 */
export function isRequestLogEnabled(): boolean {
  const level = process.env.NOVADA_LOG?.trim().toLowerCase();
  return level !== undefined && DEBUG_LEVELS.has(level);
}

/** Structured fields for a single upstream request. All optional except tool + url. */
export interface RequestLogFields {
  /** Originating MCP tool, e.g. "extract", "search". */
  tool: string;
  /** Target URL (will be redacted before emit). */
  url: string;
  /** HTTP status or upstream result code, when known. */
  status?: number;
  /** Wall-clock duration of the request in milliseconds. */
  ms?: number;
  /** Fetch mode actually used (static/render/browser/...), when relevant. */
  mode?: string;
  /** Short error summary on failure (will be redacted before emit). */
  error?: string;
}

/**
 * Emit one structured request log line to stderr as JSON. No-op unless
 * isRequestLogEnabled(). Best-effort: any failure (e.g. a non-serializable field,
 * stderr write error) is swallowed so logging can never break a request.
 *
 * The emitted object is: { ts, level, msg:"upstream_request", tool, url, ...rest }
 * with `url` and `error` redacted.
 */
export function logRequest(fields: RequestLogFields): void {
  if (!isRequestLogEnabled()) return;
  try {
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: "debug",
      msg: "upstream_request",
      tool: fields.tool,
      url: redactSecrets(fields.url),
    };
    if (fields.status !== undefined) entry.status = fields.status;
    if (fields.ms !== undefined) entry.ms = fields.ms;
    if (fields.mode !== undefined) entry.mode = fields.mode;
    if (fields.error !== undefined) entry.error = redactSecrets(fields.error);
    process.stderr.write(JSON.stringify(entry) + "\n");
  } catch {
    // Logging must never throw into the request path.
  }
}
