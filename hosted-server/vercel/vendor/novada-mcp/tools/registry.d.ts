/**
 * Canonical tool registry — the SINGLE SOURCE OF TRUTH for Novada MCP tools.
 *
 * Every tool exposed by the server (the `TOOLS` array in src/index.ts) MUST have
 * exactly one entry here, keyed by `name`. `src/tools/discover.ts` DERIVES its
 * catalog from this list — it does NOT maintain its own copy — so the discover
 * output can never drift from the tools that are actually wired.
 *
 * Drift guards (see tests/tools/discover.test.ts):
 *   1. TOOL_REGISTRY names === TOOLS names in src/index.ts (exact set match).
 *   2. The discover catalog ⊆ TOOL_REGISTRY (no ghost tools).
 *
 * This module is intentionally side-effect-free (no server construction, no
 * top-level execution) so it can be imported by index.ts, discover.ts, the
 * hosted endpoint, and tests without booting the MCP server.
 */
export type ToolStatus = "active" | "todo";
/** Category buckets, in the order they should render in `novada_discover`. */
export declare const TOOL_CATEGORIES: readonly ["Content Retrieval", "Scraping & Verification", "Proxy", "Browser & Rendering", "Account & Billing", "Health & Discovery", "Auth"];
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];
/**
 * Opt-in filtering groups (F-1/F-7 audit, W-B1) — a COARSE 4-way partition of the
 * full registry, distinct from (and orthogonal to) TOOL_CATEGORIES above:
 *   - "core"     — general-purpose content/browser/proxy tools
 *   - "scrapers" — novada_scrape + all 15 novada_scrape_<platform> siblings
 *   - "account"  — KR-6 developer-api account/billing/write tools
 *   - "meta"     — discovery/setup/telemetry helper tools
 * Every TOOL_REGISTRY entry belongs to EXACTLY ONE group (enforced by ToolMeta
 * being a required field below — TypeScript fails the build if a row omits it).
 * Consumed by src/tools/discover.ts (renders the group reference) and by
 * hosted-server/vercel/api/mcp.ts's `?groups=` filter (local NOVADA_GROUPS keeps
 * its own pre-existing, richer taxonomy — see src/index.ts — which is NOT wired to
 * this table; see W-B1's report for why).
 */
export declare const TOOL_GROUPS: readonly ["core", "scrapers", "account", "meta"];
export type ToolGroup = (typeof TOOL_GROUPS)[number];
/**
 * Which billing LEDGER a tool call draws on (C-7/G-10/G-12 audit, W-B4). Verified
 * per-tool against the tool's OWN source (network target + auth key), not guessed
 * from the tool's name — see the per-row comments below for the code evidence.
 *   - "capture"  — hits scraper.novada.com / webunlocker.novada.com only — i.e.
 *     the Capture/scraper balance (novada_account section="plans", product="capture").
 *   - "wallet"   — draws the master wallet-funded proxy-flow bandwidth (novada_proxy
 *     once the returned credentials are USED) or spends wallet currency directly
 *     (novada_static_ip_mgmt open/renew purchase/renew per-IP static allocations).
 *   - "mixed"    — the tool's OWN logic can debit EITHER ledger depending on the
 *     path taken for that specific call: its default fetch is wallet-funded proxy
 *     bandwidth (utils/http.ts's fetchViaProxy); it can escalate to a Capture-billed
 *     Web-Unblocker JS-render fetch, OR to a Browser/CDP fetch (which is ALSO
 *     Wallet-billed — same product family as novada_proxy, not Capture). Not a
 *     guess-once label — genuinely conditional per call.
 *   - "none"     — no consumption ledger is debited (free / read-only / in-memory
 *     / administrative account-management action).
 * See LEDGER_EXPLAINER below for the human-readable "which ledger funds what" copy
 * novada_discover renders from this same table (single source of truth).
 */
export declare const TOOL_LEDGERS: readonly ["wallet", "capture", "mixed", "none"];
export type ToolLedger = (typeof TOOL_LEDGERS)[number];
export interface ToolMeta {
    name: string;
    description: string;
    category: ToolCategory;
    status: ToolStatus;
    /** Short MCP `title` (UI display hint) — every tool must have one (F-7). */
    title: string;
    /** Opt-in filtering group — see TOOL_GROUPS above. */
    group: ToolGroup;
    /**
     * Billing ledger — see TOOL_LEDGERS above. OPTIONAL ON THE TYPE ONLY so that
     * src/tools/platform_scraper.ts's factory-built `registryEntry: ToolMeta`
     * object literals (which predate this field and are owned by a different
     * concurrent worker in this audit — not edited here) keep compiling without
     * also being touched. Every REAL row in TOOL_REGISTRY nonetheless has one:
     * the 22 hand-authored rows below set it directly, and the 16
     * platform-scraper rows spread in from PLATFORM_SCRAPER_REGISTRY_ENTRIES have
     * it injected via `.map()` at the spread site (all of them are "capture" —
     * every platform scraper delegates to scrape.ts's SCRAPER_API_BASE, a single
     * fact stamped once, not per-platform). A dedicated test
     * (tests/consistency/registry-ledger-taxonomy.test.ts) enforces this
     * NON-optionality at runtime for the actual registry, with a synthetic
     * unassigned row proving the check isn't inert.
     */
    ledger?: ToolLedger;
}
/**
 * Human-readable "which ledger funds what" explainer, one line per ToolLedger
 * value. novada_discover renders this verbatim so an agent choosing between
 * tools has a cost-basis, not just a name (C-7/G-10 fix). Source of truth for
 * this copy lives here, not duplicated in discover.ts.
 */
export declare const LEDGER_EXPLAINER: Readonly<Record<ToolLedger, string>>;
/**
 * One entry per registered tool. Descriptions here are the SHORT,
 * catalog-facing one-liners (the full multi-paragraph descriptions live on the
 * `TOOLS` array in src/index.ts, which the MCP client sees in inputSchema).
 * Order mirrors the `TOOLS` array for easy side-by-side review.
 */
export declare const TOOL_REGISTRY: readonly ToolMeta[];
/**
 * Every registered tool name -> group, derived from TOOL_REGISTRY (single source
 * of truth). Consumed by discover.ts's Tool Groups section and available for any
 * other transport (hosted mcp.ts) that wants to mirror the same partition.
 */
export declare const GROUP_TOOL_NAMES: Readonly<Record<ToolGroup, readonly string[]>>;
/**
 * Every registered tool name -> ledger, derived from TOOL_REGISTRY (single source
 * of truth). A row with no `ledger` set (should never happen for a real entry —
 * see tests/consistency/registry-ledger-taxonomy.test.ts) simply does not appear
 * under any key here; it is NOT silently coerced into "none", so an unassigned
 * row is visible as a gap in the union rather than masquerading as a real value.
 * Consumed by discover.ts's Billing section.
 */
export declare const LEDGER_TOOL_NAMES: Readonly<Record<ToolLedger, readonly string[]>>;
/** Tool names in the canonical registry, as a Set for fast membership checks. */
export declare const REGISTERED_TOOL_NAMES: ReadonlySet<string>;
export declare const POPULATED_TOOL_CATEGORIES: [ToolCategory, ...ToolCategory[]];
//# sourceMappingURL=registry.d.ts.map