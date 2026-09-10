/**
 * Unit pins for src/_core/gate.ts — the F12/F13 key-gate decision layer.
 *
 * The gate is a CLASS table (auth_free / unauth_basic_tier / key_required),
 * not per-tool branches: extending coverage is a new row, never a new branch.
 */
import { describe, expect, it } from "vitest";
import {
  toolAuthClass,
  decideKeyGate,
  isEscalationRequest,
  isUnauthenticatedTierCall,
  runUnauthenticatedTier,
  UNAUTH_TIER_DISCLOSURE,
  AUTH_FREE_TOOLS,
  UNAUTH_BASIC_TIER_TOOLS,
} from "../../src/_core/gate.js";
import { KNOWN_TOOL_NAMES } from "../../src/core.js";

describe("toolAuthClass — class table", () => {
  it("auth-free tools", () => {
    for (const name of ["novada_setup", "novada_discover", "novada_session_stats", "novada_search_feedback"]) {
      expect(toolAuthClass(name)).toBe("auth_free");
    }
  });

  it("unauthenticated basic tier: novada_extract", () => {
    expect(toolAuthClass("novada_extract")).toBe("unauth_basic_tier");
  });

  it("everything else defaults to key_required (incl. the unblock alias, which forces render)", () => {
    for (const name of ["novada_search", "novada_scrape", "novada_crawl", "novada_research", "novada_unblock", "novada_browser", "novada_proxy"]) {
      expect(toolAuthClass(name)).toBe("key_required");
    }
  });

  it("class-table consistency: every classified name is a real, dispatchable tool name", () => {
    for (const name of [...AUTH_FREE_TOOLS, ...UNAUTH_BASIC_TIER_TOOLS]) {
      expect(KNOWN_TOOL_NAMES.has(name), `${name} in KNOWN_TOOL_NAMES`).toBe(true);
    }
  });

  it("class-table consistency: the two special classes are disjoint", () => {
    for (const name of AUTH_FREE_TOOLS) {
      expect(UNAUTH_BASIC_TIER_TOOLS.has(name)).toBe(false);
    }
  });
});

describe("isEscalationRequest", () => {
  it("render / js / browser are escalation requests on the unauth tier", () => {
    for (const render of ["render", "js", "browser"]) {
      expect(isEscalationRequest("novada_extract", { render })).toBe(true);
    }
  });

  it("auto / static / absent are NOT escalation requests", () => {
    expect(isEscalationRequest("novada_extract", { render: "auto" })).toBe(false);
    expect(isEscalationRequest("novada_extract", { render: "static" })).toBe(false);
    expect(isEscalationRequest("novada_extract", {})).toBe(false);
    expect(isEscalationRequest("novada_extract", undefined)).toBe(false);
  });

  it("only applies to unauth-tier tools", () => {
    expect(isEscalationRequest("novada_search", { render: "render" })).toBe(false);
  });
});

describe("decideKeyGate — F12 decision matrix", () => {
  it("key present → allow (validity is enforced upstream, identically for every key value)", () => {
    expect(decideKeyGate("novada_search", { hasApiKey: true, kr6Bypass: false }).kind).toBe("allow");
    expect(decideKeyGate("novada_extract", { hasApiKey: true, kr6Bypass: false }).kind).toBe("allow");
  });

  it("KR-6 developer-key bypass → allow", () => {
    expect(decideKeyGate("novada_account", { hasApiKey: false, kr6Bypass: true }).kind).toBe("allow");
  });

  it("keyless auth-free → allow", () => {
    expect(decideKeyGate("novada_discover", { hasApiKey: false, kr6Bypass: false }).kind).toBe("allow");
    expect(decideKeyGate("novada_setup", { hasApiKey: false, kr6Bypass: false }).kind).toBe("allow");
  });

  it("keyless extract basic → allow_unauthenticated_tier (disclosed)", () => {
    const d = decideKeyGate("novada_extract", { hasApiKey: false, kr6Bypass: false, args: { url: "https://example.com" } });
    expect(d.kind).toBe("allow_unauthenticated_tier");
  });

  it("keyless extract with explicit escalation → refuse_escalation_requires_key", () => {
    for (const render of ["render", "js", "browser"]) {
      const d = decideKeyGate("novada_extract", { hasApiKey: false, kr6Bypass: false, args: { url: "https://example.com", render } });
      expect(d.kind).toBe("refuse_escalation_requires_key");
    }
  });

  it("keyless key_required → refuse_missing_key", () => {
    for (const name of ["novada_search", "novada_scrape", "novada_unblock", "novada_browser_flow"]) {
      expect(decideKeyGate(name, { hasApiKey: false, kr6Bypass: false }).kind).toBe("refuse_missing_key");
    }
  });
});

describe("unauthenticated-tier call context (AsyncLocalStorage)", () => {
  it("false outside any context", () => {
    expect(isUnauthenticatedTierCall()).toBe(false);
  });

  it("true inside runUnauthenticatedTier, across awaits and parallel branches", async () => {
    const seen: boolean[] = [];
    const result = await runUnauthenticatedTier(async () => {
      seen.push(isUnauthenticatedTierCall());
      await new Promise((r) => setTimeout(r, 5));
      seen.push(isUnauthenticatedTierCall());
      await Promise.all([
        (async () => seen.push(isUnauthenticatedTierCall()))(),
        (async () => seen.push(isUnauthenticatedTierCall()))(),
      ]);
      return "ok";
    });
    expect(result).toBe("ok");
    expect(seen).toEqual([true, true, true, true]);
    expect(isUnauthenticatedTierCall()).toBe(false); // does not leak out
  });
});

describe("UNAUTH_TIER_DISCLOSURE — pinned wording", () => {
  it("states the tier, the key requirement for escalation/billed tools, and the no-save rule", () => {
    expect(UNAUTH_TIER_DISCLOSURE).toContain("unauthenticated");
    expect(UNAUTH_TIER_DISCLOSURE).toContain("NOVADA_API_KEY");
    expect(UNAUTH_TIER_DISCLOSURE).toMatch(/escalation/i);
    expect(UNAUTH_TIER_DISCLOSURE).toMatch(/billed/i);
    expect(UNAUTH_TIER_DISCLOSURE).toMatch(/not saved/i);
    expect(UNAUTH_TIER_DISCLOSURE).toContain("novada_setup");
  });
});
