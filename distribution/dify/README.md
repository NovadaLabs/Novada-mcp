# Novada — Dify Tool Plugin

Search, extract, crawl, and scrape the live web from Dify Chatflow/Workflow/Agent apps
with one Novada API key.

| Tool | What it does |
|---|---|
| `novada_search` | Searches the web and returns ranked titles, URLs, and snippets. |
| `novada_extract` | Extracts readable content from one URL, or a JSON array of up to 10 URLs for batch mode. |
| `novada_crawl` | Crawls up to 20 pages from a starting URL (breadth- or depth-first) and extracts each page. |
| `novada_map` | Discovers up to 100 URLs on a site (sitemap first, then crawl fallback) without fetching content. |
| `novada_research` | Runs several parallel web searches, dedupes, and extracts cited source passages for a question. |
| `novada_scrape` | Returns structured records for a named platform and operation, instead of raw HTML. |
| `novada_account` | Reads wallet balance, plan quotas, usage history, or traffic for the authenticated account. |

## Setup

1. Get an API key from the Novada dashboard: https://www.novada.com (sign up, then
   open **API Keys**).
2. Install this plugin in your Dify workspace (via the Marketplace listing, or by
   uploading the `.difypkg` file directly).
3. When prompted for credentials, paste the API key into the **Novada API Key**
   field. The plugin validates it by calling Novada's own free health-check tool
   (`novada_setup`) — no quota is consumed by this check.
4. Add any of the tools above to a Chatflow, Workflow, or Agent app.

## Required credentials

- `api_key` (secret input) — a Novada API key, sent as an `Authorization: Bearer`
  header on every request to `mcp.novada.com`. No other credential is required.

## Connection requirements

This plugin's Python code makes outbound HTTPS requests to exactly one host:
`mcp.novada.com`. It never contacts any other destination directly — every search
query, URL, or scrape target you supply is forwarded as a JSON field in that request,
and Novada's own backend infrastructure performs the actual fetch/search/scrape
server-side. See `PRIVACY.md` for what data is sent and how Novada's backend handles
it afterward.

## Source

https://github.com/NovadaLabs/Novada-mcp/tree/main/distribution/dify

## Support

support@novada.com
