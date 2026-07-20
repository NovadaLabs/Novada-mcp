import type { z } from "zod";
import {
  createPlatformScraperTool,
  type PlatformScraperConfig,
  type PlatformOperationConfig,
} from "./platform_scraper.js";

// ─── Perplexity operation → catalog scraper_id map (single source of truth) ─
// Tools-v2: novada_scrape_perplexity, built on the config-driven platform-scraper
// factory (src/tools/platform_scraper.ts — see scrape_amazon.ts for the
// proof-of-pattern). Friendly, human-readable operation names for
// novada_scrape_perplexity, each mapped deterministically to the exact `slug`
// (== scraper_id) in src/data/scraper_catalog.ts's perplexity.ai block.
//
// All 2 perplexity.ai catalog operations are status:"ok" as of the 2026-07-13 live
// verification pass — none are excluded here. If a future catalog refresh marks
// either backend_broken, tests/tools/platform-scraper-catalog.test.ts will fail CI
// until it is removed from this map.
//
// ChatGPT (chatgpt.com), Perplexity's sibling AI-answer platform in the catalog,
// has NO novada_scrape_chatgpt tool: its only 2 catalog operations
// (chatgpt_answer_searchterm, chatgpt_answer_url) are BOTH status:"backend_broken"
// ("submit hangs >120s — scraper likely disabled/broken", verified 2026-07-13) — a
// tool exposing zero working operations would be worse than no tool at all.
export const PERPLEXITY_OPERATIONS = Object.freeze({
  answer_by_url: "perplexity_answer_url",
  answer_by_search_term: "perplexity_answer_searchterm",
} as const);

export type PerplexityOperation = keyof typeof PERPLEXITY_OPERATIONS;

/** Per-operation `params` doc — rendered as `- <name>: <doc>` in the enum description. */
const PERPLEXITY_OPERATION_PARAMS_DOC: Record<PerplexityOperation, string> = {
  answer_by_url: "params.url (a Perplexity AI query URL, e.g. \"https://www.perplexity.ai/?q=apple\"); optional params.file_name",
  answer_by_search_term: "params.search_terms (e.g. \"Today's weather\"); optional params.file_name",
};

const PERPLEXITY_OPERATION_CONFIGS: Record<PerplexityOperation, PlatformOperationConfig> = Object.fromEntries(
  (Object.keys(PERPLEXITY_OPERATIONS) as PerplexityOperation[]).map((name) => [
    name,
    { scraperId: PERPLEXITY_OPERATIONS[name], paramsDoc: PERPLEXITY_OPERATION_PARAMS_DOC[name] },
  ]),
) as Record<PerplexityOperation, PlatformOperationConfig>;

/** Perplexity's declarative platform-scraper config — the factory's sole input for this tool. */
export const PERPLEXITY_SCRAPER_CONFIG: PlatformScraperConfig<PerplexityOperation> = {
  platform: "perplexity.ai",
  platformLabel: "Perplexity AI",
  toolName: "novada_scrape_perplexity",
  category: "Scraping & Verification",
  registryDescription:
    "Extract Perplexity AI's own generated answer for a query (by URL or raw search term) via a closed, typed operation enum — 2 verified-working operations; same engine and output formats as novada_scrape, pinned to platform=perplexity.ai",
  operations: PERPLEXITY_OPERATION_CONFIGS,
  paramsFieldDoc:
    "Operation-specific parameters for the selected `operation`. E.g. { url: \"https://www.perplexity.ai/?q=apple\" } for " +
    "answer_by_url, { search_terms: \"Today's weather\" } for answer_by_search_term.",
  description: {
    core:
      "Extract the actual AI-generated answer Perplexity returns for a query — by a Perplexity query URL or a raw search term — through a Perplexity-only tool with a closed, typed `operation` enum. Same underlying engine as novada_scrape, pinned to platform=\"perplexity.ai\". This scrapes Perplexity's own live-rendered answer page (the model's actual response text) — it is NOT a web search results list and NOT an indexed-page brand-mention scan.",
    useWhen: [
      "what does Perplexity AI answer for <query>",
      "get Perplexity's generated answer for this perplexity.ai URL",
      "get Perplexity's answer for the search term <term>",
    ],
    notFor: [
      { when: "A general web/multi-engine search for information (not specifically Perplexity's own generated answer)", useInstead: "novada_search" },
      { when: "Checking whether a brand is mentioned on AI-company indexed public pages (chatgpt.com/perplexity.ai/openai.com/etc.)", useInstead: "novada_ai_monitor — that tool scans INDEXED PUBLIC PAGES for brand mentions across AI-company domains; it does not fetch a live generated answer for an arbitrary query the way this tool does" },
      { when: "A complex question needing cited, multi-source synthesis", useInstead: "novada_research" },
      { when: "Reading one already-known URL's raw page content", useInstead: "novada_extract" },
      { when: "A different platform's structured data (Amazon, LinkedIn, etc.)", useInstead: "novada_scrape with that platform's domain, or its own novada_scrape_<platform> tool" },
    ],
    returns:
      "Perplexity's rendered answer content (the text of its generated response) in the chosen format (markdown/json/csv/excel/html/toon) — same rendering as novada_scrape.",
    operationsNote:
      "2 verified-working Perplexity operations: answer by a perplexity.ai query URL, or answer by a raw search term (see the `operation` param's description for the exact `params` keys each needs). Every perplexity.ai catalog operation is currently status:\"ok\" — none are excluded for being backend_broken, unlike its sibling chatgpt.com, whose only 2 catalog operations are BOTH backend_broken (verified 2026-07-13, \"submit hangs >120s\") — which is why no novada_scrape_chatgpt tool exists.",
  },
};

/** The materialized Perplexity platform-scraper tool (definition + registry entry + handler). */
export const PERPLEXITY_SCRAPER_TOOL = createPlatformScraperTool(PERPLEXITY_SCRAPER_CONFIG);

export const ScrapePerplexityParamsSchema = PERPLEXITY_SCRAPER_TOOL.ParamsSchema;

export type ScrapePerplexityParams = z.infer<typeof ScrapePerplexityParamsSchema>;

export function validateScrapePerplexityParams(args: Record<string, unknown> | undefined): ScrapePerplexityParams {
  return PERPLEXITY_SCRAPER_TOOL.validateParams(args);
}

/**
 * novada_scrape_perplexity — a thin, Perplexity-only adapter over the shared scrape
 * engine (novadaScrape in ./scrape.js), generated by the platform-scraper factory.
 * Resolves the friendly `operation` name to its exact catalog scraper_id, pins the
 * platform to "perplexity.ai", and delegates everything else — the HTTP call,
 * polling, output rendering, and error classification — to novadaScrape. No
 * HTTP/FormData logic is duplicated here.
 */
export async function novadaScrapePerplexity(params: ScrapePerplexityParams, apiKey: string): Promise<string> {
  return PERPLEXITY_SCRAPER_TOOL.handler(params, apiKey);
}
