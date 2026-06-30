import { ZodError } from "zod";

// ─── Error Codes ─────────────────────────────────────────────────────────────

export enum NovadaErrorCode {
  INVALID_API_KEY        = "INVALID_API_KEY",
  RATE_LIMITED           = "RATE_LIMITED",
  URL_UNREACHABLE        = "URL_UNREACHABLE",
  SPA_NO_URLS_FOUND      = "SPA_NO_URLS_FOUND",
  API_DOWN               = "API_DOWN",
  INVALID_PARAMS         = "INVALID_PARAMS",
  PRODUCT_UNAVAILABLE    = "PRODUCT_UNAVAILABLE",
  TASK_NOT_FOUND         = "TASK_NOT_FOUND",
  TASK_PENDING           = "TASK_PENDING",
  SESSION_EXPIRED        = "SESSION_EXPIRED",
  PROXY_AUTH_FAILURE     = "PROXY_AUTH_FAILURE",
  UNKNOWN                = "UNKNOWN",
}

// ─── Failure Classification ──────────────────────────────────────────────────

export type FailureClass = "transient" | "permanent" | "auth" | "quota";

const FAILURE_CLASS: Record<NovadaErrorCode, FailureClass> = {
  [NovadaErrorCode.INVALID_API_KEY]:     "auth",
  [NovadaErrorCode.RATE_LIMITED]:        "quota",
  [NovadaErrorCode.URL_UNREACHABLE]:     "transient",
  [NovadaErrorCode.SPA_NO_URLS_FOUND]:   "permanent",
  [NovadaErrorCode.API_DOWN]:            "transient",
  [NovadaErrorCode.INVALID_PARAMS]:      "permanent",
  [NovadaErrorCode.PRODUCT_UNAVAILABLE]: "permanent",
  [NovadaErrorCode.TASK_NOT_FOUND]:      "permanent",
  [NovadaErrorCode.TASK_PENDING]:        "transient",
  [NovadaErrorCode.SESSION_EXPIRED]:     "permanent",
  [NovadaErrorCode.PROXY_AUTH_FAILURE]:  "auth",
  [NovadaErrorCode.UNKNOWN]:            "permanent",
};

const RETRY_AFTER_MS: Partial<Record<NovadaErrorCode, number>> = {
  [NovadaErrorCode.RATE_LIMITED]:    30000,
  [NovadaErrorCode.URL_UNREACHABLE]: 10000,
  [NovadaErrorCode.API_DOWN]:        30000,
  [NovadaErrorCode.TASK_PENDING]:     5000,
};

// ─── Error Class ─────────────────────────────────────────────────────────────

export class NovadaError extends Error {
  readonly code: NovadaErrorCode;
  readonly agent_instruction: string;
  readonly retryable: boolean;
  /** Optional short reason supplied by callers for INVALID_PARAMS detail. */
  readonly detail?: string;

  constructor(opts: {
    code: NovadaErrorCode;
    message: string;
    agent_instruction: string;
    retryable: boolean;
    detail?: string;
  }) {
    super(opts.message);
    this.name = "NovadaError";
    this.code = opts.code;
    this.agent_instruction = opts.agent_instruction;
    this.retryable = opts.retryable;
    this.detail = opts.detail;
  }

  /** Formats the error as an agent-readable string with failure classification. */
  toAgentString(): string {
    // Sanitize: collapse newlines in message to prevent agent_instruction injection.
    // P0 SECURITY (#2): redact any leaked credentials/internal hosts from the message
    // (a raw upstream string can carry user:pass@host or an internal *.novada.com host).
    const safeMsg = redactSecrets(this.message).replace(/[\r\n]+/g, " ").trim();
    const failureClass = FAILURE_CLASS[this.code];
    const retryAfter = RETRY_AFTER_MS[this.code];
    const lines = [
      `Error [${this.code}]: ${safeMsg}`,
      `failure_class: ${failureClass}`,
      `retry_recommended: ${this.retryable}`,
      ...(this.retryable && retryAfter ? [`retry_after_ms: ${retryAfter}`] : []),
      `agent_instruction: "${this.agent_instruction}"`,
    ];
    if (this.detail) {
      lines.push(`detail: "${redactSecrets(this.detail)}"`);
    }
    // Defense in depth: redact the fully-assembled output so no secret can slip
    // through via any field (agent_instruction templates are static, but cheap insurance).
    return redactSecrets(lines.join("\n"));
  }
}

// ─── agent_instruction Templates ─────────────────────────────────────────────

const INSTRUCTIONS: Record<NovadaErrorCode, string> = {
  [NovadaErrorCode.INVALID_API_KEY]: `\
Your API key is missing or invalid. Do not retry until the key is fixed.

Setup (one-time):
  claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp

Verify the key is active:
  Call novada_health — it will confirm which products are accessible.

Get a key: https://dashboard.novada.com/overview/`,

  [NovadaErrorCode.RATE_LIMITED]: `\
You have hit the Novada API rate limit. This is temporary and retryable.

Action: Wait 30–60 seconds before retrying this tool call.
Strategy: Use exponential backoff for automated retries (delay doubles each attempt).
Avoid: Parallel calls to the same endpoint — serialize them instead.`,

  [NovadaErrorCode.URL_UNREACHABLE]: `\
The target URL could not be reached. This may be temporary.

Action: Verify the URL is publicly accessible (not localhost, not behind auth, not a PDF redirect).
Retry: Yes — try once more after a 10-second wait.
Alternative: Use novada_unblock if the URL is protected by anti-bot measures.`,

  [NovadaErrorCode.SPA_NO_URLS_FOUND]: `\
This site appears to be a JavaScript SPA — static crawling found no URLs.
Do not retry novada_map. Recommended next steps:
1. Use novada_crawl with render="render" to crawl JS-rendered pages.
2. Use novada_unblock with method="render" to fetch rendered HTML directly.
3. Use novada_search with "site:<hostname>" to find indexed subpages.`,

  [NovadaErrorCode.API_DOWN]: `\
The Novada API is temporarily unavailable (5xx or network failure).

Action: Wait 30–60 seconds and retry.
Status: Check https://status.novada.com for ongoing incidents.
Escalate: If unavailable for >5 minutes, contact support@novada.com.`,

  [NovadaErrorCode.INVALID_PARAMS]: `\
One or more parameters are invalid. Correct them and retry.

Common issues:
1. Invalid URL — must start with http:// or https:// (no localhost, no private IPs)
2. Missing required param — check the tool's input schema for required fields
3. Wrong enum value — e.g., render must be 'auto' | 'static' | 'render' | 'browser'
4. Out of range — e.g., num_results must be 1–20; depth must be 1–5
5. String too long — e.g., search query must be < 500 chars

Action: Review the tool description and parameter constraints, then retry.`,

  [NovadaErrorCode.PRODUCT_UNAVAILABLE]: `\
This Novada product is not active on your API key. Three options:

Option 1 — Activate (recommended):
  Visit: https://dashboard.novada.com/overview/products/
  Enable the required product, then retry.

Option 2 — Use an alternative tool:
  novada_search unavailable? Try: novada_research (uses internal search)
  novada_scrape unavailable? Try: novada_extract on the target URL directly
  novada_unblock unavailable? Try: novada_browser with navigate action

Option 3 — Contact support:
  Email: support@novada.com — include your API key prefix and this error code.`,

  [NovadaErrorCode.TASK_NOT_FOUND]: `\
The requested task_id does not exist or has expired.

Action: Verify the task_id was returned from a successful novada_scraper_submit call.
Note: Tasks expire after 24 hours. Re-submit the job if needed.`,

  [NovadaErrorCode.TASK_PENDING]: `\
The scraping task is still in progress. Poll again after a delay.

Action: Wait 5–15 seconds and call novada_scraper_status with the same task_id.
Pattern: Use exponential backoff — poll at 5s, 10s, 20s, 40s intervals.`,

  [NovadaErrorCode.SESSION_EXPIRED]: `\
The browser session has expired. Create a new session.

Action: Remove the session_id param and call novada_browser again to start a fresh session.
Note: Browser sessions expire after 10 minutes of inactivity.`,

  [NovadaErrorCode.PROXY_AUTH_FAILURE]: `\
Proxy authentication failed. Verify your proxy credentials.

Action:
  1. Check NOVADA_PROXY_USER and NOVADA_PROXY_PASS are correctly set.
  2. Call novada_health to confirm proxy credentials are loaded.
  3. Regenerate credentials at https://dashboard.novada.com/overview/proxy/ if expired.`,

  [NovadaErrorCode.UNKNOWN]: `\
An unexpected error occurred.

Action: Check the error message above for clues. If it persists, contact support@novada.com with the full error text.`,
};

// ─── Sanitization ────────────────────────────────────────────────────────────

/**
 * Public Novada hosts that are safe to surface in error text. Any other
 * `*.novada.com` subdomain is treated as an internal endpoint (e.g. the
 * Browser API CDP host `upg-scbr2.novada.com`) and redacted.
 */
const PUBLIC_NOVADA_HOSTS = new Set([
  "novada.com",
  "www.novada.com",
  "dashboard.novada.com",
  "status.novada.com",
  "mcp.novada.com",
  "docs.novada.com",
]);

/**
 * P0 SECURITY (#2): strip secrets that an upstream error can leak in plaintext —
 * URL userinfo (`https://user:pass@host` → `https://host`), the literal
 * NOVADA_BROWSER_WS value, and internal `*.novada.com` host strings that aren't
 * on the public allowlist. Runs on EVERY error message + agent_instruction
 * before it reaches the caller.
 */
export function redactSecrets(msg: string): string {
  let out = msg;

  // 1. Exact NOVADA_BROWSER_WS value (contains user:pass@host) — redact first,
  //    before host-level rules can partially rewrite it.
  const browserWs = process.env.NOVADA_BROWSER_WS?.trim();
  if (browserWs) {
    out = out.split(browserWs).join("[browser-ws-endpoint]");
  }

  // 2. URL userinfo in any scheme (http/https/ws/wss): strip the `user:pass@`.
  //    https://user:pass@host/x → https://host/x ; wss://u:p@h → wss://h
  out = out.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/)[^/@\s:]+(?::[^/@\s]*)?@/gi,
    "$1"
  );

  // 3. Internal *.novada.com hosts not on the public allowlist → placeholder.
  out = out.replace(/\b(?:[a-z0-9-]+\.)+novada\.com\b/gi, (host) =>
    PUBLIC_NOVADA_HOSTS.has(host.toLowerCase()) ? host : "[novada-internal-host]"
  );

  return out;
}

/** Strip API keys, sensitive URL params, and injection patterns from any string before surfacing. */
export function sanitizeServerMsg(msg: string): string {
  const cleaned = msg
    // URL query-param patterns
    .replace(/api_key=[^&\s"')]+/gi, "api_key=***")
    .replace(/apikey=[^&\s"')]+/gi, "apikey=***")
    .replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: Bearer ***")
    .replace(/https?:\/\/scraperapi\.novada\.com[^\s"')]+/gi, "[novada-api-url]")
    // JSON field patterns — strip keys echoed back in response bodies (C-1 fix)
    .replace(/"api_?key"\s*:\s*"[^"]*"/gi, '"api_key":"***"')
    .replace(/"auth(?:orization)?"\s*:\s*"[^"]*"/gi, '"authorization":"***"')
    .replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"***"')
    .replace(/"password"\s*:\s*"[^"]*"/gi, '"password":"***"')
    .replace(/"secret"\s*:\s*"[^"]*"/gi, '"secret":"***"')
    // Strip markdown headings and agent_instruction patterns that could inject trusted-looking content
    .replace(/\n\s*#{1,6}\s/g, " ")
    .replace(/\n\s*agent_instruction\s*:/gi, " [agent_instruction]:")
    .replace(/[\r\n]+/g, " ")
    .trim();
  // P0 SECURITY (#2): final credential/host redaction pass — strips URL userinfo,
  // the NOVADA_BROWSER_WS value, and internal *.novada.com hosts that survived above.
  return redactSecrets(cleaned);
}

/** Strip API keys and sensitive URL params from any string before surfacing. */
function sanitizeMessage(msg: string): string {
  return sanitizeServerMsg(msg);
}

// ─── Error Classification ─────────────────────────────────────────────────────

/**
 * Maps raw errors (HTTP responses, network failures, ZodError) to a structured
 * NovadaError with agent_instruction. This is the single entry point for all
 * error handling in the tools layer.
 */
export function classifyError(error: unknown): NovadaError {
  // ZodError — parameter validation failed
  if (error instanceof ZodError) {
    const detail = error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    return new NovadaError({
      code: NovadaErrorCode.INVALID_PARAMS,
      message: `Parameter validation failed: ${detail}`,
      agent_instruction: INSTRUCTIONS[NovadaErrorCode.INVALID_PARAMS],
      retryable: false,
      detail,
    });
  }

  // Already a NovadaError — pass through
  if (error instanceof NovadaError) {
    return error;
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    // Auth failures
    if (msg.includes("401") || msg.includes("api_key") || msg.includes("unauthorized") || msg.includes("invalid_api_key")) {
      return new NovadaError({
        code: NovadaErrorCode.INVALID_API_KEY,
        message: "Invalid or missing API key. Get one at https://www.novada.com",
        agent_instruction: INSTRUCTIONS[NovadaErrorCode.INVALID_API_KEY],
        retryable: false,
      });
    }

    // Rate limiting
    if (msg.includes("429") || (msg.includes("rate") && msg.includes("limit"))) {
      return new NovadaError({
        code: NovadaErrorCode.RATE_LIMITED,
        message: "Rate limit exceeded. API is throttling your requests.",
        agent_instruction: INSTRUCTIONS[NovadaErrorCode.RATE_LIMITED],
        retryable: true,
      });
    }

    // Product not activated (Novada-specific codes surfaced in error messages)
    if (msg.includes("11006") || msg.includes("product_unavailable") || msg.includes("not activated") || msg.includes("402")) {
      return new NovadaError({
        code: NovadaErrorCode.PRODUCT_UNAVAILABLE,
        message: "Product not activated on your account.",
        agent_instruction: INSTRUCTIONS[NovadaErrorCode.PRODUCT_UNAVAILABLE],
        retryable: false,
      });
    }

    // Task lifecycle errors
    if (msg.includes("task not found") || msg.includes("27404") || msg.includes("task_not_found")) {
      return new NovadaError({
        code: NovadaErrorCode.TASK_NOT_FOUND,
        message: "Task not found or expired.",
        agent_instruction: INSTRUCTIONS[NovadaErrorCode.TASK_NOT_FOUND],
        retryable: false,
      });
    }

    if (msg.includes("27202") || msg.includes("task_pending") || msg.includes("still processing")) {
      return new NovadaError({
        code: NovadaErrorCode.TASK_PENDING,
        message: "Task is still processing.",
        agent_instruction: INSTRUCTIONS[NovadaErrorCode.TASK_PENDING],
        retryable: true,
      });
    }

    // Session expired
    if (msg.includes("session_expired") || msg.includes("session not found") || msg.includes("session expired")) {
      return new NovadaError({
        code: NovadaErrorCode.SESSION_EXPIRED,
        message: "Browser session has expired.",
        agent_instruction: INSTRUCTIONS[NovadaErrorCode.SESSION_EXPIRED],
        retryable: false,
      });
    }

    // Proxy auth failure
    if (msg.includes("407") || msg.includes("proxy_auth") || msg.includes("proxy authentication")) {
      return new NovadaError({
        code: NovadaErrorCode.PROXY_AUTH_FAILURE,
        message: "Proxy authentication failed.",
        agent_instruction: INSTRUCTIONS[NovadaErrorCode.PROXY_AUTH_FAILURE],
        retryable: false,
      });
    }

    // Anti-bot wall (#14): map raw Playwright/CDP/Cloudflare strings to a clear
    // category instead of surfacing internal page text. Goes BEFORE generic
    // network handling so "Just a moment" / 403 challenges aren't misread.
    if (
      msg.includes("cf-challenge") ||
      msg.includes("cf-turnstile") ||
      msg.includes("cf_chl_opt") ||
      msg.includes("just a moment") ||
      msg.includes("access denied") ||
      msg.includes("captcha") ||
      (msg.includes("403") && (msg.includes("forbidden") || msg.includes("blocked")))
    ) {
      return new NovadaError({
        code: NovadaErrorCode.URL_UNREACHABLE,
        message: "Blocked by anti-bot protection (Cloudflare/CAPTCHA challenge).",
        agent_instruction: INSTRUCTIONS[NovadaErrorCode.URL_UNREACHABLE],
        retryable: true,
      });
    }

    // Upstream browser unavailable (#14): CDP/Playwright connection failures —
    // dead WS endpoint, target closed, protocol error. These are an upstream
    // browser-service problem, not a bad URL.
    if (
      msg.includes("connectovercdp") ||
      msg.includes("browser api connection failed") ||
      msg.includes("target closed") ||
      msg.includes("target page, context or browser has been closed") ||
      msg.includes("browser has been closed") ||
      msg.includes("websocket") ||
      msg.includes("protocol error") ||
      msg.includes("browser.newcontext")
    ) {
      return new NovadaError({
        code: NovadaErrorCode.API_DOWN,
        message: "Upstream browser unavailable — the cloud browser could not be reached or the session was closed.",
        agent_instruction: INSTRUCTIONS[NovadaErrorCode.API_DOWN],
        retryable: true,
      });
    }

    // Network / URL unreachable (domain unreachable)
    if (
      msg.includes("timeout") ||
      msg.includes("timed out") ||
      msg.includes("econnrefused") ||
      msg.includes("enotfound") ||
      msg.includes("eai_again") ||
      msg.includes("err_name_not_resolved") ||
      msg.includes("network error") ||
      msg.includes("failed to fetch") ||
      msg.includes("net::err")
    ) {
      return new NovadaError({
        code: NovadaErrorCode.URL_UNREACHABLE,
        message: `Domain unreachable: ${sanitizeMessage(error.message)}`,
        agent_instruction: INSTRUCTIONS[NovadaErrorCode.URL_UNREACHABLE],
        retryable: true,
      });
    }

    // API down (5xx)
    if (msg.includes("503") || msg.includes("502") || msg.includes("500") || msg.includes("api_down")) {
      return new NovadaError({
        code: NovadaErrorCode.API_DOWN,
        message: "Novada API is temporarily unavailable.",
        agent_instruction: INSTRUCTIONS[NovadaErrorCode.API_DOWN],
        retryable: true,
      });
    }
  }

  // Fallback
  const rawMsg = error instanceof Error ? error.message : String(error);
  return new NovadaError({
    code: NovadaErrorCode.UNKNOWN,
    message: sanitizeMessage(rawMsg),
    agent_instruction: INSTRUCTIONS[NovadaErrorCode.UNKNOWN],
    retryable: false,
  });
}

/**
 * Creates a NovadaError for a specific code with a custom message.
 * Convenience factory used by tools that detect error codes from API response bodies.
 */
export function makeNovadaError(
  code: NovadaErrorCode,
  message: string,
  detail?: string
): NovadaError {
  return new NovadaError({
    code,
    message,
    agent_instruction: INSTRUCTIONS[code],
    retryable: [
      NovadaErrorCode.RATE_LIMITED,
      NovadaErrorCode.URL_UNREACHABLE,
      NovadaErrorCode.API_DOWN,
      NovadaErrorCode.TASK_PENDING,
    ].includes(code),
    detail,
  });
}
