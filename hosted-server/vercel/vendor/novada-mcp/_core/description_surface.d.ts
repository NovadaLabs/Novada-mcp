/**
 * Render `description`'s `{{sibling:toolName}}...{{/sibling}}` spans against
 * `availableToolNames` — the exact, real tool-name set the SERVING surface
 * actually lists. A span whose tool IS available keeps its inner text as-is
 * (indistinguishable from never having been marked up); a span whose tool is
 * NOT available is removed entirely (not replaced with a placeholder — the
 * surrounding sentence must still read as a complete, accurate claim without
 * it). Cosmetic whitespace/punctuation cleanup follows so a fully-stripped
 * sentence or bullet doesn't leave a dangling double-space, empty
 * parenthetical, or stray leading comma behind.
 */
export declare function renderDescriptionForSurface(description: string, availableToolNames: ReadonlySet<string>): string;
/** Every `novada_[a-z_]+`-shaped token appearing in `text` (duplicates included,
 *  order preserved) — used by tests to prove the surface-rendered output never
 *  names a tool absent from that surface's own list. */
export declare function extractToolNameTokens(text: string): string[];
//# sourceMappingURL=description_surface.d.ts.map