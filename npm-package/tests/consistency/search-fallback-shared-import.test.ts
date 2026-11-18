/**
 * C1 (#39, 2026-11-18): guards against the exact drift this fix closed.
 * Before this fix, novada_search (search.ts) and novada_research
 * (research.ts) had two INDEPENDENTLY-written cross-engine-fallback
 * implementations for the identical upstream SERP failure class. The fix
 * moved the race policy into one shared module, `_core/search-fallback.ts`,
 * and made both tools import it.
 *
 * This is a permanent CI gate, not a one-time cleanup: if a future edit
 * reintroduces a second, parallel fallback implementation in either file
 * (instead of extending the shared module), this test fails immediately —
 * the same class-not-instance drift `_core/submit-retry.ts`'s own doc
 * comment warns about ("fixing this in only one of the two submit paths...
 * left every platform scraper tool exposed to the identical upstream blip").
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, "../../src");

const searchSrc = readFileSync(resolve(SRC_DIR, "tools/search.ts"), "utf-8");
const researchSrc = readFileSync(resolve(SRC_DIR, "tools/research.ts"), "utf-8");

const SHARED_IMPORT_RE = /from\s+["']\.\.\/_core\/search-fallback\.js["']/;
const RACE_FN_IMPORT_RE = /\braceEngineFallbacks\b/;

describe("search.ts and research.ts share ONE fallback-race implementation", () => {
  it("search.ts imports from _core/search-fallback.js", () => {
    expect(searchSrc).toMatch(SHARED_IMPORT_RE);
  });

  it("research.ts imports from _core/search-fallback.js", () => {
    expect(researchSrc).toMatch(SHARED_IMPORT_RE);
  });

  it("both files import the SAME race function (raceEngineFallbacks) — not two differently-named helpers", () => {
    expect(searchSrc).toMatch(RACE_FN_IMPORT_RE);
    expect(researchSrc).toMatch(RACE_FN_IMPORT_RE);
  });
});
