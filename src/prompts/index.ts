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

    default:
      throw new Error(`Unknown prompt: ${name}. Available: ${PROMPTS.map(p => p.name).join(", ")}`);
  }
}
