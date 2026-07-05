// ─── MCP Prompts ─────────────────────────────────────────────────────────────
// Pre-defined workflow templates shown in MCP client UIs.
// These give agents reusable patterns and fix the LobeHub Prompts criterion.

interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
}

interface Prompt {
  name: string;
  description: string;
  arguments: PromptArgument[];
}

interface PromptMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
}

interface ListPromptsResult {
  prompts: Prompt[];
}

interface GetPromptResult {
  description: string;
  messages: PromptMessage[];
}

export const PROMPTS: Prompt[] = [
  {
    name: "research_topic",
    description: "Deep multi-source research on any topic with optional country and focus constraints",
    arguments: [
      { name: "topic", description: "What to research", required: true },
      { name: "country", description: "Country context for geo-relevant results, e.g. 'us', 'de', 'cn'", required: false },
      { name: "focus", description: "Focus area, e.g. 'technical', 'market trends', 'recent news only'", required: false },
    ],
  },
  {
    name: "extract_and_summarize",
    description: "Extract content from one or more URLs and prepare a focused summary",
    arguments: [
      { name: "urls", description: "URL or comma-separated list of URLs to extract", required: true },
      { name: "focus", description: "What aspect to focus on in the extracted content", required: false },
    ],
  },
  {
    name: "site_audit",
    description: "Map a website structure then extract and summarize key sections",
    arguments: [
      { name: "url", description: "Root URL of the site to audit", required: true },
      { name: "sections", description: "Which sections to prioritize, e.g. 'pricing, docs, api'", required: false },
    ],
  },
  {
    name: "scrape_platform_data",
    description: "Scrape structured data from a specific platform (Amazon, Reddit, TikTok, LinkedIn, etc.) using the Novada Scraper API",
    arguments: [
      { name: "platform", description: "Platform name, e.g. 'amazon.com', 'reddit.com', 'tiktok.com'", required: true },
      { name: "data_type", description: "What data to get, e.g. 'product listings', 'user posts', 'job listings', 'reviews'", required: true },
      { name: "query", description: "Search keyword, username, URL, or other search term depending on data type", required: true },
    ],
  },
  {
    name: "browser_stateful_workflow",
    description: "Automate a multi-step browser workflow with persistent session state (login, form submission, paginated scraping)",
    arguments: [
      { name: "url", description: "Starting URL for the workflow", required: true },
      { name: "workflow", description: "What to do step-by-step, e.g. 'log in as admin, navigate to reports, download CSV'", required: true },
      { name: "session_id", description: "Session ID to reuse across calls (optional — creates new session if not provided)", required: false },
    ],
  },
  {
    name: "novada-which-tool",
    description: "Decision tree that picks the right Novada tool for a task: search vs extract vs crawl vs scrape vs research vs map vs unblock vs browser",
    arguments: [
      { name: "task", description: "What you are trying to accomplish, e.g. 'get all docs pages from a site', 'find recent news on X', 'extract prices from a known URL'", required: true },
    ],
  },
  {
    name: "novada-extract-format",
    description: "Decision tree for novada_extract output: when to request specific fields (JSON) vs full markdown vs clean main-content vs raw HTML",
    arguments: [
      { name: "goal", description: "What you need from the page, e.g. 'just the price and title', 'read the whole article', 'parse the DOM myself'", required: false },
    ],
  },
];

export function listPrompts(): ListPromptsResult {
  return { prompts: PROMPTS };
}

export function getPrompt(name: string, args: Record<string, string>): GetPromptResult {
  switch (name) {
    case "research_topic": {
      const lines = [
        `Please research the following topic thoroughly: "${args.topic}"`,
        args.country ? `Focus on information relevant to: ${args.country}.` : "",
        args.focus ? `Specifically focus on: ${args.focus}.` : "",
        "",
        "Recommended workflow:",
        "1. Use novada_research with depth='auto' for a multi-source overview.",
        "2. Use novada_extract on the 2-3 most relevant source URLs for full content.",
        "3. Synthesize findings into a structured summary with citations.",
      ];
      return {
        description: `Research: ${args.topic}`,
        messages: [{
          role: "user",
          content: { type: "text", text: lines.filter(Boolean).join("\n") },
        }],
      };
    }

    case "extract_and_summarize": {
      const urlList = args.urls.split(",").map(u => u.trim()).filter(Boolean);
      const lines = [
        `Please extract and analyze content from the following URL${urlList.length > 1 ? "s" : ""}:`,
        ...urlList.map(u => `  - ${u}`),
        args.focus ? `\nFocus specifically on: ${args.focus}` : "",
        "",
        "Use novada_extract with the URL(s) above.",
        urlList.length > 1
          ? "Pass them as an array for batch extraction in a single call."
          : "",
        "After extracting, summarize the key information clearly.",
      ];
      return {
        description: `Extract: ${args.urls.slice(0, 60)}${args.urls.length > 60 ? "..." : ""}`,
        messages: [{
          role: "user",
          content: { type: "text", text: lines.filter(Boolean).join("\n") },
        }],
      };
    }

    case "site_audit": {
      const lines = [
        `Please audit the website at: ${args.url}`,
        args.sections ? `Pay special attention to these sections: ${args.sections}` : "",
        "",
        "Recommended workflow:",
        `1. novada_map ${args.url} — discover all pages and understand site structure.`,
        "2. Identify the most important pages (pricing, docs, API reference, about, blog).",
        args.sections
          ? `3. novada_extract the pages matching: ${args.sections}`
          : "3. novada_extract the top 3-5 most important pages.",
        "4. Summarize: site structure, key content, notable features, any gaps.",
      ];
      return {
        description: `Audit: ${args.url}`,
        messages: [{
          role: "user",
          content: { type: "text", text: lines.filter(Boolean).join("\n") },
        }],
      };
    }

    case "scrape_platform_data": {
      const lines = [
        `Please scrape structured data from ${args.platform}.`,
        `Data type: ${args.data_type}`,
        `Query: ${args.query}`,
        ``,
        `Workflow:`,
        `1. Read the \`novada://scraper-platforms\` resource to find the correct operation ID for ${args.platform} and ${args.data_type}.`,
        `2. Call novada_scrape with:`,
        `   - platform: "${args.platform}"`,
        `   - operation: <the operation ID from the resource>`,
        `   - params: { keyword: "${args.query}", num: 10 }  // key name varies by operation — check novada://scraper-platforms`,
        `   - format: "markdown" for human-readable output, "json" for programmatic use`,
        `3. If novada_scrape returns Error 11006 (Scraper API not activated), use novada_extract as fallback.`,
        `4. Present the structured data clearly.`,
      ];
      return {
        description: `Scrape ${args.data_type} from ${args.platform}`,
        messages: [{
          role: "user",
          content: { type: "text", text: lines.filter(Boolean).join("\n") },
        }],
      };
    }

    case "browser_stateful_workflow": {
      const hasSession = args.session_id && args.session_id.trim() !== "";
      const sessionNote = hasSession
        ? `Use session_id="${args.session_id}" to maintain state from a prior call.`
        : `No session_id provided — a new browser session will be created. Save the session_id from the response to reuse it in follow-up calls.`;
      const lines = [
        `Please automate the following browser workflow:`,
        `URL: ${args.url}`,
        `Workflow: ${args.workflow}`,
        ``,
        sessionNote,
        ``,
        `Execution approach:`,
        `1. Use aria_snapshot after navigate to see the page structure (role-based semantic tree, easier than raw HTML).`,
        `2. Chain all actions in a single novada_browser call where possible (up to 20 actions per call).`,
        `3. Use session_id to maintain login state across multiple calls if the workflow spans multiple pages.`,
        `4. Use wait (with selector) before click if elements may not be loaded yet.`,
        `5. Use screenshot at key checkpoints to verify workflow progress.`,
        hasSession ? `6. Reuse session_id="${args.session_id}" in follow-up calls.` : `6. Save the session_id from the first response to continue the workflow.`,
      ];
      return {
        description: `Browser workflow: ${args.workflow.slice(0, 50)}${args.workflow.length > 50 ? "..." : ""}`,
        messages: [{
          role: "user",
          content: { type: "text", text: lines.filter(Boolean).join("\n") },
        }],
      };
    }

    case "novada-which-tool": {
      const lines = [
        `Pick the right Novada tool for this task: "${args.task}"`,
        ``,
        `Decision tree (top match wins):`,
        `1. Don't know which page has the answer, or want current info across the web?`,
        `   → novada_search (titles + snippets, 4 engines). Set enrich_top=true to auto-read the #1 result.`,
        `2. Question needs synthesis from MANY sources (comparison, market scan, deep dive)?`,
        `   → novada_research (parallel searches → extract top sources → cited report). One call replaces many search+extract calls.`,
        `3. Have the exact URL and want its content (read/summarize/specific fields)?`,
        `   → novada_extract. Handles anti-bot automatically. Batch up to 10 URLs in one call. See the novada-extract-format prompt to choose fields vs markdown.`,
        `4. Need to discover which URLs exist on a site (no content yet)?`,
        `   → novada_map (sitemap-first, fast). Then novada_extract the ones you want.`,
        `5. Need content from MANY pages on one domain (e.g. all /docs/*)?`,
        `   → novada_crawl (BFS/DFS, up to ~20 pages). Use select_paths to restrict. For a single page use novada_extract instead.`,
        `6. Target is a known PLATFORM (Amazon, Reddit, TikTok, LinkedIn, YouTube, etc.) and you want structured records?`,
        `   → novada_scrape (typed fields). Read novada://scraper-platforms for the operation ID. See the scrape_platform_data prompt.`,
        `7. novada_extract failed and you specifically need the raw rendered HTML for custom DOM parsing?`,
        `   → novada_unblock (forces JS render; returns raw HTML, not cleaned text).`,
        `8. Task needs interaction — click, type, log in, paginate, screenshot?`,
        `   → novada_browser (CDP actions, persistent session_id). See the browser_stateful_workflow prompt.`,
        ``,
        `Common mistakes: using novada_crawl for one page (use novada_extract); using novada_search for an open-ended report (use novada_research); using novada_unblock for readable text (use novada_extract with render="render").`,
        `State your choice and why, then call that tool.`,
      ];
      return {
        description: `Which Novada tool for: ${args.task.slice(0, 50)}${args.task.length > 50 ? "..." : ""}`,
        messages: [{
          role: "user",
          content: { type: "text", text: lines.filter(Boolean).join("\n") },
        }],
      };
    }

    case "novada-extract-format": {
      const goalLine = args.goal && args.goal.trim() !== ""
        ? `Goal: ${args.goal}`
        : "";
      const lines = [
        `Choose the right novada_extract output settings.`,
        goalLine,
        ``,
        `Decision tree (top match wins):`,
        `1. Want SPECIFIC data points (price, author, rating, availability, sku)?`,
        `   → format="json" + fields=["price","title", ...]. JSON-LD is checked first, then pattern matching. This is the main reason to use json.`,
        `2. Want to read / summarize the ENTIRE page (article, blog post, docs page)?`,
        `   → format="markdown" (the default). Add clean=true to strip nav/footer/ads and keep only the main body (~15K chars vs full page).`,
        `3. Need the raw HTML source for your own DOM parsing / debugging?`,
        `   → format="html" (truncated at 10K). For the FULL DOM use novada_unblock instead.`,
        ``,
        `Rendering: leave render="auto" (default — static first, escalates if JS-heavy). Only force render="render" for known JS-heavy SPAs. If JSON comes back empty/minimal, the page is likely JS-rendered: retry with render="render", or wait_for a CSS selector / wait_ms.`,
        `Multiple pages: pass url as an array (up to 10) to extract in parallel in one call.`,
        ``,
        `Common mistake: using markdown when you only need a few fields — use format="json" + fields instead.`,
        `State the format + fields you'll use, then call novada_extract.`,
      ];
      return {
        description: args.goal && args.goal.trim() !== ""
          ? `Extract format for: ${args.goal.slice(0, 50)}${args.goal.length > 50 ? "..." : ""}`
          : "novada_extract format decision tree",
        messages: [{
          role: "user",
          content: { type: "text", text: lines.filter(Boolean).join("\n") },
        }],
      };
    }

    default:
      throw new Error(`Unknown prompt: ${name}. Available: ${PROMPTS.map(p => p.name).join(", ")}`);
  }
}
