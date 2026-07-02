import { z } from "zod";
import {
  TOOL_REGISTRY,
  TOOL_CATEGORIES,
  type ToolMeta,
  type ToolCategory,
} from "./registry.js";

// ─── Tool Catalog ─────────────────────────────────────────────────────────────
// The catalog is DERIVED from the canonical registry (./registry.ts) — the single
// source of truth — so it can never list a tool that isn't registered, nor omit a
// tool that is. Drift is asserted by tests/tools/discover.test.ts.

// ─── Zod Schema ───────────────────────────────────────────────────────────────

export const DiscoverParamsSchema = z.object({
  category: z
    .enum(TOOL_CATEGORIES)
    .optional()
    .describe(
      `Optional category filter. One of: ${TOOL_CATEGORIES.map((c) => `'${c}'`).join(", ")}. Omit to list all tools.`
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
  const { category } = params;

  const visible = visibleTools
    ? TOOL_REGISTRY.filter((t) => visibleTools.has(t.name))
    : TOOL_REGISTRY;

  const entries = category
    ? visible.filter((t) => t.category === category)
    : visible;

  if (entries.length === 0) {
    // Determine why the result is empty:
    //   (a) the category exists in the full registry but is filtered out of the
    //       visible set → gated message with count + novada_health pointer
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
        `Call \`novada_health\` to check which products are active on your API key ` +
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

  lines.push("---");
  lines.push("## Next Steps");
  lines.push("");
  lines.push(
    "- **Start here:** Call `novada_health` to check which products are active on your API key."
  );
  lines.push(
    "- **Search the web:** Use `novada_search` for queries, `novada_extract` for specific URLs."
  );
  lines.push(
    "- **Structured data:** Use `novada_scrape` for 13 active platforms (~78 operations) (Amazon, TikTok, LinkedIn, etc.)."
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
