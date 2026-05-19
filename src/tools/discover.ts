import { z } from "zod";

// ─── Tool Catalog ─────────────────────────────────────────────────────────────

type ToolStatus = "active" | "todo";

interface ToolEntry {
  name: string;
  description: string;
  category: string;
  status: ToolStatus;
}

const TOOL_CATALOG: ToolEntry[] = [
  // Content Retrieval
  {
    name: "novada_search",
    description: "Search the web via Google, Bing, DuckDuckGo, Yahoo, or Yandex with geo-targeting, time_range, domain filters, and optional auto-extract on top results",
    category: "Content Retrieval",
    status: "active",
  },
  {
    name: "novada_extract",
    description: "Extract main content, title, description, links, and structured fields from one or up to 10 URLs; supports static/render/browser escalation and PDF detection",
    category: "Content Retrieval",
    status: "active",
  },
  {
    name: "novada_crawl",
    description: "Crawl websites using BFS or DFS traversal with configurable depth, content extraction, include/exclude patterns, and ReDoS-safe path filtering",
    category: "Content Retrieval",
    status: "active",
  },
  {
    name: "novada_map",
    description: "Discover all URLs on a website without extracting content; uses sitemap.xml via robots.txt first, falls back to BFS; returns up to 100 filtered URLs",
    category: "Content Retrieval",
    status: "active",
  },
  {
    name: "novada_research",
    description: "Multi-step research: 3–10 parallel SERP queries, source deduplication, full content extraction from top URLs, returns cited report with findings summary",
    category: "Content Retrieval",
    status: "active",
  },
  // Scraping & Verification
  {
    name: "novada_scrape",
    description: "Extract structured data from 129 supported platforms (Amazon, Reddit, TikTok, LinkedIn, etc.) in a single synchronous call; supports markdown/json/csv/html/xlsx output",
    category: "Scraping & Verification",
    status: "active",
  },
  {
    name: "novada_verify",
    description: "Fact-check a claim by running 3 parallel queries (supporting + skeptical + neutral); returns verdict (supported/unsupported/contested/insufficient_data) and confidence score 0–100",
    category: "Scraping & Verification",
    status: "active",
  },
  {
    name: "novada_unblock",
    description: "Render blocked or JS-heavy pages via Web Unblocker or Browser CDP; returns raw rendered HTML; supports render/browser methods and wait_for selectors",
    category: "Scraping & Verification",
    status: "active",
  },
  {
    name: "novada_scraper_submit",
    description: "Submit an async scraping task; returns task_id for status polling. Use when novada_scrape doesn't support the platform. Follow with novada_scraper_status to poll, then novada_scraper_result to retrieve data.",
    category: "Scraping & Verification",
    status: "active",
  },
  {
    name: "novada_scraper_status",
    description: "Poll async scraping task status by task_id; returns pending/running/complete/failed with per-state agent_instruction. Poll every 5–10s with exponential backoff.",
    category: "Scraping & Verification",
    status: "active",
  },
  {
    name: "novada_scraper_result",
    description: "Retrieve completed scraping results by task_id; returns markdown table, JSON, or raw API response. Call only after novada_scraper_status reports status='complete'.",
    category: "Scraping & Verification",
    status: "active",
  },
  {
    name: "novada_scraper_task_list",
    description: "List all scraping tasks submitted by the current user; endpoint: GET /v1/scraper/task_list",
    category: "Scraping & Verification",
    status: "todo",
  },
  {
    name: "novada_unblock_direct",
    description: "Send a direct request through Web Unblocker without browser CDP (alternative to render-based unblocking; lower cost)",
    category: "Scraping & Verification",
    status: "todo",
  },
  // Proxy
  {
    name: "novada_proxy",
    description: "Get residential/mobile/ISP/datacenter proxy configuration (legacy generic fallback); returns proxy URL, shell export commands, or curl --proxy flag",
    category: "Proxy",
    status: "active",
  },
  {
    name: "novada_proxy_residential",
    description: "Residential proxy (100M+ real home IPs); supports country/city/session targeting. Best anti-bot bypass. Use format='env' for shell exports or format='curl' for curl commands.",
    category: "Proxy",
    status: "active",
  },
  {
    name: "novada_proxy_isp",
    description: "ISP proxy (rotating ISP-assigned IPs); cleaner than residential, faster than mobile. Good balance of trust-score and speed for social platforms.",
    category: "Proxy",
    status: "active",
  },
  {
    name: "novada_proxy_datacenter",
    description: "Datacenter proxy (fast, cost-effective IP rotation); best for high-volume scraping of sites without strict bot detection. Lowest latency.",
    category: "Proxy",
    status: "active",
  },
  {
    name: "novada_proxy_mobile",
    description: "Mobile carrier proxy (3G/4G/5G IPs); highest trust score. Use for mobile-specific content, carrier-gated pages, or apps that detect non-mobile IPs.",
    category: "Proxy",
    status: "active",
  },
  {
    name: "novada_proxy_static",
    description: "Static ISP proxy (dedicated IP per session_id); same IP every request. Essential for accounts where IP changes trigger security alerts (social media, banking).",
    category: "Proxy",
    status: "active",
  },
  {
    name: "novada_proxy_dedicated",
    description: "Dedicated datacenter proxy (exclusive IP, never shared); maximum control for sensitive workflows. Combines datacenter speed with static IP stability.",
    category: "Proxy",
    status: "active",
  },
  {
    name: "novada_proxy_discover",
    description: "Discover available proxy types, area selections, current account limits, and geographic coverage",
    category: "Proxy",
    status: "todo",
  },
  // Browser & Rendering
  {
    name: "novada_browser",
    description: "Automate browser interactions: navigate, click, type, screenshot, aria_snapshot, evaluate JS, wait, scroll, hover, press_key, select — up to 20 actions per call; maintains session state",
    category: "Browser & Rendering",
    status: "active",
  },
  {
    name: "novada_browser_flow",
    description: "Cloud browser automation via action sequence API (POST browser_flow_use); executes click/scroll/wait/type/screenshot actions in sequence; supports sticky sessions via session_id.",
    category: "Browser & Rendering",
    status: "active",
  },
  {
    name: "novada_browser_area_select",
    description: "Select proxy area for browser automation sessions; endpoint: GET /proxy/browser_area",
    category: "Browser & Rendering",
    status: "todo",
  },
  // Health & Discovery
  {
    name: "novada_health",
    description: "Check which Novada API products are active on the current API key; parallelized probes for Search, Extract, Scraper, Proxy, Browser; returns status table with latency",
    category: "Health & Discovery",
    status: "active",
  },
  {
    name: "novada_health_all",
    description: "Extended health check returning detailed status and usage metrics for all Novada products; includes activation links for inactive products",
    category: "Health & Discovery",
    status: "active",
  },
  {
    name: "novada_discover",
    description: "List all available Novada tools with name, description, category, and status",
    category: "Health & Discovery",
    status: "active",
  },
  // Auth
  {
    name: "novada_auth_token",
    description: "Exchange credentials for OAuth2 Bearer token for interactive auth flows; not required for API-key-only usage",
    category: "Auth",
    status: "todo",
  },
];

// ─── Zod Schema ───────────────────────────────────────────────────────────────

export const DiscoverParamsSchema = z.object({
  category: z
    .enum([
      "Content Retrieval",
      "Scraping & Verification",
      "Proxy",
      "Browser & Rendering",
      "Health & Discovery",
      "Auth",
    ])
    .optional()
    .describe(
      "Optional category filter. One of: 'Content Retrieval', 'Scraping & Verification', 'Proxy', 'Browser & Rendering', 'Health & Discovery', 'Auth'. Omit to list all tools."
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
 */
export async function novadaDiscover(params: DiscoverParams): Promise<string> {
  const { category } = params;

  const entries = category
    ? TOOL_CATALOG.filter((t) => t.category === category)
    : TOOL_CATALOG;

  if (entries.length === 0) {
    return `No tools found for category: ${category}`;
  }

  // Group by category
  const grouped = new Map<string, ToolEntry[]>();
  for (const entry of entries) {
    const existing = grouped.get(entry.category) ?? [];
    existing.push(entry);
    grouped.set(entry.category, existing);
  }

  const categoryOrder = [
    "Content Retrieval",
    "Scraping & Verification",
    "Proxy",
    "Browser & Rendering",
    "Health & Discovery",
    "Auth",
  ];

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

  const orderedCategories = categoryOrder.filter((c) => grouped.has(c));

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
    "- **Structured data:** Use `novada_scrape` for 129 platforms (Amazon, TikTok, LinkedIn, etc.)."
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
