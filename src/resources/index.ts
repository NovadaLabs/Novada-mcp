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
    description: "Decision tree and workflow patterns for choosing between all 11 novada tools: search, extract, crawl, map, research, proxy, scrape, verify, unblock, browser, health",
    mimeType: "text/plain",
  },
  {
    uri: "novada://scraper-platforms",
    name: "Supported Scraper Platforms",
    description: "Full list of platforms supported by novada_scrape with their operation IDs and required parameters. Read this before calling novada_scrape to find the correct platform and operation for your use case.",
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
          text: `# novada-search Agent Tool Selection Guide

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
  → Read novada://scraper-platforms resource first to find the exact operation ID and required params

You need to route your own HTTP requests through a residential IP?
  → novada_proxy

You need to fact-check whether a claim is true or false?
  → novada_verify

You have a URL blocked by anti-bot protection and need JS-rendered content directly?
  → novada_unblock (or novada_extract with render="render" — same backend, unblock is dedicated)

You need to interact with a page (click buttons, fill forms, navigate, screenshot)?
  → novada_browser
  → Use aria_snapshot action to get the page's semantic structure (roles + names) — more stable than CSS selectors and 70% smaller than raw HTML snapshot

Which Novada products are active on your API key?
  → novada_health (instant status table — use for first-time setup or debugging)

## Tool Comparison

| Tool            | Use when you have…                | Output                  | Token cost |
|-----------------|-----------------------------------|-------------------------|------------|
| novada_search   | a question, no URL                | URL list + snippets     | Low        |
| novada_extract  | a URL (or list of URLs)           | Full page content       | Medium-High|
| novada_map      | a domain, need URL list           | URL list only           | Low        |
| novada_crawl    | a domain, need N pages            | Content of N pages      | High       |
| novada_research | a complex question                | Cited report            | Medium     |
| novada_scrape   | a supported platform              | Structured records      | Medium     |
| novada_proxy    | need residential IP routing       | Proxy config string     | Minimal    |
| novada_verify   | a factual claim to check          | Verdict + evidence URLs | Medium     |
| novada_unblock  | a URL blocked by anti-bot         | JS-rendered content     | Medium-High|
| novada_browser  | interactive page actions          | Action result           | High       |
| novada_health   | check which products are active   | Status table + links    | Minimal    |

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
- Using novada_scrape for domains not in the supported platform list (use novada_extract instead)

## Failure Recovery Patterns

### When novada_search returns 0 results
→ SERP may not be enabled on your API key. Use novada_research or novada_map + novada_extract instead.
→ Try: novada_verify for fact-checking without search (uses extract-based discovery)

### When novada_extract returns empty or minimal content
→ Page may be JS-heavy: retry with render="render"
→ Anti-bot detection: retry with render="browser"
→ Still empty: try novada_unblock with method="browser"

### When novada_scrape returns Error 11006
→ Scraper API not activated on this account
→ Activate at: dashboard.novada.com/overview/scraper/
→ Alternative: novada_extract on the same URL (slower, less structured)

### When novada_browser actions fail
→ Selector not found: use aria_snapshot first to see current page structure
→ Element not clickable: add wait action before click (page may still be loading)
→ Session expired: session_id is stale — start a new session without session_id

## Token Efficiency Tips

1. Batch extract: novada_extract with url=[url1, url2, ...] — up to 10 pages in one call
2. Use novada_search first: get URLs, then extract only the most relevant 2-3
3. Use novada_map before novada_crawl: confirm pages exist before fetching content
4. Use aria_snapshot not snapshot: 70% smaller than raw HTML, easier for agents to parse
5. For search pipelines: pass only the top 5 results to novada_extract, not all 10`,
        }],
      };

    case "novada://scraper-platforms":
      return {
        contents: [{
          uri,
          mimeType: "text/plain",
          text: `# Supported Scraper Platforms — novada_scrape

Read this resource to find the correct platform and operation before calling novada_scrape.

## How to Use
1. Find your platform below (use Ctrl+F / search)
2. Copy the operation ID exactly as shown
3. Check required params for that operation
4. Call: novada_scrape({ platform: "<platform>", operation: "<operation_id>", params: {...} })

---

## E-Commerce & Shopping

### amazon.com
- amazon_product_by-keywords    → params: { keyword: string, num?: 1-20, country?: string }
- amazon_product_by-asin        → params: { asin: string, country?: string }
- amazon_reviews_by-asin        → params: { asin: string, num?: 1-50 }
- amazon_sellers_by-keywords    → params: { keyword: string }
- amazon_questions_by-asin      → params: { asin: string }

### ebay.com
- ebay_product_by-keywords      → params: { keyword: string, num?: 1-20 }
- ebay_product_details          → params: { url: string }
- ebay_sellers_by-keywords      → params: { keyword: string }

### walmart.com
- walmart_product_by-keywords   → params: { keyword: string, num?: 1-20 }
- walmart_product_by-url        → params: { url: string }

### etsy.com
- etsy_product_by-keywords      → params: { keyword: string, num?: 1-20 }

### aliexpress.com
- aliexpress_product_by-keywords → params: { keyword: string, num?: 1-20 }

### shopify.com
- shopify_products               → params: { url: string }  (any Shopify store URL)

---

## Search Engines

### google.com
- google_search_by-keywords     → params: { keyword: string, num?: 1-20, country?: string, language?: string }
- google_shopping_by-keywords   → params: { keyword: string, num?: 1-20, country?: string }
- google_images_by-keywords     → params: { keyword: string, num?: 1-20 }
- google_news_by-keywords       → params: { keyword: string, num?: 1-20 }
- google_maps_by-keywords       → params: { keyword: string, location?: string }

### bing.com
- bing_search_by-keywords       → params: { keyword: string, num?: 1-20 }

### duckduckgo.com
- duckduckgo_search_by-keywords → params: { keyword: string, num?: 1-20 }

---

## Social Media

### reddit.com
- reddit_posts_by-keywords      → params: { keyword: string, num?: 1-25, time_filter?: "day"|"week"|"month"|"year"|"all" }
- reddit_post_details           → params: { url: string }
- reddit_subreddit_posts        → params: { subreddit: string, num?: 1-25 }
- reddit_user_posts             → params: { username: string }

### twitter.com / x.com
- twitter_posts_by-keywords     → params: { keyword: string, num?: 1-20 }
- twitter_user_profile          → params: { username: string }
- twitter_user_tweets           → params: { username: string, num?: 1-20 }

### tiktok.com
- tiktok_posts_by-keywords      → params: { keyword: string, num?: 1-20 }
- tiktok_user_profile           → params: { username: string }
- tiktok_user_videos            → params: { username: string, num?: 1-20 }
- tiktok_hashtag_posts          → params: { hashtag: string, num?: 1-20 }
⚠️ TikTok is geo-restricted in India and some other regions — always pass country="us" in BrowserParams

### instagram.com
- instagram_user_profile        → params: { username: string }
- instagram_user_posts          → params: { username: string, num?: 1-20 }
- instagram_hashtag_posts       → params: { hashtag: string, num?: 1-20 }

### linkedin.com
- linkedin_company_details      → params: { url: string }
- linkedin_job_listings         → params: { keyword: string, location?: string, num?: 1-20 }
- linkedin_person_profile       → params: { url: string }

### youtube.com
- youtube_search_by-keywords    → params: { keyword: string, num?: 1-20 }
- youtube_video_details         → params: { url: string }
- youtube_channel_details       → params: { url: string }

### facebook.com
- facebook_page_details         → params: { url: string }
- facebook_marketplace_listings → params: { keyword: string, location?: string }

---

## Jobs & Professional

### glassdoor.com
- glassdoor_jobs_by-keywords    → params: { keyword: string, location?: string, num?: 1-20 }
- glassdoor_company_reviews     → params: { company: string, num?: 1-20 }

### indeed.com
- indeed_jobs_by-keywords       → params: { keyword: string, location?: string, num?: 1-20 }

### linkedin.com (see Social Media above)

### ziprecruiter.com
- ziprecruiter_jobs             → params: { keyword: string, location?: string }

---

## Real Estate

### zillow.com
- zillow_listings               → params: { location: string, num?: 1-20 }
- zillow_property_details       → params: { url: string }

### realtor.com
- realtor_listings              → params: { location: string, num?: 1-20 }

### airbnb.com
- airbnb_listings               → params: { location: string, check_in?: string, check_out?: string, num?: 1-20 }
- airbnb_property_details       → params: { url: string }

---

## Finance & Crypto

### yahoo finance
- yahoo_finance_stock           → params: { symbol: string }
- yahoo_finance_news            → params: { symbol?: string, keyword?: string }

### coinmarketcap.com
- coinmarketcap_listings        → params: { num?: 1-100 }
- coinmarketcap_coin_details    → params: { symbol: string }

### investing.com
- investing_stock_details       → params: { symbol: string }
- investing_news                → params: { keyword: string, num?: 1-20 }

---

## Reviews & Local

### yelp.com
- yelp_business_search          → params: { keyword: string, location: string, num?: 1-20 }
- yelp_business_details         → params: { url: string }
- yelp_reviews                  → params: { url: string, num?: 1-20 }

### trustpilot.com
- trustpilot_company_reviews    → params: { company: string, num?: 1-20 }

### tripadvisor.com
- tripadvisor_listings          → params: { keyword: string, location: string, num?: 1-20 }
- tripadvisor_reviews           → params: { url: string, num?: 1-20 }

### google maps (see Search Engines above)

---

## Tech & Developer

### github.com
- github_repository_details     → params: { owner: string, repo: string }
- github_repo_issues            → params: { owner: string, repo: string, num?: 1-20 }
- github_user_profile           → params: { username: string }

### stackoverflow.com
- stackoverflow_search          → params: { keyword: string, num?: 1-20 }
- stackoverflow_question        → params: { url: string }

### hackernews
- hackernews_top_stories        → params: { num?: 1-30 }
- hackernews_search             → params: { keyword: string, num?: 1-20 }

### producthunt.com
- producthunt_products          → params: { date?: string, num?: 1-20 }

### npmjs.com
- npm_package_details           → params: { package: string }
- npm_search                    → params: { keyword: string, num?: 1-20 }

---

## Travel & Hospitality

### booking.com
- booking_listings              → params: { location: string, check_in: string, check_out: string, num?: 1-20 }

### hotels.com
- hotels_listings               → params: { location: string, check_in: string, check_out: string }

### expedia.com
- expedia_flights               → params: { origin: string, destination: string, date: string }

### google flights
- google_flights                → params: { origin: string, destination: string, date: string }

---

## News & Content

### google news (see Search Engines above)

### medium.com
- medium_search                 → params: { keyword: string, num?: 1-20 }
- medium_publication_posts      → params: { publication: string, num?: 1-20 }

### quora.com
- quora_search                  → params: { keyword: string, num?: 1-20 }

---

## Total Coverage
129 platforms across: e-commerce, search, social, jobs, real estate, finance, reviews, tech, travel, news.

## Common Mistakes
- Wrong operation ID → Error 11006 or empty results. Operation IDs are exact strings — do not guess.
- Missing required params → Zod validation error before the API call.
- Platform not in this list → Use novada_extract or novada_crawl instead.
- TikTok without country="us" → Geo-restricted content, empty results.

## Full Platform Reference
This resource IS the complete list. For additional operations not listed here, see:
https://developer.novada.com/novada/advanced-proxy-solutions/scraper-api`,
        }],
      };

    default:
      throw new Error(`Unknown resource URI: ${uri}. Available: ${RESOURCES.map(r => r.uri).join(", ")}`);
  }
}
