import { z } from "zod";
import { getProxyCredentials } from "../utils/credentials.js";
import { makeNovadaError, NovadaErrorCode } from "../_core/errors.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

export const ProxyMobileParamsSchema = z.object({
  url: z.string().optional()
    .describe("Optional target URL. When provided, returns config scoped for that URL. Omit for generic proxy credentials."),
  country: z.string()
    .regex(/^[a-zA-Z]{2}$/, "country must be a 2-letter ISO code (e.g. 'us', 'gb', 'de')")
    .optional()
    .describe("ISO 2-letter country code for geo-targeting (e.g. 'us', 'gb'). Use to access mobile-targeted content from a specific region."),
  carrier: z.string()
    .max(50)
    .regex(/^[a-zA-Z0-9\s\-]+$/, "carrier must contain only letters, numbers, spaces, or hyphens")
    .optional()
    .describe("Mobile carrier name for carrier-level targeting (e.g. 'verizon', 'att', 't-mobile'). Optional."),
  session_id: z.string()
    .max(64)
    .regex(/^[a-zA-Z0-9_\-]+$/, "session_id must be alphanumeric, hyphens, or underscores only")
    .optional()
    .describe("Session ID for sticky mobile IP routing. Use for multi-step workflows requiring consistent mobile IP."),
  format: z.enum(["url", "env", "curl"]).default("url")
    .describe("Output format. 'url': proxy URL string (default). 'env': shell export commands. 'curl': curl --proxy flag."),
});

export type ProxyMobileParams = z.infer<typeof ProxyMobileParamsSchema>;

export function validateProxyMobileParams(args: Record<string, unknown> | undefined): ProxyMobileParams {
  return ProxyMobileParamsSchema.parse(args ?? {});
}

// ─── Username Builder ─────────────────────────────────────────────────────────

function buildMobileUsername(user: string, params: ProxyMobileParams): string {
  const parts: string[] = [user];
  // Mobile zone
  parts.push("zone-mob");
  if (params.country) parts.push(`region-${params.country.toLowerCase()}`);
  if (params.carrier) parts.push(`carrier-${params.carrier.toLowerCase().replace(/\s+/g, "")}`);
  if (params.session_id) parts.push(`session-${params.session_id}`);
  return parts.join("-");
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

/**
 * Return mobile proxy configuration for use in HTTP clients.
 *
 * Mobile proxies use 4G/5G IPs from real mobile devices — ideal for accessing
 * mobile-targeted content, mobile apps, and platforms that serve different
 * content to mobile vs. desktop users.
 */
export async function novadaProxyMobile(params: ProxyMobileParams): Promise<string> {
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
  const username = buildMobileUsername(user, params);
  const encodedUser = encodeURIComponent(username);
  const encodedPass = encodeURIComponent(pass);
  const maskedUrl = `http://${encodedUser}:***@${endpoint}`;
  const endpointParts = endpoint.split(":");
  const proxyHost = endpointParts[0];
  const proxyPort = endpointParts[1] ? parseInt(endpointParts[1]) : 7777;

  const targetingParts: string[] = [];
  if (params.country) targetingParts.push(params.country.toUpperCase());
  if (params.carrier) targetingParts.push(`carrier: ${params.carrier}`);
  const targeting = targetingParts.length > 0 ? targetingParts.join(" / ") : "Any country (rotating)";

  if (params.format === "env") {
    return [
      `## Mobile Proxy Configuration (Shell Environment)`,
      `zone: mobile`,
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
      `Mobile IPs. Best for mobile-targeted content and apps. 4G/5G IPs from real devices. If targeting app APIs, pair with mobile User-Agent header.`,
    ].join("\n");
  }

  if (params.format === "curl") {
    return [
      `## Mobile Proxy Configuration (curl)`,
      `zone: mobile`,
      `targeting: ${targeting}`,
      `proxy_url: ${maskedUrl}`,
      ``,
      `# Add this flag to any curl command — replace *** with $NOVADA_PROXY_PASS:`,
      `curl --proxy "${maskedUrl}" <your-url>`,
      ``,
      `## agent_instruction`,
      `Mobile IPs. Best for mobile-targeted content and apps. Pair with mobile User-Agent for best results.`,
      `To get the actual proxy URL with credentials: substitute *** with the runtime value of the NOVADA_PROXY_PASS environment variable.`,
    ].join("\n");
  }

  // Default: url format
  return [
    `## Mobile Proxy Configuration`,
    `zone: mobile`,
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
    `Mobile IPs. Best for mobile-targeted content and apps. 4G/5G IPs from real mobile devices on cellular networks.`,
    `For stronger anti-bot bypassing (desktop), use novada_proxy_residential instead.`,
    `- proxy_url above shows *** for the password — read NOVADA_PROXY_PASS from your environment to complete it.`,
    `- For consistent IP across a workflow, set session_id.`,
    `- Tip: pair with a mobile User-Agent string for full mobile simulation.`,
  ].join("\n");
}
