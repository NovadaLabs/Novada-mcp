import { ZodError } from "zod";

// ─── Error Codes ─────────────────────────────────────────────────────────────

export enum NovadaErrorCode {
  INVALID_API_KEY        = "INVALID_API_KEY",
  RATE_LIMITED           = "RATE_LIMITED",
  URL_UNREACHABLE        = "URL_UNREACHABLE",
  SPA_NO_URLS_FOUND      = "SPA_NO_URLS_FOUND",
  API_DOWN               = "API_DOWN",
  WRONG_TARGET           = "WRONG_TARGET",
  INVALID_PARAMS         = "INVALID_PARAMS",
  PRODUCT_UNAVAILABLE    = "PRODUCT_UNAVAILABLE",
  /** B1 (2026-09-21): upstream business code 11004 ("Insufficient balance") —
   *  the product IS active but its ledger has no funds. Distinct from
   *  PRODUCT_UNAVAILABLE (not activated / not provisioned): the fix is a
   *  top-up, not activation. Permanent + non-retryable: retrying cannot
   *  succeed until the ledger is funded. Mirrors the proxy preflight's
   *  reference shape (proxy_preflight.ts assertFlowLedgerActive). */
  INSUFFICIENT_BALANCE   = "INSUFFICIENT_BALANCE",
  TASK_NOT_FOUND         = "TASK_NOT_FOUND",
  TASK_PENDING           = "TASK_PENDING",
  SESSION_EXPIRED        = "SESSION_EXPIRED",
  PROXY_AUTH_FAILURE     = "PROXY_AUTH_FAILURE",
  /** F15 (2026-09-10 audit): the fetch succeeded but OUR readability/Turndown parse
   *  pass crashed on the page's markup (e.g. amazon.com/dp/B0CX23V2ZK → raw
   *  "TypeError: … reading 'parentNode'"). Permanent for this page+parser — retrying
   *  the same call re-runs the same crashing parser; format="html" bypasses it. */
  PARSE_FAILED           = "PARSE_FAILED",
  /** Round 3 (S1-connector, 2026-10-13): a request that received NO HTTP response at
   *  all before its own client-side deadline elapsed (axios ECONNABORTED / a message
   *  matching /timeout/i) — distinct from API_DOWN (an explicit 5xx/error response WAS
   *  received) and from a generic network failure (DNS/ECONNREFUSED — also API_DOWN).
   *  Transient + retryable: the message names exactly how long the caller waited and,
   *  when a task_id already exists, that resuming with it (not re-submitting) is safe
   *  and does not incur a new charge. */
  TIMEOUT                = "TIMEOUT",
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
  [NovadaErrorCode.WRONG_TARGET]:        "permanent",
  [NovadaErrorCode.INVALID_PARAMS]:      "permanent",
  [NovadaErrorCode.PRODUCT_UNAVAILABLE]: "permanent",
  // "permanent" (not "quota") deliberately: matches the proxy preflight's
  // PRODUCT_UNAVAILABLE reference shape so a balance failure classifies
  // identically no matter which tool surfaced it (the B1 class invariant).
  [NovadaErrorCode.INSUFFICIENT_BALANCE]: "permanent",
  [NovadaErrorCode.TASK_NOT_FOUND]:      "permanent",
  [NovadaErrorCode.TASK_PENDING]:        "transient",
  [NovadaErrorCode.SESSION_EXPIRED]:     "permanent",
  [NovadaErrorCode.PROXY_AUTH_FAILURE]:  "auth",
  [NovadaErrorCode.PARSE_FAILED]:        "permanent",
  [NovadaErrorCode.TIMEOUT]:             "transient",
  [NovadaErrorCode.UNKNOWN]:            "permanent",
};

const RETRY_AFTER_MS: Partial<Record<NovadaErrorCode, number>> = {
  [NovadaErrorCode.RATE_LIMITED]:    30000,
  [NovadaErrorCode.URL_UNREACHABLE]: 10000,
  [NovadaErrorCode.API_DOWN]:        30000,
  [NovadaErrorCode.TASK_PENDING]:     5000,
  [NovadaErrorCode.TIMEOUT]:          10000,
};

// ─── Error Class ─────────────────────────────────────────────────────────────

export class NovadaError extends Error {
  readonly code: NovadaErrorCode;
  readonly agent_instruction: string;
  readonly retryable: boolean;
  /** Optional short reason supplied by callers for INVALID_PARAMS detail. */
  readonly detail?: string;
  /**
   * Raw upstream business `code` from a developer-api envelope (e.g. `11009` =
   * "product not provisioned" for flow-balance endpoints), when known. Lets
   * callers classify on the STRUCTURED code instead of parsing `message` —
   * see plan_balance_all.ts's `isUnavailable` check, which keys off this field
   * (plus the pre-existing HTTP-404 message literal) instead of guessing from
   * upstream prose that can vary per endpoint/locale.
   */
  readonly businessCode?: number;

  constructor(opts: {
    code: NovadaErrorCode;
    message: string;
    agent_instruction: string;
    retryable: boolean;
    detail?: string;
    businessCode?: number;
  }) {
    super(opts.message);
    this.name = "NovadaError";
    this.code = opts.code;
    this.agent_instruction = opts.agent_instruction;
    this.retryable = opts.retryable;
    this.detail = opts.detail;
    this.businessCode = opts.businessCode;
  }

  /** Formats the error as an agent-readable string with failure classification. */
  toAgentString(): string {
    // Sanitize: collapse newlines (ALL Unicode line-terminator variants — see
    // ANY_LINE_TERMINATORS_RE's comment) to prevent agent_instruction injection.
    // P0 SECURITY (#2): redact any leaked credentials/internal hosts from the message
    // (a raw upstream string can carry user:pass@host or an internal *.novada.com host).
    const safeMsg = redactSecrets(this.message).replace(ANY_LINE_TERMINATORS_RE, " ").trim();
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

// ─── AggregateError Summarization ────────────────────────────────────────────

/** Max number of distinct causes surfaced from an AggregateError summary. */
const AGGREGATE_CAUSE_LIMIT = 3;
/** Max length (chars) of each individual cause snippet in an aggregate-error summary. */
const AGGREGATE_CAUSE_MAX_CHARS = 120;

/**
 * FIX-A (2026-07-30, agent-first extract error path): `Promise.any()` escalation
 * ladders (e.g. extract.ts's direct-fetch-vs-proxy race) reject with a bare
 * `AggregateError` whose default `.message` is the literal string
 * "All promises were rejected" — an implementation detail with zero actionable
 * content for an agent (live field report: extracting cell.com surfaced this raw
 * string verbatim and the caller guessed "可能是限流" out of nowhere).
 *
 * This maps that AggregateError to a summary of its DISTINCT underlying causes
 * (first `AGGREGATE_CAUSE_LIMIT`, each truncated to `AGGREGATE_CAUSE_MAX_CHARS`
 * chars) so the caller has something to act on instead of nothing.
 *
 * Defensive by design (Worker Done-Definition #1 — a cause-summarizer that itself
 * throws must never mask the original error): every step is wrapped so any failure
 * here degrades to `null`, letting the caller fall back to the untouched original
 * error message.
 */
export function summarizeAggregateError(err: unknown): { message: string; causes: string[] } | null {
  try {
    const isAggregate =
      (typeof AggregateError !== "undefined" && err instanceof AggregateError) ||
      (typeof err === "object" && err !== null && "errors" in err && Array.isArray((err as { errors?: unknown }).errors));
    if (!isAggregate) return null;

    const rawErrors = (err as { errors: unknown[] }).errors;
    if (!Array.isArray(rawErrors) || rawErrors.length === 0) return null;

    const toCause = (e: unknown): string => {
      const s = e instanceof Error ? e.message : String(e);
      const oneLine = s.replace(ANY_LINE_TERMINATORS_RE, " ").trim();
      return oneLine.length > AGGREGATE_CAUSE_MAX_CHARS
        ? oneLine.slice(0, AGGREGATE_CAUSE_MAX_CHARS - 1) + "…"
        : oneLine;
    };

    const seen = new Set<string>();
    const causes: string[] = [];
    for (const e of rawErrors) {
      const cause = toCause(e);
      if (cause && !seen.has(cause)) {
        seen.add(cause);
        causes.push(cause);
        if (causes.length >= AGGREGATE_CAUSE_LIMIT) break;
      }
    }
    if (causes.length === 0) return null;

    const message = `All ${rawErrors.length} fetch strategies failed: ${causes.join("; ")}`;
    return { message, causes };
  } catch {
    return null;
  }
}

// ─── Fetch-failure escalation classification (F2, 2026-11-18 reliability fix) ──
//
// render="auto" already escalates static→render→browser when a fetch SUCCEEDS
// but returns bad CONTENT (bot-challenge / JS-heavy — see extract.ts). It did
// NOT escalate when the fetch itself FAILS at the HTTP/network level — a 403 on
// both the direct and proxy legs just propagated straight to the caller in <1s
// (2026-11-18 layer-study.md Cluster 2: apnews.com, congress.gov, zeit.de,
// nowsecure.nl all gave up this way while render="render" rescued half of them).
//
// Class table, not a one-site check: a status/network-error CLASS that means
// "this request was actively blocked, a retry via a different fetch path might
// get through" escalates; a class that means "this resource genuinely doesn't
// exist / isn't authorized for anyone" does not — retrying via render would
// waste 10-50s to reproduce the same verdict.
export const BLOCK_CLASS_STATUSES: ReadonlySet<number> = new Set([
  403, 429, 503,
  520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530, // Cloudflare edge errors
]);
export const NOT_ESCALATE_STATUSES: ReadonlySet<number> = new Set([400, 401, 404, 410]);

/** Network-level error signatures (no HTTP status at all) that mean "the
 *  connection itself was interfered with" — same escalate-worthy class as a
 *  403/503, just surfaced by the transport instead of the server. */
const BLOCK_CLASS_NETWORK_PATTERNS = [
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ECONNABORTED/i,
  /\btimeout\b/i,
  /\bEOF\b/i, // "unexpected eof while reading" — TLS-fingerprint rejection (layer-study §3)
  /socket hang up/i,
];

/** Extracts every distinct HTTP status code present in `err` — including inside
 *  an AggregateError's `.errors` list (the direct+proxy race in extract.ts's
 *  "auto" mode rejects with one of these once BOTH legs fail). Returns an empty
 *  array when no status is present anywhere (e.g. a pure network error). */
function collectStatuses(err: unknown): number[] {
  const statuses: number[] = [];
  const visit = (e: unknown) => {
    // Duck-typed rather than `instanceof AxiosError`: any object carrying a
    // `.response.status` (the shape axios errors — real AxiosError instances
    // AND any equivalent mock/wrapper used in tests — always expose) is
    // accepted. instanceof is brittle across module-mock boundaries (vitest's
    // axios automock) and would silently classify nothing as block-class.
    const status = (e as { response?: { status?: unknown } })?.response?.status;
    if (typeof status === "number") statuses.push(status);
    const errs = (e as { errors?: unknown[] })?.errors;
    if (Array.isArray(errs)) errs.forEach(visit);
  };
  visit(err);
  return statuses;
}

/** True when `err` matches one of the network-level block-class patterns above,
 *  checking every leg of an AggregateError (same recursive shape as collectStatuses). */
function matchesBlockClassNetworkPattern(err: unknown): boolean {
  const visit = (e: unknown): boolean => {
    const msg = e instanceof Error ? `${e.message} ${(e as NodeJS.ErrnoException).code ?? ""}` : String(e);
    if (BLOCK_CLASS_NETWORK_PATTERNS.some((re) => re.test(msg))) return true;
    const errs = (e as { errors?: unknown[] })?.errors;
    return Array.isArray(errs) ? errs.some(visit) : false;
  };
  return visit(err);
}

/**
 * F2 discriminator: should a static/proxy fetch failure in render="auto" mode
 * escalate to the render (Web Unblocker) tier, or fail as today?
 *
 * - ANY leg's status in BLOCK_CLASS_STATUSES, or any leg matching a block-class
 *   network pattern → escalate (the block might not apply to a different fetch path).
 * - No block-class signal anywhere, and at least one leg's status is in
 *   NOT_ESCALATE_STATUSES (genuinely missing/unauthorized) → do not escalate.
 * - No status at all and no recognized network pattern (unclassified) → do not
 *   escalate, matching today's behavior — this function only ADDS escalation
 *   cases it has positive evidence for, it never removes the existing floor.
 */
export function isBlockClassFetchFailure(err: unknown): boolean {
  if (matchesBlockClassNetworkPattern(err)) return true;
  const statuses = collectStatuses(err);
  return statuses.some((s) => BLOCK_CLASS_STATUSES.has(s));
}

// ─── Honest-failure detection (F3, 2026-11-18 reliability fix; H1 fix round 2) ─
//
// Many tools signal failure by RETURNING a normally-shaped string whose text
// happens to describe a failure, instead of throwing — e.g. extract.ts returns
// "## Extract Failed" / "## Browser Mode Unavailable" text from a successful
// async function call. The MCP dispatch choke points (npm-package/src/index.ts,
// hosted-server/vercel/api/mcp.ts) already set `isError: true` at every CATCH
// site; this closes the other gap — a non-throwing result whose text IS the
// failure. 2026-11-18 layer-study.md: 7 of 24 AWS-research tool calls were
// exactly this shape (failure body, isError:false), which is why the problem
// was invisible to both telemetry and the agent's own retry logic.
//
// H1 (independent review, round 2): the FIRST version of this detector used a
// word-boundary regex (`\b(?:Failed|Error|Unavailable)\b`) over the whole first
// line. That is unsafe: several tools' SUCCESS header interpolates caller input
// into that SAME first line — research.ts:1266 `` `## Research: ${args.topic}` ``
// (every research call, success AND failure, starts with this), ai_monitor.ts
// `` `## Brand Presence on AI-Company Domains — ${brand}` ``. A topic/brand
// containing the word "error" or "failed" (e.g. "common React error boundary
// patterns") flipped a fully successful result to isError:true. Caller-supplied
// text (topic, query, url, brand) must NEVER be inspected by this detector.
//
// Fix: two signals, NEITHER of which can carry caller text —
//  1. PRIMARY — the `agent_instruction: status:X` marker every formatter emits.
//     Verified (by reading every site, not assumed) that every `status:` token
//     in the codebase is a fixed string literal or a ternary between fixed
//     string literals (`status:failed`, `status:${hasMaterial?"success":"partial"}`,
//     `status:search_unavailable`, `status:browser_unavailable_on_runtime`,
//     `error: invalid_params`, ...) — never string-interpolated from a tool
//     param. grep `status:` across npm-package/src/tools/*.ts to re-verify if a
//     new tool is added; a hit that is NOT one of these fixed enumerable tokens
//     means this invariant has been violated and this comment is now stale.
//  2. SECONDARY — an EXACT, closed table of formatter-owned header strings
//     (FAILURE_HEADER_LITERALS below), matched by whole-line EQUALITY against
//     the trimmed first line — never a substring/word-boundary scan over
//     arbitrary interpolated content. Enumerated by grepping every literal
//     `` `## X` `` string under npm-package/src/tools/*.ts and keeping only the
//     ones that are TRUE fixed literals (no `${...}` interpolation anywhere in
//     that header line) and that a tool returns ONLY on genuine failure. A
//     header that interpolates caller input (`## Research: ${topic}`, `##
//     Brand Presence on AI-Company Domains — ${brand}`) is deliberately
//     EXCLUDED from this table — such a header can never prove failure on its
//     own text, by construction, regardless of what the caller's input says.
// "## Research Incomplete" / "## Verify Incomplete" ARE included — pure fixed
// literals, no interpolation — but are genuine zero-material failures (same
// `status:*_failed`/`status:*unavailable` family as their siblings), distinct
// from the real partial-success shape (`` `## Research: ${topic}` `` with
// `status:partial`), which is excluded by never being in this table at all.
// H1 round-3 (independent review): this table must be COMPLETE, not just the
// literals this fix wave happened to touch first. Completeness is enforced by
// tests/_core/failure-envelope-coverage.test.ts, which statically scans every
// `npm-package/src/tools/*.ts` file for any markdown-heading string literal
// containing a failure word and asserts it is classified HERE or in
// NON_FAILURE_HEADER_ALLOWLIST below — an unclassified new heading fails CI.
// Do not add a heading to this file without also running that test.
export const FAILURE_HEADER_LITERALS: ReadonlySet<string> = new Set([
  "## Extract Failed",
  "## Extraction Error",
  "## Browser Mode Unavailable",
  "## Search Unavailable",
  "## Invalid Parameter — engine",
  "## Research Unavailable",
  "## Research Incomplete",
  "## Verify Unavailable",
  "## Verify Incomplete",
  // Round 3 (independent review): missed in rounds 1-2 — caught by the
  // completeness scanner, not manual re-reading.
  "## Browser Flow — API Error",       // browser_flow.ts:356
  "## Browser Flow — Endpoint Unavailable", // browser_flow.ts:374
  "## Monitor: Error",                 // monitor.ts:631
  // Round 4 (independent review): the WORD-LIST scanner itself was the bug —
  // these two headings contain no trigger word ("Not Configured" / "Missing
  // Dependency" are not in Error|Failed|Unavailable|Incomplete|Invalid|
  // Refused|Denied) so they were never even candidates. Caught only once the
  // scanner was replaced with EXHAUSTIVE classification (every heading in
  // tools/** must appear in FAILURE_HEADER_LITERALS or SUCCESS_OR_NEUTRAL_HEADERS
  // — no keyword filter decides what counts as "a candidate").
  "## Browser API — Not Configured",       // browser.ts:125 — no NOVADA_BROWSER_WS/auto-provision; terminal
  "## Browser API — Missing Dependency",   // browser.ts:149 — playwright-core not installed; terminal
]);

/**
 * EXHAUSTIVE classification (round 4, independent review) of every OTHER
 * markdown heading a tools/** formatter can emit — i.e. every heading NOT in
 * FAILURE_HEADER_LITERALS. Built from a recursive, comment-aware static scan
 * of npm-package/src/tools/** (tests/consistency/failure-envelope-coverage.test.ts
 * runs the SAME scan every CI invocation — not a one-time manual pass) that
 * found 219 non-comment heading-literal occurrences, 104 distinct strings, 14
 * of which are real failures (now in FAILURE_HEADER_LITERALS above). This map
 * covers the other 90 distinct strings (reduced to 83 keys after prefix
 * collapsing — see keyOf() below).
 *
 * Replaces round 1-3's keyword-filtered approach (`Error|Failed|Unavailable|
 * Incomplete|Invalid|Refused|Denied`) entirely — that filter was itself the
 * bug: "## Browser API — Not Configured" / "## Browser API — Missing
 * Dependency" (browser.ts) are real, currently-shipping failures that contain
 * NONE of those words, so they were never even candidates for review. There
 * is no keyword list in this round's design — every heading found by the scan
 * must be in exactly one of the two tables, full stop.
 *
 * Key shape: a non-interpolated heading is keyed by its exact trimmed text. A
 * heading containing `${` is keyed by keyOf()'s fixed prefix — the substring
 * before the first `${`, computed identically by the runtime-irrelevant
 * static scanner and documented here so a human reviewer can see what each
 * entry actually covers. Several visually-different headings legitimately
 * reduce to the same short prefix (`"## "`, `"### "`, `"### ["` — e.g. every
 * `### [${idx}] ...` numbered-item sub-heading across crawl.ts/extract.ts/
 * research.ts) — that is fine: the prefix itself contains no failure word by
 * construction, so the key's classification holds regardless of which
 * specific call site produced it; the test file's header documents each
 * collapsed group so a reviewer can still see what was merged.
 *
 * Reason column: most entries are structural sub-headings (used as a LATER
 * line inside an already-classified body, never alone) or static section
 * titles never used on a failure path — tagged "structural" for brevity.
 * Entries that could plausibly look ambiguous get a real, specific reason.
 */
export const SUCCESS_OR_NEUTRAL_HEADERS: ReadonlyMap<string, string> = new Map([
  // ── Structural sub-headings (appear as a LATER line inside an already-
  // classified success/neutral/failure body; never used alone as the first
  // line, never the sole signal of outcome) ──
  ["## Agent Action", "structural sub-heading"],
  ["## Agent Hints", "structural sub-heading"],
  ["## Agent Instruction", "structural sub-heading"],
  ["## Agent Memory", "structural sub-heading"],
  ["## agent_instruction", "structural sub-heading (lowercase proxy_*.ts variant)"],
  ["## as curl:", "structural sub-heading (proxy.ts curl-snippet label)"],
  ["## Changed Fields", "structural sub-heading (monitor.ts change-detected body)"],
  ["## Chainable Output", "structural sub-heading"],
  ["## Content Changed", "structural sub-heading (monitor.ts change-detected body)"],
  ["## Extraction Diagnostics", "structural sub-heading"],
  ["## Fields Summary", "structural sub-heading"],
  ["## Key Findings", "structural sub-heading (research.ts success body)"],
  ["## Ledger (plan preflight)", "structural sub-heading (proxy.ts)"],
  ["## Requested Fields", "structural sub-heading"],
  ["## Requested Fields (none resolved)", "structural sub-heading — zero-match is a field-level diagnostic, not a tool failure"],
  ["## Same-Domain Links (", "structural sub-heading, interpolated count — prefix-keyed"],
  ["## Links (", "structural sub-heading, interpolated count — prefix-keyed"],
  ["## Setup", "structural sub-heading (proxy.ts config instructions)"],
  ["## Sources", "structural sub-heading (research.ts success body)"],
  ["## Sources matching a negation of the claim (", "structural sub-heading (verify.ts), interpolated count — prefix-keyed"],
  ["## Sources matching the claim wording (", "structural sub-heading (verify.ts), interpolated count — prefix-keyed"],
  ["## Structured Data", "structural sub-heading"],
  ["## Summary", "structural sub-heading (ai_monitor.ts)"],
  ["## Tracked Fields", "structural sub-heading (monitor.ts)"],
  ["## Usage Examples", "structural sub-heading"],
  ["## Verification (one live IP-echo through this proxy — ~1 KB metered traffic, ~1s; disable with verify=false)", "structural sub-heading (proxy.ts verification section label, not a verdict)"],
  ["## Warnings", "structural sub-heading"],
  ["## Why This Happens", "structural sub-heading (used inside browser.ts/runtime.ts's OWN already-classified failure messages — explanatory, not a second signal)"],
  ["# ", "structural sub-heading, interpolated — prefix-keyed (site_copy.ts page titles)"],
  ["# Add this flag to any curl command — replace *** with $NOVADA_PROXY_PASS:", "structural sub-heading (proxy_*.ts curl instructions)"],
  ["# Replace *** with your proxy password", "structural sub-heading (proxy_*.ts curl instructions)"],
  ["# Set NOVADA_PROXY_PASS in your environment first, then copy these lines:", "structural sub-heading (proxy.ts shell-env instructions)"],
  ["# Set NOVADA_PROXY_PASS in your environment first:", "structural sub-heading (proxy_*.ts shell-env instructions)"],
  ["### ", "structural sub-heading, interpolated — prefix-keyed (ai_monitor.ts per-model/discover.ts per-category sub-sections)"],
  ["### Action ", "structural sub-heading, interpolated — prefix-keyed (browser.ts/browser_flow.ts per-action result line)"],
  ["### Pages (first ", "structural sub-heading, interpolated — prefix-keyed (site_copy.ts)"],
  ["### Recent calls (last ", "structural sub-heading, interpolated — prefix-keyed (session_stats.ts)"],
  ["### [", "structural sub-heading, interpolated — prefix-keyed (numbered-item sub-heading shared by crawl.ts/extract.ts (x2)/research.ts)"],

  // ── Top-level SUCCESS headers (first line of a genuinely successful result) ──
  ["## Active Browser Sessions", "success — novada_browser list-sessions result"],
  ["## Batch Extract Results", "success — extract.ts batch mode"],
  ["## Batch Extract Results (Full)", "success — extract.ts batch mode, full detail"],
  ["## Browser Flow Results", "success — browser_flow.ts completed run"],
  ["## Browser Session Results", "success — novada_browser completed run"],
  ["## Claim Verification", "success — verify.ts completed verdict"],
  ["## Crawl Results", "success — crawl.ts completed run"],
  ["## Extracted Content", "success — extract.ts's one success header, used by all 3 formatter call sites"],
  ["## Monitor: Changes Detected", "success — monitor.ts: this check ran and found a real content change; not a failure"],
  ["## Monitor: First Check", "success — monitor.ts: baseline established; not a failure"],
  ["## Monitor: No Changes", "success — monitor.ts: this check ran cleanly and found nothing changed; not a failure"],
  ["## Next Steps", "success — search.ts result-footer section"],
  ["## Scrape Results", "success — scrape.ts completed run (6 call sites, same literal)"],
  ["## Search Results", "success — search.ts completed run"],
  ["## Session Closed", "success — novada_browser session-close confirmation"],
  ["## Site Copy", "success — site_copy.ts in-progress/summary section"],
  ["## Site Copy Complete", "success — site_copy.ts completed run"],
  ["## Site Map", "success — map.ts completed run (also used by the SPA_NO_URLS_FOUND notice below — same header, deliberately: see Agent Notice — Under-delivery)"],

  // ── Account/proxy config cards — informational displays, never a pass/fail
  // verdict on their own (account.ts, proxy*.ts) ──
  ["## Wallet Balance\\n\\n**", "informational card (account.ts renderBalanceCard) — single-line template packing \\n escapes, prefix-keyed up to the first interpolation"],
  ["## Proxy Configuration", "informational card — proxy credentials/usage display, not a verdict"],
  ["## Proxy Configuration (Shell Environment)", "informational card — proxy credentials display"],
  ["## Proxy Configuration (curl)", "informational card — proxy credentials display"],
  ["## Datacenter Proxy Configuration", "informational card — proxy_datacenter.ts"],
  ["## Datacenter Proxy Configuration (Shell Environment)", "informational card — proxy_datacenter.ts"],
  ["## Datacenter Proxy Configuration (curl)", "informational card — proxy_datacenter.ts"],
  ["## Dedicated Proxy Configuration", "informational card — proxy_dedicated.ts"],
  ["## Dedicated Proxy Configuration (Shell Environment)", "informational card — proxy_dedicated.ts"],
  ["## Dedicated Proxy Configuration (curl)", "informational card — proxy_dedicated.ts"],
  ["## ISP Proxy Configuration", "informational card — proxy_isp.ts"],
  ["## ISP Proxy Configuration (Shell Environment)", "informational card — proxy_isp.ts"],
  ["## ISP Proxy Configuration (curl)", "informational card — proxy_isp.ts"],
  ["## Mobile Proxy Configuration", "informational card — proxy_mobile.ts"],
  ["## Mobile Proxy Configuration (Shell Environment)", "informational card — proxy_mobile.ts"],
  ["## Mobile Proxy Configuration (curl)", "informational card — proxy_mobile.ts"],
  ["## Residential Proxy Configuration", "informational card — proxy_residential.ts"],
  ["## Residential Proxy Configuration (Shell Environment)", "informational card — proxy_residential.ts"],
  ["## Residential Proxy Configuration (curl)", "informational card — proxy_residential.ts"],
  ["## Static Proxy Configuration", "informational card — proxy_static.ts"],
  ["## Static Proxy Configuration (Shell Environment)", "informational card — proxy_static.ts"],
  ["## Static Proxy Configuration (curl)", "informational card — proxy_static.ts"],

  // ── AMBIGUOUS — reviewed explicitly, reason is load-bearing ──
  [
    "## Agent Notice — Under-delivery",
    "AMBIGUOUS, reviewed: map.ts's own comment at the call site states this is " +
    "\"surfaced as a friendly agent message (not an error block) so the tool " +
    "always returns a successful string response\" when a crawl/SPA page found " +
    "no additional URLs — an explicit design decision that under-delivery vs. " +
    "the requested URL count is informational (with next-step guidance), not a " +
    "tool failure. Shares the same preceding \"## Site Map\" success header.",
  ],
  [
    "## Brand Presence on AI-Company Domains — ",
    "AMBIGUOUS, reviewed: ai_monitor.ts's header interpolates the caller's brand " +
    "(prefix-keyed, so brand text itself is never inspected). Per-query failures " +
    "are folded into an aggregate sentiment:\"not_found\" entry inside this SAME " +
    "success-shaped report (never a standalone failure return) — same partial-" +
    "success pattern as novada_research's status:partial.",
  ],
  [
    "## Research: ",
    "AMBIGUOUS, reviewed: research.ts's real first-line header for EVERY outcome " +
    "except the two standalone total-failure headers already in " +
    "FAILURE_HEADER_LITERALS (## Research Unavailable / ## Research Incomplete). " +
    "Interpolates the caller's topic (prefix-keyed — topic text is never " +
    "inspected). Success/partial is distinguished later in the body by " +
    "status:success vs status:partial (FAILURE_STATUS_RE deliberately excludes " +
    "status:partial).",
  ],
  [
    "## Researched source material for: ",
    "AMBIGUOUS, reviewed: research.ts mid-body section heading for the SAME " +
    "success/partial result as \"## Research: \" above (never appears on a " +
    "standalone-failure path) — interpolates the caller's topic, prefix-keyed.",
  ],
  [
    "## ",
    "AMBIGUOUS, reviewed: bare \"## \" prefix shared by 3 interpolated headings " +
    "with near-zero fixed text before the first ${} — discover.ts's per-platform " +
    "operations section (`## ${platform} — Scraper Operations`, always success: " +
    "listing operations for a known platform) and search.ts's 2 per-result " +
    "title lines (`## ${i+1}. ...`, always success: one of N found results, " +
    "never emitted on a failed search — search's own failure path returns " +
    "## Search Unavailable before any results are rendered).",
  ],
]);

/** Classification key for a heading: the full trimmed text for a literal
 *  heading, or the fixed substring before the first `${` for an interpolated
 *  one — identical function used by the completeness scanner
 *  (tests/consistency/failure-envelope-coverage.test.ts) so this file's
 *  documentation and the enforced CI check can never drift apart. */
export function headingClassificationKey(heading: string): string {
  const i = heading.indexOf("${");
  return i === -1 ? heading : heading.slice(0, i);
}

/** Marks a non-"## heading" failure signal some tools use instead/in addition
 *  (e.g. "agent_instruction: status:failed", "status:browser_unavailable_on_runtime",
 *  "status:search_unavailable"). Deliberately does NOT match "status:success" or
 *  the many other non-failure status tokens (status:no_content is advisory, not
 *  matched here — it is attached to results that already carry real content).
 *  Safe against caller-text injection: see the verified invariant above — every
 *  token this can match is a fixed string literal in the codebase, never
 *  interpolated from params.topic/params.query/params.url/etc. */
export const FAILURE_STATUS_RE = /agent_instruction:\s*status:\s*(?:failed|[a-z0-9_]*unavailable|[a-z0-9_]*_failed)\b/i;

/**
 * Round 3 (independent review) — `agent_status:` is a SEPARATE, sibling
 * convention to `agent_instruction: status:X` (monitor.ts, verify.ts use it
 * alongside, not instead of, the one above). Verified by reading every
 * `agent_status:` site in npm-package/src/tools/*.ts: the value is always a
 * fixed string literal — `baseline_set` / `no_change` / `changes_found`
 * (success, monitor.ts) vs `error` (failure, monitor.ts) / `search_unavailable`
 * / `search_temporarily_failed` (failure, verify.ts) — never interpolated from
 * a tool param. `error` is matched as a whole token (not a substring) so it
 * can never accidentally match inside a longer success-shaped identifier. */
export const FAILURE_AGENT_STATUS_RE = /\bagent_status:\s*(?:error|[a-z0-9_]*unavailable|[a-z0-9_]*_failed)\b/i;

/**
 * True when `text` (a tool's returned result, NOT a thrown error) is itself a
 * failure envelope per the class above. Checked ONLY against structured
 * markers emitted by the tools' own formatters — never a loose keyword scan
 * over the whole body or an arbitrary interpolated line, which would
 * false-positive on legitimate content/caller-text that happens to contain
 * "error"/"failed"/"unavailable".
 */
export function looksLikeFailureEnvelope(text: unknown): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  const firstLine = (text.slice(0, 200).split("\n", 1)[0] ?? "").trimEnd();
  if (FAILURE_HEADER_LITERALS.has(firstLine)) return true;
  return FAILURE_STATUS_RE.test(text) || FAILURE_AGENT_STATUS_RE.test(text);
}

// ─── agent_instruction Templates ─────────────────────────────────────────────

const INSTRUCTIONS: Record<NovadaErrorCode, string> = {
  [NovadaErrorCode.INVALID_API_KEY]: `\
Your API key is missing or invalid. Do not retry until the key is fixed.

Setup (one-time):
  claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp

Verify the key is active:
  Call novada_account section="summary" — it will confirm which products are accessible.

Get a key: https://dashboard.novada.com/api-key/`,

  [NovadaErrorCode.RATE_LIMITED]: `\
You have hit the Novada API rate limit. This is temporary and retryable.

Action: Wait 30–60 seconds before retrying this tool call.
Strategy: Use exponential backoff for automated retries (delay doubles each attempt).
Avoid: Parallel calls to the same endpoint — serialize them instead.`,

  [NovadaErrorCode.URL_UNREACHABLE]: `\
The target URL could not be reached. This may be temporary.

Action: Verify the URL is publicly accessible (not localhost, not behind auth, not a PDF redirect).
Retry: Yes — try once more after a 10-second wait.
Alternative: Use novada_extract with render="render" (or render="browser") if the URL is protected by anti-bot measures.`,

  [NovadaErrorCode.SPA_NO_URLS_FOUND]: `\
This site appears to be a JavaScript SPA — static crawling found no URLs.
Do not retry novada_map. Recommended next steps:
1. Use novada_crawl with render="render" to crawl JS-rendered pages.
2. Use novada_extract with render="render" (or format="html") to fetch rendered content directly.
3. Use novada_search with "site:<hostname>" to find indexed subpages.`,

  [NovadaErrorCode.API_DOWN]: `\
The Novada backend couldn't complete this request. This is on Novada's side — not your request, your parameters, or your API key.

Action: Retry ONCE. If it fails again, this data source is temporarily under maintenance (a known backend issue we're actively fixing) — stop retrying, it won't succeed by trying harder.
Meanwhile: to read a page directly, use novada_extract on the URL; for a web query, use novada_search or novada_research.
Status: https://status.novada.com · Still down after a while? support@novada.com.`,

  [NovadaErrorCode.WRONG_TARGET]: `\
The backend returned data for a DIFFERENT item than you requested — a data-integrity mismatch on Novada's side, not a problem with your request.

Action: Do NOT use these records. Do NOT blindly retry — a retry may return the same wrong item.
Alternative: read the exact target directly with novada_extract on the URL.
This has been logged for the Novada team to investigate.`,

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
  novada_extract blocked by anti-bot? Try: render="browser" (or novada_browser with navigate action)

Option 3 — Contact support:
  Email: support@novada.com — include your API key prefix and this error code.`,

  [NovadaErrorCode.INSUFFICIENT_BALANCE]: `\
Your Novada balance for this product's ledger is insufficient — the upstream refused the request. Do NOT retry: this is a billing state, not a transient failure; retrying cannot succeed until the balance is topped up.

Action:
  1. Top up at https://dashboard.novada.com — note that Wallet and Capture are SEPARATE ledgers: novada_search / novada_scrape / render escalation bill the Capture ledger, so a funded Wallet alone does not unblock them.
  2. Verify per-product balances with novada_account(section="plans").
  3. Retry the original call only after the matching ledger shows a positive balance.`,

  [NovadaErrorCode.TASK_NOT_FOUND]: `\
The requested task_id does not exist or has expired.

Action: Use novada_scrape — it runs synchronously and returns results directly, with no task_id to track or poll.
Note: The async submit/status/result flow is no longer required; novada_scrape replaces it.`,

  [NovadaErrorCode.TASK_PENDING]: `\
The operation is still in progress.

Action: Wait 5–15 seconds, then retry the same tool call.
Note: novada_scrape runs synchronously and returns results directly — there is no separate status/result poll step.`,

  [NovadaErrorCode.SESSION_EXPIRED]: `\
The browser session has expired. Create a new session.

Action: Remove the session_id param and call novada_browser again to start a fresh session.
Note: Browser sessions expire after 10 minutes of inactivity.`,

  [NovadaErrorCode.PROXY_AUTH_FAILURE]: `\
Proxy authentication failed. Verify your proxy credentials.

Action:
  1. Check NOVADA_PROXY_USER and NOVADA_PROXY_PASS are correctly set.
  2. Call novada_account section="summary" to confirm proxy credentials are loaded.
  3. Regenerate credentials at https://dashboard.novada.com/overview/proxy/ if expired.`,

  [NovadaErrorCode.PARSE_FAILED]: `\
The page was fetched successfully but its HTML crashed the content parser (readability/markdown pass).
Do not retry the same call — the parser will crash on the same markup again. Changing render mode does not help: the failure is in parsing, not access.

Action: Retry with format="html" to get the raw page HTML (bypasses the parser) and extract what you need from it directly.
Alternative: For catalog platforms (amazon, github, tiktok, ...), use the matching novada_scrape operation for structured data.`,

  [NovadaErrorCode.UNKNOWN]: `\
An unexpected error occurred.

Action: Check the error message above for clues. If it persists, contact support@novada.com with the full error text.`,

  [NovadaErrorCode.TIMEOUT]: `\
The request to the Novada backend did not receive a response before its own deadline elapsed — this is a
client-side timeout, not an explicit error from the server. The message above states exactly how long the
caller waited for which phase (submit vs poll).

Action: If no task_id was returned (a submit-phase timeout), nothing was created or charged — simply retry
the same call. If a task_id IS already known (a poll-phase timeout, or one from an earlier response), resume
with that task_id instead of re-submitting — this skips a new billable task and is the faster path to a result.`,
};

// ─── Sanitization ────────────────────────────────────────────────────────────

/**
 * Review round 1 (2026-07-30, CRITICAL — live-verified over stdio, and LIVE in
 * prod on mcp.novada.com v0.9.32 today): every newline-handling pattern in this
 * file used to match ONLY `\r`/`\n` (`[\r\n]`). ECMA-262 (11.5) treats FOUR
 * characters as line terminators for `^`/`$` under a regex's `/m` flag: `\n`
 * (U+000A), `\r` (U+000D), U+2028 (LINE SEPARATOR), and U+2029 (PARAGRAPH
 * SEPARATOR). An attacker-controlled string containing a bare U+2028/U+2029
 * followed by `agent_instruction: "..."` sailed straight through every `[\r\n]`
 * pattern below unmodified — while this repo's OWN agent_instruction
 * extraction convention (`/^\s*agent_instruction\s*:\s*(.+)$/im`) DOES treat
 * U+2028/U+2029 as a line boundary in JS.
 *
 * WHO IS ACTUALLY EXPOSED (corrected 2026-07-30 by security review — an earlier
 * draft of this comment cited contract-test.py as a vulnerable consumer, which
 * is WRONG): Python's `re` under `(?im)` treats ONLY bare `\n` as a `^`/`$`
 * boundary — not `\r`, not U+2028/U+2029 — so contract-test.py was never at
 * risk from these variants, and our own harness therefore could not have caught
 * this. The exposed consumers are DOWNSTREAM JS/TS MCP clients (i.e. most real
 * agent runtimes, including the ones we ship this package for), which follow
 * ECMA-262 line-terminator semantics. Do not weaken this collapse on the
 * grounds that "our tests don't need it" — our tests are not the threat model.
 * Net effect: a forged "line" could masquerade as the FIRST line-anchored
 * agent_instruction match, ahead of the real one appended after it.
 *
 * Realistic exploit path (not merely theoretical): an agent scrapes an
 * untrusted page, passes a URL/param sourced from that page into a tool call,
 * the tool's error path echoes that string back (as scrape.ts, extract error
 * paths, and the resources/index.ts fix above all do) — the page's author now
 * controls a fake "agent_instruction:" line that lands in the calling agent's
 * context ahead of the genuine one.
 *
 * Fix: every pattern that used to test/replace `[\r\n]` (or a bare `\n`) now
 * uses this shared, named Unicode-aware line-terminator class instead of a
 * private ad-hoc regex — one definition, so a future newline-handling addition
 * to this file can reuse it correctly instead of re-introducing the ASCII-only
 * gap.
 */
// Exported (not just module-local) so any OTHER file that sanitizes untrusted
// text before it can reach a trust boundary reuses the SAME character class
// instead of re-defining its own ASCII-only one (see verify.ts's sanitizeClaim
// for the sibling fix that reuses this).
export const LINE_TERMINATOR_CHARS = "\\r\\n\\u2028\\u2029";
/** Matches ANY run of Unicode line-terminator characters (see comment above). */
const ANY_LINE_TERMINATORS_RE = new RegExp(`[${LINE_TERMINATOR_CHARS}]+`, "g");
/** Matches a single Unicode line terminator immediately before a markdown heading marker (`#`..`######`). */
const HEADING_INJECTION_RE = new RegExp(`[${LINE_TERMINATOR_CHARS}]\\s*#{1,6}\\s`, "g");
/** Matches a single Unicode line terminator immediately before the literal `agent_instruction:` token — the exact injection this sanitizer exists to defeat. */
const AGENT_INSTRUCTION_INJECTION_RE = new RegExp(`[${LINE_TERMINATOR_CHARS}]\\s*agent_instruction\\s*:`, "gi");

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
 * NOVADA_BROWSER_WS value, internal `*.novada.com` host strings not on the public
 * allowlist, proxy usernames (Novada format patterns), and local filesystem paths
 * (/Users/…, /home/…). Runs on EVERY error message + agent_instruction before it
 * reaches the caller.
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

  // 4. Proxy usernames: Novada format patterns like `customer-x-zone-res`,
  //    `user-xyz-zone-isp`, or any `*-zone-(res|isp|mob|dcp|static|dedicated)` token.
  out = out.replace(
    /\b[a-zA-Z0-9_-]+-zone-(?:res|isp|mob|dcp|static|dedicated)\S*/g,
    "[proxy-username]"
  );

  // 5. Local filesystem paths: /Users/… and /home/… — strip to avoid leaking
  //    the operator's username or directory structure in error messages.
  out = out.replace(/\/(?:Users|home)\/[^\s"')]+/g, "[local-path]");

  // 6. Prose-format credentials: "Account: value", "Password：value", etc.
  //    Matches both ASCII colon (:) and full-width colon (U+FF1A ：) so that
  //    non-ASCII API error messages (e.g. Chinese proxy responses) are also covered.
  //    Keywords: Account, Password, Passwd, Pwd, User, Username (case-insensitive).
  out = out.replace(
    /(Account|Password|Passwd|Pwd|User(?:name)?)\s*[:：]\s*\S+/gi,
    "$1: ***"
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
    // DONE-DEFINITION (account-tools-redaction, 2026-10-30): the SUCCESS path
    // masks the username half of a dial-credential pair via maskCredentials
    // (account/username/user_name -> "<PROXY_USER>"). An error path that ever
    // echoes a JSON-shaped `"account":"..."` fragment back in its message (e.g.
    // a future duplicate-account error) must not leak it either.
    .replace(/"account"\s*:\s*"[^"]*"/gi, '"account":"<PROXY_USER>"')
    .replace(/"username"\s*:\s*"[^"]*"/gi, '"username":"<PROXY_USER>"')
    .replace(/"user_name"\s*:\s*"[^"]*"/gi, '"user_name":"<PROXY_USER>"')
    // Strip markdown headings and agent_instruction patterns that could inject trusted-looking
    // content — Unicode-aware (U+2028/U+2029 count too; see ANY_LINE_TERMINATORS_RE's comment).
    .replace(HEADING_INJECTION_RE, " ")
    .replace(AGENT_INSTRUCTION_INJECTION_RE, " [agent_instruction]:")
    .replace(ANY_LINE_TERMINATORS_RE, " ")
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

    // Unknown tool name (core.ts's dispatch() default case). The message
    // itself already lists every valid tool name, class-derived from the
    // live registry (F-5) — give a crisp, specific instruction instead of
    // falling through to the generic UNKNOWN template below.
    if (msg.includes("unknown tool:")) {
      return new NovadaError({
        code: NovadaErrorCode.INVALID_PARAMS,
        message: sanitizeMessage(error.message),
        agent_instruction:
          "The tool name is wrong. Call novada_discover to see every valid tool name, " +
          "or pick one from the 'Available:' list already in this error's message, then retry.",
        retryable: false,
      });
    }

    // Auth failures
    if (msg.includes("401") || msg.includes("api_key") || msg.includes("unauthorized") || msg.includes("invalid_api_key")) {
      return new NovadaError({
        code: NovadaErrorCode.INVALID_API_KEY,
        message: "Invalid or missing API key. Get one at https://novada.com",
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

    // Proxy auth failure. "authorizationerror" / "account or password verification failed" (Fix C;
    // phrase narrowed 2026-09-21 correctness gate — the bare "account or password" substring
    // false-positived on benign page prose and MCP selector params, so it must be the full
    // gateway phrase; the real CDP error still matches via BOTH this phrase and "authorizationerror".
    // 2026-09-21): the Novada Browser API gateway rejects bad CDP credentials
    // with "AuthorizationError: Account or Password verification failed" — on a
    // CAPABLE runtime that is a genuine credential failure and must classify
    // here (this block runs BEFORE the connectovercdp/API_DOWN block below, so
    // the auth signal wins over the generic CDP-transport match). The
    // serverless transport FALSE-positive that used to produce the same string
    // never reaches classifyError anymore — browser.ts's runtime guard returns
    // before attempting the connection.
    if (
      msg.includes("407") ||
      msg.includes("proxy_auth") ||
      msg.includes("proxy authentication") ||
      msg.includes("authorizationerror") ||
      msg.includes("account or password verification failed")
    ) {
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

// ─── Upstream business-code classification (B1, 2026-09-21) ──────────────────
//
// THE upstream-envelope `code` → taxonomy table — the single source of truth
// for every tool whose generic fallback used to `throw new Error(...)` on a
// non-zero envelope code (scrape.ts submit + download poll, search.ts submit,
// browser_flow.ts). Before this table, `code 11004` ("Insufficient balance")
// was classified THREE different ways: UNKNOWN/"contact support" (scrape),
// transient/retryable (search), and a plain formatted string (browser_flow) —
// while the proxy preflight correctly refused with PRODUCT_UNAVAILABLE +
// ledger evidence + a top-up instruction (the reference shape).
//
// CLASS-shaped on purpose: a future upstream code is a new ROW here — never a
// new branch in a tool file. Rows are ONLY codes whose meaning is verified
// GLOBALLY consistent across endpoints (each row cites its evidence).
//
// Deliberately EXCLUDED (endpoint-ambiguous — the same number means different
// things per endpoint, so a global row would misclassify somewhere):
//   10000 — browser_flow: auth failure; scrape download poll: "result not yet
//           available" (keep polling).
//   10001 — search submit: invalid/missing API key; scrape submit: missing
//           required params; scrape download poll: file-type limitation.
//   11008 — scrape submit: unknown platform (scrape.ts handles it locally with
//           a scrape-specific message BEFORE consulting this table).
// Endpoint-specific codes stay handled at their call site, BEFORE the shared
// fallback consults this table.
export const BUSINESS_CODE_MAP: ReadonlyArray<{
  code: number;
  error: NovadaErrorCode;
  /** Verified meaning + where it was confirmed. */
  meaning: string;
}> = [
  // Live-confirmed 2026-09: scraper/search/browser_flow envelopes return
  // {code:11004, msg:"Insufficient balance"} when the funding ledger is empty.
  { code: 11004, error: NovadaErrorCode.INSUFFICIENT_BALANCE, meaning: "Insufficient balance on the product's funding ledger" },
  // scrape.ts submit handler + classifyError's prose pattern both already
  // treated 11006 as not-activated.
  { code: 11006, error: NovadaErrorCode.PRODUCT_UNAVAILABLE, meaning: "Product not activated on this account" },
  // plan_balance_all.ts isNotProvisioned(): 11009 = "Failed to obtain user
  // information" — plan not provisioned (live-captured 2026-08).
  { code: 11009, error: NovadaErrorCode.PRODUCT_UNAVAILABLE, meaning: "Product not provisioned for this account" },
  // scrape.ts + browser_flow.ts errorMessages maps and developer_api.ts's
  // non-retry auth set all agree: 11000 = invalid API key.
  { code: 11000, error: NovadaErrorCode.INVALID_API_KEY, meaning: "Invalid API key" },
  // scrape.ts + search.ts both map 5000x to auth errors returned as HTTP 200.
  { code: 50001, error: NovadaErrorCode.INVALID_API_KEY, meaning: "Scraper API auth error" },
  { code: 50002, error: NovadaErrorCode.INVALID_API_KEY, meaning: "Scraper API auth error" },
  { code: 50003, error: NovadaErrorCode.INVALID_API_KEY, meaning: "Scraper API auth error" },
  // scrape.ts + search.ts both map envelope code 500 to a transient server error.
  { code: 500, error: NovadaErrorCode.API_DOWN, meaning: "Upstream server error" },
];

/**
 * Classify a raw upstream envelope `code` (optionally with its `msg`) through
 * BUSINESS_CODE_MAP. Structural code match wins; the ONLY prose fallback is the
 * insufficient-balance signal (so a balance refusal surfaced under a new/renamed
 * code still lands in the right class instead of UNKNOWN). Returns
 * NovadaErrorCode.UNKNOWN for anything unmapped — callers keep their existing
 * generic fallback for that case, so this function never squashes an
 * endpoint-specific classification that classifyError's prose pass would have
 * produced.
 */
export function classifyBusinessCode(code: number, msg?: string): NovadaErrorCode {
  const row = BUSINESS_CODE_MAP.find((r) => r.code === code);
  if (row) return row.error;
  if (msg && /insufficient\s+balance/i.test(msg)) return NovadaErrorCode.INSUFFICIENT_BALANCE;
  return NovadaErrorCode.UNKNOWN;
}

// ─── Business code 10000 ("serp capture failed" / "result data not exist") ──
//
// Round 3 (S1-connector, item 3, live-verified 2026-10-13): novada_scrape_yandex
// with yandex_domain="yandex.com" fails 3/3 live with upstream code 10000 ("serp
// capture failed"), while yandex.ru/yandex.com.tr succeed in ~3s on the SAME
// query. Code 10000 is not yandex-specific (the catalog already uses the same
// code for non-search platforms, e.g. "code=10000 result data not exist —
// extractor broken") and is NOT in BUSINESS_CODE_MAP above because its right
// agent_instruction differs by WHICH platform/engine hit it — a flat single
// message would either be too vague (generic platforms) or omit the one
// concrete, verified fix that exists for yandex (switch regional TLD).
//
// Class rule (not a yandex.com special case in BEHAVIOR): every scraper
// platform that can submit a request gets *some* actionable hint for code
// 10000 from this ONE table, keyed by the catalog platform domain
// (submitScrapeTask's `scraper_name` / submitSearchScrapeTask's `scraperName`).
// Only the yandex.com ROW happens to carry a more specific, verified fix —
// adding a 17th platform needs a new row here (or falls through to the
// default), never a new `if` branch at either call site.
const SERP_CAPTURE_FAILED_HINTS: Readonly<Record<string, string>> = {
  "yandex.com": "retry with a regional yandex_domain param (e.g. \"yandex.ru\" or \"yandex.com.tr\", both verified working) instead of \"yandex.com\", which is the variant most likely to fail SERP capture",
  "google.com": "retry once; if it persists, try a different country param — this is usually a transient regional capture issue, not a bad query",
  "bing.com": "retry once; if it persists, try a different country param",
  "duckduckgo.com": "retry once; if it persists, try a different region (kl) param",
};
const DEFAULT_SERP_CAPTURE_FAILED_HINT =
  "retry once; if it persists, try a different country/region param for this platform, or try novada_extract as an alternative";

/**
 * Per-platform agent_instruction hint for upstream business code 10000. See the
 * table's doc comment above for the class rule this implements.
 */
export function serpCaptureFailedHint(scraperDomain: string): string {
  return SERP_CAPTURE_FAILED_HINTS[scraperDomain] ?? DEFAULT_SERP_CAPTURE_FAILED_HINT;
}

/**
 * Creates a NovadaError for a specific code with a custom message.
 * Convenience factory used by tools that detect error codes from API response bodies.
 * `businessCode` optionally preserves the raw upstream developer-api envelope
 * `code` (e.g. 11009) so callers can classify structurally — see NovadaError.businessCode.
 */
export function makeNovadaError(
  code: NovadaErrorCode,
  message: string,
  detail?: string,
  businessCode?: number,
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
      NovadaErrorCode.TIMEOUT,
    ].includes(code),
    detail,
    businessCode,
  });
}
