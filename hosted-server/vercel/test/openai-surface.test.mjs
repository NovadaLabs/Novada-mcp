/**
 * Per-client tool surfaces (api/_surface.ts) — the "openai" surface served to
 * OAuth clients whose redirect URIs are on chatgpt.com / openai.com.
 *
 * Layers covered here (the end-to-end path through the built server is in
 * openai-surface-e2e.test.mjs):
 *   1. classifyRedirectUris — which registrations select the surface.
 *   2. resolveClientSurface — caching and failure fallback.
 *   3. The rendered tool list itself, reproduced with the REAL vendored
 *      buildToolsForSurface + the REAL policy (same inputs mcp.ts's
 *      buildSurfaceTools uses): names, descriptions, annotations, wording.
 *
 * Runs on plain Node ≥22.18 (`node --test`) — same runtime as the rest of this dir.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  classifyRedirectUris,
  resolveClientSurface,
  resetClientSurfaceCacheForTests,
  OPENAI_SURFACE_TOOLS,
  SURFACE_POLICIES,
  applyAnnotationRules,
} from "../api/_surface.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDOR = join(__dirname, "..", "vendor", "novada-mcp");
const { TOOLS: CORE_TOOLS, buildToolsForSurface } = await import(join(VENDOR, "core.js"));
const { extractToolNameTokens } = await import(join(VENDOR, "_core", "description_surface.js"));
const surfaces = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "config", "surfaces.json"), "utf8")).surfaces;

// ─── 1. classifyRedirectUris ────────────────────────────────────────────────

const CLASSIFY_CASES = [
  ["ChatGPT connector callback", ["https://chatgpt.com/connector_platform_oauth_redirect"], "openai"],
  ["OpenAI platform callback", ["https://platform.openai.com/apps-manage/oauth"], "openai"],
  ["subdomain of chatgpt.com", ["https://auth.chatgpt.com/cb"], "openai"],
  ["bare openai.com", ["https://openai.com/cb"], "openai"],
  ["uppercase host", ["https://ChatGPT.com/cb"], "openai"],
  ["trailing-dot host", ["https://chatgpt.com./cb"], "openai"],
  ["one matching URI among several", ["http://localhost:6274/cb", "https://chatgpt.com/cb"], "openai"],
  ["lookalike prefix (substring, not a domain match)", ["https://evilchatgpt.com/cb"], "default"],
  ["lookalike suffix domain", ["https://chatgpt.com.example.net/cb"], "default"],
  ["openai.com in the path only", ["https://example.com/openai.com/cb"], "default"],
  ["openai.com in userinfo only", ["https://openai.com@example.com/cb"], "default"],
  ["plain http on chatgpt.com", ["http://chatgpt.com/cb"], "default"],
  ["Claude", ["https://claude.ai/api/mcp/auth_callback"], "default"],
  ["localhost dev client", ["http://127.0.0.1:33418/callback"], "default"],
  ["malformed URI", ["not a url"], "default"],
  ["no URIs", [], "default"],
];

for (const [label, uris, expected] of CLASSIFY_CASES) {
  test(`classifyRedirectUris: ${label} → ${expected}`, () => {
    assert.equal(classifyRedirectUris(uris), expected);
  });
}

// ─── 2. resolveClientSurface ────────────────────────────────────────────────

test("resolveClientSurface caches a resolved client (client records are immutable)", async () => {
  resetClientSurfaceCacheForTests();
  let calls = 0;
  const lookup = async () => { calls++; return ["https://chatgpt.com/cb"]; };
  assert.equal(await resolveClientSurface("client-a", lookup), "openai");
  assert.equal(await resolveClientSurface("client-a", lookup), "openai");
  assert.equal(calls, 1);
});

test("resolveClientSurface: unknown client → default, not cached (retried next request)", async () => {
  resetClientSurfaceCacheForTests();
  let calls = 0;
  const lookup = async () => { calls++; return null; };
  assert.equal(await resolveClientSurface("client-gone", lookup), "default");
  assert.equal(await resolveClientSurface("client-gone", lookup), "default");
  assert.equal(calls, 2);
});

test("resolveClientSurface: storage error → default for that request, never throws, not cached", async () => {
  resetClientSurfaceCacheForTests();
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls === 1) throw new Error("ECONNRESET");
    return ["https://chatgpt.com/cb"];
  };
  const origError = console.error;
  console.error = () => {};
  try {
    assert.equal(await resolveClientSurface("client-flaky", flaky), "default");
  } finally {
    console.error = origError;
  }
  assert.equal(await resolveClientSurface("client-flaky", flaky), "openai");
});

// ─── 3. The rendered OpenAI tool list ───────────────────────────────────────

const policy = SURFACE_POLICIES.openai;
// Same computation as mcp.ts buildSurfaceTools (minus titles, which are not under test here).
const openaiTools = buildToolsForSurface(OPENAI_SURFACE_TOOLS)
  .filter((t) => OPENAI_SURFACE_TOOLS.has(t.name))
  .map((t) => ({ ...t, annotations: applyAnnotationRules(t.name, t.annotations, policy.annotationRules) }));
const coreByName = new Map(CORE_TOOLS.map((t) => [t.name, t]));

function allStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object") for (const v of Object.values(value)) allStrings(v, out);
  return out;
}

test("openai surface lists exactly the 17 reviewed tools, all of them real", () => {
  assert.equal(OPENAI_SURFACE_TOOLS.size, 17);
  assert.deepEqual(new Set(openaiTools.map((t) => t.name)), OPENAI_SURFACE_TOOLS);
  assert.deepEqual(new Set(surfaces.openai.tools), OPENAI_SURFACE_TOOLS, "config/surfaces.json must match _surface.ts");
});

test("no description or parameter text names a tool the openai surface does not list", () => {
  for (const t of openaiTools) {
    for (const s of allStrings({ description: t.description, inputSchema: t.inputSchema })) {
      const foreign = extractToolNameTokens(s).filter((n) => !OPENAI_SURFACE_TOOLS.has(n));
      assert.deepEqual(foreign, [], `${t.name} mentions ${foreign.join(", ")}`);
    }
  }
});

test("no unrendered sibling markup survives on the openai surface", () => {
  for (const t of openaiTools) assert.doesNotMatch(t.description, /\{\{\/?sibling/, t.name);
});

// Pricing / promotional / comparative wording the OpenAI review rejects
// (spec 2026-11-04 §3). One row per pattern, applied to every string of every
// listed tool (descriptions AND parameter descriptions).
const BANNED_WORDING = [
  /\$\s?\d/,
  /free credits?/i,
  /free (trial|tier|calls?)/i,
  /\btrial\b/i,
  /\bdiscount/i,
  /\bcheap(er|est)?\b/i,
  /low[- ]cost|cost[- ]effective|cost[- ]efficient/i,
  /\bfaster\b|\bfastest\b/i,
  /\bslower\b|\bslowest\b/i,
  /most reliable/i,
  /\bstrongest\b/i,
  /more thorough/i,
  /\d+-\d+x faster/i,
  /raw SERP dump/i,
];

test("no pricing, promotional, or comparative wording anywhere in the openai tool list", () => {
  for (const t of openaiTools) {
    for (const s of allStrings({ description: t.description, inputSchema: t.inputSchema })) {
      for (const re of BANNED_WORDING) {
        assert.doesNotMatch(s, re, `${t.name}: "${(s.match(re) || [""])[0]}" in: ${s.slice(0, 160)}`);
      }
    }
  }
});

test("platform scrapers are marked not read-only (they queue scrape jobs) and not destructive", () => {
  const scrapers = openaiTools.filter((t) => t.name.startsWith("novada_scrape_"));
  assert.equal(scrapers.length, 9);
  for (const t of scrapers) {
    assert.equal(t.annotations.readOnlyHint, false, t.name);
    assert.equal(t.annotations.destructiveHint, false, t.name);
  }
});

test("every other tool keeps its own annotations unchanged", () => {
  for (const t of openaiTools.filter((x) => !x.name.startsWith("novada_scrape_"))) {
    assert.deepEqual(t.annotations, coreByName.get(t.name).annotations, t.name);
  }
});

test("annotation overrides never leak into the default surface's catalog objects", () => {
  for (const t of CORE_TOOLS.filter((x) => x.name.startsWith("novada_scrape_"))) {
    assert.equal(t.annotations.readOnlyHint, true, `${t.name} on the default surface must stay as authored`);
  }
});

test("openai initialize instructions name only listed tools and carry no pricing wording", () => {
  const foreign = extractToolNameTokens(policy.instructions).filter((n) => !OPENAI_SURFACE_TOOLS.has(n));
  assert.deepEqual(foreign, []);
  for (const re of BANNED_WORDING) assert.doesNotMatch(policy.instructions, re);
  for (const name of OPENAI_SURFACE_TOOLS) assert.ok(policy.instructions.includes(name), `instructions should route to ${name}`);
});

test("openai policy: no hidden aliases, no first-run notice, no local-server pointers, own not-listed message", () => {
  assert.equal(policy.routeHiddenAliases, false);
  assert.equal(policy.firstRunNotice, false);
  assert.equal(policy.mentionLocalServer, false);
  const msg = policy.notOnSurfaceMessage("novada_scrape");
  assert.match(msg, /TOOL_NOT_ENABLED/);
  assert.doesNotMatch(msg, /npx|npm|local MCP/i);
});

test("default policy is today's behavior (all switches on, no instructions, no overrides)", () => {
  const d = SURFACE_POLICIES.default;
  assert.equal(d.tools, null);
  assert.deepEqual(d.annotationRules, []);
  assert.equal(d.routeHiddenAliases, true);
  assert.equal(d.firstRunNotice, true);
  assert.equal(d.promptsAndResources, true);
  assert.equal(d.mentionLocalServer, true);
  assert.equal(d.instructions, undefined);
  assert.equal(d.notOnSurfaceMessage, undefined);
});
