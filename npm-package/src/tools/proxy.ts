import type { ProxyParams } from "./types.js";
import { resolveProxyCredentials } from "../utils/credentials.js";
import { novadaProxyStatic } from "./proxy_static.js";
import { novadaProxyDedicated } from "./proxy_dedicated.js";
import {
  assertFlowLedgerActive,
  URL_PROXY_PLANS,
  type LedgerPreflight,
} from "./proxy_preflight.js";
import {
  verifyProxyExit,
  isVerifySupportedRuntime,
  pickProxyListEntry,
  DEFAULT_ECHO_TIMEOUT_MS,
  type ProxyVerifyResult,
  type ProxyVerifyTarget,
  type VerifyFailureClass,
} from "./proxy_verify.js";

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

// ─── F11 ledger + verification evidence (appended to every issued config) ────
//
// F11 CONFIRMED 2026-09-10: a key whose residential_flow ledger showed balance
// 0 (plan expired 2026-07-08) received clean-looking credentials; the gateway
// accepted auth then refused CONNECT with HTTP 402 — visible only as curl exit
// 56. Two-part fix:
//   1. PREFLIGHT (proxy_preflight.ts): before issuing, read the MATCHING
//      product's flow-ledger row (balance + expire_time) via the shared
//      FLOW_BALANCE_ENDPOINTS table — read with the BILLING account's key
//      (HIGH-1: auto-fetched creds carry `billingApiKey`; direct env/SDK creds
//      bill an unknowable account, so nothing is consulted and the response
//      discloses "ledger unknown for the billing account") — and REFUSE
//      (fail-closed, full evidence) on a positive 0/expired/not-provisioned
//      signal. Indeterminate lookups fail open and are DISCLOSED below.
//   2. VERIFY (proxy_verify.ts): after issuing, run exactly ONE IP-echo request
//      through the issued proxy (5s timeout, never inside any retry loop) and
//      put the evidence — exit_ip, org/ASN, country, latency — in the response;
//      on failure still return the config plus a classified
//      verification_failed note (402 payment / 407 auth / timeout / …).

const FAILURE_HINTS: Record<VerifyFailureClass, string> = {
  payment_required:
    `an exhausted/expired plan is the usual cause — check novada_account(section="plans") ` +
    `and top up/renew at ${URL_PROXY_PLANS}.`,
  auth_failed:
    `credentials were rejected — inspect/regenerate sub-accounts via novada_proxy_account_list, ` +
    `or fix NOVADA_PROXY_USER/NOVADA_PROXY_PASS.`,
  timeout:
    `the gateway did not answer within 5s — could be transient; the config may still work. ` +
    `Try it yourself (this tool probes exactly once, never retries).`,
  network_error:
    `the proxy gateway could not be reached from this machine — check NOVADA_PROXY_ENDPOINT ` +
    `and local network egress.`,
  bad_response:
    `the gateway answered, but not with the echo payload — an intermediary may be interfering; ` +
    `try the curl line manually.`,
};

/**
 * Ledger disclosure line. When the preflight was indeterminate the config is
 * still issued (fail-open), but the response must say WHY the ledger is
 * unverified — directly-supplied credentials (env/SDK) bill an account this
 * server cannot identify, so NO ledger is consulted for them (HIGH-1: judging
 * another account's ledger produced wrong-account denials and wrong-account
 * evidence), while auto-fetched credentials imply a known billing key whose
 * ledger lookup happened to fail.
 */
function ledgerDisclosure(ledger: LedgerPreflight | null, credSource: "direct" | "auto_fetched"): string {
  if (!ledger) return `unverified — no ledger information available`;
  if (ledger.status === "active") {
    return (
      `${ledger.label} flow ledger (${ledger.ledger}): active — ` +
      `balance ${ledger.balance_human ?? "n/a"}, expires ${ledger.expires_at ?? "n/a"}`
    );
  }
  // status === "unknown" (expired/exhausted/unavailable never reach here — they throw)
  if (credSource === "direct") {
    return (
      `unverified — ledger unknown for the billing account (credentials were supplied via ` +
      `env/SDK, so the account they bill cannot be read from here; no ledger was consulted)`
    );
  }
  return `unverified — ledger lookup failed (${ledger.detail ?? "no detail"})`;
}

const VERIFY_HEADER =
  `## Verification (one live IP-echo through this proxy — ~1 KB metered traffic, ~1s; disable with verify=false)`;

/**
 * Build the "## Ledger" + "## Verification" evidence block appended to every
 * issued config. Runs the echo probe at most ONCE (opt-out via verify=false;
 * local-stdio runtimes only — hosted runtimes cannot open raw proxied sockets,
 * so the skip is disclosed instead of risking a false negative).
 */
async function buildEvidenceBlock(opts: {
  ledgerLine: string;
  wantVerify: boolean;
  target: ProxyVerifyTarget | null;
  requestedCountry?: string;
}): Promise<string> {
  const lines: string[] = [`## Ledger (plan preflight)`, opts.ledgerLine, ``, VERIFY_HEADER];

  if (!opts.wantVerify) {
    lines.push(`verification: skipped (verify=false — no live check performed)`);
  } else if (!isVerifySupportedRuntime()) {
    lines.push(
      `verification: skipped (hosted runtime — raw proxied connections are unavailable here; ` +
        `run the curl line locally to verify)`,
    );
  } else if (!opts.target) {
    lines.push(`verification: skipped (no verifiable credential entry resolved)`);
  } else {
    // Exactly ONE probe — never retried, never inside a loop.
    let result: ProxyVerifyResult;
    try {
      result = await verifyProxyExit(opts.target, DEFAULT_ECHO_TIMEOUT_MS);
    } catch (err) {
      // verifyProxyExit resolves on every expected path; a throw is a prober
      // bug — verification must never break issuing.
      result = {
        verified: false,
        failure_class: "network_error",
        detail: `prober failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
        latency_ms: 0,
      };
    }
    if (result.verified) {
      lines.push(`status: VERIFIED — the proxy routed a live request`, `exit_ip: ${result.exit_ip}`);
      if (result.org || result.asn) {
        lines.push(`org: ${[result.org, result.asn ? `(${result.asn})` : ""].filter(Boolean).join(" ")}`);
      }
      if (result.country || result.country_code) {
        // ipinfo.io-class echoes report only a 2-letter code (no full name) —
        // render whichever evidence exists.
        const name = result.country ?? result.country_code;
        const code = result.country && result.country_code ? ` (${result.country_code})` : "";
        lines.push(`country: ${name}${code}`);
      }
      lines.push(`latency_ms: ${result.latency_ms}`);
      if (
        opts.requestedCountry &&
        result.country_code &&
        result.country_code.toLowerCase() !== opts.requestedCountry.toLowerCase()
      ) {
        lines.push(
          `warning: exit country ${result.country_code} does not match requested country ` +
            `${opts.requestedCountry} — geo-targeting may not have applied`,
        );
      }
    } else {
      lines.push(
        `status: verification_failed (${result.failure_class})`,
        `detail: ${result.detail}${result.http_status !== undefined ? ` [HTTP ${result.http_status}]` : ""}`,
        `note: the configuration above is still returned — it may not work until the cause is fixed.`,
        `hint: ${FAILURE_HINTS[result.failure_class]}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Return proxy configuration for use in HTTP clients, curl, or shell.
 *
 * Agents use this when they need to make HTTP requests through a residential proxy,
 * bypass geo-restrictions, or maintain IP consistency across a session.
 */
export async function novadaProxy(params: ProxyParams): Promise<string> {
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

  // Verification defaults ON; params.verify is optional in the schema so
  // `undefined` (caller left it unset) means "verify".
  const wantVerify = params.verify !== false;

  // F2: city is silently dropped for static and dedicated — warn the caller.
  const cityWarnings: string[] = [];
  if ((params.type === "static" || params.type === "dedicated") && params.city) {
    cityWarnings.push(
      `city param is not supported for type="${params.type}" — only country + session_id are used (received: "${params.city}")`
    );
  }

  // 0.9.4: static/dedicated are per-IP products with their own credential model —
  // delegate to their specialized handlers instead of the zone-based path.
  // Verification probes the SAME list entry the handler surfaces (the first
  // valid line); when no entry resolves the handler returned a
  // configuration_required message — nothing was issued, nothing to verify.
  if (params.type === "static" || params.type === "dedicated") {
    const result =
      params.type === "static"
        ? await novadaProxyStatic({ country: params.country ?? "us", session_id: params.session_id ?? "default", format: effectiveFormat })
        : await novadaProxyDedicated({ session_id: params.session_id ?? "default", format: effectiveFormat });
    const body = appendCityWarningsAndCurlSnippet(result, cityWarnings, effectiveFormat);
    const entry = pickProxyListEntry(
      params.type === "static" ? process.env.NOVADA_STATIC_PROXY_LIST : process.env.NOVADA_DEDICATED_PROXY_LIST,
    );
    if (!entry) return body;
    const evidence = await buildEvidenceBlock({
      ledgerLine:
        `not applicable — type="${params.type}" is a per-IP product (user-managed credential list), ` +
        `no flow ledger to preflight`,
      wantVerify,
      target: entry,
      requestedCountry: params.type === "static" ? params.country : undefined,
    });
    return `${body}\n\n${evidence}`;
  }
  // INC-198: Use resolveProxyCredentials() which auto-fetches via account API
  // when only NOVADA_PROXY_ENDPOINT is set (no user/pass).
  //
  // Credentials are resolved BEFORE the F11 ledger preflight (HIGH-1): the
  // gate must consult the ledger of the account the issued credentials BILL
  // to, and only resolveProxyCredentials() knows that — `billingApiKey` for
  // auto-fetched creds, unknowable for direct env/SDK creds (which therefore
  // fail open with a disclosure instead of being judged on the wrong account).
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

  // F11: refuse to hand out credentials when the BILLING account's flow ledger
  // positively says the plan cannot route (balance 0 / expired / not
  // provisioned). Table-driven: static/dedicated never reach here (delegated
  // above; no flow ledger row). Direct env/SDK creds bill an unknowable
  // account, so no ledger is consulted and the disclosure below says so;
  // indeterminate lookups fail OPEN — disclosed via ledgerDisclosure().
  const ledger: LedgerPreflight | null = await assertFlowLedgerActive(params.type, proxyCreds); // throws with full evidence on a positive bad signal

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

  // VISIBILITY: probe the REAL issued config — the full username with
  // zone/region/session suffix, against the configured endpoint — exactly once.
  // Credentials go only into the probe's Proxy-Authorization header; the
  // returned evidence contains no credential bytes.
  const evidence = await buildEvidenceBlock({
    ledgerLine: ledgerDisclosure(ledger, proxyCreds.source),
    wantVerify,
    target: {
      host: proxyHost,
      port: proxyPort,
      username: buildProxyUsername(proxyUser, params),
      password: proxyPass,
    },
    requestedCountry: appliedCountry,
  });

  if (effectiveFormat === "env") {
    const formatted = [
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
    return `${formatted}\n\n${evidence}`;
  }

  if (effectiveFormat === "curl") {
    const formatted = [
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
    return `${formatted}\n\n${evidence}`;
  }

  // Default: url format
  const formatted = [
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
  return `${formatted}\n\n${evidence}`;
}
