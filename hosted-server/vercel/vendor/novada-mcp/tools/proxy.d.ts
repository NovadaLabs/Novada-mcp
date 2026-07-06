import type { ProxyParams } from "./types.js";
/**
 * Return proxy configuration for use in HTTP clients, curl, or shell.
 *
 * Agents use this when they need to make HTTP requests through a residential proxy,
 * bypass geo-restrictions, or maintain IP consistency across a session.
 */
export declare function novadaProxy(params: ProxyParams): Promise<string>;
//# sourceMappingURL=proxy.d.ts.map