/**
 * G-8 (P3, audit 2026-09-02, npm-package/src/index.ts:372) — the auto-provisioned
 * proxy sub-account username was logged RAW to stderr on cold-start auto-provision:
 *
 *   console.error(`[novada] Auto-provisioned proxy credentials (account: ${autoCreds.user})`);
 *
 * autoCreds.user is a Novada proxy sub-account username, shaped like
 * `<customer>-<id>-zone-<flow>` (e.g. "customer-abc123-zone-res") — the codebase's
 * OWN redactSecrets() rule #4 (src/_core/errors.ts) classifies that exact `*-zone-*`
 * shape as a secret and strips it to "[proxy-username]" everywhere else in the
 * codebase (every tool error, every hosted response). This log line was the one
 * place that shape reached stderr unredacted. Local stdio only, own credential,
 * password never logged → P3 — but the fix is one call, so no reason to leave it.
 *
 * src/index.ts boots a stdio MCP server at module top-level (server.run() runs
 * unconditionally, no import.meta guard) and must NEVER be imported by a test —
 * see tests/tools/discover.test.ts and tests/tools/tool-definitions.test.ts's
 * header comments for the same constraint. So this file follows the established
 * pattern (tests/audit/playbook.test.ts) of reading src/index.ts as text and
 * asserting against its source, PLUS an extract-and-execute step that runs the
 * REAL template-literal expression (not a reimplementation) against a
 * realistic zone-shaped username and the real redactSecrets(), so the test
 * proves the rendered stderr line is actually clean — not just that some call
 * to redactSecrets appears somewhere nearby.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { redactSecrets } from "../../src/_core/errors.js";

const indexSrc = readFileSync(new URL("../../src/index.ts", import.meta.url), "utf8");

describe("G-8: auto-provisioned proxy credential log is redacted", () => {
  it("the auto-provision console.error call site exists at its known anchor", () => {
    expect(indexSrc).toContain("Auto-provisioned proxy credentials");
  });

  it("does NOT interpolate autoCreds.user raw into the log template", () => {
    // This is the exact pre-fix pattern (G-8's claim) — must be gone.
    expect(indexSrc).not.toMatch(/\$\{autoCreds\.user\}/);
  });

  it("routes autoCreds.user through redactSecrets() before logging", () => {
    const anchor = "Auto-provisioned proxy credentials";
    const anchorIdx = indexSrc.indexOf(anchor);
    expect(anchorIdx, "anchor must exist").toBeGreaterThan(-1);
    const callStart = indexSrc.lastIndexOf("console.error(", anchorIdx);
    expect(callStart, "console.error( call site must precede the anchor").toBeGreaterThan(-1);
    const callEnd = indexSrc.indexOf(");", anchorIdx) + 2;
    const callSite = indexSrc.slice(callStart, callEnd);
    expect(callSite).toMatch(/redactSecrets\(autoCreds\.user\)/);
  });

  it("extract-and-execute: the REAL template literal, given a zone-shaped username, never emits the raw username to stderr", () => {
    const anchor = "Auto-provisioned proxy credentials";
    const anchorIdx = indexSrc.indexOf(anchor);
    const callStart = indexSrc.lastIndexOf("console.error(", anchorIdx);
    const callEnd = indexSrc.indexOf(");", anchorIdx) + 2;
    const callSite = indexSrc.slice(callStart, callEnd);

    const templateMatch = callSite.match(/console\.error\((`[\s\S]*`)\)/);
    expect(templateMatch, "must be a template-literal console.error call").not.toBeNull();

    // Execute the ACTUAL template expression from the source (not a reimplementation),
    // with the real redactSecrets and a realistic zone-shaped username injected.
    const buildLine = new Function("autoCreds", "redactSecrets", `return ${templateMatch![1]};`);
    const autoCreds = { user: "customer-abc123-zone-res", pass: "s3cret-pass-irrelevant" };
    const line: string = buildLine(autoCreds, redactSecrets);

    expect(line).not.toContain(autoCreds.user);
    expect(line).not.toContain("zone-res");
    expect(line).toContain("[proxy-username]"); // redactSecrets' own placeholder for *-zone-* usernames
    // Sanity: prove this test would have caught the pre-fix bug (raw interpolation
    // would have put the exact username in the line).
    expect(`account: ${autoCreds.user}`).not.toEqual(line.match(/account: .*/)?.[0]);
  });
});
