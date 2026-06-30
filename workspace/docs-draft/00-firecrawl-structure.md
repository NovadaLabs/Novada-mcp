# Firecrawl Documentation Structure Reference

> Extracted 2026-06-24 from docs.firecrawl.dev. Five key pages analyzed plus full sitemap from llms.txt.

---

## 1. Introduction (`/introduction`)

### Heading Structure

| Level | Heading | Content Type |
|-------|---------|--------------|
| H1 | Introduction | Marketing prose -- what Firecrawl is |
| H2 | Get started | Two CTA cards (API key signup, playground) + `pip install` bash command |
| H2 | Use Firecrawl with AI agents (recommended) | One-liner install command + link to MCP Server. Positioned as PRIMARY path |
| H2 | What can Firecrawl do? | Three capability cards with prose (Search, Scrape, Interact) |
| H2 | Why Firecrawl? | Bulleted value-prop list |
| H2 | Search | Code examples in 4 languages (Python, Node.js, cURL, CLI) + collapsible JSON response |
| H2 | Scrape | Code examples in 4 languages + collapsible JSON response with metadata |
| H2 | Interact | Code examples in 4 languages + collapsible JSON response with session details |
| H2 | More capabilities | Six feature cards linking deeper |
| H2 | Resources | Four cards: API Reference, SDKs, Open Source, Integrations |

### Patterns & Agent-Friendliness
- **Language tabs**: Every code section has Python / Node.js / cURL / CLI tabs
- **Collapsible responses**: JSON output hidden in accordions to keep page scannable
- **CTA-first**: Sign-up and playground links appear before any code
- **Agent onboarding is the recommended path** -- called out explicitly above SDK install
- **llms.txt reference**: "For AI agents: Use llms.txt for a full index of all documentation"

---

## 2. Skills + CLI (`/sdks/cli`)

### Heading Structure

| Level | Heading | Content Type |
|-------|---------|--------------|
| H1 | Skills + CLI | Intro prose + npm install command |
| H2 | Installation | `npm install -g firecrawl` with flags explained; note about agent discovery |
| H2 | Authentication | Prose about keyless free tier |
| H3 | Login | Multiple bash variants: interactive, API key, env var |
| H3 | View Configuration | Single bash command + sample output |
| H3 | Logout | Single bash command |
| H3 | Self-Hosted / Local Development | Custom API URL + env var config |
| H3 | Check Status | Bash command + sample output with bullet explanations |
| H2 | Commands | Parent section for all CLI commands |
| H3 | Scrape | Multiple code examples + tip box + **options table (20+ params)** |
| H3 | Search | Code examples + options table (filtering, location) |
| H3 | Map | Code examples + options table (sitemap, filtering) |
| H3 | Interact | Sequential code examples + options table |
| H3 | Crawl | Code examples + status checking + **options table (20+ params)** |
| H3 | Monitor | Command examples + goal-setting guidance + options table |
| H3 | Agent | Code examples + schema-based output + options table |
| H3 | Credit Usage | Simple bash command |
| H3 | Version | Single bash command |
| H2 | Global Options | Cross-command params reference table |
| H2 | Output Handling | Piping/redirection examples + format behavior |
| H2 | Examples | Categorized bash snippets: Quick Scrape, Full Site Crawl, Site Discovery, Research Workflow, Agent, tool chaining with jq |
| H2 | Telemetry | Data collection details + disable method |
| H2 | Open Source | GitHub links for CLI and skills repos |

### Patterns & Agent-Friendliness
- **Every command has a full options table**: param name, type, default, description
- **Examples section at the bottom**: real-world copy-paste workflows, not just API references
- **jq chaining shown**: teaches composition (`firecrawl search "..." | jq '.results[0].url'`)
- **Keyless free tier**: agents can start without any auth setup
- **"Restart agents after setup"** note: explicitly addresses agent tooling lifecycle
- **Output handling section**: documents stdout/stderr behavior for piping -- critical for CLI-as-tool

---

## 3. Build with AI / AI Onboarding (`/ai-onboarding`)

### Heading Structure

| Level | Heading | Content Type |
|-------|---------|--------------|
| H1 | Build with AI | Intro prose on AI agent capabilities |
| H2 | Get credentials | Two card options + keyless fallback explanation |
| H2 | Skills + CLI | Bash install command + prose |
| H3 | What the install gives you | **Three tables**: CLI skills, Build skills, Workflow skills |
| H3 | Choose your path | **4-step process** (Steps component): each step has prose + bash/curl examples |
| H2 | Using Firecrawl as a Tool | Intro + **5 accordion sections** (Search, Scrape, Crawl, Map, Interact) each with CLI + REST examples |
| H3 | How agents chain tools together | Numbered workflow list |
| H2 | Agentic Debugging | `/support/ask` endpoint + curl example + reference card |
| H2 | Firecrawl MCP Server | Bash + JSON config examples + reference card |
| H2 | Firecrawl Docs for Agents | 4-step process with example URLs (llms.txt, llms-full.txt) |
| H2 | Quick Start Guides | Intro + **12 platform quickstart cards** (Cursor, Claude Code, Windsurf, etc.) |
| H2 | Agent Harnesses | Intro + **11 framework cards** (LangChain, OpenAI, Anthropic, etc.) |
| H2 | SDKs | Short prose + **9 SDK cards** + LLM integration links |

### Patterns & Agent-Friendliness
- **This is THE agent landing page** -- everything routes through here
- **Skills taxonomy via tables**: categorizes CLI skills vs Build skills vs Workflow skills
- **Accordion-based tool reference**: keeps page compact; each tool section is self-contained
- **"Choose your path" Steps component**: guided onboarding with branching
- **Agentic Debugging**: dedicated section for agent self-help (`/support/ask`)
- **Docs for Agents section**: explicitly teaches agents how to consume docs (llms.txt, llms-full.txt)
- **Card grid pattern**: quickstarts and harnesses presented as visual grids for scanability

---

## 4. MCP Server (`/mcp-server`)

### Heading Structure

| Level | Heading | Content Type |
|-------|---------|--------------|
| H1 | Firecrawl MCP Server | Feature overview + install options |
| H2 | Features | Bulleted capability list (search, scrape, parse, interact, monitor, etc.) |
| H2 | Installation | Three sub-methods: Remote hosted URL, npx, Manual npm install |
| H2 | Running on Cursor | Step-by-step + JSON config blocks (version-specific) |
| H2 | Running on Windsurf | JSON config example |
| H2 | Running with Streamable HTTP Mode | Env var setup + usage |
| H2 | Installing via Smithery (Legacy) | CLI command |
| H2 | Running on VS Code | Install buttons + manual JSON config (user + workspace) |
| H2 | Running on Claude Desktop | JSON config (HTTP + local npx approaches) |
| H2 | Running on Claude Code | CLI command examples |
| H2 | Running on Google Antigravity | GIF demo + step-by-step + JSON config |
| H2 | Running on n8n | Numbered setup instructions |
| H2 | Configuration | Env vars, examples, system settings |
| H2 | Rate Limiting and Batch Processing | Bulleted feature overview |
| H2 | Available Tools | **15 numbered tool subsections**, each with JSON examples + descriptions |
| H2 | Logging System | Log message snippets |
| H2 | Error Handling | JSON error response example |
| H2 | Development | Bash commands + contribution guidelines |
| H2 | License | Brief statement |

### Patterns & Agent-Friendliness
- **One H2 per IDE/platform**: Cursor, Windsurf, VS Code, Claude Desktop, Claude Code, n8n, etc.
- **Copy-paste JSON configs**: every platform section has a ready-to-paste config block
- **15 tools documented inline**: each tool has its own subsection with JSON input/output examples
- **Remote hosted URL as first install option**: zero local setup path
- **Explicit Claude Code section**: `claude mcp add firecrawl` one-liner
- **Multiple transport modes**: stdio (npx) vs Streamable HTTP -- both documented

---

## 5. Advanced Scraping Guide (`/advanced-scraping-guide`)

### Heading Structure

| Level | Heading | Content Type |
|-------|---------|--------------|
| H2 | Advanced Scraping Guide | Overview of guide scope |
| H2 | Basic scraping | Code examples in Python, Node.js, cURL |
| H2 | Scraping PDFs | Prose on PDF modes (auto, fast, ocr) + JSON config |
| H2 | Scrape options | Parent section with sub-tables |
| H3 | Formats (`formats`) | Table of output format types |
| H3 | Mobile scraping | Code examples + explanatory prose |
| H3 | Content filtering | Parameter reference table |
| H3 | Timing and cache | Parameter reference table |
| H3 | PDF parsing | Parameter reference table |
| H3 | Actions | **Comprehensive actions table** + code examples (screenshots, clicks, JS exec, PDF gen) |
| H2 | Full scrape example | Single cURL combining all options |
| H2 | JSON extraction via formats | Code examples (Python, Node.js, cURL) for structured extraction |
| H2 | Agent endpoint | Reference table + code examples for autonomous multi-page extraction |
| H2 | Check agent status | cURL polling example |
| H2 | Crawling multiple pages | cURL examples + sub-tables |
| H3 | Path filtering | Parameter reference table |
| H3 | Crawl scope | Parameter reference table |
| H3 | Sitemap and deduplication | Parameter reference table |
| H3 | Scrape options for crawl | Parameter reference table |
| H2 | Crawl example | Single cURL with multiple options |
| H2 | Mapping website links | cURL example + map options table |
| H2 | Whitelisting Firecrawl | Prose for firewall config |

### Patterns & Agent-Friendliness
- **Parameter tables everywhere**: every feature has a structured reference table
- **"Full example" sections**: composite cURL commands showing everything together
- **Progressive complexity**: basic -> PDF -> options -> actions -> agent -> crawl -> map
- **Actions are a first-class concept**: screenshots, clicks, JS execution, PDF generation
- **Agent endpoint documented alongside scraping**: shows the AI-native path

---

## 6. Features/Agent (`/features/agent`)

### Heading Structure

| Level | Heading | Content Type |
|-------|---------|--------------|
| H1 | Agent | Intro prose: "Gather data wherever it lives on the web" |
| H2 | Using `/agent` | Code examples (Python, Node, cURL) with Pydantic/Zod schemas + JSON response |
| H2 | Providing URLs (Optional) | Code samples across multiple languages |
| H2 | Job Status and Completion | Async processing explanation + polling code + status table + JSON responses |
| H2 | Share agent runs | Prose on shareable links and privacy |
| H2 | Model Selection | **Comparison table** (Spark 1 Mini vs Spark 1 Pro) + code examples |
| H2 | Parameters | **Full parameter reference table** |
| H2 | Agent vs Extract: What's Improved | **Feature comparison table** |
| H2 | Example Use Cases | Bulleted list of 4 use cases |
| H2 | CSV Upload in Agent Playground | Prose for batch processing |
| H2 | Troubleshooting with Ask | cURL example + Ask API link |
| H2 | API Reference | Link to endpoint docs |
| H2 | Pricing | Dynamic credit-based billing explanation with subsections |

---

## Cross-Cutting Documentation Patterns

### What Firecrawl Does Well (for reference)

1. **Agent-first positioning**: AI agent onboarding is the *recommended* path, not an afterthought
2. **llms.txt / llms-full.txt**: Machine-readable doc index for agent consumption
3. **Keyless free tier**: Agents can start immediately with zero auth friction
4. **One H2 per IDE/platform in MCP docs**: Each platform gets its own copy-paste config section
5. **Language tabs everywhere**: Python / Node.js / cURL / CLI for every code example
6. **Collapsible response bodies**: Keeps pages scannable while full JSON is available
7. **Parameter reference tables**: Every tool/command has a structured table with name, type, default, description
8. **"Full example" composite commands**: Shows everything combined, not just individual params
9. **Progressive disclosure**: Accordions, collapsibles, Steps components control information density
10. **Skills taxonomy**: CLI skills, Build skills, Workflow skills -- categorized, not just listed
11. **Agentic debugging**: Dedicated `/support/ask` endpoint for agents to self-diagnose
12. **15 MCP tools documented inline**: Each with JSON input/output, not just a list of names

### Content Patterns by Type

| Pattern | Where Used | Why It Works |
|---------|-----------|--------------|
| Language tabs (4 langs) | Introduction, Advanced Scraping | Serve every SDK user on one page |
| Options reference table | CLI commands, Advanced Scraping | Structured, scannable, complete |
| Accordion/collapsible | Introduction (responses), AI Onboarding (tools) | Compact page, full detail on demand |
| Steps component | AI Onboarding ("Choose your path") | Guided flow for new users |
| Card grids | Introduction, AI Onboarding (quickstarts) | Visual navigation for many options |
| Comparison tables | Agent (vs Extract, model selection) | Decision support |
| Copy-paste JSON configs | MCP Server (per-platform) | Zero-friction setup |
| Composite "full example" | Advanced Scraping | Shows real-world usage, not toy examples |

### Site Architecture (from llms.txt)

```
docs.firecrawl.dev/
  introduction              -- Landing page
  ai-onboarding             -- Agent-first onboarding (THE entry point for AI)
  mcp-server                -- MCP setup for all IDE/platforms
  advanced-scraping-guide   -- Deep technical reference

  features/
    agent, ask, interact, monitoring, parse, document-parsing,
    lockdown, pii-redaction, research, search, scrape

  sdks/
    cli, overview, python, node, go, rust

  quickstarts/
    IDE: cursor, claude-code, windsurf, amp, antigravity, codex-cli, gemini-cli, opencode
    Backend: express, fastify, hono, nestjs, django, fastapi, flask, rails, laravel, spring-boot
    Frontend: nextjs, nuxt, remix, sveltekit, astro
    Serverless: aws-lambda, cloudflare-workers, deno-deploy, supabase-edge-functions, vercel-functions
    Languages: python, nodejs, go, rust, ruby, php, java, dotnet, elixir, bun

  developer-guides/
    common-sites/: amazon, etsy, github, wikipedia
    cookbooks/: ai-research-assistant, brand-style-guide
    llm-sdks-and-frameworks/: openai, anthropic, gemini, langchain, langgraph, llamaindex, mastra, vercel-ai-sdk, elevenagents, google-adk
    mcp-setup-guides/: chatgpt, claude-ai, factory-ai, oauth
    usage-guides/: choosing-the-data-extractor
    workflow-automation/: dify, make, n8n, zapier

  use-cases/
    ai-platforms, competitive-intelligence, content-generation, data-migration,
    deep-research, developers-mcp, investment-finance, lead-enrichment,
    observability, product-ecommerce, seo-platforms

  api-reference/
    v2-introduction
    endpoints: scrape, search, map, crawl, parse, batch-scrape, activity,
               browser-*, monitor-*, research-*, credit-usage, token-usage, queue-status
    webhooks: crawl-*, batch-scrape-*, monitor-*
    openapi: v2-openapi.json, v1-openapi.json, webhooks-openapi.json

  agents/
    fire-1-extract (FIRE-1 Agent Beta)

  ai-onboarding/
    agent-auth (WorkOS ID-JAG)

  partner-integration
```

### Key Takeaways for Novada MCP Docs

1. **Lead with the agent path**: Firecrawl positions "Use with AI agents" above SDK install. Copy this.
2. **llms.txt is table stakes**: Machine-readable doc index for agent consumption.
3. **Per-platform MCP configs**: One section per IDE with copy-paste JSON. Do not combine.
4. **Parameter tables, not prose**: Every tool needs a structured reference table.
5. **"Full example" sections**: Show a real composite command, not just individual param docs.
6. **Keyless/free tier first**: Reduce onboarding friction to zero where possible.
7. **Skills taxonomy**: Categorize tools by purpose (search, extract, crawl, proxy, browser) not just list them.
8. **Agentic self-help**: Dedicated debugging endpoint or guidance for agents encountering errors.
9. **Quickstart explosion**: 30+ framework-specific quickstarts. Breadth matters for discovery.
10. **Use cases section**: Frames the product around jobs-to-be-done, not features.
