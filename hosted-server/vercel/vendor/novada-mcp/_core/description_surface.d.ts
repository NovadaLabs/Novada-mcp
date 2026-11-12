export type ServingRuntime = "local" | "hosted";
/**
 * Input-schema properties that do nothing on the hosted runtime, so hosted does
 * not advertise them. One row per parameter; `tools: "*"` = every tool that has
 * it. The schemas still ACCEPT these keys (a client sending one is not
 * rejected) — they are only left out of the listed inputSchema.
 */
export declare const HOSTED_INERT_PARAMS: ReadonlyArray<{
    param: string;
    tools: "*" | readonly string[];
    reason: string;
}>;
/**
 * Render a tool's inputSchema for `runtime`: runtime/sibling spans in every
 * property description are resolved exactly like the tool description, and on
 * hosted the HOSTED_INERT_PARAMS rows are removed (from `properties` and
 * `required`). Never mutates the input.
 */
export declare function renderInputSchemaForSurface(toolName: string, inputSchema: Record<string, unknown>, availableToolNames: ReadonlySet<string>, runtime: ServingRuntime): Record<string, unknown>;
/**
 * Render `description`'s `{{sibling:toolName}}...{{/sibling}}` spans against
 * `availableToolNames` — the exact, real tool-name set the SERVING surface
 * actually lists. A span whose tool IS available keeps its inner text as-is
 * (indistinguishable from never having been marked up); a span whose tool is
 * NOT available is removed entirely (not replaced with a placeholder — the
 * surrounding sentence must still read as a complete, accurate claim without
 * it). `{{local}}`/`{{hosted}}` spans are kept only on the matching `runtime`.
 * Cosmetic whitespace/punctuation cleanup follows so a fully-stripped
 * sentence or bullet doesn't leave a dangling double-space, empty
 * parenthetical, or stray leading comma behind.
 */
export declare function renderDescriptionForSurface(description: string, availableToolNames: ReadonlySet<string>, runtime: ServingRuntime): string;
/** Every `novada_[a-z_]+`-shaped token appearing in `text` (duplicates included,
 *  order preserved) — used by tests to prove the surface-rendered output never
 *  names a tool absent from that surface's own list. */
export declare function extractToolNameTokens(text: string): string[];
//# sourceMappingURL=description_surface.d.ts.map