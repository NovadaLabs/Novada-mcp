import { z } from "zod";
import { getProxyCredentials } from "../utils/credentials.js";
import { makeNovadaError, NovadaErrorCode } from "../_core/errors.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

export const ProxyDatacenterParamsSchema = z.object({
  url: z.string().optional()
    .describe("Optional target URL. When provided, returns config scoped for that URL. Omit for generic proxy credentials."),
  country: z.string()
    .regex(/^[a-zA-Z]{2}$/, "country must be a 2-letter ISO code (e.g. 'us', 'gb', 'de')")
    .optional()
    .describe("ISO 2-letter country code for geo-targeting (e.g. 'us', 'de'). Optional — omit for any country."),
  session_id: z.string()
    .max(64)
    .regex(/^[a-zA-Z0-9_\-]+$/, "session_id must be alphanumeric, hyphens, or underscores only")
    .optional()
    .describe("Session ID for sticky datacenter IP routing. Use for multi-step workflows requiring consistent IP."),
  format: z.enum(["url", "env", "curl"]).default("url")
    .describe("Output format. 'url': proxy URL string (default). 'env': shell export commands. 'curl': curl --proxy flag."),
});

export type ProxyDatacenterParams = z.infer<typeof ProxyDatacenterParamsSchema>;

export function validateProxyDatacenterParams(args: Record<string, unknown> | undefined): ProxyDatacenterParams {
  return ProxyDatacenterParamsSchema.parse(args ?? {});
}

// ─── Username Builder ─────────────────────────────────────────────────────────

function buildDatacenterUsername(user: string, params: ProxyDatacenterParams): string {
  const parts: string[] = [user];
  // Datacenter rotating zone
  parts.push("zone-dcp");
  if (params.country) parts.push(`region-${params.country.toLowerCase()}`);
  if (params.session_id) parts.push(`session-${params.session_id}`);
  return parts.join("-");
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

/**
 * Return datacenter proxy configuration for use in HTTP clients.
 *
 * Datacenter proxies are the fastest and most cost-effective option.
 * Best for high-volume scraping of targets without aggressive anti-bot protection
 * (APIs, public data feeds, non-protected pages).
 */
export async function novadaProxyDatacenter(params: ProxyDatacenterParams): Promise<string> {
  const proxyCreds = getProxyCredentials();

  if (!proxyCreds) {
    const missing = [
      !process.env.NOVADA_PROXY_USER ? "NOVADA_PROXY_USER" : null,
      !process.env.NOVADA_PROXY_PASS ? "NOVADA_PROXY_PASS" : null,
      !process.env.NOVADA_PROXY_ENDPOINT ? "NOVADA_PROXY_ENDPOINT" : null,
    ].filter(Boolean).join(", ");

    return makeNovadaError(
      NovadaErrorCode.PROXY_AUTH_FAILURE,
      `Proxy credentials not configured. Missing: ${missing}`,
      `Set NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT environment variables. Get credentials from: https://dashboard.novada.com → Residential Proxies → Endpoint Generator`
    ).toAgentString();
  }

  const { user, pass, endpoint } = proxyCreds;
  const username = buildDatacenterUsername(user, params);
  const encodedUser = encodeURIComponent(username);
  const encodedPass = encodeURIComponent(pass);
  const maskedUrl = `http://${encodedUser}:***@${endpoint}`;
  const endpointParts = endpoint.split(":");
  const proxyHost = endpointParts[0];
  const proxyPort = endpointParts[1] ? parseInt(endpointParts[1]) : 7777;

  const targeting = params.country ? params.country.toUpperCase() : "Any country (rotating)";

  if (params.format === "env") {
    return [
      `## Datacenter Proxy Configuration (Shell Environment)`,
      `zone: datacenter`,
      `targeting: ${targeting}`,
      params.session_id ? `session: ${params.session_id} (sticky IP)` : `session: rotating (new IP per request)`,
      `proxy_url: ${maskedUrl}`,
      ``,
      `export NOVADA_PROXY_PASS="<your-proxy-password>"  # Set this first`,
      `export HTTP_PROXY="http://${encodedUser}:\${NOVADA_PROXY_PASS}@${endpoint}"`,
      `export HTTPS_PROXY="http://${encodedUser}:\${NOVADA_PROXY_PASS}@${endpoint}"`,
      `export http_proxy="http://${encodedUser}:\${NOVADA_PROXY_PASS}@${endpoint}"`,
      `export https_proxy="http://${encodedUser}:\${NOVADA_PROXY_PASS}@${endpoint}"`,
      ``,
      `## agent_instruction`,
      `Fastest proxies. Best for high-volume, non-anti-bot targets. If blocked, upgrade to novada_proxy_isp or novada_proxy_residential.`,
    ].join("\n");
  }

  if (params.format === "curl") {
    return [
      `## Datacenter Proxy Configuration (curl)`,
      `zone: datacenter`,
      `targeting: ${targeting}`,
      `proxy_url: ${maskedUrl}`,
      ``,
      `# Add this flag to any curl command — replace *** with $NOVADA_PROXY_PASS:`,
      `curl --proxy "${maskedUrl}" <your-url>`,
      ``,
      `## agent_instruction`,
      `Fastest proxies. Best for high-volume, non-anti-bot targets. If blocked, upgrade to novada_proxy_isp or novada_proxy_residential.`,
      `To get the actual proxy URL with credentials: substitute *** with the runtime value of the NOVADA_PROXY_PASS environment variable.`,
    ].join("\n");
  }

  // Default: url format
  return [
    `## Datacenter Proxy Configuration`,
    `zone: datacenter`,
    `targeting: ${targeting}`,
    params.session_id ? `session: ${params.session_id} (sticky IP)` : `session: rotating (new IP per request)`,
    `proxy_url: ${maskedUrl}`,
    ``,
    `## Usage Examples`,
    ``,
    `Node.js (axios):`,
    `  proxy: { host: "${proxyHost}", port: ${proxyPort}, auth: { username: "${username}", password: "<NOVADA_PROXY_PASS>" } }`,
    ``,
    `Python (requests):`,
    `  proxies = { "http": "${maskedUrl}", "https": "${maskedUrl}" }`,
    `  # Replace *** with the value of NOVADA_PROXY_PASS`,
    ``,
    `## agent_instruction`,
    `Fastest proxies. Best for high-volume, non-anti-bot targets. Datacenter IPs are detectable by advanced bot-protection systems.`,
    `Escalation path: if blocked → try novada_proxy_isp → try novada_proxy_residential.`,
    `- proxy_url above shows *** for the password — read NOVADA_PROXY_PASS from your environment to complete it.`,
    `- For consistent IP across a workflow, set session_id.`,
  ].join("\n");
}
