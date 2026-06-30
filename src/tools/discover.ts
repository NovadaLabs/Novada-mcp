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
    return `No tools found for category: ${category}`;
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
  lines.push(
    "- **Proxy access:** Use `novada_proxy` for geo-targeted IP rotation."
  );
  lines.push(
    "- **Browser automation:** Use `novada_browser` for interactive flows (login, click, screenshot)."
  );

  return lines.join("\n");
}
