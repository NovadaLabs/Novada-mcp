import { resolveProxyCredentials } from "../utils/credentials.js";
/**
 * Build Novada proxy username with targeting options.
 * Novada format: baseUser-zone-res-country-us-city-london-session-abc123
 */
const ZONE_MAP = {
    residential: "zone-res",
    isp: "zone-isp",
    mobile: "zone-mob",
    datacenter: "zone-dcp",
    static: "zone-static",
    dedicated: "zone-dedicated",
};
function buildProxyUsername(user, params) {
    const parts = [user];
    const zone = ZONE_MAP[params.type];
    if (zone)
        parts.push(zone);
    if (params.country && params.type !== "isp")
        parts.push(`region-${params.country.toLowerCase()}`);
    if (params.city)
        parts.push(`city-${params.city.toLowerCase().replace(/\s+/g, "")}`);
    if (params.session_id)
        parts.push(`session-${params.session_id}`);
    return parts.join("-");
}
const TYPE_LABELS = {
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
export async function novadaProxy(params) {
    // INC-198: Use resolveProxyCredentials() which auto-fetches via account API
    // when only NOVADA_PROXY_ENDPOINT is set (no user/pass).
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
    // Mask username in output to prevent credential leakage
    const maskedUser = proxyUser.slice(0, 4) + "***";
    const maskedUsername = buildProxyUsername(maskedUser, params);
    const encodedMaskedUser = encodeURIComponent(maskedUsername);
    const typeLabel = TYPE_LABELS[params.type] ?? params.type;
    const maskedUrl = `http://${encodedMaskedUser}:***@${proxyEndpoint}`;
    // Shell-safe URL: uses ${NOVADA_PROXY_PASS} literal so credentials are never in tool output
    const proxyUrlShell = `http://${encodedMaskedUser}:\${NOVADA_PROXY_PASS}@${proxyEndpoint}`;
    const endpointParts = proxyEndpoint.split(":");
    const proxyHost = endpointParts[0];
    const proxyPort = endpointParts[1] ? parseInt(endpointParts[1]) : 7777;
    if (params.format === "env") {
        return [
            `## Proxy Configuration (Shell Environment)`,
            `type: ${typeLabel}`,
            params.country ? `targeting: ${params.country.toUpperCase()}${params.city ? ` / ${params.city}` : ""}` : "",
            params.session_id ? `session: ${params.session_id} (sticky IP)` : "",
            `proxy_url: ${maskedUrl}`,
            ``,
            `# Set NOVADA_PROXY_PASS in your environment first, then copy these lines:`,
            `export HTTP_PROXY="${proxyUrlShell}"`,
            `export HTTPS_PROXY="${proxyUrlShell}"`,
            `export http_proxy="${proxyUrlShell}"`,
            `export https_proxy="${proxyUrlShell}"`,
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
            `proxy_url: ${maskedUrl}`,
            ``,
            `# Set NOVADA_PROXY_PASS in your environment first:`,
            `curl --proxy "${proxyUrlShell}" <your-url>`,
            ``,
            `## Agent Hints`,
            `- Add this flag to any curl command to route through the proxy.`,
            `- For multi-step workflows needing the same IP, add session_id param.`,
        ].join("\n");
    }
    // Default: url format
    return [
        `## Proxy Configuration`,
        `type: ${typeLabel}`,
        params.country ? `targeting: ${params.country.toUpperCase()}${params.city ? ` / ${params.city}` : ""}` : "",
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
        `## Agent Hints`,
        `- proxy_url above shows *** for the password — read NOVADA_PROXY_PASS from your environment to complete it.`,
        `- For consistent IP across a workflow, set session_id (e.g. "my-session-1").`,
        `- For web extraction tasks, novada_extract handles proxy routing automatically.`,
    ].filter(l => l !== "").join("\n");
}
//# sourceMappingURL=proxy.js.map