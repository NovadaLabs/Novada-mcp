/**
 * server.json prose-description drift guard (audit finding B-4 / V1-N6).
 *
 * `tests/consistency/server-json-sync.test.ts` already guards server.json's `tools[]` array
 * (names, versions) against the registry/build output. It does NOT guard the two HAND-AUTHORED
 * prose fields that also state a tool count in English — `resources[2]` (the `novada://guide`
 * resource, uri `novada://guide`) and `skills[0]`'s description — which is exactly how B-4 shipped
 * stale ("all 11 novada tools" / "11 Novada MCP tools") while TOOL_REGISTRY had already grown to 38.
 * Those two fields are NOT touched by `scripts/gen-server-json.mjs` (see its own header comment:
 * only `version`, `packages[].version`, top-level `description`, and `tools[]` are derived — every
 * other top-level field, including `resources` and `skills`, is "hand-authored and PRESERVED
 * as-is"), so nothing previously re-validated them after a hand-edit.
 *
 * V1-verification-ABP.md's V1-N6 finding warned that simply hand-typing the CURRENT correct count
 * (38) into these strings "re-plants the same landmine — any literal count will drift again". This
 * test is the guard that closes that gap: it derives the expected count from TOOL_REGISTRY.length
 * (the single source of truth, src/tools/registry.ts) rather than hardcoding 38 anywhere in this
 * file, and it fails loudly the moment TOOL_REGISTRY grows/shrinks without these strings being
 * updated to match.
 *
 * Not-inert proof: the "general sweep" test below is exercised against a synthetic fixture object
 * (never the real server.json) to prove the regex/comparison logic actually flags a mismatched
 * count, mirroring the self-check pattern in tests/tools/discover.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_REGISTRY } from "../../src/tools/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const serverJson = JSON.parse(readFileSync(resolve(__dirname, "../../server.json"), "utf8"));
const rootReadme = readFileSync(resolve(__dirname, "../../../README.md"), "utf8");
const npmReadme = readFileSync(resolve(__dirname, "../../README.md"), "utf8");
const toolsDoc = readFileSync(resolve(__dirname, "../../../docs/TOOLS.md"), "utf8");

const EXPECTED = TOOL_REGISTRY.length; // never hardcode this — derive it, every time

/**
 * Recursively collects every string value in a JSON-parsed object/array tree.
 * Used to sweep server.json for stray tool-count mentions regardless of which
 * field they live in — a new hand-authored field with a stale count is caught
 * automatically, without this test needing to know the field's path.
 */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
  return out;
}

/**
 * Finds every "<number> [novada|Novada MCP] tool(s)" mention in a string and returns the
 * matched numbers. server.json's prose fields only ever state the GLOBAL tool count this way
 * (verified: grep -noE "[0-9]+[^\"]*tool" server.json returns exactly the resources[2] and
 * skills[0] hits, both stating the total) — unlike README.md/TOOLS.md, which also legitimately
 * mention subset counts ("8 tools that don't apply", "15 typed per-platform tools"), so this
 * blind-sweep approach is safe for server.json specifically but NOT reused against the READMEs
 * below (those use a targeted positive-match instead, see next describe block).
 */
function toolCountMentions(text: string): number[] {
  const re = /(\d+)\s+(novada\s+)?(Novada MCP\s+)?tools?\b/gi;
  const matches: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) matches.push(Number(m[1]));
  return matches;
}

describe("server.json prose descriptions never disagree with TOOL_REGISTRY.length", () => {
  it("sanity: TOOL_REGISTRY has more than a handful of tools (guards against an empty-import false pass)", () => {
    expect(EXPECTED).toBeGreaterThan(20);
  });

  // 2026-09-03 gap closure: scripts/gen-server-json.mjs hardcodes the top-level `description`
  // it writes on every `npm run build` — a prior 164-char value silently shipped a
  // schema-INVALID server.json (official registry schema: maxLength 100) on every rebuild,
  // even after a hand-edit brought the checked-in file back under the limit. This assertion
  // makes that class of regression fail the SAME test suite the generator's own comment now
  // points at, instead of only surfacing via a manual ajv run.
  it("top-level description is within the registry schema's maxLength:100 (verified live against static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json)", () => {
    expect(typeof serverJson.description).toBe("string");
    expect(
      serverJson.description.length,
      `server.json top-level description is ${serverJson.description.length} chars (max 100) — check both the checked-in file AND scripts/gen-server-json.mjs's hardcoded string, since the generator overwrites this field on every build: "${serverJson.description}"`
    ).toBeLessThanOrEqual(100);
  });

  it("the novada://guide resource description states the current tool count", () => {
    const guide = (serverJson.resources as Array<{ uri: string; description: string }>).find(
      (r) => r.uri === "novada://guide"
    );
    expect(guide, "server.json is missing the novada://guide resource entry").toBeTruthy();
    const mentions = toolCountMentions(guide!.description);
    expect(mentions.length, `novada://guide description has no "<N> tools" mention: "${guide!.description}"`).toBeGreaterThan(0);
    for (const n of mentions) {
      expect(n, `novada://guide description states ${n} tools, but TOOL_REGISTRY has ${EXPECTED} — update server.json`).toBe(EXPECTED);
    }
  });

  it("skills[0] description states the current tool count", () => {
    const skill = (serverJson.skills as Array<{ name: string; description: string }>)[0];
    expect(skill, "server.json has no skills[0] entry").toBeTruthy();
    const mentions = toolCountMentions(skill.description);
    expect(mentions.length, `skills[0] description has no "<N> tools" mention: "${skill.description}"`).toBeGreaterThan(0);
    for (const n of mentions) {
      expect(n, `skills[0] description states ${n} tools, but TOOL_REGISTRY has ${EXPECTED} — update server.json`).toBe(EXPECTED);
    }
  });

  it("general sweep: every '<N> tool(s)' mention anywhere in server.json equals TOOL_REGISTRY.length", () => {
    const allStrings = collectStrings(serverJson);
    const offenders: Array<{ text: string; found: number }> = [];
    for (const s of allStrings) {
      for (const n of toolCountMentions(s)) {
        if (n !== EXPECTED) offenders.push({ text: s, found: n });
      }
    }
    expect(
      offenders,
      `server.json contains stale tool-count mention(s): ${JSON.stringify(offenders)} — TOOL_REGISTRY.length is ${EXPECTED}`
    ).toEqual([]);
  });

  // Not-inert proof: same sweep logic against a synthetic fixture with an injected stale count,
  // proving toolCountMentions() + the comparison actually fire rather than being vacuously green.
  it("self-check: the sweep detector fires on an injected stale count (proves it isn't inert)", () => {
    const fixture = {
      resources: [{ uri: "novada://guide", description: `all ${EXPECTED - 1} novada tools: search, extract` }],
    };
    const allStrings = collectStrings(fixture);
    const offenders = allStrings.flatMap((s) => toolCountMentions(s).filter((n) => n !== EXPECTED));
    expect(offenders).toEqual([EXPECTED - 1]);
  });
});

describe("README.md / npm-package/README.md / docs/TOOLS.md headline tool count matches TOOL_REGISTRY.length", () => {
  // Positive-match only (not a blind sweep, unlike server.json above): these three files also
  // legitimately mention SUBSET counts ("8 tools that don't apply to hosted", "15 typed
  // per-platform scrapers") which a blind sweep would wrongly flag. We only assert the headline
  // "<N> tools" phrase is present and correct — same safe pattern tests/tools/discover.test.ts
  // already uses for README.md/root README.md/SKILL.md, reused here so docs/TOOLS.md (previously
  // unguarded by any test) gets the same protection, and so the expected number is derived from
  // TOOL_REGISTRY.length directly rather than a second hardcoded literal.
  const headlinePattern = new RegExp(`\\b${EXPECTED}\\s+(curated\\s+)?tools\\b`, "i");

  it("root README.md states the current headline tool count", () => {
    expect(rootReadme).toMatch(headlinePattern);
  });

  it("npm-package/README.md states the current headline tool count", () => {
    expect(npmReadme).toMatch(headlinePattern);
  });

  it("docs/TOOLS.md states the current headline tool count", () => {
    expect(toolsDoc).toMatch(headlinePattern);
  });
});
