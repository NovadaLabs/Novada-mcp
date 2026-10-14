// ─── Surface-aware description rendering ────────────────────────────────────
// Round 4 (S1-connector, F1 — CLASS fix, independent judge 2026-10-13).
//
// Problem: a tool description can legitimately reference a SIBLING tool (e.g.
// novada_crawl's "for a whole site, use novada_site_copy instead") that exists
// on npm-package's local/stdio surface but is NOT on the hosted
// (mcp.novada.com) surface — HOSTED_HIDDEN tools like novada_site_copy are
// never ported there (writes to a read-only serverless FS). A hosted customer
// reading that description sees a recommendation for a tool they can never
// call — Directory review correctly flags this as an inaccurate description.
//
// Fix (ONE choke point, not per-tool hand edits): author sibling-only spans in
// the SOURCE description text as `{{sibling:toolName}}...{{/sibling}}`. This
// module's ONE render function is the only place that markup is interpreted,
// called at exactly two sites — npm-package's own TOOLS export (core.ts,
// rendered against REGISTERED_TOOL_NAMES — npm hides nothing, so every span
// resolves present, output is byte-identical to the un-rendered text) and
// hosted's ListTools assembly (mcp.ts, rendered against ITS OWN hosted-visible
// name set — spans referencing a hosted-hidden tool are stripped). Adding a
// 2nd/3rd sibling-only mention anywhere in the future needs ZERO new render
// logic, only the same markup convention at the new call site.
//
// Scope note: per Round 4's explicit (strict) decision, this mechanism is for
// SIBLING-TOOL mentions only (a real, structurally-defined tool that may or may
// not be visible on a given surface). It is NOT used for backward-compat ALIAS
// names (novada_wallet_balance, novada_unblock, etc.) — those must never
// appear in a model-facing description on EITHER surface at all (removed at
// the source instead; see novada_account's description + its own comment).

const SIBLING_SPAN_RE = /\{\{sibling:(novada_[a-z_]+)\}\}([\s\S]*?)\{\{\/sibling\}\}/g;

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
export function renderDescriptionForSurface(
  description: string,
  availableToolNames: ReadonlySet<string>,
): string {
  let out = description.replace(SIBLING_SPAN_RE, (_full, toolName: string, inner: string) =>
    availableToolNames.has(toolName) ? inner : "",
  );
  // Cosmetic-only cleanup of artifacts a fully-removed span can leave behind.
  // Order matters: collapse empty parens/doubled-separator pairs BEFORE the
  // generic whitespace collapse, so e.g. "(novada_site_copy)" -> "()" -> ""
  // fully disappears rather than leaving stray "()" or "( , )" behind.
  out = out
    .replace(/\(\s*\)/g, "")
    .replace(/,\s*\)/g, ")")
    .replace(/\(\s*,/g, "(")
    .replace(/ {2,}/g, " ")
    .replace(/[ \t]+([.,);])/g, "$1")
    .replace(/[ \t]+\n/g, "\n");
  return out;
}

/** Every `novada_[a-z_]+`-shaped token appearing in `text` (duplicates included,
 *  order preserved) — used by tests to prove the surface-rendered output never
 *  names a tool absent from that surface's own list. */
export function extractToolNameTokens(text: string): string[] {
  return [...text.matchAll(/\bnovada_[a-z_]+\b/g)].map((m) => m[0]);
}
