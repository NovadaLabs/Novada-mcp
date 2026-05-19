import { z } from "zod";
import { getProxyCredentials } from "../utils/credentials.js";
import { makeNovadaError, NovadaErrorCode } from "../_core/errors.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

export const ProxyStaticParamsSchema = z.object({
  url: z.string().optional()
    .describe("Optional target URL. When provided, returns config scoped for that URL. Omit for generic proxy credentials."),
  country: z.string()
    .regex(/^[a-zA-Z]{2}$/, "country must be a 2-letter ISO code (e.g. 'us', 'gb', 'de')")
    .describe("ISO 2-letter country code (required for static ISP proxy — each country has a distinct pool of dedicated IPs)."),
  session_id: z.string()
    .max(64)
    .regex(/^[a-zA-Z0-9_\-]+$/, "session_id must be alphanumeric, hyphens, or underscores only")
    .describe("Session ID required for static proxy — determines which dedicated IP is assigned. Same session_id always returns the same IP."),
  format: z.enum(["url", "env", "curl"]).default("url")
    .describe("Output format. 'url': proxy URL string (default). 'env': shell export commands. 'curl': curl --proxy flag."),
});

export type ProxyStaticParams = z.infer<typeof ProxyStaticParamsSchema>;

export function validateProxyStaticParams(args: Record<string, unknown> | undefined): ProxyStaticParams {
  return ProxyStaticParamsSchema.parse(args ?? {});
}

// ─── Username Builder ─────────────────────────────────────────────────────────

function buildStaticUsername(user: string, params: ProxyStaticParams): string {
  const parts: string[] = [user];
  // Static ISP zone (dedicated IP)
  parts.push("zone-static");
  parts.push(`country-${params.country.toLowerCase()}`);
  // session_id is required for static proxy
  parts.push(`session-${params.session_id}`);
  return parts.join("-");
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

/**
 * Return static ISP proxy configuration for use in HTTP clients.
 *
 * Static ISP proxies assign a dedicated IP that never changes for a given
 * session_id + country combination. Essential for accounts requiring consistent
 * identity (social media logins, platforms that track IP changes as suspicious activity).
 */
export async function novadaProxyStatic(params: ProxyStaticParams): Promise<string> {
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
  const username = buildStaticUsername(user, params);
  const encodedUser = encodeURIComponent(username);
  const encodedPass = encodeURIComponent(pass);
  const maskedUrl = `http://${encodedUser}:***@${endpoint}`;
  const endpointParts = endpoint.split(":");
  const proxyHost = endpointParts[0];
  const proxyPort = endpointParts[1] ? parseInt(endpointParts[1]) : 7777;

  if (params.format === "env") {
    return [
      `## Static ISP Proxy Configuration (Shell Environment)`,
      `zone: static`,
      `targeting: ${params.country.toUpperCase()} (dedicated IP)`,
      `session: ${params.session_id} (same IP every request — static)`,
      `proxy_url: ${maskedUrl}`,
      ``,
      `# Copy these lines to your shell — replace *** with the value of $NOVADA_PROXY_PASS:`,
      `export HTTP_PROXY="${maskedUrl}"`,
      `export HTTPS_PROXY="${maskedUrl}"`,
      `export http_proxy="${maskedUrl}"`,
      `export https_proxy="${maskedUrl}"`,
      ``,
      `## agent_instruction`,
      `Same IP every request. Best for accounts requiring consistent identity. This IP is dedicated to your session_id — do not share session_id across unrelated workflows.`,
      `To get the actual proxy URL with credentials: substitute *** with the runtime value of the NOVADA_PROXY_PASS environment variable.`,
    ].join("\n");
  }

  if (params.format === "curl") {
    return [
      `## Static ISP Proxy Configuration (curl)`,
      `zone: static`,
      `targeting: ${params.country.toUpperCase()} (dedicated IP)`,
      `session: ${params.session_id} (static — same IP every call)`,
      `proxy_url: ${maskedUrl}`,
      ``,
      `# Add this flag to any curl command — replace *** with $NOVADA_PROXY_PASS:`,
      `curl --proxy "${maskedUrl}" <your-url>`,
      ``,
      `## agent_instruction`,
      `Same IP every request. Best for accounts requiring consistent identity. session_id maps to a dedicated IP — keep it consistent for the same account/workflow.`,
      `To get the actual proxy URL with credentials: substitute *** with the runtime value of the NOVADA_PROXY_PASS environment variable.`,
    ].join("\n");
  }

  // Default: url format
  return [
    `## Static ISP Proxy Configuration`,
    `zone: static`,
    `targeting: ${params.country.toUpperCase()} (dedicated IP)`,
    `session: ${params.session_id} (static — same IP every request)`,
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
    `Same IP every request. Best for accounts requiring consistent identity. The session_id pins you to a dedicated ISP IP in the target country.`,
    `Use case: social media account management, login-dependent workflows, any platform that flags IP changes as suspicious.`,
    `Fallback: if account access fails, try novada_proxy_dedicated for an exclusive datacenter IP.`,
    `- proxy_url above shows *** for the password — read NOVADA_PROXY_PASS from your environment to complete it.`,
    `- IMPORTANT: Keep the same session_id for the entire lifecycle of a single account.`,
  ].join("\n");
}
