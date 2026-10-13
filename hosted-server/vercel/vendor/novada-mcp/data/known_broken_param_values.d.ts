export interface KnownBrokenParamValue {
    /** Catalog platform domain, e.g. "yandex.com" — matches novadaScrape's `platform`. */
    platform: string;
    /** Catalog operation slug, e.g. "yandex" — matches novadaScrape's resolved `operation`. */
    operation: string;
    /** The params key this broken value appears under, e.g. "yandex_domain". */
    param: string;
    /** The exact broken value (string-compared against the caller's param). */
    value: string;
    /** Date this was live-verified against the real backend. */
    verifiedOn: string;
    /** What was actually observed (upstream code/message, success/fail ratio). */
    evidence: string;
    /** Values for the SAME param, on the SAME platform/operation, confirmed working. */
    workingAlternatives: string[];
}
export declare const KNOWN_BROKEN_PARAM_VALUES: readonly KnownBrokenParamValue[];
/**
 * Pure lookup — true iff `platform`/`operation`/`param`/`value` exactly matches a
 * row in KNOWN_BROKEN_PARAM_VALUES. `value` is compared as a string (params
 * flowing through MCP tool calls are frequently strings regardless of the
 * caller's JS type, so this coerces rather than requiring strict `===`).
 */
export declare function findKnownBrokenParamValue(platform: string, operation: string, param: string, value: unknown): KnownBrokenParamValue | undefined;
//# sourceMappingURL=known_broken_param_values.d.ts.map