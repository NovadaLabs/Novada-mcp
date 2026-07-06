/**
 * Remove null, undefined, empty strings, and empty arrays from an object.
 * Prevents sending empty values to the Novada API.
 * Pattern inspired by Firecrawl MCP's removeEmptyTopLevel.
 */
export function cleanParams(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v == null)
            continue;
        if (typeof v === "string" && v.trim() === "")
            continue;
        if (Array.isArray(v) && v.length === 0)
            continue;
        if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0)
            continue;
        out[k] = v;
    }
    return out;
}
//# sourceMappingURL=params.js.map