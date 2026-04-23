import type { ProxyParams } from "./types.js";

/**
 * Build Novada proxy username with targeting options.
 * Novada format: baseUser-country-us-city-london-session-abc123
 */
function buildProxyUsername(user: string, params: ProxyParams): string {
  const parts: string[] = [user];

  if (params.country) parts.push(`country-${params.country.toLowerCase()}`);
  if (params.city) parts.push(`city-${params.city.toLowerCase().replace(/\s+/g, "")}`);
  if (params.session_id) parts.push(`session-${params.session_id}`);

  return parts.join("-");
}

const TYPE_LABELS: Record<string, string> = {
  residential: "Residential proxy (100M+ IPs, best for anti-bot)",
  mobile: "Mobile proxy (4G/5G IPs, best for app automation)",
  isp: "ISP proxy (stable, best for long sessions)",
  datacenter: "Datacenter proxy (fastest, highest volume)",
};

/**
 * Return proxy configuration for use in HTTP clients, curl, or shell.
 *
 * Agents use this when they need to make HTTP requests through a residential proxy,
 * bypass geo-restrictions, or maintain IP consistency across a session.
 */
export async function novadaProxy(params: ProxyParams): Promise<string> {
  const proxyUser = process.env.NOVADA_PROXY_USER;
  const proxyPass = process.env.NOVADA_PROXY_PASS;
  const proxyEndpoint = process.env.NOVADA_PROXY_ENDPOINT;

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

  const username = buildProxyUsername(proxyUser, params);
  const encodedUser = encodeURIComponent(username);
  const encodedPass = encodeURIComponent(proxyPass);
  const proxyUrl = `http://${encodedUser}:${encodedPass}@${proxyEndpoint}`;
  const typeLabel = TYPE_LABELS[params.type] ?? params.type;

  if (params.format === "env") {
    return [
      `## Proxy Configuration (Shell Environment)`,
      `type: ${typeLabel}`,
      params.country ? `targeting: ${params.country.toUpperCase()}${params.city ? ` / ${params.city}` : ""}` : "",
      params.session_id ? `session: ${params.session_id} (sticky IP)` : "",
      ``,
      `export HTTP_PROXY="${proxyUrl}"`,
      `export HTTPS_PROXY="${proxyUrl}"`,
      `export http_proxy="${proxyUrl}"`,
      `export https_proxy="${proxyUrl}"`,
      ``,
      `## Agent Hints`,
      `- Set these env vars before running HTTP requests to route through the proxy.`,
      `- Use session_id for sticky IP across multiple requests in a workflow.`,
    ].filter(l => l !== "").join("\n");
  }

  if (params.format === "curl") {
    return [
      `## Proxy Configuration (curl)`,
      `type: ${typeLabel}`,
      ``,
      `curl --proxy "${proxyUrl}" <your-url>`,
      ``,
      `## Agent Hints`,
      `- Add this flag to any curl command to route through the proxy.`,
      `- For multi-step workflows needing the same IP, add session_id param.`,
    ].join("\n");
  }

  // Default: url format
  const [host, port] = proxyEndpoint.split(":");
  return [
    `## Proxy Configuration`,
    `type: ${typeLabel}`,
    params.country ? `targeting: ${params.country.toUpperCase()}${params.city ? ` / ${params.city}` : ""}` : "",
    params.session_id ? `session: ${params.session_id} (sticky IP)` : "session: rotating (new IP per request)",
    ``,
    `proxy_url: ${proxyUrl}`,
    ``,
    `## Usage Examples`,
    ``,
    `Node.js (axios):`,
    `  proxy: { host: "${host}", port: ${port || 7777}, auth: { username: "${username}", password: "***" } }`,
    ``,
    `Python (requests):`,
    `  proxies = { "http": "${proxyUrl}", "https": "${proxyUrl}" }`,
    ``,
    `## Agent Hints`,
    `- Use this proxy_url in your HTTP client's proxy configuration.`,
    `- For consistent IP across a workflow, set session_id (e.g. "my-session-1").`,
    `- For web extraction tasks, novada_extract handles proxy routing automatically.`,
  ].filter(l => l !== "").join("\n");
}
