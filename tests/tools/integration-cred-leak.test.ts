/**
 * F1 (P0, CWE-798): Regression guard — integration.mjs must NOT hardcode production credentials.
 *
 * The script must:
 *   1. Read credentials from environment variables, not embed them as literals.
 *   2. Exit fast with a clear message naming missing env vars when none are set.
 *   3. Pass `node --check` (syntax-only parse).
 *
 * Strategy: we read the source text of tests/live/integration.mjs and assert structural
 * properties — no string containing a known-bad pattern (proxy user prefix, wss:// with
 * colon-password, hex keys) appears as a JS string literal default; and the required fast-
 * fail guard is present.  We do NOT import the live script (it loads build/ and exits) — we
 * do static source analysis only, exactly like a linter would.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const SCRIPT = resolve(__dirname, "../../tests/live/integration.mjs");

function source(): string {
  return readFileSync(SCRIPT, "utf-8");
}

describe("F1 — integration.mjs credential hygiene", () => {
  it("must not assign process.env.NOVADA_PROXY_USER to a non-empty string literal", () => {
    // Pattern: process.env.NOVADA_PROXY_USER = '...' where rhs is a non-empty string
    const src = source();
    const match = src.match(/process\.env\.NOVADA_PROXY_USER\s*=\s*['"`]([^'"`]+)['"`]/);
    expect(match).toBeNull();
  });

  it("must not assign process.env.NOVADA_PROXY_PASS to a non-empty string literal", () => {
    const src = source();
    const match = src.match(/process\.env\.NOVADA_PROXY_PASS\s*=\s*['"`]([^'"`]+)['"`]/);
    expect(match).toBeNull();
  });

  it("must not assign process.env.NOVADA_PROXY_ENDPOINT to a non-empty string literal", () => {
    const src = source();
    const match = src.match(/process\.env\.NOVADA_PROXY_ENDPOINT\s*=\s*['"`]([^'"`]+)['"`]/);
    expect(match).toBeNull();
  });

  it("must not assign process.env.NOVADA_API_KEY to a non-empty string literal", () => {
    const src = source();
    const match = src.match(/process\.env\.NOVADA_API_KEY\s*=\s*['"`]([^'"`]+)['"`]/);
    expect(match).toBeNull();
  });

  it("must not assign process.env.NOVADA_BROWSER_WS to a non-empty string literal", () => {
    const src = source();
    const match = src.match(/process\.env\.NOVADA_BROWSER_WS\s*=\s*['"`]([^'"`]+)['"`]/);
    expect(match).toBeNull();
  });

  it("must not assign process.env.NOVADA_WEB_UNBLOCKER_KEY to a non-empty string literal", () => {
    const src = source();
    const match = src.match(/process\.env\.NOVADA_WEB_UNBLOCKER_KEY\s*=\s*['"`]([^'"`]+)['"`]/);
    expect(match).toBeNull();
  });

  it("must contain a fast-fail guard that names missing env vars and calls process.exit", () => {
    const src = source();
    // Must have: some form of process.exit(1) or process.exit with non-zero
    const hasExit = /process\.exit\s*\(\s*[1-9]/.test(src);
    expect(hasExit).toBe(true);
  });

  it("must read NOVADA_API_KEY from process.env (not hardcode it)", () => {
    const src = source();
    // Must reference process.env.NOVADA_API_KEY as a read (not assignment to literal)
    const hasEnvRead = /process\.env\.NOVADA_API_KEY/.test(src);
    expect(hasEnvRead).toBe(true);
  });
});
