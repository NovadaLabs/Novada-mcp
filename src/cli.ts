#!/usr/bin/env node

/**
 * nova CLI — Direct command-line access to Novada web data tools.
 *
 * Usage:
 *   nova search "best AI frameworks 2025"
 *   nova extract https://example.com
 *   nova crawl https://docs.example.com --pages 10
 *   nova map https://example.com --search "api"
 *   nova research "How do AI agents use web scraping?"
 */

import { novadaSearch, novadaExtract, novadaCrawl, novadaResearch, novadaMap, novadaProxy, novadaScrape, novadaVerify, validateSearchParams, validateExtractParams, validateCrawlParams, validateResearchParams, validateMapParams, validateProxyParams, validateScrapeParamsFull, validateVerifyParams } from "./tools/index.js";
import { VERSION } from "./config.js";

const API_KEY = process.env.NOVADA_API_KEY;

const HELP = `nova v${VERSION} — Novada web data CLI

Usage:
  nova search <query> [--engine google] [--num 10] [--country us] [--time day|week|month|year]
              [--include domain1,domain2] [--exclude domain1,domain2]
  nova extract <url> [--format markdown|text|html] [--render auto|static|render|browser]
  nova crawl <url> [--max-pages 5] [--strategy bfs|dfs] [--render auto|static|render]
              [--select "/docs/.*,/api/.*"] [--exclude-paths "/blog/.*"]
              [--instructions "only API reference pages"]
  nova map <url> [--search <term>] [--limit 50] [--max-depth 2]
  nova research <question> [--depth auto|quick|deep|comprehensive] [--focus "technical"]
  nova proxy [--type residential|mobile|isp|datacenter] [--country us] [--format url|env|curl]
  nova scrape --platform amazon.com --operation amazon_product_by-keywords --keyword "iphone 16"
              [--num 10] [--format markdown|json|csv|html|xlsx] [--limit 20]
  nova verify "<claim>" [--context "as of 2024"]

Environment:
  NOVADA_API_KEY          Required. Scraper API key.
  NOVADA_BROWSER_WS       Optional. wss://user:pass@upg-scbr.novada.com (Browser API)
  NOVADA_PROXY_USER       Optional. Proxy username (from dashboard)
  NOVADA_PROXY_PASS       Optional. Proxy password
  NOVADA_PROXY_ENDPOINT   Optional. Proxy host:port

Examples:
  nova search "GPT-5 release" --time week --country us
  nova search "best AI tools" --include "github.com,arxiv.org"
  nova extract https://example.com --format markdown
  nova extract https://example.com --render browser
  nova crawl https://docs.example.com --max-pages 10 --select "/api/.*"
  nova crawl https://docs.example.com --instructions "only quickstart pages"
  nova map https://example.com --search "pricing" --max-depth 3
  nova research "How do AI agents use web scraping?" --depth deep --focus "production use cases"
  nova proxy --type residential --country us --format env
  nova scrape --platform amazon.com --operation amazon_product_by-keywords --keyword "iphone 16" --num 5 --format csv
  nova scrape --platform reddit.com --operation reddit_posts_by-keywords --keyword "AI agents" --num 10
  nova verify "The Eiffel Tower is 330 meters tall" --context "as of 2024"
`;

function parseArgs(args: string[]): { positional: string; flags: Record<string, string> } {
  let positional = "";
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        // --flag=value syntax
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        // --flag value syntax
        flags[arg.slice(2)] = args[i + 1];
        i++;
      } else {
        // boolean flag (no value) — set to "true"
        flags[arg.slice(2)] = "true";
      }
    } else if (!positional) {
      positional = arg;
    }
  }
  return { positional, flags };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  if (command === "--version" || command === "-v") {
    console.log(`nova v${VERSION}`);
    process.exit(0);
  }

  if (!API_KEY && command !== "proxy") {
    console.error("Error: NOVADA_API_KEY not set. Get your key at https://www.novada.com");
    process.exit(1);
  }

  const { positional, flags } = parseArgs(rest);

  const noPositionalCommands = new Set(["proxy", "scrape"]);
  if (!positional && !noPositionalCommands.has(command)) {
    console.error(`Error: ${command} requires an argument. Run 'nova --help' for usage.`);
    process.exit(1);
  }

  try {
    let result: string;

    switch (command) {
      case "search":
        result = await novadaSearch(
          validateSearchParams({
            query: positional,
            engine: flags.engine || "google",
            num: flags.num ? parseInt(flags.num) : 10,
            country: flags.country || "",
            language: flags.language || "",
            time_range: flags.time as "day" | "week" | "month" | "year" | undefined,
            start_date: flags.from,
            end_date: flags.to,
            include_domains: flags.include ? flags.include.split(",").map((d: string) => d.trim()) : undefined,
            exclude_domains: flags.exclude ? flags.exclude.split(",").map((d: string) => d.trim()) : undefined,
          }),
          API_KEY!
        );
        break;

      case "extract":
        result = await novadaExtract(
          validateExtractParams({
            url: positional,
            format: (flags.format as "markdown" | "text" | "html") || "markdown",
            render: (flags.render as "auto" | "static" | "render" | "browser") || "auto",
          }),
          API_KEY!
        );
        break;

      case "crawl":
        result = await novadaCrawl(
          validateCrawlParams({
            url: positional,
            max_pages: flags["max-pages"]
              ? parseInt(flags["max-pages"])
              : flags.pages
                ? parseInt(flags.pages)
                : 5,
            strategy: (flags.strategy as "bfs" | "dfs") || "bfs",
            render: (flags.render as "auto" | "static" | "render") || "auto",
            instructions: flags.instructions,
            select_paths: flags.select ? flags.select.split(",").map((p: string) => p.trim()) : undefined,
            exclude_paths: flags["exclude-paths"] ? flags["exclude-paths"].split(",").map((p: string) => p.trim()) : undefined,
          }),
          API_KEY!
        );
        break;

      case "map":
        result = await novadaMap(
          validateMapParams({
            url: positional,
            search: flags.search,
            limit: flags.limit ? parseInt(flags.limit) : 50,
            max_depth: flags["max-depth"] ? parseInt(flags["max-depth"]) : 2,
          }),
          API_KEY!
        );
        break;

      case "research":
        result = await novadaResearch(
          validateResearchParams({
            question: positional,
            depth: (flags.depth as "quick" | "deep" | "auto" | "comprehensive") || "auto",
            focus: flags.focus,
          }),
          API_KEY!
        );
        break;

      case "proxy": {
        const params = validateProxyParams({
          type: (flags.type as "residential" | "mobile" | "isp" | "datacenter") || "residential",
          country: flags.country,
          format: (flags.format as "url" | "env" | "curl") || "url",
          session_id: flags.session,
        });
        result = await novadaProxy(params);
        break;
      }

      case "scrape": {
        // Build params object from remaining flags (pass-through for operation-specific params)
        const { platform, operation, format, limit, ...rest } = flags;
        const opParams: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rest)) {
          // Try to coerce numeric values
          const num = Number(v);
          opParams[k] = isNaN(num) || v === "" ? v : num;
        }
        result = await novadaScrape(
          validateScrapeParamsFull({
            platform,
            operation,
            params: opParams,
            format: (format as "markdown" | "json" | "csv" | "html" | "xlsx") || "markdown",
            limit: limit ? parseInt(limit) : 20,
          }),
          API_KEY!
        );
        break;
      }

      case "verify":
        result = await novadaVerify(
          validateVerifyParams({
            claim: positional,
            context: flags.context,
          }),
          API_KEY!
        );
        break;

      default:
        console.error(`Unknown command: ${command}. Run 'nova --help' for usage.`);
        process.exit(1);
    }

    console.log(result);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
