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

// ─── Runtime-only text (2026-11-12, OpenAI plugin review round 2) ───────────
// Some description text is true on only ONE runtime: "every extraction is
// written to ~/Downloads/..." and "Self-host: set NOVADA_PROXY_USER/PASS" hold
// for the local npm server, but the hosted endpoint never writes to disk and
// has no env to configure. Shown on hosted, that text is inaccurate — and the
// OpenAI review read the auto-save line as a user-visible side effect on a
// readOnlyHint tool. Same choke point as sibling spans: author such text as
// `{{local}}...{{/local}}` (or `{{hosted}}...{{/hosted}}`); the span keeps its
// inner text on the matching runtime and is removed on the other.
export type ServingRuntime = "local" | "hosted";
const RUNTIME_SPAN_RE = /\{\{(local|hosted)\}\}([\s\S]*?)\{\{\/\1\}\}/g;

/**
 * Input-schema properties that do nothing on the hosted runtime, so hosted does
 * not advertise them. One row per parameter; `tools: "*"` = every tool that has
 * it. The schemas still ACCEPT these keys (a client sending one is not
 * rejected) — they are only left out of the listed inputSchema.
 */
export const HOSTED_INERT_PARAMS: ReadonlyArray<{ param: string; tools: "*" | readonly string[]; reason: string }> = [
  { param: "project", tools: "*", reason: "groups saved output files into a subfolder; hosted never writes output files" },
  { param: "verify", tools: ["novada_proxy"], reason: "the live IP-echo check runs on local/stdio only; hosted skips it" },
];

function isHostedInert(toolName: string, param: string): boolean {
  return HOSTED_INERT_PARAMS.some((r) => r.param === param && (r.tools === "*" || r.tools.includes(toolName)));
}

/**
 * Render a tool's inputSchema for `runtime`: runtime/sibling spans in every
 * property description are resolved exactly like the tool description, and on
 * hosted the HOSTED_INERT_PARAMS rows are removed (from `properties` and
 * `required`). Never mutates the input.
 */
export function renderInputSchemaForSurface(
  toolName: string,
  inputSchema: Record<string, unknown>,
  availableToolNames: ReadonlySet<string>,
  runtime: ServingRuntime,
): Record<string, unknown> {
  const props = inputSchema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!props) return inputSchema;
  const outProps: Record<string, Record<string, unknown>> = {};
  for (const [name, prop] of Object.entries(props)) {
    if (runtime === "hosted" && isHostedInert(toolName, name)) continue;
    outProps[name] = typeof prop.description === "string"
      ? { ...prop, description: renderDescriptionForSurface(prop.description, availableToolNames, runtime) }
      : prop;
  }
  const out: Record<string, unknown> = { ...inputSchema, properties: outProps };
  if (Array.isArray(inputSchema.required)) {
    out.required = (inputSchema.required as string[]).filter((n) => n in outProps);
  }
  return out;
}

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
export function renderDescriptionForSurface(
  description: string,
  availableToolNames: ReadonlySet<string>,
  runtime: ServingRuntime,
): string {
  let out = description
    .replace(SIBLING_SPAN_RE, (_full, toolName: string, inner: string) =>
      availableToolNames.has(toolName) ? inner : "",
    )
    .replace(RUNTIME_SPAN_RE, (_full, spanRuntime: string, inner: string) =>
      spanRuntime === runtime ? inner : "",
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
