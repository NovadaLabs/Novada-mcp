# Novada

Web search, page extraction and structured platform data for your Antigravity agent, backed by Novada's own proxy network.

**Free to start:** new Novada accounts get $10 in free credits, no credit card needed. There is no monthly call cap; usage is billed to your Novada account.

## What it is good at

- **Structured data from 14 platforms, no HTML parsing.** One typed tool per platform: Amazon, Google, Bing, DuckDuckGo, Yandex, YouTube, Instagram, Facebook, TikTok, X, Walmart, LinkedIn, GitHub and Perplexity. Each tool takes a closed list of operations, so a wrong value is rejected before any call.
- **Pages that block bots.** `novada_extract` moves from a plain fetch to JS rendering to a real browser on its own, reads up to 10 URLs per call, and names the blocker when it cannot get through.
- **Cited research in one call.** `novada_research` runs several searches, removes duplicates, and returns numbered source passages for the agent to write its answer from.

## Setup

1. Install the plugin from the Marketplace, or from your shell:

   ```bash
   agy plugin install novada
   ```

   You can also install it straight from GitHub:

   ```bash
   agy plugin install https://github.com/NovadaLabs/novada-mcp/tree/main/distribution/plugins/antigravity
   ```

2. The first time the agent calls a Novada tool, Antigravity opens your browser to sign in with your Novada account (OAuth). No API key needs to be pasted anywhere.
3. Don't have an account yet? Sign up at [novada.com](https://www.novada.com) to get your free credits. Ask the agent to run `novada_setup` at any time to check your balance.

## Tools

The plugin connects to Novada's hosted endpoint, `https://mcp.novada.com/mcp`.

| Tool | Use it when |
|------|-------------|
| `novada_search` | Find pages by query (Google, DuckDuckGo or Yandex, with time, domain and country filters). |
| `novada_extract` | Read one known URL, or up to 10 in parallel, including pages behind anti-bot protection. |
| `novada_research` | Answer a complex question with passages from several sources in one call. |
| `novada_scrape` and 14 platform tools such as `novada_scrape_amazon` and `novada_scrape_linkedin` | Get structured records (products, reviews, jobs, profiles, posts, search results) from a specific platform. |
| `novada_crawl` | Pull content from a bounded set of related pages (up to 20) on one site. |
| `novada_map` | Discover which URLs exist on a site before fetching them. |
| `novada_monitor` | Detect changes on a page, such as a price or stock status. |
| `novada_ai_monitor` | Check how a brand is mentioned on public pages of AI-company websites. |
| `novada_proxy` | Get proxy settings to route your own HTTP client through a chosen IP type, country or session. |
| `novada_account`, `novada_proxy_account_list`, `novada_proxy_account_create`, `novada_static_ip_mgmt` | Check balance and usage, and manage proxy sub-accounts and static IPs. |
| `novada_discover`, `novada_setup` | Find the right tool for a task, or check that your account works. |

Actions that change your account, such as creating a proxy sub-account, use a two-step approval token, so the agent shows you a preview before anything is changed.

## Try these prompts

| Use case | Ask your agent |
|---|---|
| Price research | "Compare the top 5 Amazon results for 'standing desk' by price and rating, then check the cheapest one on Walmart." |
| Lead research | "List Data Analyst jobs on LinkedIn in Germany posted this week, with company and link." |
| Cited answer | "What changed in the EU battery regulation this year? Give me sources I can quote." |

## Pricing

Each tool call is billed to your own Novada account at Novada's standard rates. See current pricing at [novada.com](https://www.novada.com).

## Support

- Email: [support@novada.com](mailto:support@novada.com)
- Issues: [github.com/NovadaLabs/novada-mcp/issues](https://github.com/NovadaLabs/novada-mcp/issues)
- Source: [github.com/NovadaLabs/novada-mcp](https://github.com/NovadaLabs/novada-mcp) (MIT license)
