import { z } from "zod";
import { getProxyCredentials } from "../utils/credentials.js";
import { makeNovadaError, NovadaErrorCode } from "../_core/errors.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

export const ProxyDedicatedParamsSchema = z.object({
  url: z.string().optional()
    .describe("Optional target URL. When provided, returns config scoped for that URL. Omit for generic proxy credentials."),
  session_id: z.string()
    .max(64)
    .regex(/^[a-zA-Z0-9_\-]+$/, "session_id must be alphanumeric, hyphens, or underscores only")
    .describe("Session ID required for dedicated proxy — determines your exclusive datacenter IP assignment. Same session_id always returns the same dedicated IP."),
  format: z.enum(["url", "env", "curl"]).default("url")
    .describe("Output format. 'url': proxy URL string (default). 'env': shell export commands. 'curl': curl --proxy flag."),
});

export type ProxyDedicatedParams = z.infer<typeof ProxyDedicatedParamsSchema>;

export function validateProxyDedicatedParams(args: Record<string, unknown> | undefined): ProxyDedicatedParams {
  return ProxyDedicatedParamsSchema.parse(args ?? {});
}

// ─── Username Builder ─────────────────────────────────────────────────────────

function buildDedicatedUsername(user: string, params: ProxyDedicatedParams): string {
  const parts: string[] = [user];
  // Dedicated datacenter zone
  parts.push("zone-dedicated");
  // session_id required for dedicated — maps to exclusive IP
  parts.push(`session-${params.session_id}`);
  return parts.join("-");
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

/**
 * Return dedicated datacenter proxy configuration for use in HTTP clients.
 *
 * Dedicated datacenter proxies assign an exclusive IP that no other user shares.
 * Ideal for high-trust platforms where IP reputation matters, or workflows that
 * need a clean, exclusive IP with no risk of other users' activity affecting access.
 */
export async function novadaProxyDedicated(params: ProxyDedicatedParams): Promise<string> {
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
  const username = buildDedicatedUsername(user, params);
  const encodedUser = encodeURIComponent(username);
  const encodedPass = encodeURIComponent(pass);
  const maskedUrl = `http://${encodedUser}:***@${endpoint}`;
  const endpointParts = endpoint.split(":");
  const proxyHost = endpointParts[0];
  const proxyPort = endpointParts[1] ? parseInt(endpointParts[1]) : 7777;

  if (params.format === "env") {
    return [
      `## Dedicated Datacenter Proxy Configuration (Shell Environment)`,
      `zone: dedicated`,
      `ip_type: exclusive datacenter (not shared with other users)`,
      `session: ${params.session_id} (dedicated IP — never rotates)`,
      `proxy_url: ${maskedUrl}`,
      ``,
      `# Copy these lines to your shell — replace *** with $NOVADA_PROXY_PASS:`,
      `export HTTP_PROXY="${maskedUrl}"`,
      `export HTTPS_PROXY="${maskedUrl}"`,
      `export http_proxy="${maskedUrl}"`,
      `export https_proxy="${maskedUrl}"`,
      ``,
      `## agent_instruction`,
      `Exclusive datacenter IP. Best for high-trust platforms. No other user shares this IP — clean reputation guaranteed. For human-like IP appearance, use novada_proxy_residential instead.`,
      `To get the actual proxy URL with credentials: substitute *** with the runtime value of the NOVADA_PROXY_PASS environment variable.`,
    ].join("\n");
  }

  if (params.format === "curl") {
    return [
      `## Dedicated Datacenter Proxy Configuration (curl)`,
      `zone: dedicated`,
      `ip_type: exclusive datacenter`,
      `session: ${params.session_id} (dedicated — never rotates)`,
      `proxy_url: ${maskedUrl}`,
      ``,
      `# Add this flag to any curl command — replace *** with $NOVADA_PROXY_PASS:`,
      `curl --proxy "${maskedUrl}" <your-url>`,
      ``,
      `## agent_instruction`,
      `Exclusive datacenter IP. Best for high-trust platforms. For human-like IP appearance, use novada_proxy_residential.`,
      `To get the actual proxy URL with credentials: substitute *** with the runtime value of the NOVADA_PROXY_PASS environment variable.`,
    ].join("\n");
  }

  // Default: url format
  return [
    `## Dedicated Datacenter Proxy Configuration`,
    `zone: dedicated`,
    `ip_type: exclusive datacenter (not shared with other users)`,
    `session: ${params.session_id} (dedicated IP — never rotates)`,
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
    `Exclusive datacenter IP. Best for high-trust platforms. This IP is not shared with other users — clean reputation, no contamination risk.`,
    `Use case: high-value API access, platforms that permanently ban shared IPs, clean-slate scraping with no prior negative history.`,
    `Fallback: if the target blocks datacenter IPs outright, use novada_proxy_residential (looks like real home user) or novada_proxy_static (dedicated ISP IP).`,
    `- proxy_url above shows *** for the password — read NOVADA_PROXY_PASS from your environment to complete it.`,
    `- IMPORTANT: Keep the same session_id throughout the lifetime of work requiring this dedicated IP.`,
  ].join("\n");
}
