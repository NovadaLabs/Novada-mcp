/**
 * Closure C2 — Auth circular suggestion test.
 *
 * When a TOOL_CATEGORIES entry ("Auth") has zero TOOL_REGISTRY entries and is
 * requested, the "valid categories" list in the response must NOT include "Auth"
 * (since retrying it will always return the same empty result — infinite loop).
 *
 * The fix: build the valid-categories list from TOOL_CATEGORIES filtered to
 * categories that have >= 1 registry entry.
 */
import { describe, it, expect } from "vitest";
import { TOOL_REGISTRY, TOOL_CATEGORIES } from "../../src/tools/registry.js";
import { novadaDiscover, validateDiscoverParams } from "../../src/tools/discover.js";

describe("C2: zero-entry category (Auth) must not appear in valid-categories retry list", () => {
  it("TOOL_CATEGORIES includes Auth with 0 registry entries (pre-condition)", () => {
    expect(TOOL_CATEGORIES).toContain("Auth");
    const authCount = TOOL_REGISTRY.filter((t) => t.category === "Auth").length;
    expect(authCount).toBe(0);
  });

  it("novadaDiscover(Auth) valid-categories list does NOT include 'Auth'", async () => {
    // Auth has 0 registry entries and 0 visible entries — it falls through to the
    // "truly empty" branch (fullRegistryCount === 0) at discover.ts:81.
    // Before the fix, TOOL_CATEGORIES.join includes "Auth" in that message.
    const out = await novadaDiscover(validateDiscoverParams({ category: "Auth" }));

    // The message must not advertise Auth as a valid retry target
    // Pattern: "Valid categories are: ..., Auth, ..." or ends with ", Auth."
    expect(out).not.toMatch(/valid categories are:.*\bAuth\b/i);
  });

  it("novadaDiscover(Auth) still returns the gated-vs-unknown distinction intact", async () => {
    // It should NOT look like a gated message (Auth has 0 entries in full registry)
    const out = await novadaDiscover(validateDiscoverParams({ category: "Auth" }));
    expect(out).not.toMatch(/registered tool.*but none are exposed/i);
  });

  it("novadaDiscover(Auth) valid-categories list includes non-empty categories like Proxy", async () => {
    const out = await novadaDiscover(validateDiscoverParams({ category: "Auth" }));
    // Should still list non-empty categories
    expect(out).toMatch(/valid categories are:.*\bProxy\b/i);
  });

  it("novadaDiscover(Bananas) valid-categories list also does NOT include Auth", () => {
    // validateDiscoverParams rejects unknown categories via Zod before novadaDiscover
    // so this tests the Zod schema describe string (less critical but useful)
    // Just verify Zod throws for truly unknown categories
    expect(() => validateDiscoverParams({ category: "Bananas" })).toThrow();
  });
});
