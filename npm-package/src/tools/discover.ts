import { z } from "zod";
import {
  TOOL_REGISTRY,
  TOOL_CATEGORIES,
  POPULATED_TOOL_CATEGORIES,
  TOOL_GROUPS,
  GROUP_TOOL_NAMES,
  type ToolMeta,
  type ToolCategory,
} from "./registry.js";
import { VERSION } from "../config.js";
import { CATALOG_BY_DOMAIN, CATALOG_DOMAINS } from "../data/scraper_catalog.js";

// ─── Tool Catalog ─────────────────────────────────────────────────────────────
// The catalog is DERIVED from the canonical registry (./registry.ts) — the single
// source of truth — so it can never list a tool that isn't registered, nor omit a
// tool that is. Drift is asserted by tests/tools/discover.test.ts.

// ─── Zod Schema ───────────────────────────────────────────────────────────────

export const DiscoverParamsSchema = z.object({
  category: z
    // Use POPULATED_TOOL_CATEGORIES (categories with >=1 registry entry) so that
    // zero-entry placeholders like "Auth" never appear in the enum, the inputSchema
    // description, or Zod validation-error hints shown to callers.
    .enum(POPULATED_TOOL_CATEGORIES)
    .optional()
    .describe(
      `Optional category filter. One of: ${POPULATED_TOOL_CATEGORIES.map((c) => `'${c}'`).join(", ")}. Omit to list all tools.`
    ),
  platform: z
    .string()
    .optional()
    .describe(
      `Optional platform domain to look up (e.g. 'amazon.com', 'tiktok.com'). When provided, returns all operations for that platform from the scraper catalog — free, no API call, no credit cost. Mutually exclusive with category: if both are provided, platform takes priority.`
    ),
});

export type DiscoverParams = z.infer<typeof DiscoverParamsSchema>;

export function validateDiscoverParams(
  args: Record<string, unknown> | undefined
): DiscoverParams {
  return DiscoverParamsSchema.parse(args ?? {});
}

// ─── Tool Implementation ──────────────────────────────────────────────────────

/**
 * List all available Novada tools, grouped by category.
 * Agents should call this first to understand what tools are available.
 * The listing is derived from the canonical TOOL_REGISTRY.
 *
 * @param visibleTools Optional allowlist of tool names to include. When provided,
 *   only registered tools whose name is in the set are listed — used by the hosted
 *   endpoint so the catalog reflects only the tools actually exposed there (e.g.
 *   browser tools and disk-writing tools are excluded on hosted). Names not in the
 *   registry are ignored; omit the arg to list the full registry (local MCP).
 */
export async function novadaDiscover(
  params: DiscoverParams,
  visibleTools?: ReadonlySet<string>
): Promise<string> {
  const { category, platform } = params;

  // ─── Platform lookup shortcut (no API call, no credit cost) ─────────────────
  if (platform) {
    const platformOps = CATALOG_BY_DOMAIN.get(platform);
    if (!platformOps) {
      const validDomains = CATALOG_DOMAINS.join(", ");
      return (
        `Platform '${platform}' is not in the scraper catalog. ` +
        `Valid platform domains: ${validDomains}. ` +
        `For platforms not in this list, use novada_extract instead.`
      );
    }
    const lines: string[] = [
      `## ${platform} — Scraper Operations`,
      "",
      `**${platformOps.size} operations available.** Use with novada_scrape({ platform: "${platform}", operation: "<operation_id>", params: {...} })`,
      "",
      "| Operation | Required Params | Format |",
      "|-----------|-----------------|--------|",
    ];
    for (const [slug, op] of platformOps) {
      const reqParams = op.params
        .filter(p => p.required)
        .map(p => p.key)
        .join(", ") || "(none)";
      const statusNote = op.status === "backend_broken"
        ? ` ⚠️ backend-broken: ${op.broken_reason ?? "backend failure"}`
        : "";
      lines.push(`| \`${slug}\` | ${reqParams}${statusNote} | ${op.format} |`);
    }
    return lines.join("\n");
  }

  const visible = visibleTools
    ? TOOL_REGISTRY.filter((t) => visibleTools.has(t.name))
    : TOOL_REGISTRY;

  const entries = category
    ? visible.filter((t) => t.category === category)
    : visible;

  if (entries.length === 0) {
    // Determine why the result is empty:
    //   (a) the category exists in the full registry but is filtered out of the
    //       visible set → gated message with count + novada_account pointer
    //   (b) the category has zero entries in the full registry itself → truly
    //       unknown / empty category message
    const fullRegistryCount = TOOL_REGISTRY.filter(
      (t) => t.category === category
    ).length;
    if (fullRegistryCount > 0) {
      // Category is real but gated in this session
      const toolWord = fullRegistryCount === 1 ? "tool" : "tools";
      return (
        `Category "${category}" has ${fullRegistryCount} registered ${toolWord} ` +
        `but none are exposed in this session. ` +
        `Call \`novada_account\` to see your balance, plans, and entitlements ` +
        `and whether this category is available to you.`
      );
    }
    // Truly empty or unknown category (future-proofing: if a TOOL_CATEGORIES
    // entry has no registry entries yet).
    // Only advertise categories that actually have >= 1 registry entry so that
    // a zero-entry placeholder (e.g. "Auth") is never listed as a retry target
    // — an agent retrying category=Auth would loop forever.
    const nonEmptyCategories = TOOL_CATEGORIES.filter(
      (c) => TOOL_REGISTRY.some((t) => t.category === c)
    );
    const validCategories = nonEmptyCategories.join(", ");
    return (
      `No tools found for category: ${category}. ` +
      `Valid categories are: ${validCategories}.`
    );
  }

  // Group by category
  const grouped = new Map<ToolCategory, ToolMeta[]>();
  for (const entry of entries) {
    const existing = grouped.get(entry.category) ?? [];
    existing.push(entry);
    grouped.set(entry.category, existing);
  }

  const lines: string[] = [
    "## Novada MCP — Tool Catalog",
    "",
    `> ${category ? `Showing tools in category: **${category}**` : "All tools listed below, grouped by category."}`,
    "> Status: ✅ active = available now  |  🔜 todo = planned, not yet available",
    // Same NOVADA_SERVER_VERSION invariant as setup.ts: hosted injects HOSTED_VERSION here.
    `> server_version: ${process.env.NOVADA_SERVER_VERSION ?? VERSION}`,
    "",
  ];

  const activeCount = entries.filter((t) => t.status === "active").length;
  const todoCount = entries.filter((t) => t.status === "todo").length;
  lines.push(
    `**${activeCount} active** | ${todoCount} planned | ${entries.length} total`
  );
  lines.push("");

  const orderedCategories = TOOL_CATEGORIES.filter((c) => grouped.has(c));

  for (const cat of orderedCategories) {
    const tools = grouped.get(cat)!;
    lines.push(`### ${cat}`);
    lines.push("");
    lines.push("| Tool | Description | Status |");
    lines.push("|------|-------------|--------|");

    for (const tool of tools) {
      const statusIcon = tool.status === "active" ? "✅ active" : "🔜 todo";
      // Truncate description to keep table readable
      const desc =
        tool.description.length > 100
          ? tool.description.slice(0, 97) + "..."
          : tool.description;
      lines.push(`| \`${tool.name}\` | ${desc} | ${statusIcon} |`);
    }

    lines.push("");
  }

  // Derive which Next Steps bullets to include based on the visible tool set.
  const visibleNames = new Set(visible.map((t) => t.name));

  // ─── Tool Groups reference (F-1/F-7 audit, W-B1) ───────────────────────────
  // Class-driven from registry.ts's GROUP_TOOL_NAMES — a new tool automatically
  // appears here via its registry row's `group`, no per-tool edit needed. Counts
  // are narrowed to THIS session's visible set so the "hides" math is honest when
  // a NOVADA_TOOLS/NOVADA_GROUPS (local) or ?tools=/?groups= (hosted) filter is
  // already active. Rendered as prose (no `| \`name\` |` table cells) so it never
  // collides with the tools-table regex other callers/tests scan for.
  //
  // Copy note (W-B1, coordinator review): the 4-group partition below is a
  // REFERENCE classification — it is only wired to the identical `?groups=`/
  // `NOVADA_GROUPS` VALUE for "scrapers" (both surfaces) and "meta" (hosted only,
  // narrowed — see caveat below). Hosted's PRE-EXISTING "core"/"account" keys
  // return smaller, DIFFERENTLY-SCOPED sets and are called out explicitly so this
  // text stays true on both surfaces instead of implying `?groups=core` reproduces
  // the count below.
  lines.push("---");
  lines.push("## Tool Groups");
  lines.push("");
  lines.push(
    "Canonical 4-group reference partition (registry-derived; every tool belongs to exactly one). " +
    "Wiring to an actual filter differs by surface — this list itself is always accurate for THIS session; " +
    "whether a given `?groups=`/`NOVADA_GROUPS` VALUE reproduces it depends on the surface:"
  );
  lines.push(
    "- **Always exact, either surface:** `NOVADA_TOOLS=<names>` (local) / `?tools=<names>` (hosted) — list the exact tool names from any group below."
  );
  lines.push(
    "- **`scrapers`:** exact match on BOTH `NOVADA_GROUPS=scraper` (local, pre-existing key) and `?groups=scrapers` (hosted)."
  );
  lines.push(
    "- **`meta`:** hosted's `?groups=meta` returns a NARROWER 2-tool subset (novada_discover, novada_setup) — " +
    "novada_session_stats/novada_search_feedback are permanently hidden on hosted (in-memory state that resets every serverless call)."
  );
  lines.push(
    "- **`core` / `account`:** hosted already has its OWN, differently-scoped `?groups=core` (10 tools) and `?groups=account` (3 tools) — " +
    "these do NOT match the counts below. Hosted permanently hides 8 write/stateful tools total (novada_site_copy, novada_browser_flow, " +
    "novada_ip_whitelist, novada_capture_apikey, novada_static_ip_mgmt, novada_session_stats, novada_search_feedback, novada_verify-from-listing). " +
    "Call `novada_discover` on your actual endpoint to see this session's real filtered set — don't assume the counts below."
  );
  lines.push("");
  for (const group of TOOL_GROUPS) {
    const memberNames = GROUP_TOOL_NAMES[group].filter((n) => visibleNames.has(n));
    const hides = visible.length - memberNames.length;
    lines.push(
      `- **${group}** (${memberNames.length} tool${memberNames.length === 1 ? "" : "s"}): ` +
      memberNames.map((n) => `\`${n}\``).join(", ") +
      ` — filtering to only this group would hide ${hides} other tool${hides === 1 ? "" : "s"}.`
    );
  }
  lines.push("");

  lines.push("---");
  lines.push("## Next Steps");
  lines.push("");
  lines.push(
    "- **Start here:** Call `novada_account` to see your balance, plans, and entitlements."
  );
  lines.push(
    "- **Search the web:** Use `novada_search` for queries, `novada_extract` for specific URLs."
  );
  lines.push(
    "- **Structured data:** Use `novada_scrape` for 16 active platforms (~87 operations) (Amazon, TikTok, LinkedIn, ChatGPT, SHEIN, etc.)."
  );
  lines.push(
    "- **Full research:** Use `novada_research` for multi-source synthesis."
  );
  if (visibleNames.has("novada_proxy")) {
    lines.push(
      "- **Proxy access:** Use `novada_proxy` for geo-targeted IP rotation."
    );
  }
  if (visibleNames.has("novada_browser")) {
    lines.push(
      "- **Browser automation:** Use `novada_browser` for interactive flows (login, click, screenshot)."
    );
  }

  return lines.join("\n");
}
