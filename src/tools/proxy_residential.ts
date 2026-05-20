import { z } from "zod";
import { getProxyCredentials } from "../utils/credentials.js";
import { makeNovadaError, NovadaErrorCode } from "../_core/errors.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

export const ProxyResidentialParamsSchema = z.object({
  url: z.string().optional()
    .describe("Optional target URL to route through the proxy. When provided, returns config scoped for that URL. Omit to get generic proxy credentials."),
  country: z.string()
    .regex(/^[a-zA-Z]{2}$/, "country must be a 2-letter ISO code (e.g. 'us', 'gb', 'de')")
    .optional()
    .describe("ISO 2-letter country code for geo-targeting (e.g. 'us', 'gb', 'de'). Best for geo-restricted content."),
  city: z.string()
    .max(50)
    .regex(/^[a-zA-Z\s\-]+$/, "city must contain only letters, spaces, or hyphens")
    .optional()
    .describe("City-level targeting (e.g. 'london', 'new-york'). Requires country to be set."),
  session_id: z.string()
    .max(64)
    .regex(/^[a-zA-Z0-9_\-]+$/, "session_id must be alphanumeric, hyphens, or underscores only")
    .optional()
    .describe("Session ID for sticky IP routing — same session_id returns the same residential IP across requests."),
  format: z.enum(["url", "env", "curl"]).default("url")
    .describe("Output format. 'url': proxy URL string (default). 'env': shell export commands. 'curl': curl --proxy flag."),
});

export type ProxyResidentialParams = z.infer<typeof ProxyResidentialParamsSchema>;

export function validateProxyResidentialParams(args: Record<string, unknown> | undefined): ProxyResidentialParams {
  return ProxyResidentialParamsSchema.parse(args ?? {});
}

// ─── Username Builder ─────────────────────────────────────────────────────────

function buildResidentialUsername(user: string, params: ProxyResidentialParams): string {
  const parts: string[] = [user];
  // Residential zone
  parts.push("zone-res");
  if (params.country) parts.push(`region-${params.country.toLowerCase()}`);
  if (params.city) parts.push(`city-${params.city.toLowerCase().replace(/\s+/g, "")}`);
  if (params.session_id) parts.push(`session-${params.session_id}`);
  return parts.join("-");
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

/**
 * Return residential proxy configuration for use in HTTP clients.
 *
 * Residential proxies route through real ISP-assigned home IPs (100M+ pool),
 * making them the best choice for anti-bot protected pages and geo-restricted content.
 */
export async function novadaProxyResidential(params: ProxyResidentialParams): Promise<string> {
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
  const username = buildResidentialUsername(user, params);
  const encodedUser = encodeURIComponent(username);
  const encodedPass = encodeURIComponent(pass);
  const maskedUrl = `http://${encodedUser}:***@${endpoint}`;
  const endpointParts = endpoint.split(":");
  const proxyHost = endpointParts[0];
  const proxyPort = endpointParts[1] ? parseInt(endpointParts[1]) : 7777;

  const targeting = params.country
    ? `${params.country.toUpperCase()}${params.city ? ` / ${params.city}` : ""}`
    : "Any country (rotating)";

  if (params.format === "env") {
    return [
      `## Residential Proxy Configuration (Shell Environment)`,
      `zone: residential`,
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
      `Best for geo-restricted content. Use country param for targeting. Residential IPs from 100M+ real home devices pass anti-bot checks that datacenter IPs fail.`,
    ].join("\n");
  }

  if (params.format === "curl") {
    return [
      `## Residential Proxy Configuration (curl)`,
      `zone: residential`,
      `targeting: ${targeting}`,
      `proxy_url: ${maskedUrl}`,
      ``,
      `# Add this flag to any curl command — replace *** with $NOVADA_PROXY_PASS:`,
      `curl --proxy "${maskedUrl}" <your-url>`,
      ``,
      `## agent_instruction`,
      `Best for geo-restricted content. Use country param for targeting. Residential IPs bypass most anti-bot systems.`,
      `To get the actual proxy URL with credentials: substitute *** with the runtime value of the NOVADA_PROXY_PASS environment variable.`,
    ].join("\n");
  }

  // Default: url format
  return [
    `## Residential Proxy Configuration`,
    `zone: residential`,
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
    `Best for geo-restricted content. Use country param for targeting. Residential IPs from 100M+ real home devices — optimal for anti-bot protected pages and regional content access.`,
    `Fallback chain: residential → isp → mobile → datacenter (in decreasing anti-bot strength).`,
    `- proxy_url above shows *** for the password — read NOVADA_PROXY_PASS from your environment to complete it.`,
    `- For consistent IP across a workflow, set session_id.`,
  ].join("\n");
}
