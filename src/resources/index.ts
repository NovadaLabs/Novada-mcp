// ─── MCP Resources ────────────────────────────────────────────────────────────
// Read-only data agents can access before making tool decisions.
// Reduces hallucination ("does novada support X?") and fixes LobeHub Resources criterion.

interface Resource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

interface ListResourcesResult {
  resources: Resource[];
}

interface ReadResourceResult {
  contents: ResourceContent[];
}

export const RESOURCES: Resource[] = [
  {
    uri: "novada://engines",
    name: "Supported Search Engines",
    description: "List of search engines available in novada_search with characteristics and recommended use cases",
    mimeType: "text/plain",
  },
  {
    uri: "novada://countries",
    name: "Supported Country Codes",
    description: "Country codes for geo-targeted search in novada_search. 195 countries supported; top 50 listed here.",
    mimeType: "text/plain",
  },
  {
    uri: "novada://guide",
    name: "Agent Tool Selection Guide",
    description: "Decision tree and workflow patterns for choosing between all 7 novada tools: search, extract, crawl, map, research, proxy, scrape",
    mimeType: "text/plain",
  },
];

export function listResources(): ListResourcesResult {
  return { resources: RESOURCES };
}

export function readResource(uri: string): ReadResourceResult {
  switch (uri) {
    case "novada://engines":
      return {
        contents: [{
          uri,
          mimeType: "text/plain",
          text: `# Supported Search Engines

google     — Best general-purpose engine, highest relevance. Default choice.
bing       — Good alternative. Required for mkt-based locale targeting (sets mkt param automatically).
duckduckgo — Privacy-focused, no personalization bias. Good for neutral/unfiltered results.
yahoo      — Older index, occasionally surfaces different pages than Google.
yandex     — Best for Russian-language content and Eastern European queries.

## Recommendation
- Default: google
- Russian/CIS content: yandex
- Unbiased results: duckduckgo
- Always pair with country + language for localized results.`,
        }],
      };

    case "novada://countries":
      return {
        contents: [{
          uri,
          mimeType: "text/plain",
          text: `# Country Codes for Geo-Targeted Search
Pass as the 'country' parameter in novada_search. 195 countries total.

## Most Used
us — United States    gb — United Kingdom    de — Germany
fr — France           jp — Japan             cn — China
kr — South Korea      in — India             br — Brazil
ca — Canada           au — Australia         mx — Mexico
es — Spain            it — Italy             nl — Netherlands

## Europe
se — Sweden           no — Norway            dk — Denmark
fi — Finland          ch — Switzerland       at — Austria
pl — Poland           cz — Czech Republic    ru — Russia
pt — Portugal         be — Belgium           gr — Greece
hu — Hungary          ro — Romania           tr — Turkey

## Asia-Pacific
sg — Singapore        hk — Hong Kong         tw — Taiwan
id — Indonesia        th — Thailand          vn — Vietnam
ph — Philippines      my — Malaysia          nz — New Zealand

## Middle East & Africa
sa — Saudi Arabia     ae — UAE               il — Israel
eg — Egypt            ng — Nigeria           za — South Africa
ke — Kenya            ma — Morocco

## Americas
ar — Argentina        co — Colombia          cl — Chile
pe — Peru             ve — Venezuela         ec — Ecuador

Total: 195 countries supported.`,
        }],
      };

    case "novada://guide":
      return {
        contents: [{
          uri,
          mimeType: "text/plain",
          text: `# novada-mcp Agent Tool Selection Guide

## Quick Decision Tree

You have a question or topic but no URL?
  → Simple fact lookup: novada_search
  → Complex multi-source question: novada_research (depth='auto')

You have a URL and need its content?
  → novada_extract (pass url as array for batch — up to 10 pages in one call)

You need to know what URLs exist on a site?
  → novada_map → then novada_extract on chosen URLs

You need content from multiple pages and don't have the URLs yet?
  → novada_crawl (with select_paths regex to target relevant sections)

You need structured data from a known platform (Amazon, Reddit, TikTok…)?
  → novada_scrape

You need to route your own HTTP requests through a residential IP?
  → novada_proxy

## Tool Comparison

| Tool            | Use when you have…          | Output              | Token cost |
|-----------------|-----------------------------|---------------------|------------|
| novada_search   | a question, no URL          | URL list + snippets | Low        |
| novada_extract  | a URL (or list of URLs)     | Full page content   | Medium-High|
| novada_map      | a domain, need URL list     | URL list only       | Low        |
| novada_crawl    | a domain, need N pages      | Content of N pages  | High       |
| novada_research | a complex question          | Cited report        | Medium     |
| novada_scrape   | a supported platform        | Structured records  | Medium     |
| novada_proxy    | need residential IP routing | Proxy config        | Minimal    |

## Efficient Workflow Patterns

### RAG Pipeline
novada_search → novada_extract([top 5 urls]) → feed to vector store

### Competitive Analysis
novada_map competitor.com → novada_crawl with select_paths=['/pricing','/features'] → synthesize

### Current Events
novada_search with time_range='week' → novada_extract on top results

### Documentation Ingestion
novada_map docs.example.com → novada_crawl with select_paths=['/docs/api/.*']

### Research Report
novada_research with depth='deep' → novada_extract on 2–3 most relevant sources

### E-commerce Data
novada_scrape with platform='amazon.com', operation='amazon_product_by-keywords'

## Common Mistakes to Avoid

- Using novada_extract for URL discovery (use novada_map first — much faster)
- Using novada_crawl when you only need 1 page (use novada_extract)
- Calling novada_extract 5 times instead of once with url=[...] array
- Setting max_pages too high in crawl (large token cost, often unnecessary)
- Not adding time_range for queries about recent events
- Using novada_scrape for domains not in the supported platform list (use novada_extract instead)`,
        }],
      };

    default:
      throw new Error(`Unknown resource URI: ${uri}. Available: ${RESOURCES.map(r => r.uri).join(", ")}`);
  }
}
