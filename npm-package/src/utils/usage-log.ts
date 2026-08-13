/**
 * usage-log.ts — local, user-facing usage log for the `novada-mcp` stdio server.
 *
 * WHY: hosted (mcp.novada.com) usage is logged server-side via the gateway, but a user
 * running `npx novada-mcp` locally has no visibility into what their MCP actually did.
 * This writes a small append-only JSONL trail on the user's own machine so they can audit
 * their usage. It is:
 *   - LOCAL ONLY — never sends anything over the network (that's Path A's job, server-side,
 *     via the x-mcp-* request headers on the product-API calls).
 *   - FAIL-SILENT — a logging failure (read-only HOME, disk full, permissions) must NEVER
 *     break a tool call. Every path is wrapped; logUsage rejects nothing.
 *   - SECRET-FREE — the apikey lives in env, never in tool args, and is never written. Only
 *     a short, truncated descriptor of the target is recorded, never full request/response
 *     bodies.
 *
 * Opt-out:  NOVADA_MCP_LOG=off
 * Location: NOVADA_MCP_LOG_DIR overrides the default ~/.novada-mcp/logs
 * Rotation: files older than 7 days are pruned once per process.
 */
import { appendFile, mkdir, readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { redactSecrets } from "../_core/errors.js";

export interface UsageEvent {
  /** The MCP tool name, e.g. "novada_scrape". */
  tool: string;
  status: "success" | "error";
  /** Wall-clock duration of the dispatch, in ms. */
  ms: number;
  /** Short, truncated descriptor of what was acted on (url/keyword/asin/…). Never a secret. */
  target?: string;
  /** Truncated error string, present only on status "error". */
  error?: string;
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TARGET_MAX = 120;
const ERROR_MAX = 200;

/** Descriptor fields we're willing to surface, in priority order. Anything else is ignored so
 *  we never dump arbitrary (possibly large or sensitive) argument blobs into the log. */
const TARGET_KEYS = [
  "url", "urls", "keyword", "query", "q", "search_term", "search_terms",
  "asin", "sku", "domain", "video_id", "profile_url", "post_url", "listing_url", "id",
] as const;

function isDisabled(): boolean {
  return (process.env.NOVADA_MCP_LOG ?? "").trim().toLowerCase() === "off";
}

function logDir(): string {
  const override = process.env.NOVADA_MCP_LOG_DIR?.trim();
  return override && override.length > 0 ? override : join(homedir(), ".novada-mcp", "logs");
}

/**
 * Pull a short, human-useful descriptor from tool args WITHOUT dumping the whole object.
 * Only allowlisted keys are considered; the value is coerced to a string and truncated.
 * Returns undefined when nothing useful is present (e.g. account/discover tools).
 */
export function summarizeTarget(args: unknown): string | undefined {
  // Runs synchronously in the dispatch handler (outside logUsage's try/catch), so it must
  // never throw — wrap the whole body defensively even though JSON-RPC args are plain JSON.
  try {
    if (!args || typeof args !== "object") return undefined;
    const rec = args as Record<string, unknown>;
    for (const key of TARGET_KEYS) {
      const v = rec[key];
      if (v == null) continue;
      if (Array.isArray(v)) {
        if (v.length === 0) continue;
        const first = String(v[0]);
        const suffix = v.length > 1 ? ` (+${v.length - 1} more)` : "";
        return truncate(redactSecrets(first + suffix), TARGET_MAX);
      }
      if (typeof v === "string" || typeof v === "number") {
        const s = String(v).trim();
        if (s.length > 0) return truncate(redactSecrets(s), TARGET_MAX);
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

// Once-per-process prune guard. NOTE: pruneOld() is unit-tested directly; this flag's
// "prune once after the first successful write" wiring runs only in production, not in tests.
let prunedThisProcess = false;

/**
 * Append one usage line to today's local log. Fire-and-forget from the caller (`void logUsage(…)`);
 * it never throws and never rejects. Returns a Promise only so tests can await the write.
 */
export async function logUsage(ev: UsageEvent): Promise<void> {
  // Everything — including isDisabled() — is inside the try so logUsage can NEVER reject.
  // Both call sites use `void logUsage(...)` with no .catch and there is no global
  // unhandledRejection handler, so an escaped rejection would crash the stdio server.
  try {
    if (isDisabled()) return;
    const dir = logDir();
    await mkdir(dir, { recursive: true });

    const now = new Date();
    const line = JSON.stringify({
      ts: now.toISOString(),
      tool: ev.tool,
      ...(ev.target ? { target: ev.target } : {}),
      status: ev.status,
      ms: ev.ms,
      // The raw error can carry proxy creds / NOVADA_BROWSER_WS / local paths — redact before it
      // lands in a log the user may paste into a support ticket. (target is already redacted upstream.)
      ...(ev.error ? { error: truncate(redactSecrets(ev.error), ERROR_MAX) } : {}),
    }) + "\n";

    await appendFile(join(dir, `usage-${now.toISOString().slice(0, 10)}.jsonl`), line, "utf8");

    // Prune stale files once per process, best-effort, after a successful write proves the dir works.
    if (!prunedThisProcess) {
      prunedThisProcess = true;
      void pruneOld(dir);
    }
  } catch {
    // Fail-silent by contract: logging must never break a tool call.
  }
}

/** Delete usage-YYYY-MM-DD.jsonl files older than the retention window. Exported for tests;
 *  in production it's called once per process from logUsage. Best-effort, never throws. */
export async function pruneOld(dir: string): Promise<void> {
  try {
    const cutoff = Date.now() - RETENTION_MS;
    for (const f of await readdir(dir)) {
      const m = /^usage-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (!m) continue;
      const day = Date.parse(m[1]);
      if (Number.isFinite(day) && day < cutoff) {
        await unlink(join(dir, f)).catch(() => {});
      }
    }
  } catch {
    // ignore — pruning is best-effort
  }
}
