/**
 * Closure C2 / Round-3f — Auth must be completely absent from the Zod enum.
 *
 * The root-cause fix (Round-3f): derive the DiscoverParamsSchema Zod enum from
 * POPULATED_TOOL_CATEGORIES (categories with >= 1 registry entry), so Auth never
 * enters the enum at all. This means:
 *   - validateDiscoverParams({ category: "Auth" }) throws ZodError (Zod rejects it)
 *   - The inputSchema enum does NOT contain "Auth"
 *   - The Zod validation-error "valid values" hint does NOT contain "Auth"
 *   - All three surfaces (enum, description, validation hint) are clean at the source.
 *
 * The earlier C2 runtime fix (filtering the "valid categories" string in novadaDiscover)
 * remains intact as defence-in-depth, but is now unreachable for "Auth" since Zod
 * rejects it before the function is ever invoked.
 */
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { TOOL_REGISTRY, TOOL_CATEGORIES, POPULATED_TOOL_CATEGORIES } from "../../src/tools/registry.js";
import { novadaDiscover, validateDiscoverParams, DiscoverParamsSchema } from "../../src/tools/discover.js";

describe("C2: zero-entry category (Auth) must not appear in valid-categories retry list", () => {
  it("TOOL_CATEGORIES includes Auth with 0 registry entries (pre-condition)", () => {
    expect(TOOL_CATEGORIES).toContain("Auth");
    const authCount = TOOL_REGISTRY.filter((t) => t.category === "Auth").length;
    expect(authCount).toBe(0);
  });

  it("POPULATED_TOOL_CATEGORIES does NOT include Auth (root-cause fix)", () => {
    expect(POPULATED_TOOL_CATEGORIES).not.toContain("Auth");
    // Must still include all non-empty categories
    expect(POPULATED_TOOL_CATEGORIES).toContain("Proxy");
    expect(POPULATED_TOOL_CATEGORIES).toContain("Content Retrieval");
  });

  it("validateDiscoverParams rejects Auth — Zod throws since Auth is not in the enum", () => {
    // Root-cause fix: Auth is no longer in the Zod enum, so it is rejected here,
    // not at the novadaDiscover runtime layer.
    expect(() => validateDiscoverParams({ category: "Auth" })).toThrow(ZodError);
  });

  it("Zod validation error for 'Auth' does NOT list Auth in valid values hint", () => {
    let validValues: string[] = [];
    try {
      validateDiscoverParams({ category: "Auth" });
    } catch (e: unknown) {
      if (e instanceof ZodError) {
        validValues = e.issues.flatMap((i) => ("values" in i ? (i.values as string[]) : []));
      }
    }
    expect(validValues, "Zod error valid-values hint must not contain Auth").not.toContain("Auth");
    // Must still advertise real categories
    expect(validValues).toContain("Proxy");
  });

  it("novadaDiscover still returns the gated-vs-unknown distinction for a category that is gated", async () => {
    // This tests the runtime branch (fullRegistryCount > 0 but no visible tools).
    // We simulate by passing a visible set that excludes all Proxy tools, then
    // calling novadaDiscover directly (bypassing Zod) with a Proxy params object.
    const proxyParams = { category: "Proxy" as const };
    const proxyTools = TOOL_REGISTRY.filter((t) => t.category === "Proxy").map((t) => t.name);
    expect(proxyTools.length).toBeGreaterThan(0);
    // Pass an empty visible set — Proxy tools exist in full registry but are not visible
    const out = await novadaDiscover(proxyParams, new Set<string>());
    expect(out).toMatch(/registered tool.*but none are exposed/i);
  });

  it("novadaDiscover(Bananas) rejects via Zod for truly unknown categories", () => {
    expect(() => validateDiscoverParams({ category: "Bananas" })).toThrow(ZodError);
  });
});
