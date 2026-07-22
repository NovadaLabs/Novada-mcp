import { z } from "zod";
import { TOOL_REGISTRY, TOOL_CATEGORIES, POPULATED_TOOL_CATEGORIES, } from "./registry.js";
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
        .describe(`Optional category filter. One of: ${POPULATED_TOOL_CATEGORIES.map((c) => `'${c}'`).join(", ")}. Omit to list all tools.`),
    platform: z
        .string()
        .optional()
        .describe(`Optional platform domain to look up (e.g. 'amazon.com', 'tiktok.com'). When provided, returns all operations for that platform from the scraper catalog — free, no API call, no credit cost. Mutually exclusive with category: if both are provided, platform takes priority.`),
});
export function validateDiscoverParams(args) {
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
export async function novadaDiscover(params, visibleTools) {
    const { category, platform } = params;
    // ─── Platform lookup shortcut (no API call, no credit cost) ─────────────────
    if (platform) {
        const platformOps = CATALOG_BY_DOMAIN.get(platform);
        if (!platformOps) {
            const validDomains = CATALOG_DOMAINS.join(", ");
            return (`Platform '${platform}' is not in the scraper catalog. ` +
                `Valid platform domains: ${validDomains}. ` +
                `For platforms not in this list, use novada_extract instead.`);
        }
        const lines = [
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
        const fullRegistryCount = TOOL_REGISTRY.filter((t) => t.category === category).length;
        if (fullRegistryCount > 0) {
            // Category is real but gated in this session
            const toolWord = fullRegistryCount === 1 ? "tool" : "tools";
            return (`Category "${category}" has ${fullRegistryCount} registered ${toolWord} ` +
                `but none are exposed in this session. ` +
                `Call \`novada_account\` to see your balance, plans, and entitlements ` +
                `and whether this category is available to you.`);
        }
        // Truly empty or unknown category (future-proofing: if a TOOL_CATEGORIES
        // entry has no registry entries yet).
        // Only advertise categories that actually have >= 1 registry entry so that
        // a zero-entry placeholder (e.g. "Auth") is never listed as a retry target
        // — an agent retrying category=Auth would loop forever.
        const nonEmptyCategories = TOOL_CATEGORIES.filter((c) => TOOL_REGISTRY.some((t) => t.category === c));
        const validCategories = nonEmptyCategories.join(", ");
        return (`No tools found for category: ${category}. ` +
            `Valid categories are: ${validCategories}.`);
    }
    // Group by category
    const grouped = new Map();
    for (const entry of entries) {
        const existing = grouped.get(entry.category) ?? [];
        existing.push(entry);
        grouped.set(entry.category, existing);
    }
    const lines = [
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
    lines.push(`**${activeCount} active** | ${todoCount} planned | ${entries.length} total`);
    lines.push("");
    const orderedCategories = TOOL_CATEGORIES.filter((c) => grouped.has(c));
    for (const cat of orderedCategories) {
        const tools = grouped.get(cat);
        lines.push(`### ${cat}`);
        lines.push("");
        lines.push("| Tool | Description | Status |");
        lines.push("|------|-------------|--------|");
        for (const tool of tools) {
            const statusIcon = tool.status === "active" ? "✅ active" : "🔜 todo";
            // Truncate description to keep table readable
            const desc = tool.description.length > 100
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
    lines.push("- **Start here:** Call `novada_account` to see your balance, plans, and entitlements.");
    lines.push("- **Search the web:** Use `novada_search` for queries, `novada_extract` for specific URLs.");
    lines.push("- **Structured data:** Use `novada_scrape` for 16 active platforms (~87 operations) (Amazon, TikTok, LinkedIn, ChatGPT, SHEIN, etc.).");
    lines.push("- **Full research:** Use `novada_research` for multi-source synthesis.");
    if (visibleNames.has("novada_proxy")) {
        lines.push("- **Proxy access:** Use `novada_proxy` for geo-targeted IP rotation.");
    }
    if (visibleNames.has("novada_browser")) {
        lines.push("- **Browser automation:** Use `novada_browser` for interactive flows (login, click, screenshot).");
    }
    return lines.join("\n");
}
//# sourceMappingURL=discover.js.map