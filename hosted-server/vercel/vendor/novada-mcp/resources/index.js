// ─── MCP Resources ────────────────────────────────────────────────────────────
// Read-only data agents can access before making tool decisions.
// Reduces hallucination ("does novada support X?") and fixes LobeHub Resources criterion.
import { SCRAPER_CATALOG } from "../data/scraper_catalog.js";
export const RESOURCES = [
    {
        uri: "novada://engines",
        name: "Supported Search Engines",
        description: "List of search engines available in novada_search with characteristics and recommended use cases",
        mimeType: "text/plain",
    },
    {
        uri: "novada://countries",
        name: "Supported Country Codes",
        description: "Country codes for geo-targeted search in novada_search. All 195 ISO 3166-1 alpha-2 country codes, grouped by region.",
        mimeType: "text/plain",
    },
    {
        uri: "novada://guide",
        name: "Agent Tool Selection Guide",
        description: "Decision tree and workflow patterns for choosing between all 23 novada tools: search, extract, crawl, map, research, proxy variants (6), scrape, scraper async (3), verify, unblock, browser, health, discover",
        mimeType: "text/plain",
    },
    {
        uri: "novada://scraper-platforms",
        name: "Supported Scraper Platforms",
        description: "Full list of platforms supported by novada_scrape with their operation IDs and required parameters. Read this before calling novada_scrape to find the correct platform and operation for your use case.",
        mimeType: "text/plain",
    },
    {
        uri: "novada://llms-txt",
        name: "LLM-Optimized Tool Reference",
        description: "Concise LLM-friendly reference for all 23 novada tools. One paragraph per tool with best-for, not-for, required params, and example. Optimized for context injection — 60% shorter than full guide.",
        mimeType: "text/plain",
    },
    {
        uri: "novada://privacy",
        name: "Privacy & Telemetry Disclosure",
        description: "Exactly what usage metadata the hosted Novada MCP gateway (mcp.novada.com) logs — full field list, what is never collected (search queries, URL paths, page content, parameter values), retention, and contact. The local npm server logs nothing to Novada.",
        mimeType: "text/plain",
    },
];
// Static category mapping — domain → display category
const PLATFORM_CATEGORIES = {
    "amazon.com": "E-Commerce",
    "walmart.com": "E-Commerce",
    "shein.com": "E-Commerce",
    "google.com": "Search Engine",
    "bing.com": "Search Engine",
    "duckduckgo.com": "Search Engine",
    "yandex.com": "Search Engine",
    "x.com": "Social Media",
    "tiktok.com": "Social Media",
    "instagram.com": "Social Media",
    "facebook.com": "Social Media",
    "youtube.com": "Social Media",
    "linkedin.com": "Professional / B2B",
    "github.com": "Tech / Developer",
    "chatgpt.com": "AI / Conversational",
    "perplexity.ai": "AI / Conversational",
};
const CATEGORY_ORDER = [
    "E-Commerce",
    "Search Engine",
    "Social Media",
    "Professional / B2B",
    "Tech / Developer",
    "AI / Conversational",
    "Other",
];
function buildScraperPlatformsText() {
    const lines = [
        "# Supported Scraper Platforms — novada_scrape",
        "",
        "Read this resource to find the correct platform and operation before calling novada_scrape.",
        "Operation IDs are EXACT — do not guess or invent variants. Verified 2026-07-13.",
        "",
        "## How to Use",
        "1. Find your platform below",
        "2. Copy the operation exactly as shown — do NOT modify it",
        "3. Call: novada_scrape({ platform: \"<domain>\", operation: \"<operation_id>\", params: {...} })",
        "4. Params are wrapped automatically in scraper_params=[{...}] format by the MCP",
        "",
        `IMPORTANT: Only these ${SCRAPER_CATALOG.length} platforms have active operations. All others`,
        "(reddit, glassdoor, zillow, etc.) have 0 scenes and will return error 11006.",
        "Use novada_extract for unsupported platforms.",
        "",
        "---",
        "",
    ];
    // Group by category
    const byCategory = {};
    for (const p of SCRAPER_CATALOG) {
        const cat = PLATFORM_CATEGORIES[p.domain] ?? "Other";
        if (!byCategory[cat])
            byCategory[cat] = [];
        byCategory[cat].push(p);
    }
    const cats = [
        ...CATEGORY_ORDER.filter(c => byCategory[c]),
        ...Object.keys(byCategory).filter(c => !CATEGORY_ORDER.includes(c)),
    ];
    for (const cat of cats) {
        const platforms = byCategory[cat];
        if (!platforms?.length)
            continue;
        lines.push(`## ${cat}`, "");
        for (const p of platforms) {
            lines.push(`### ${p.domain} (platform_id=${p.platform_id})`);
            const healthy = p.ops.filter(op => op.status === "ok");
            const broken = p.ops.filter(op => op.status === "backend_broken");
            for (const op of healthy) {
                const allParams = op.params.map(param => {
                    const optMark = param.required ? "" : "?";
                    return `${param.key}${optMark}: string`;
                }).join(", ");
                const paramStr = allParams || "none";
                lines.push(`- ${op.slug.padEnd(44)} → params: { ${paramStr} }`);
            }
            if (broken.length > 0) {
                lines.push("");
                lines.push("  Backend-broken (call forwarded with warning — backend may fix any day):");
                for (const op of broken) {
                    lines.push(`  - ${op.slug} — ${op.broken_reason ?? "backend failure"}`);
                }
            }
            lines.push("");
        }
    }
    lines.push("---", "");
    lines.push("## NOT AVAILABLE (0 scenes — use novada_extract instead)");
    lines.push("reddit.com, glassdoor.com, zillow.com, ebay.com, etsy.com, tripadvisor.com, airbnb.com,");
    lines.push("booking.com, indeed.com, stackoverflow.com, medium.com, quora.com, and ~91 others.");
    lines.push("");
    lines.push("## Common Mistakes");
    lines.push("- Using invented operation IDs — use ONLY the IDs listed above.");
    lines.push("- Using reddit/glassdoor/zillow — NOT AVAILABLE, use novada_extract instead.");
    lines.push("- Error 11006 = either (a) Scraper API not activated, or (b) invalid operation ID. Check the ID first.");
    lines.push("- Error 11008 = unknown platform name. Use exact domain like \"amazon.com\", \"x.com\".");
    lines.push("- Error 11009 = wrong request format (flat vs scraper_params). The MCP handles this automatically.");
    return lines.join("\n");
}
export function listResources() {
    return { resources: RESOURCES };
}
export function readResource(uri) {
    switch (uri) {
        case "novada://engines":
            return {
                contents: [{
                        uri,
                        mimeType: "text/plain",
                        text: `# Supported Search Engines

google     — Best general-purpose engine, highest relevance. Default choice.
duckduckgo — Privacy-focused, no personalization bias. Good for neutral/unfiltered results.
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
Pass as the 'country' parameter in novada_search. 195 countries supported.

## Most Used
us — United States    gb — United Kingdom    de — Germany
fr — France           jp — Japan             cn — China
kr — South Korea      in — India             br — Brazil
ca — Canada           au — Australia         mx — Mexico
es — Spain            it — Italy             nl — Netherlands

## Europe
ad — Andorra          al — Albania           am — Armenia
at — Austria          az — Azerbaijan        ba — Bosnia & Herzegovina
be — Belgium          bg — Bulgaria          by — Belarus
ch — Switzerland      cy — Cyprus            cz — Czech Republic
de — Germany          dk — Denmark           ee — Estonia
es — Spain            fi — Finland           fr — France
gb — United Kingdom   ge — Georgia           gr — Greece
hr — Croatia          hu — Hungary           ie — Ireland
is — Iceland          it — Italy             li — Liechtenstein
lt — Lithuania        lu — Luxembourg        lv — Latvia
mc — Monaco           md — Moldova           me — Montenegro
mk — North Macedonia  mt — Malta             nl — Netherlands
no — Norway           pl — Poland            pt — Portugal
ro — Romania          rs — Serbia            ru — Russia
se — Sweden           si — Slovenia          sk — Slovakia
sm — San Marino       tr — Turkey            ua — Ukraine

## Asia
ae — UAE              af — Afghanistan       am — Armenia
az — Azerbaijan       bd — Bangladesh        bh — Bahrain
bn — Brunei           bt — Bhutan            cn — China
cy — Cyprus           ge — Georgia           id — Indonesia
il — Israel           in — India             iq — Iraq
ir — Iran             jo — Jordan            jp — Japan
kg — Kyrgyzstan       kh — Cambodia          kp — North Korea
kr — South Korea      kw — Kuwait            kz — Kazakhstan
la — Laos             lb — Lebanon           lk — Sri Lanka
mn — Mongolia         mm — Myanmar           mv — Maldives
my — Malaysia         np — Nepal             om — Oman
ph — Philippines      pk — Pakistan          ps — Palestine
qa — Qatar            sa — Saudi Arabia      sg — Singapore
sy — Syria            tj — Tajikistan        th — Thailand
tl — Timor-Leste      tm — Turkmenistan      tr — Turkey
tw — Taiwan           uz — Uzbekistan        vn — Vietnam
ye — Yemen

## Americas
ag — Antigua & Barbuda  ar — Argentina       bb — Barbados
bh — Belize (BZ)        bo — Bolivia         br — Brazil
bs — Bahamas            bz — Belize          ca — Canada
cl — Chile              co — Colombia        cr — Costa Rica
cu — Cuba               dm — Dominica        do — Dominican Republic
ec — Ecuador            gd — Grenada         gt — Guatemala
gy — Guyana             hn — Honduras        ht — Haiti
jm — Jamaica            kn — Saint Kitts & Nevis  lc — Saint Lucia
mx — Mexico             ni — Nicaragua       pa — Panama
pe — Peru               py — Paraguay        sr — Suriname
sv — El Salvador        tt — Trinidad & Tobago    us — United States
uy — Uruguay            vc — Saint Vincent   ve — Venezuela

## Africa
ao — Angola           bf — Burkina Faso      bi — Burundi
bj — Benin            bw — Botswana          cd — DR Congo
cf — Central African Rep  cg — Congo         ci — Côte d'Ivoire
cm — Cameroon         cv — Cape Verde        dj — Djibouti
dz — Algeria          eg — Egypt             er — Eritrea
et — Ethiopia         ga — Gabon             gh — Ghana
gm — Gambia           gn — Guinea            gq — Equatorial Guinea
gw — Guinea-Bissau    ke — Kenya             km — Comoros
lr — Liberia          ls — Lesotho           ly — Libya
ma — Morocco          mg — Madagascar        ml — Mali
mr — Mauritania       mu — Mauritius         mw — Malawi
mz — Mozambique       na — Namibia           ne — Niger
ng — Nigeria          rw — Rwanda            sc — Seychelles
sd — Sudan            sl — Sierra Leone      sn — Senegal
so — Somalia          ss — South Sudan       st — São Tomé & Príncipe
sz — Eswatini         td — Chad              tg — Togo
tn — Tunisia          tz — Tanzania          ug — Uganda
za — South Africa     zm — Zambia            zw — Zimbabwe

## Oceania
au — Australia        fj — Fiji              fm — Micronesia
ki — Kiribati         mh — Marshall Islands  nr — Nauru
nz — New Zealand      pg — Papua New Guinea  pw — Palau
sb — Solomon Islands  to — Tonga             tv — Tuvalu
vu — Vanuatu          ws — Samoa

Total: 195 countries supported.`,
                    }],
            };
        case "novada://guide":
            return {
                contents: [{
                        uri,
                        mimeType: "text/plain",
                        text: `# novada Agent Tool Selection Guide

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

You need to route your own HTTP requests through a specific IP type?
  → novada_proxy_residential — real home IP, strongest anti-bot bypass
  → novada_proxy_isp — ISP-assigned IP, looks like a home user
  → novada_proxy_static — static residential, same IP every time
  → novada_proxy_datacenter — fastest, best for non-anti-bot targets
  → novada_proxy_mobile — 4G/5G mobile IP
  → novada_proxy_dedicated — exclusive datacenter IP, not shared

You need to submit an async scraping job for a non-standard platform?
  → novada_scraper_submit → novada_scraper_status → novada_scraper_result

Which tools are available on your API key?
  → novada_discover (or novada_health for product activation status)

You need to fact-check whether a claim is true or false?
  → novada_verify

You have a URL blocked by anti-bot protection and need JS-rendered content directly?
  → novada_extract with render="render" (Web Unblocker; add format="html" if you need raw HTML)

You need to interact with a page (click buttons, fill forms, navigate, screenshot)?
  → novada_browser
  → Use aria_snapshot action to get the page's semantic structure (roles + names) — more stable than CSS selectors and 70% smaller than raw HTML snapshot

Which Novada products are active on your API key?
  → novada_health (instant status table — use for first-time setup or debugging)

## Tool Comparison

| Tool                      | Use when you have…                   | Output                  | Token cost |
|---------------------------|--------------------------------------|-------------------------|------------|
| novada_search             | a question, no URL                   | URL list + snippets     | Low        |
| novada_extract            | a URL (or list of URLs)              | Full page content       | Medium-High|
| novada_map                | a domain, need URL list              | URL list only           | Low        |
| novada_crawl              | a domain, need N pages               | Content of N pages      | High       |
| novada_research           | a complex question                   | Cited report            | Medium     |
| novada_scrape             | a supported platform (16 platforms)  | Structured records      | Medium     |
| novada_scraper_submit     | async scraping job submission        | task_id                 | Minimal    |
| novada_scraper_status     | task_id, need to check progress      | Status JSON             | Minimal    |
| novada_scraper_result     | completed task_id, need results      | Formatted records       | Low        |
| novada_proxy_residential  | real home IP needed                  | Proxy config string     | Minimal    |
| novada_proxy_isp          | ISP IP for social/ecommerce          | Proxy config string     | Minimal    |
| novada_proxy_static       | sticky residential IP                | Proxy config string     | Minimal    |
| novada_proxy_datacenter   | fastest proxy, no anti-bot needed    | Proxy config string     | Minimal    |
| novada_proxy_mobile       | 4G/5G mobile IP                      | Proxy config string     | Minimal    |
| novada_proxy_dedicated    | exclusive IP, clean reputation       | Proxy config string     | Minimal    |
| novada_verify             | a factual claim to check             | Verdict + evidence URLs | Medium     |
| novada_extract render=render | a URL blocked by anti-bot         | JS-rendered content     | Medium-High|
| novada_browser            | interactive page actions             | Action result           | High       |
| novada_health             | check which products are active      | Status table + links    | Minimal    |
| novada_discover           | need full tool catalog               | Tool catalog JSON       | Low        |

## Efficient Workflow Patterns

### RAG Pipeline
novada_search → novada_extract([top 5 urls]) → feed to vector store

### Competitive Analysis
novada_map competitor.com → novada_crawl with select_paths=['/pricing','/features'] → synthesize

### Current Events
novada_search with time_range='week' → novada_extract on top results

### Documentation Ingestion
novada_map docs.example.com → novada_crawl with select_paths=['/docs/api/**']

### Research Report
novada_research with depth='deep' → novada_extract on 2–3 most relevant sources

### E-commerce Data
novada_scrape with platform='amazon.com', operation='amazon_product_keywords'

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
→ Still empty: retry novada_extract with render="render" and format="html" for raw HTML/DOM

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
                        text: buildScraperPlatformsText(),
                    }],
            };
        case "novada://llms-txt":
            return {
                contents: [{
                        uri,
                        mimeType: "text/plain",
                        text: `# Novada MCP — Quick Reference (LLM-optimized)
> 23 tools. Read this to pick the right one.

## novada_search
Best for: web search when you have a question, not a URL. Returns titles+URLs+snippets from 4 engines (Google, Bing, DuckDuckGo, Yandex).
Not for: reading a URL you have (use novada_extract), or full reports (use novada_research).
Required: query. Optional: engine (default google), num (default 10), time_range.
Example: novada_search({query: "Claude MCP tutorial 2025", engine: "google", num: 5})

## novada_extract
Best for: reading content from a URL you already have. Supports batch (up to 10 URLs).
Not for: discovering URLs (use novada_map), crawling many pages (use novada_crawl).
Required: url. Optional: render (auto/static/render/browser), fields, max_chars.
Example: novada_extract({url: "https://docs.example.com/api", render: "auto"})

## novada_crawl
Best for: multi-page content from a site (e.g. all /docs/* pages). BFS or DFS up to 20 pages.
Not for: single page (use novada_extract), URL discovery only (use novada_map).
Required: url. Optional: max_pages (default 5), strategy (bfs/dfs), select_paths.
Example: novada_crawl({url: "https://docs.example.com", max_pages: 10, select_paths: ["/docs/**"]})

## novada_map
Best for: discovering all URLs on a site before deciding what to read. Fast — tries sitemap first.
Not for: reading content (follow with novada_extract or novada_crawl).
Required: url. Optional: limit (default 50), max_depth.
Example: novada_map({url: "https://example.com", limit: 100})

## novada_research
Best for: complex questions needing 3-10 sources. Auto-generates sub-queries, deduplicates, synthesizes.
Not for: simple single-fact lookup (use novada_search), reading a specific URL (use novada_extract).
Required: question. Optional: depth (quick/deep/comprehensive/auto), focus.
Example: novada_research({question: "How do MCP servers work with Claude?", depth: "deep"})

## novada_scrape
Best for: structured data from 16 active platforms (~88 operations) (Amazon, TikTok, LinkedIn, YouTube, ChatGPT, SHEIN, etc.).
Not for: arbitrary sites not in the platform list (use novada_extract or novada_crawl).
Required: platform, operation, params. Optional: format (markdown/json/toon), limit.
Example: novada_scrape({platform: "amazon.com", operation: "amazon_product_keywords", params: {keyword: "iphone 16"}})
Tip: Read novada://scraper-platforms to find valid platform+operation combinations.

## novada_proxy
Best for: getting proxy credentials (residential/mobile/ISP/datacenter) for your own HTTP requests.
Not for: web page extraction (use novada_extract — proxy is automatic there).
Required: none. Optional: type, country, city, session_id, format (url/env/curl).
Example: novada_proxy({type: "residential", country: "us", format: "curl"})

## novada_verify
Best for: fact-checking a claim against web sources. Returns supported/unsupported/contested/insufficient_data.
Not for: open questions (use novada_research).
Required: claim (min 10 chars). Optional: context.
Example: novada_verify({claim: "OpenAI released GPT-5 in 2025", context: "AI industry"})

## novada_extract (raw HTML / bot-protected)
Best for: raw HTML from a bot-protected or JS-heavy page when you need the DOM, not cleaned text — use render="render" (Web Unblocker) with format="html".
Not for: cleaned text extraction (use novada_extract with render="render", default format).
Required: url. Optional: render (auto/static/render/browser), format (markdown/html), country, wait_for, timeout.
Example: novada_extract({url: "https://example.com/protected", render: "render", format: "html"})

## novada_browser
Best for: interactive flows — login, click, fill forms, screenshot, scrape behind user actions.
Not for: simple page reading (use novada_extract).
Required: actions (array, max 20). Optional: country, timeout, session_id.
Example: novada_browser({actions: [{action: "navigate", url: "https://example.com"}, {action: "screenshot"}]})

## novada_health
Best for: diagnosing why a tool fails. Shows which Novada products are active on your API key.
Required: none.
Example: novada_health({})

## novada_discover
Best for: getting the full tool catalog with descriptions, categories, and availability status.
Not for: checking product activation (use novada_health).
Required: none.
Example: novada_discover({})

## novada_scraper_submit
Best for: submitting an async scraping job for platforms outside novada_scrape's 16 active platforms.
Not for: synchronous extraction (use novada_scrape for supported platforms).
Required: platform, operation. Optional: params, country.
Example: novada_scraper_submit({ platform: "amazon.com", operation: "amazon_product_keywords", params: { keyword: "wireless earbuds" } })

## novada_scraper_status
Best for: polling status of an async scraping task submitted via novada_scraper_submit.
Required: task_id.
Example: novada_scraper_status({task_id: "abc123"})

## novada_scraper_result
Best for: retrieving completed results from an async scraping task.
Not for: incomplete tasks — always check novada_scraper_status first.
Required: task_id. Optional: format (markdown/json/raw).
Example: novada_scraper_result({task_id: "abc123", format: "json"})

## novada_proxy_residential
Best for: geo-targeted scraping through real home IPs. Strongest anti-bot bypass.
Not for: page content extraction (use novada_extract — proxy is automatic there).
Required: none. Optional: country, city, session_id, format (url/env/curl).
Example: novada_proxy_residential({country: "us", format: "curl"})

## novada_proxy_isp
Best for: social media and ecommerce — IPs look like real home users from an ISP.
Required: none. Optional: country, session_id, format.
Example: novada_proxy_isp({country: "gb", format: "env"})

## novada_proxy_static
Best for: workflows needing the same residential IP across multiple requests.
Required: none. Optional: country, session_id, format.
Example: novada_proxy_static({country: "de", session_id: "sess42"})

## novada_proxy_datacenter
Best for: high-volume scraping of non-anti-bot targets. Fastest proxy type.
Required: none. Optional: country, session_id, format.
Example: novada_proxy_datacenter({country: "us"})

## novada_proxy_mobile
Best for: mobile-targeted content and 4G/5G IP reputation. Pair with mobile User-Agent.
Required: none. Optional: country, session_id, format.
Example: novada_proxy_mobile({country: "jp"})

## novada_proxy_dedicated
Best for: high-trust platforms requiring a clean, exclusive IP (not shared with other users).
Required: session_id (dedicated IP is tied to session). Optional: country, format.
Example: novada_proxy_dedicated({session_id: "dedicated-01", country: "us"})

## Quick Decision Tree
URL you have → novada_extract
No URL, need search → novada_search
Many pages → novada_crawl
Find URLs → novada_map
Platform data (Amazon/TikTok etc.) → novada_scrape
Async scraping job → novada_scraper_submit → novada_scraper_status → novada_scraper_result
Complex question → novada_research
Fact check → novada_verify
Raw HTML/DOM → novada_extract with render="render" and format="html"
Click/interact → novada_browser
Residential proxy → novada_proxy_residential
ISP/static/datacenter/mobile/dedicated proxy → novada_proxy_{type}
Diagnose failure → novada_health
Full tool catalog → novada_discover`,
                    }],
            };
        case "novada://privacy":
            return {
                contents: [{
                        uri,
                        mimeType: "text/plain",
                        text: `# Novada MCP — Privacy & Telemetry Disclosure

This document describes exactly what the HOSTED Novada MCP gateway
(mcp.novada.com) logs about your usage. The local npm server
(\`npx novada-mcp\`) sends no usage telemetry to Novada — this disclosure
applies to the hosted gateway only.

## What the hosted gateway logs (mcp_events)

One event per tool call and one per session initialize, with these fields ONLY:

- ts               — server timestamp of the event
- event_type       — "tool_call" or "initialize"
- request_id       — random UUID per HTTP request (correlation only)
- token_hash       — SHA-256 hash of your API key (never the key itself)
- plan             — "free" or "pro" (billing classification)
- client_name      — MCP client name from the initialize handshake (e.g. "claude-code")
- client_version   — MCP client version from the initialize handshake
- protocol_version — MCP protocol version (currently always null; not exposed per-call)
- tool             — name of the tool called (e.g. "novada_extract")
- arg_keys         — parameter NAMES only (e.g. ["url","format"]) — never values
- target_domain    — for URL-taking tools only: the HOSTNAME of the target URL
                     (lowercase, leading "www." stripped). Never the path, query
                     string, port, credentials, or fragment. Null for tools that
                     take no URL (novada_search queries are not collected at all).
- outcome          — "ok", an error code, or "cap_blocked"
- latency_ms       — how long the call took server-side
- charged          — whether one free-quota unit was consumed
- over_cap_allowed — whether the call passed via the paid exemption
- quota_remaining  — free-quota counter after this call
- server_version   — the gateway build that served the call
- region           — the serving datacenter region (e.g. "iad1")

## What is NEVER logged

- Search queries (novada_search query text is not collected)
- Full URLs — no paths, query strings, ports, credentials, or fragments
- Fetched page content, scrape results, or any tool response body
- Parameter VALUES of any kind — only parameter names
- Your API key in plaintext (only its SHA-256 hash)

## Retention

Aggregates are retained; raw events are reviewed for retention policy — see
the privacy page at https://novada.com for the current policy.

## Why this is collected

Service improvement (which tools and parameters are actually used, latency,
failure modes) and abuse prevention (cap enforcement, anomalous usage patterns).

## Contact

support@novada.com`,
                    }],
            };
        default:
            throw new Error(`Unknown resource URI: ${uri}. Available: ${RESOURCES.map(r => r.uri).join(", ")}`);
    }
}
//# sourceMappingURL=index.js.map