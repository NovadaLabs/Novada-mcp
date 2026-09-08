import type { ProxyParams } from "./types.js";
import { resolveProxyCredentials } from "../utils/credentials.js";
import { novadaProxyStatic } from "./proxy_static.js";
import { novadaProxyDedicated } from "./proxy_dedicated.js";
import { novadaPlanBalanceAll } from "./plan_balance_all.js";
import { NovadaError, NovadaErrorCode } from "../_core/errors.js";

/**
 * Build Novada proxy username with targeting options.
 * Novada format: baseUser-zone-res-country-us-city-london-session-abc123
 */
const ZONE_MAP: Record<string, string> = {
  residential: "zone-res",
  isp: "zone-isp",
  mobile: "zone-mob",
  datacenter: "zone-dcp",
  static: "zone-static",
  dedicated: "zone-dedicated",
};

function buildProxyUsername(user: string, params: ProxyParams): string {
  const parts: string[] = [user];
  const zone = ZONE_MAP[params.type];
  if (zone) parts.push(zone);
  if (params.country && params.type !== "isp") parts.push(`region-${params.country.toLowerCase()}`);
  if (params.city) parts.push(`city-${params.city.toLowerCase().replace(/\s+/g, "")}`);
  if (params.session_id) parts.push(`session-${params.session_id}`);
  return parts.join("-");
}

const TYPE_LABELS: Record<string, string> = {
  residential: "Residential proxy (100M+ IPs, best for anti-bot)",
  mobile: "Mobile proxy (4G/5G IPs, best for app automation)",
  isp: "ISP proxy (stable, best for long sessions)",
  datacenter: "Datacenter proxy (fastest, highest volume)",
  static: "Static ISP proxy (dedicated IP, same IP every request)",
  dedicated: "Dedicated datacenter proxy (exclusive IP, not shared)",
};

/**
 * Append city warnings (F2) and a short "as curl:" one-liner (F1) to an
 * already-formatted proxy result string.
 *
 * The curl snippet is ALWAYS appended for "url" and "env" outputs so any user
 * on any device has an immediately usable form. For "curl" outputs the snippet
 * is omitted (the whole response IS the curl command).
 * For static/dedicated the snippet uses a placeholder endpoint since those tools
 * return a masked curl command in their "url" section already; we just append a
 * clean note for env format completeness.
 */
function appendCityWarningsAndCurlSnippet(
  result: string,
  cityWarnings: string[],
  format: "url" | "env" | "curl",
): string {
  const parts: string[] = [result];

  if (cityWarnings.length > 0) {
    // Trailing newline matches the ISP-path warningsBlock format (review MEDIUM-2).
    parts.push(`\n## Warnings\n${JSON.stringify(cityWarnings)}\n`);
  }

  // Append a curl one-liner so every device has an immediately runnable form.
  // Skip for "curl" outputs — they already ARE the curl command.
  if (format !== "curl") {
    parts.push(`\n## as curl:\ncurl --proxy "<PROXY_URL>" https://example.com`);
  }

  return parts.join("");
}

// ─── C-11 fix: expired/unprovisioned-plan entitlement gate ─────────────────
// Finding (C-reliability-live.md, C-11): "novada_proxy hands out ready-to-use
// config for EXPIRED plans with zero warning. type=residential returned
// rotating-proxy config while the same server's account tool shows Residential
// EXPIRED 2026-07-08 / 0.0 MB. Agent wires a dead proxy, fails at connect time
// with no clue." Fix (as recommended by the finding): a cheap entitlement
// cross-check via plan_balance_all — ONE scoped call to the single product in
// question — before handing out credentials that would silently fail at
// connect time.
//
// Scope: only the 4 flow-metered, auto-provisioned zone-based types
// (residential/isp/mobile/datacenter) — these are the ones plan_balance_all
// actually tracks (ALL_PRODUCT_KEYS) and the ones whose credentials come from
// resolveProxyCredentials()'s account-API auto-fetch, which is exactly the
// path the C-11 finding observed. static/dedicated use a DIFFERENT,
// user-managed credential model (NOVADA_STATIC_PROXY_LIST /
// NOVADA_DEDICATED_PROXY_LIST env vars — the user already owns those specific
// IPs by having configured them), so there is no comparable "is this plan
// still active" question to ask for them here.
const FLOW_ENTITLEMENT_TYPES = new Set<ProxyParams["type"]>([
  "residential", "isp", "mobile", "datacenter",
]);

const PLAN_LABELS: Record<string, string> = {
  residential: "Residential",
  isp: "ISP",
  mobile: "Mobile",
  datacenter: "Datacenter",
};

const URL_PROXY_PLANS = "https://dashboard.novada.com/overview/products/";

/**
 * Cap how long the entitlement pre-check is allowed to hold up an otherwise-
 * fast credential-formatting call. plan_balance_all's underlying devApiPost
 * uses a 30s default timeout — too slow to gate a normally-instant tool on. A
 * timeout here degrades to "unknown" (fail OPEN, never fail closed on a slow
 * network) rather than making every proxy call pay up to 30s of latency.
 */
const ENTITLEMENT_CHECK_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const t = setTimeout(() => reject(new Error(`entitlement check timed out after ${ms}ms`)), ms);
      // Never keep the process alive just for this timer.
      (t as unknown as { unref?: () => void }).unref?.();
    }),
  ]);
}

type EntitlementStatus = "active" | "expired" | "unavailable" | "unknown";

/**
 * Check whether the flow-metered plan for `type` is active, using the SAME
 * per-product lookup novada_account section="plans" already exposes (single
 * source of truth — reuses plan_balance_all's expired/unavailable derivation
 * rather than re-implementing the expire_time math here).
 *
 * Fails OPEN by design (returns "unknown", never throws) on anything that
 * ISN'T an explicit expired/not-provisioned signal: no dev-api key configured,
 * network error, malformed response, or a timeout. A diagnostics failure must
 * never break a working credential formatter — this mirrors the codebase's own
 * G-11 precedent (auth fail-open on upstream verification outage).
 */
async function checkPlanEntitlement(type: ProxyParams["type"]): Promise<EntitlementStatus> {
  if (!FLOW_ENTITLEMENT_TYPES.has(type)) return "unknown";
  try {
    const raw = await withTimeout(
      novadaPlanBalanceAll({ products: [type as "residential" | "isp" | "mobile" | "datacenter"] } as never),
      ENTITLEMENT_CHECK_TIMEOUT_MS,
    );
    const parsed = JSON.parse(raw) as {
      per_product?: Record<string, { status?: string; expired?: boolean; unavailable?: boolean }>;
    };
    const entry = parsed?.per_product?.[type];
    if (!entry) return "unknown";
    if (entry.status === "ok" && entry.expired === true) return "expired";
    if (entry.status === "error" && entry.unavailable === true) return "unavailable";
    return "active";
  } catch {
    return "unknown";
  }
}

/**
 * Throws a structured NovadaError (→ isError:true at the MCP dispatch layer)
 * naming the specific plan + the renew URL + an agent_instruction, instead of
 * silently returning working-looking credentials for a dead plan (C-11).
 */
function throwExpiredPlanError(type: ProxyParams["type"], entitlement: "expired" | "unavailable"): never {
  const label = PLAN_LABELS[type] ?? type;
  const reason = entitlement === "expired" ? "EXPIRED" : "not provisioned on this account";
  throw new NovadaError({
    code: NovadaErrorCode.PRODUCT_UNAVAILABLE,
    message: `Your ${label} proxy plan is ${reason} — Novada will not route traffic for it. Returning credentials would silently fail at connect time.`,
    agent_instruction:
      `Do NOT use novada_proxy(type="${type}") right now — the ${label} plan is ${reason.toLowerCase()}, ` +
      `so any credentials returned would fail to connect with no further clue. Tell the user to renew/purchase ` +
      `the ${label} plan at ${URL_PROXY_PLANS}, then retry novada_proxy. To confirm plan status across ALL ` +
      `ledgers (Wallet + every product) before retrying, call novada_account(section="plans").`,
    retryable: false,
    detail: `plan=${label} type=${type} status=${entitlement}`,
  });
}

/**
 * Return proxy configuration for use in HTTP clients, curl, or shell.
 *
 * Agents use this when they need to make HTTP requests through a residential proxy,
 * bypass geo-restrictions, or maintain IP consistency across a session.
 */
export async function novadaProxy(params: ProxyParams): Promise<string> {
  // C-11 fix: refuse to hand out credentials for a plan we can positively
  // confirm is expired or not provisioned. Runs BEFORE the static/dedicated
  // branch checks below (those types are exempt — see FLOW_ENTITLEMENT_TYPES'
  // doc comment) so it only ever gates the auto-provisioned zone-based path.
  if (FLOW_ENTITLEMENT_TYPES.has(params.type)) {
    const entitlement = await checkPlanEntitlement(params.type);
    if (entitlement === "expired" || entitlement === "unavailable") {
      throwExpiredPlanError(params.type, entitlement);
    }
    // "active" or "unknown" (couldn't verify) — proceed. "unknown" is a
    // deliberate fail-open: we only ever BLOCK on a positive signal.
  }

  // F1: On the hosted door (Vercel), when the caller did NOT explicitly pass a
  // format, default to "url" (a single pasteable proxy URL string) rather than
  // whatever the schema default is. Local/stdio callers are unaffected.
  // Note: the ProxyParams type has format optional; when undefined here the
  // caller left it unset — that is the "no explicit format" case.
  const effectiveFormat: "url" | "env" | "curl" = params.format ?? "url";
  // "url" is the universal default — pasteable on any device including phones.
  // If hosted/local defaults ever need to diverge, gate on
  // process.env.VERCEL || process.env.VERCEL_ENV here (review LOW-2 removed the
  // dead ternary that anchored this).

  // F2: city is silently dropped for static and dedicated — warn the caller.
  const cityWarnings: string[] = [];
  if ((params.type === "static" || params.type === "dedicated") && params.city) {
    cityWarnings.push(
      `city param is not supported for type="${params.type}" — only country + session_id are used (received: "${params.city}")`
    );
  }

  // 0.9.4: static/dedicated are per-IP products with their own credential model —
  // delegate to their specialized handlers instead of the zone-based path.
  if (params.type === "static") {
    const result = await novadaProxyStatic({ country: params.country ?? "us", session_id: params.session_id ?? "default", format: effectiveFormat });
    return appendCityWarningsAndCurlSnippet(result, cityWarnings, effectiveFormat);
  }
  if (params.type === "dedicated") {
    const result = await novadaProxyDedicated({ session_id: params.session_id ?? "default", format: effectiveFormat });
    return appendCityWarningsAndCurlSnippet(result, cityWarnings, effectiveFormat);
  }
  // INC-198: Use resolveProxyCredentials() which auto-fetches via account API
  // when only NOVADA_PROXY_ENDPOINT is set (no user/pass).
  const proxyCreds = await resolveProxyCredentials();
  const proxyUser = proxyCreds?.user;
  const proxyPass = proxyCreds?.pass;
  const proxyEndpoint = proxyCreds?.endpoint;

  if (!proxyUser || !proxyPass || !proxyEndpoint) {
    const missing = [
      !proxyUser ? "NOVADA_PROXY_USER" : null,
      !proxyPass ? "NOVADA_PROXY_PASS" : null,
      !proxyEndpoint ? "NOVADA_PROXY_ENDPOINT" : null,
    ].filter(Boolean).join(", ");

    return [
      `## Proxy Configuration`,
      `status: not configured`,
      ``,
      `Missing environment variables: ${missing}`,
      ``,
      `## Setup`,
      `Set these in your environment or MCP config:`,
      `  NOVADA_PROXY_USER=your_proxy_username`,
      `  NOVADA_PROXY_PASS=your_proxy_password`,
      `  NOVADA_PROXY_ENDPOINT=proxy-host:port`,
      ``,
      `Get credentials from: https://dashboard.novada.com → Residential Proxies → Endpoint Generator`,
      ``,
      `## Agent Hints`,
      `- Once configured, this tool returns a proxy URL/config string for use in HTTP requests.`,
      `- For web extraction without managing proxies, use novada_extract or novada_crawl instead.`,
    ].join("\n");
  }

  // M7: never derive the masked username from the REAL value. Novada usernames
  // are structured (baseUser-zone-…) so even a 4-char prefix can reveal the
  // account. Use a fixed placeholder base — the zone/targeting/session suffix
  // comes from the caller's own params, not from the credential. The success
  // path bypasses the error redactor, so this must be leak-safe on its own.
  // The base is a fixed placeholder, so it needs no percent-encoding — keep it
  // human-readable as <PROXY_USER> (matching the Node/axios example below).
  const maskedUsername = buildProxyUsername("<PROXY_USER>", params);
  const encodedMaskedUser = maskedUsername;
  const typeLabel = TYPE_LABELS[params.type] ?? params.type;

  // Only country that buildProxyUsername actually applied should be reported as
  // "targeting" — isp drops country (see buildProxyUsername), so printing it
  // would claim geo-routing that isn't in the username.
  const appliedCountry = params.country && params.type !== "isp" ? params.country : undefined;
  const targetingLine = appliedCountry
    ? `targeting: ${appliedCountry.toUpperCase()}${params.city ? ` / ${params.city}` : ""}`
    : "";

  const warnings: string[] = [];
  if (params.type === "isp" && params.country) {
    warnings.push(`country accepted but not applied on this endpoint — do not rely on geo-routing for type="isp" (received: "${params.country}")`);
  }
  const warningsBlock = warnings.length > 0 ? [`## Warnings`, JSON.stringify(warnings), ``] : [];

  const maskedUrl = `http://${encodedMaskedUser}:***@${proxyEndpoint}`;
  // Shell-safe URL: uses ${NOVADA_PROXY_PASS} literal so credentials are never in tool output
  const proxyUrlShell = `http://${encodedMaskedUser}:\${NOVADA_PROXY_PASS}@${proxyEndpoint}`;
  const endpointParts = proxyEndpoint.split(":");
  const proxyHost = endpointParts[0];
  const proxyPort = endpointParts[1] ? parseInt(endpointParts[1]) : 7777;

  if (effectiveFormat === "env") {
    return [
      `## Proxy Configuration (Shell Environment)`,
      `type: ${typeLabel}`,
      targetingLine,
      params.session_id ? `session: ${params.session_id} (sticky IP)` : "",
      `proxy_url: ${maskedUrl}`,
      ``,
      `# Set NOVADA_PROXY_PASS in your environment first, then copy these lines:`,
      `export HTTP_PROXY="${proxyUrlShell}"`,
      `export HTTPS_PROXY="${proxyUrlShell}"`,
      `export http_proxy="${proxyUrlShell}"`,
      `export https_proxy="${proxyUrlShell}"`,
      ``,
      ...warningsBlock,
      `## Agent Hints`,
      `- Set these env vars before running HTTP requests to route through the proxy.`,
      `- Use session_id for sticky IP across multiple requests in a workflow.`,
      ``,
      `## as curl:`,
      `curl --proxy "${proxyUrlShell}" https://example.com`,
    ].filter(l => l !== "").join("\n");
  }

  if (effectiveFormat === "curl") {
    return [
      `## Proxy Configuration (curl)`,
      `type: ${typeLabel}`,
      `proxy_url: ${maskedUrl}`,
      ``,
      `# Set NOVADA_PROXY_PASS in your environment first:`,
      `curl --proxy "${proxyUrlShell}" <your-url>`,
      ``,
      ...warningsBlock,
      `## Agent Hints`,
      `- Add this flag to any curl command to route through the proxy.`,
      `- For multi-step workflows needing the same IP, add session_id param.`,
    ].join("\n");
  }

  // Default: url format
  return [
    `## Proxy Configuration`,
    `type: ${typeLabel}`,
    targetingLine,
    params.session_id ? `session: ${params.session_id} (sticky IP)` : "session: rotating (new IP per request)",
    `proxy_url: ${maskedUrl}`,
    ``,
    `## Usage Examples`,
    ``,
    `Node.js (axios):`,
    `  proxy: { host: "${proxyHost}", port: ${proxyPort}, auth: { username: "<PROXY_USER>", password: "<NOVADA_PROXY_PASS>" } }`,
    ``,
    `Python (requests):`,
    `  proxies = { "http": "${maskedUrl}", "https": "${maskedUrl}" }`,
    `  # Replace *** with the value of NOVADA_PROXY_PASS`,
    ``,
    ...warningsBlock,
    `## as curl:`,
    `curl --proxy "${proxyUrlShell}" https://example.com`,
    ``,
    `## Agent Hints`,
    `- proxy_url above shows *** for the password — read NOVADA_PROXY_PASS from your environment to complete it.`,
    `- For consistent IP across a workflow, set session_id (e.g. "my-session-1").`,
    `- For web extraction tasks, novada_extract handles proxy routing automatically.`,
  ].filter(l => l !== "").join("\n");
}
