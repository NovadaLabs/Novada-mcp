import { z } from "zod";

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

// ─── Tool ─────────────────────────────────────────────────────────────────────

/**
 * Return dedicated datacenter proxy configuration for use in HTTP clients.
 *
 * Dedicated datacenter proxies assign an exclusive IP that no other user shares.
 * Ideal for high-trust platforms where IP reputation matters, or workflows that
 * need a clean, exclusive IP with no risk of other users' activity affecting access.
 */
export async function novadaProxyDedicated(params: ProxyDedicatedParams): Promise<string> {
  // Dedicated proxies require per-IP credentials, not zone-based routing.
  // The current implementation generates zone-format commands which are incorrect.
  // Dedicated proxy IPs are assigned per-account after purchase at dashboard.novada.com/overview/proxies/
  // Each IP has unique credentials in format: curl -x IP:PORT -U "USER:PASS" target
  // Set NOVADA_DEDICATED_PROXY_LIST env var with your dedicated proxy list (format: IP:PORT:USER:PASS per line)
  // until this tool is fully redesigned.
  const dedicatedProxyList = process.env.NOVADA_DEDICATED_PROXY_LIST;
  if (!dedicatedProxyList) {
    return JSON.stringify({
      status: "configuration_required",
      message: "Dedicated proxies require per-IP credentials purchased from your Novada dashboard.",
      next_step: "1. Go to https://dashboard.novada.com/overview/proxies/ to purchase dedicated IPs. " +
                 "2. Each IP provides a unique IP:PORT and USERNAME:PASSWORD. " +
                 "3. Set NOVADA_DEDICATED_PROXY_LIST env var (format: IP:PORT:USER:PASS per line). " +
                 "4. Example command: curl -x 151.242.47.74:8886 -U \"youruser:yourpass\" ipinfo.novada.pro",
      agent_instruction: "Dedicated proxies are not zone-based. Each IP has unique credentials. " +
                         "Inform the user they need to configure NOVADA_DEDICATED_PROXY_LIST with their purchased dedicated IPs.",
    }, null, 2);
  }

  // Parse NOVADA_DEDICATED_PROXY_LIST — expected format: IP:PORT:USER:PASS (one per line)
  // Pick the first entry.
  const entries = dedicatedProxyList
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.split(":").length >= 4);

  if (entries.length === 0) {
    return JSON.stringify({
      status: "configuration_required",
      message: "NOVADA_DEDICATED_PROXY_LIST is set but contains no valid entries.",
      format: "IP:PORT:USER:PASS (one per line). Example: 151.242.47.74:8886:ax0kSJ8snE6wF1mR:p3K0rNpsP2iR",
      agent_instruction: "Fix NOVADA_DEDICATED_PROXY_LIST format and retry.",
    }, null, 2);
  }

  const [proxyIp, proxyPort, proxyUser, proxyPass] = entries[0].split(":");
  const maskedCmd = `curl -x ${proxyIp}:${proxyPort} -U "${proxyUser}:***" ipinfo.novada.pro`;

  if (params.format === "curl") {
    return [
      `## Dedicated Proxy Configuration (curl)`,
      `ip: ${proxyIp}  port: ${proxyPort}`,
      `ip_type: exclusive datacenter (not shared with other users)`,
      `session: ${params.session_id}`,
      ``,
      `curl -x ${proxyIp}:${proxyPort} -U "${proxyUser}:${proxyPass}" <your-url>`,
      ``,
      `## agent_instruction`,
      `Dedicated proxy uses an exclusive IP with unique credentials — not zone-based. Same IP every call. No other user shares this IP.`,
    ].join("\n");
  }

  if (params.format === "env") {
    return [
      `## Dedicated Proxy Configuration (Shell Environment)`,
      `ip: ${proxyIp}  port: ${proxyPort}`,
      `ip_type: exclusive datacenter (not shared with other users)`,
      ``,
      `export HTTP_PROXY="http://${proxyUser}:${proxyPass}@${proxyIp}:${proxyPort}"`,
      `export HTTPS_PROXY="http://${proxyUser}:${proxyPass}@${proxyIp}:${proxyPort}"`,
      ``,
      `## agent_instruction`,
      `Dedicated proxy — exclusive datacenter IP with unique credentials per IP. Not zone-based.`,
    ].join("\n");
  }

  // Default: url
  return [
    `## Dedicated Proxy Configuration`,
    `ip: ${proxyIp}  port: ${proxyPort}`,
    `ip_type: exclusive datacenter (not shared with other users)`,
    `session: ${params.session_id}`,
    `command: ${maskedCmd}`,
    ``,
    `## agent_instruction`,
    `Dedicated proxy — exclusive IP with unique credentials. Not zone-based routing. Same IP on every request. No other user shares this IP.`,
  ].join("\n");
}
