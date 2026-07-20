import type { z } from "zod";
import {
  createPlatformScraperTool,
  type PlatformScraperConfig,
  type PlatformOperationConfig,
} from "./platform_scraper.js";

// ─── GitHub operation → catalog scraper_id map (single source of truth) ─────
// Tools-v2: novada_scrape_github, built on the config-driven platform-scraper
// factory (src/tools/platform_scraper.ts — see scrape_amazon.ts for the
// proof-of-pattern). Friendly, human-readable operation names for
// novada_scrape_github, each mapped deterministically to the exact `slug`
// (== scraper_id) in src/data/scraper_catalog.ts's github.com block.
//
// All 3 github.com catalog operations are status:"ok" as of the 2026-07-13 live
// verification pass — none are excluded here. If a future catalog refresh marks
// any of these backend_broken, tests/tools/platform-scraper-catalog.test.ts will
// fail CI until it is removed from this map.
//
// repository_by_url / repository_details_by_url note: the catalog carries TWO
// distinct scraper_ids (github_repository_repo-url, api_id 90, and
// github_repository_url, api_id 92) that both take the SAME single `url` param
// and read as functionally identical from the catalog's own metadata (only their
// dflt example URL differs). The catalog does not document a behavioral
// difference between them, so both are exposed here rather than guessing which
// one to silently drop — any real difference lives on the backend, not in the
// catalog data this config is built from.
export const GITHUB_OPERATIONS = Object.freeze({
  repository_by_url: "github_repository_repo-url",
  repository_details_by_url: "github_repository_url",
  repositories_by_search_url: "github_repository_search-url",
} as const);

export type GithubOperation = keyof typeof GITHUB_OPERATIONS;

/** Per-operation `params` doc — rendered as `- <name>: <doc>` in the enum description. */
const GITHUB_OPERATION_PARAMS_DOC: Record<GithubOperation, string> = {
  repository_by_url: "params.url (repository URL, e.g. \"https://github.com/gin-gonic/gin\"); optional params.file_name",
  repository_details_by_url: "params.url (repository URL, e.g. \"https://github.com/QwenLM/Qwen\"); optional params.file_name",
  repositories_by_search_url: "params.search_url (a GitHub search-results URL, e.g. \"https://github.com/search?q=ai&type=repositories\"); optional params.page_limit, params.max, params.file_name",
};

const GITHUB_OPERATION_CONFIGS: Record<GithubOperation, PlatformOperationConfig> = Object.fromEntries(
  (Object.keys(GITHUB_OPERATIONS) as GithubOperation[]).map((name) => [
    name,
    { scraperId: GITHUB_OPERATIONS[name], paramsDoc: GITHUB_OPERATION_PARAMS_DOC[name] },
  ]),
) as Record<GithubOperation, PlatformOperationConfig>;

/** GitHub's declarative platform-scraper config — the factory's sole input for this tool. */
export const GITHUB_SCRAPER_CONFIG: PlatformScraperConfig<GithubOperation> = {
  platform: "github.com",
  platformLabel: "GitHub",
  toolName: "novada_scrape_github",
  category: "Scraping & Verification",
  registryDescription:
    "Extract structured GitHub repository data (by repository URL or a search-results URL) via a closed, typed operation enum — 3 verified-working operations; same engine and output formats as novada_scrape, pinned to platform=github.com",
  operations: GITHUB_OPERATION_CONFIGS,
  paramsFieldDoc:
    "Operation-specific parameters for the selected `operation`. E.g. { url: \"https://github.com/gin-gonic/gin\" } for " +
    "repository_by_url/repository_details_by_url, { search_url: \"https://github.com/search?q=ai&type=repositories\" } for repositories_by_search_url.",
  description: {
    core:
      "Extract structured GitHub repository data — repository details by URL, or multiple repositories from a GitHub search-results URL — through a GitHub-only tool with a closed, typed `operation` enum. Same underlying engine as novada_scrape, pinned to platform=\"github.com\".",
    useWhen: [
      "get repository info (stars, forks, description, language, etc.) for this GitHub repo URL",
      "get the repositories listed on this GitHub search-results URL",
    ],
    notFor: [
      { when: "A single GitHub URL (repo, issue, PR, user) you just want read as plain text", useInstead: "novada_extract" },
      { when: "A general web/code search not scoped to GitHub, or a GitHub issue/PR/user lookup (no catalog operation exists for those)", useInstead: "novada_search, or novada_extract for a known URL" },
      { when: "A different platform's structured data (LinkedIn, Amazon, etc.)", useInstead: "novada_scrape with that platform's domain, or its own novada_scrape_<platform> tool" },
    ],
    returns:
      "Structured repository records (name, description, stars, forks, language, etc.) in the chosen format (markdown/json/csv/excel/html/toon) — same rendering as novada_scrape.",
    operationsNote:
      "3 verified-working GitHub operations: two repository-by-URL lookups (`repository_by_url` and `repository_details_by_url` map to distinct catalog scraper_ids — github_repository_repo-url and github_repository_url respectively — both taking the same `url` param; the catalog documents no behavioral difference between them) and repository listing from a GitHub search-results URL (see the `operation` param's description for the exact `params` keys each needs). Every github.com catalog operation is currently status:\"ok\" — none are excluded for being backend_broken.",
  },
};

/** The materialized GitHub platform-scraper tool (definition + registry entry + handler). */
export const GITHUB_SCRAPER_TOOL = createPlatformScraperTool(GITHUB_SCRAPER_CONFIG);

export const ScrapeGithubParamsSchema = GITHUB_SCRAPER_TOOL.ParamsSchema;

export type ScrapeGithubParams = z.infer<typeof ScrapeGithubParamsSchema>;

export function validateScrapeGithubParams(args: Record<string, unknown> | undefined): ScrapeGithubParams {
  return GITHUB_SCRAPER_TOOL.validateParams(args);
}

/**
 * novada_scrape_github — a thin, GitHub-only adapter over the shared scrape engine
 * (novadaScrape in ./scrape.js), generated by the platform-scraper factory. Resolves
 * the friendly `operation` name to its exact catalog scraper_id, pins the platform to
 * "github.com", and delegates everything else — the HTTP call, polling, output
 * rendering, and error classification — to novadaScrape. No HTTP/FormData logic is
 * duplicated here.
 */
export async function novadaScrapeGithub(params: ScrapeGithubParams, apiKey: string): Promise<string> {
  return GITHUB_SCRAPER_TOOL.handler(params, apiKey);
}
