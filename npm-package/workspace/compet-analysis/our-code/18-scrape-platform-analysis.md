# novada_scrape Platform Coverage Analysis

> Analyzed: 2026-06-23
> Sources: src/tools/scrape.ts, src/resources/index.ts, src/tools/types.ts, docs/novada-api/scraper-operation-ids.md

---

## 1. Platform and Operation Count

The resource text and discover.ts both claim "129 platforms." This is **misleading**. Per the docs and the `novada://scraper-platforms` resource content itself:

- **Active platforms: 13** (scene_total > 0, verified 2026-05-18 dashboard extract)
- **Operations total (active): ~70** across those 13 platforms
- **Registered but unavailable: ~116 other platforms** (0 scenes — reddit.com, glassdoor.com, zillow.com, airbnb.com, etc.)

The "129" figure refers to how many platform entries exist in the backend registry, not how many are usable. Using it in marketing/docs copy ("Discover all 129 supported platforms") is a false claim that misleads agents and users. Agents that read the resource discover this contradiction immediately (the resource itself says "Only these 13 platforms have active operations").

### Active platforms and operation counts

| Platform | Category | Operations |
|----------|----------|-----------|
| amazon.com | E-Commerce | 13 |
| walmart.com | E-Commerce | 5 |
| google.com | Search | 11 |
| bing.com | Search | 6 |
| duckduckgo.com | Search | 1 |
| yandex.com | Search | 1 |
| youtube.com | Social Media | 13 |
| instagram.com | Social Media | 7 |
| facebook.com | Social Media | 6 |
| tiktok.com | Social Media | 5 |
| x.com / twitter | Social Media | 3 |
| linkedin.com | Professional/B2B | 4 |
| github.com | Developer | 3 |
| **Total** | | **~78 operations** |

---

## 2. Operation ID Format and Naming Consistency

### Format

`{platform_prefix}_{resource_type}_{lookup_method}`

Examples:
- `amazon_product_asin`
- `amazon_product_keywords`
- `linkedin_job_listings_information_job-listing-url`
- `twitter_profile_username`

### Inconsistencies found

1. **Search engines use flat params (Format A), all others use `scraper_params` JSON array (Format B).** This dual-format is documented internally but invisible to API consumers. The MCP handles it automatically, which is good.

2. **Naming is not uniformly hierarchical.** Compare:
   - `ins_profiles_username` (prefix = `ins`, not `instagram`)
   - `twitter_profile_username` (prefix = `twitter`, not `x`)
   - `duckduckgo` (flat, no category segment)
   - `yandex` (flat, no category segment)
   - `linkedin_job_listings_information_job-listing-url` (overly long, 5 segments)

3. **Hyphen vs underscore inconsistency.** Most use underscores, but: `amazon_product_category-url`, `amazon_product_best-sellers`, `amazon_product-list_keywords-domain`, `github_repository_repo-url`, `linkedin_job_listings_information_job-listing-url`. The schema regex `^[a-zA-Z0-9_\-]+$` permits hyphens, which is correct. But it's inconsistent across platforms.

4. **Historical aliases maintained in code** (`OPERATION_ALIASES` map in scrape.ts):
   - `amazon_product_by-keywords` → `amazon_product_keywords`
   - `amazon_product_by-asin` → `amazon_product_asin`
   - `google_shopping` → `google_shopping_keywords`
   - `google_shopping_by-keyword` → `google_shopping_keywords`

   These aliases indicate prior naming inconsistencies that were corrected but not removed from the backend. The alias map is a necessary shim; it should be expanded when new IDs are renamed.

---

## 3. Agent Discovery via `novada://scraper-platforms`

### How it works

The resource is a static hardcoded text block in `src/resources/index.ts`. Agents can read it before calling `novada_scrape` to get the canonical list. This eliminates guessing and the 11006 error loop.

### Discovery flow in practice

1. Agent reads `novada://scraper-platforms`
2. Finds exact `platform` + `operation` + `params` spec
3. Calls `novada_scrape({ platform, operation, params })`
4. MCP wraps params in `scraper_params=[{...}]` (or flat fields for search engines)
5. Submits to `POST scraper.novada.com/request` with `scraper_name` + `scraper_id`
6. Polls `scraper_download?task_id=...` every 2s, timeout 180s
7. Returns formatted records

### Discovery gap: resource is stale

The resource header says "Verified from dashboard 2026-05-18." The last commit date shows 3+ unpushed commits as of 2026-06-15. If new scenes are activated on the backend (e.g., reddit.com gets scene_total > 0), the resource won't reflect it until someone manually updates `src/resources/index.ts`. There is no sync mechanism.

### Contradiction: "129 platforms" vs "13 active"

Both the MCP tool description and the `novada://guide` resource say "129 platforms." The `novada://scraper-platforms` resource correctly says "Only these 13 platforms have active operations." This contradiction will confuse agents and users. The marketing count (129) should be removed from agent-facing text.

---

## 4. JSON Schema Extraction Capability (jsonOptions)

**novada_scrape has no `jsonOptions` parameter.** The schema in `types.ts` (`ScrapeParamsSchema`) only exposes:

```typescript
{
  platform: string,
  operation: string,
  params: Record<string, unknown>,
  limit: number,
  format: "markdown" | "json" | "toon"
}
```

The structured data returned by `novada_scrape` is **pre-defined by the platform operation** on the backend. The agent cannot define a custom extraction schema. This is fundamentally different from Firecrawl's `/extract` endpoint.

The `format: "json"` option returns the raw records from the platform scraper as JSON — it does not perform LLM-based field extraction. There is no `jsonOptions.prompt` or `jsonOptions.schema` equivalent.

---

## 5. Error Handling

The error handling is well-structured with typed errors:

| Error | Source | Handler |
|-------|--------|---------|
| HTTP 401/403 | AxiosError | "Invalid API key or insufficient permissions" |
| Code 11006 | Submit API | `NovadaError(PRODUCT_UNAVAILABLE)` + alias hint + `agent_instruction` |
| Code 11008 | Submit API | `NovadaError(INVALID_PARAMS)` + domain format hint |
| Code 10001 | Submit | "Missing required parameters" |
| Code 11000 | Submit | "Invalid API key" |
| Download code 10001 | Poll | "Invalid file type" |
| Download code 10002/10003 | Poll | Task failed, retry |
| Download code 27203 | Poll | Transient server error, retry once |
| Poll timeout (180s) | Poll | `NovadaError(TASK_PENDING)` |
| Empty result | Processing | "No records returned" (not an error, graceful) |

Key strengths:
- 11006 errors include alias hint if the agent used a near-miss operation ID
- `agent_instruction` field tells agents to read `novada://scraper-platforms` before retrying
- Prototype-pollution blocked via null-prototype `OPERATION_ALIASES` object + BLOCKED_KEYS set
- API key value stripped from error URLs (`apikey=***`)
- `TASK_PENDING` uses typed error so `classifyError` doesn't misclassify as `URL_UNREACHABLE`

Weakness: The 180s poll timeout is long. Amazon can take 120-180s (noted in comments), but most platforms are faster. There is no platform-specific timeout configuration — everything waits up to 3 minutes.

---

## 6. Missing Operations — Gap Analysis

### High-value platforms with 0 active scenes

| Platform | Use Case | Competitor coverage |
|----------|----------|---------------------|
| reddit.com | Community sentiment, AMAs, keyword posts | Bright Data has Reddit scraper |
| glassdoor.com | Company reviews, salary data | Bright Data has Glassdoor scraper |
| zillow.com | Real estate listings | Bright Data has Zillow scraper |
| indeed.com | Job listings (consumer-facing) | Bright Data has Indeed scraper |
| airbnb.com | Rental listings | Bright Data has Airbnb scraper |
| booking.com | Hotel data | Bright Data has Booking.com scraper |
| etsy.com | Marketplace listings | Bright Data has Etsy scraper |
| ebay.com | Auction/marketplace | Bright Data has eBay scraper |
| tripadvisor.com | Reviews, travel | Bright Data has TripAdvisor scraper |

### Missing operations on active platforms

| Platform | Missing operation |
|----------|------------------|
| linkedin.com | Profile scraping (person pages, not just company) |
| linkedin.com | Post/feed scraping |
| google.com | Google News SERP |
| google.com | Google Images SERP |
| amazon.com | Amazon Q&A / answered questions |
| youtube.com | Channel subscribers / analytics |
| github.com | Issues, pull requests, commits |
| github.com | User profile |

### Missing platform categories

- **E-commerce (non-US)**: Shopee, Lazada, Tokopedia, AliExpress — 0 scenes. Critical for SEA markets.
- **Reviews**: Yelp, G2, Trustpilot, Capterra — 0 scenes.
- **Real estate**: Zillow, Redfin, Rightmove — 0 scenes.
- **Job boards**: Indeed, ZipRecruiter, Glassdoor — 0 scenes.
- **News**: Reuters, Bloomberg, BBC, Hacker News — 0 scenes.
- **B2B data**: Crunchbase, AngelList, PitchBook — 0 scenes.

---

## 7. Comparison to Firecrawl's Structured Extraction

### Firecrawl `/extract` (v2) — LLM-based

| Feature | Firecrawl extract | novada_scrape |
|---------|-------------------|---------------|
| Platform support | **Any URL** (no platform list) | 13 active platforms only |
| Schema definition | User-defined JSON Schema (Zod/Pydantic) | Backend-fixed per operation |
| Extraction method | LLM inference (FIRE-1 agent model) | Pre-built HTML parsers |
| Multi-URL / wildcard | `urls: ["site.com/*"]` — crawl + extract | Single operation, `limit` param |
| Web search enrichment | `enableWebSearch: true` | Not available |
| Async support | Start job, poll status | Built-in poll loop (180s max) |
| Output | Any schema the user defines | Fixed record structure per scraper |
| Accuracy on structured pages | Medium (LLM can hallucinate) | High (deterministic parser) |
| Accuracy on unstructured pages | High (LLM handles layout variation) | N/A — not applicable |
| Cost model | Per-token LLM cost + scrape | Per-request |
| Limitation | Known beta limitations: can miss data, inconsistent across runs | Dependent on backend parser quality |

### Key differentiator: deterministic vs LLM

Firecrawl's LLM extraction works on **any website** but output quality varies — the model can hallucinate fields or miss data on complex layouts. Novada's platform scrapers are **deterministic parsers** that reliably extract exactly what the backend is programmed to return, but only for 13 platforms.

Novada's `novada_extract` with `fields` parameter (in `ExtractParamsSchema`) is the closest analog to Firecrawl's extraction: it does pattern matching + JSON-LD extraction for specified fields. But it has no LLM inference step — it only matches known patterns.

### Novada's structural gap

Novada has no LLM-based extraction layer. To compete with Firecrawl's `/extract`, a `jsonOptions` parameter on `novada_extract` (with a `prompt` and/or `schema`) would be needed. This would require backend support for LLM post-processing of extracted content.

---

## 8. Summary of Gaps

### P0 — Agent-facing correctness issues

1. **"129 platforms" is false in agent context.** The MCP description, `novada://guide`, `discover.ts`, and `health.ts` all state "129 platforms." The actual usable count is 13. This creates a trust gap when agents discover the real list. All "129" references in agent-facing text should say "13 active platforms (129 registered)" or similar.

2. **`novada://scraper-platforms` has no auto-sync.** It is a static hardcoded string that will drift from the backend. A mechanism to detect when scenes become active (even a quarterly manual audit process) is needed.

### P1 — Platform gaps vs competitors

3. **Reddit (0 scenes)** — Bright Data has it. High demand for sentiment analysis, AMAs, research.
4. **Glassdoor (0 scenes)** — Company review data is a standard B2B use case.
5. **LinkedIn profiles (person pages)** — Only company pages are supported. Person profiles are missing.
6. **Google News SERP** — `google_serp_web` exists, but no dedicated news scene.
7. **Yelp/TripAdvisor (0 scenes)** — Review data is a standard market research use case.

### P2 — Structural missing features

8. **No LLM-based extraction** — Firecrawl's `/extract` with JSON schema works on any URL. Novada has no equivalent. The `fields` param on `novada_extract` does pattern matching only.

9. **No platform-specific poll timeouts** — All platforms wait up to 180s. Fast platforms (TikTok profile) shouldn't be blocked behind Amazon's 120-180s timeout profile.

10. **No `jsonOptions` on `novada_scrape`** — Users cannot request a custom output structure. All records are returned in the platform scraper's native schema.

### P3 — Naming debt

11. **`ins_` prefix for Instagram** (not `instagram_`) is inconsistent with all other platforms.
12. **`twitter_` prefix for X.com** (platform was renamed X but prefix remains `twitter_`).
13. **Long operation IDs** like `linkedin_job_listings_information_job-listing-url` are hard to type and error-prone.
