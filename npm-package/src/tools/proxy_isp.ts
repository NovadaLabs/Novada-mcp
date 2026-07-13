import { z } from "zod";
import { resolveProxyCredentials } from "../utils/credentials.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

export const ProxyIspParamsSchema = z.object({
  url: z.string().optional()
    .describe("Optional target URL. When provided, returns config scoped for that URL. Omit for generic proxy credentials."),
  country: z.string()
    .regex(/^[a-zA-Z]{2}$/, "country must be a 2-letter ISO code (e.g. 'us', 'gb', 'de')")
    .optional()
    .describe("ISO 2-letter country code for geo-targeting (e.g. 'us', 'gb'). ISP proxies are best for social and ecommerce."),
  session_id: z.string()
    .max(64)
    .regex(/^[a-zA-Z0-9_\-]+$/, "session_id must be alphanumeric, hyphens, or underscores only")
    .optional()
    .describe("Session ID for sticky ISP IP routing. Use for multi-step workflows that require the same IP."),
  format: z.enum(["url", "env", "curl"]).default("url")
    .describe("Output format. 'url': proxy URL string (default). 'env': shell export commands. 'curl': curl --proxy flag."),
});

export type ProxyIspParams = z.infer<typeof ProxyIspParamsSchema>;

export function validateProxyIspParams(args: Record<string, unknown> | undefined): ProxyIspParams {
  return ProxyIspParamsSchema.parse(args ?? {});
}

// ─── Username Builder ─────────────────────────────────────────────────────────

function buildIspUsername(user: string, params: ProxyIspParams): string {
  const parts: string[] = [user];
  // ISP rotating zone
  parts.push("zone-isp");
  if (params.session_id) parts.push(`session-${params.session_id}`);
  return parts.join("-");
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

/**
 * Return ISP proxy configuration for use in HTTP clients.
 *
 * ISP proxies are assigned to real Internet Service Providers — they look like
 * genuine home users and are ideal for social media, ecommerce, and any platform
 * that distinguishes real users from datacenter IPs.
 */
export async function novadaProxyIsp(params: ProxyIspParams): Promise<string> {
  // INC-197/198: Use resolveProxyCredentials + friendly error format
  const proxyCreds = await resolveProxyCredentials();

  if (!proxyCreds) {
    return [
      `## Proxy Configuration`,
      `status: not configured`,
      ``,
      `Proxy credentials could not be resolved. Either:`,
      `- Set NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars, OR`,
      `- Set NOVADA_PROXY_ENDPOINT + NOVADA_API_KEY (credentials auto-fetched from your account)`,
      ``,
      `Get credentials from: https://dashboard.novada.com → Residential Proxies → Endpoint Generator`,
      ``,
      `## Agent Hints`,
      `- For web extraction without managing proxies, use novada_extract or novada_crawl instead.`,
    ].join("\n");
  }

  const { user, pass, endpoint } = proxyCreds;
  const username = buildIspUsername(user, params);
  const encodedUser = encodeURIComponent(username);
  // Mask username in output to prevent credential leakage
  const maskedUser = user.slice(0, 4) + '***';
  const maskedUsername = buildIspUsername(maskedUser, params);
  const encodedMaskedUser = encodeURIComponent(maskedUsername);
  const maskedUrl = `http://${encodedMaskedUser}:***@${endpoint}`;
  const endpointParts = endpoint.split(":");
  const proxyHost = endpointParts[0];
  const proxyPort = endpointParts[1] ? parseInt(endpointParts[1]) : 7777;

  // ISP zone (zone-isp) does not support country targeting in the zone string.
  // The country param is accepted by schema but has no effect on the backend.
  const targeting = params.country
    ? `Any (ISP zone does not support country targeting — '${params.country.toUpperCase()}' ignored; use novada_proxy_residential for geo-targeted ISP)`
    : "Any country (rotating)";

  const warnings: string[] = [];
  if (params.country) {
    warnings.push(`country param is accepted but silently ignored for ISP proxies — ISP proxies do not support country targeting on this product (received: "${params.country}")`);
  }
  const warningsBlock = warnings.length > 0 ? [`## Warnings`, JSON.stringify(warnings), ``] : [];

  if (params.format === "env") {
    return [
      `## ISP Proxy Configuration (Shell Environment)`,
      `zone: isp`,
      `targeting: ${targeting}`,
      params.session_id ? `session: ${params.session_id} (sticky IP)` : `session: rotating (new IP per request)`,
      `proxy_url: ${maskedUrl}`,
      ``,
      `export NOVADA_PROXY_PASS="<your-proxy-password>"  # Set this first`,
      `export HTTP_PROXY="http://${encodedMaskedUser}:\${NOVADA_PROXY_PASS}@${endpoint}"`,
      `export HTTPS_PROXY="http://${encodedMaskedUser}:\${NOVADA_PROXY_PASS}@${endpoint}"`,
      `export http_proxy="http://${encodedMaskedUser}:\${NOVADA_PROXY_PASS}@${endpoint}"`,
      `export https_proxy="http://${encodedMaskedUser}:\${NOVADA_PROXY_PASS}@${endpoint}"`,
      ``,
      ...warningsBlock,
      `## agent_instruction`,
      `ISP proxies look like real home users. Best for social/ecommerce. Use country param for targeting. For higher anti-bot strength, try novada_proxy_residential instead.`,
    ].join("\n");
  }

  if (params.format === "curl") {
    return [
      `## ISP Proxy Configuration (curl)`,
      `zone: isp`,
      `targeting: ${targeting}`,
      `proxy_url: ${maskedUrl}`,
      ``,
      `# Add this flag to any curl command — replace *** with $NOVADA_PROXY_PASS:`,
      `curl --proxy "${maskedUrl}" <your-url>`,
      ``,
      ...warningsBlock,
      `## agent_instruction`,
      `ISP proxies look like real home users. Best for social/ecommerce. Use novada_proxy_residential for stronger anti-bot scenarios.`,
      `To get the actual proxy URL with credentials: substitute *** with the runtime value of the NOVADA_PROXY_PASS environment variable.`,
    ].join("\n");
  }

  // Default: url format
  return [
    `## ISP Proxy Configuration`,
    `zone: isp`,
    `targeting: ${targeting}`,
    params.session_id ? `session: ${params.session_id} (sticky IP)` : `session: rotating (new IP per request)`,
    `proxy_url: ${maskedUrl}`,
    ``,
    `## Usage Examples`,
    ``,
    `Node.js (axios):`,
    `  proxy: { host: "${proxyHost}", port: ${proxyPort}, auth: { username: "${maskedUsername}", password: "<NOVADA_PROXY_PASS>" } }`,
    ``,
    `Python (requests):`,
    `  proxies = { "http": "${maskedUrl}", "https": "${maskedUrl}" }`,
    `  # Replace *** with the value of NOVADA_PROXY_PASS`,
    ``,
    ...warningsBlock,
    `## agent_instruction`,
    `ISP proxies look like real home users. Best for social/ecommerce. ISP IPs are assigned to real ISPs — they pass checks that fail datacenter IPs.`,
    `Fallback: if ISP proxy fails anti-bot checks, use novada_proxy_residential (stronger). For speed, use novada_proxy_datacenter.`,
    `- proxy_url above shows *** for the password — read NOVADA_PROXY_PASS from your environment to complete it.`,
    `- For consistent IP across a workflow, set session_id.`,
  ].join("\n");
}
