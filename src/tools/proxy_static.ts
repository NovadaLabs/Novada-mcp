import { z } from "zod";

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

// ─── Tool ─────────────────────────────────────────────────────────────────────

/**
 * Return static ISP proxy configuration for use in HTTP clients.
 *
 * Static ISP proxies assign a dedicated IP that never changes for a given
 * session_id + country combination. Essential for accounts requiring consistent
 * identity (social media logins, platforms that track IP changes as suspicious activity).
 */
export async function novadaProxyStatic(params: ProxyStaticParams): Promise<string> {
  // Static proxies require per-IP credentials, not zone-based routing.
  // The current implementation generates zone-format commands which are incorrect.
  // Static proxy IPs are assigned per-account after purchase at dashboard.novada.com/overview/proxies/
  // Each IP has unique credentials in format: curl -x IP:PORT -U "USER:PASS" target
  // Set NOVADA_STATIC_PROXY_LIST env var with your static proxy list (format: IP:PORT:USER:PASS per line)
  // until this tool is fully redesigned.
  const staticProxyList = process.env.NOVADA_STATIC_PROXY_LIST;
  if (!staticProxyList) {
    return JSON.stringify({
      status: "configuration_required",
      message: "Static proxies require per-IP credentials purchased from your Novada dashboard.",
      next_step: "1. Go to https://dashboard.novada.com/overview/proxies/ to purchase static IPs. " +
                 "2. Each IP provides a unique IP:PORT and USERNAME:PASSWORD. " +
                 "3. Set NOVADA_STATIC_PROXY_LIST env var (format: IP:PORT:USER:PASS per line). " +
                 "4. Example command: curl -x 151.242.47.74:8886 -U \"youruser:yourpass\" ipinfo.novada.pro",
      agent_instruction: "Static proxies are not zone-based. Each IP has unique credentials. " +
                         "Inform the user they need to configure NOVADA_STATIC_PROXY_LIST with their purchased static IPs.",
    }, null, 2);
  }

  // Parse NOVADA_STATIC_PROXY_LIST — expected format: IP:PORT:USER:PASS (one per line)
  // Pick the first entry that matches the requested country (or first entry if no country match).
  const entries = staticProxyList
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.split(":").length >= 4);

  if (entries.length === 0) {
    return JSON.stringify({
      status: "configuration_required",
      message: "NOVADA_STATIC_PROXY_LIST is set but contains no valid entries.",
      format: "IP:PORT:USER:PASS (one per line). Example: 151.242.47.74:8886:ax0kSJ8snE6wF1mR:p3K0rNpsP2iR",
      agent_instruction: "Fix NOVADA_STATIC_PROXY_LIST format and retry.",
    }, null, 2);
  }

  const [proxyIp, proxyPort, proxyUser, proxyPass] = entries[0].split(":");
  const maskedCmd = `curl -x ${proxyIp}:${proxyPort} -U "${proxyUser}:***" ipinfo.novada.pro`;

  if (params.format === "curl") {
    return [
      `## Static Proxy Configuration (curl)`,
      `ip: ${proxyIp}  port: ${proxyPort}`,
      `targeting: ${params.country.toUpperCase()} (dedicated IP)`,
      `session: ${params.session_id}`,
      ``,
      `curl -x ${proxyIp}:${proxyPort} -U "${proxyUser}:${proxyPass}" <your-url>`,
      ``,
      `## agent_instruction`,
      `Static proxy uses a dedicated IP with unique credentials — not zone-based. Same IP every call. Best for account-bound workflows.`,
    ].join("\n");
  }

  if (params.format === "env") {
    return [
      `## Static Proxy Configuration (Shell Environment)`,
      `ip: ${proxyIp}  port: ${proxyPort}`,
      `targeting: ${params.country.toUpperCase()} (dedicated IP)`,
      ``,
      `export HTTP_PROXY="http://${proxyUser}:${proxyPass}@${proxyIp}:${proxyPort}"`,
      `export HTTPS_PROXY="http://${proxyUser}:${proxyPass}@${proxyIp}:${proxyPort}"`,
      ``,
      `## agent_instruction`,
      `Static proxy — dedicated IP with unique credentials per IP. Not zone-based.`,
    ].join("\n");
  }

  // Default: url
  return [
    `## Static Proxy Configuration`,
    `ip: ${proxyIp}  port: ${proxyPort}`,
    `targeting: ${params.country.toUpperCase()} (dedicated IP)`,
    `session: ${params.session_id}`,
    `command: ${maskedCmd}`,
    ``,
    `## agent_instruction`,
    `Static proxy — dedicated IP with unique credentials. Not zone-based routing. Same IP on every request.`,
  ].join("\n");
}

