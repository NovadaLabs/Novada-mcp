/**
 * Remove null, undefined, empty strings, and empty arrays from an object.
 * Prevents sending empty values to the Novada API.
 * Pattern inspired by Firecrawl MCP's removeEmptyTopLevel.
 */
export declare function cleanParams<T extends Record<string, unknown>>(obj: T): Partial<T>;
//# sourceMappingURL=params.d.ts.map