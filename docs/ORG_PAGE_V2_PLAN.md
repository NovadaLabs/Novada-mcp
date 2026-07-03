# NovadaLabs Org Page — v2 Plan (post multi-agent review)

Synthesis of 4 parallel reviewers (capability / positioning / IA / visual) against the live v1
at github.com/NovadaLabs. v1 shipped a clean skeleton but **undersells the product** and leans on
competitor comparison the founder rejected. This is the v2 direction.

---

## 1. Key finding — the product is much bigger than v1 showed

v1 framed Novada as a 4-step loop (Find→Reach→Extract→Use) + an 8-row table.
Reality (from reading `NovadaLabs/novada-mcp` source): **~34 tools, 10 capability categories.**

| Category | What it does | In v1? |
| --- | --- | --- |
| Search & research | 5-engine search, cited multi-source research, fact-check (`verify`) | partial |
| Content extraction | URL→markdown/JSON, batch, PDF, structured `fields` | yes |
| Site intelligence | crawl, map, discover | yes |
| **Structured platform scraping** | **129 platforms** (Amazon, LinkedIn, TikTok, Zillow, YouTube…), md/json/csv/xlsx | ❌ missing |
| **Async job pipeline** | submit→status→result + task management for long jobs | ❌ missing |
| **Change monitoring** | field-level diffs with % change between calls | ❌ missing |
| **AI brand monitoring** | how ChatGPT/Perplexity/Grok/Claude/Gemini mention your brand + sentiment | ❌ missing |
| Browser automation | session-persistent CDP browser, 11 action types, geo per session | thin |
| **Proxy network** | **6 types** (residential/ISP/datacenter/mobile/static/dedicated) + sub-accounts, IP whitelist, static-IP purchase, traffic analytics | 1 row |
| **Account / ops** | wallet, per-product balances, usage, daily traffic, key mgmt — agent can watch its own spend | ❌ missing |

Plus native MCP **Prompts (5)** + **Resources (5)** — reusable workflow templates & reference data. No competitor ships these.

**Strongest differentiator (one line):** the only MCP that unifies scraping (129 platforms + async),
anti-bot infrastructure (6 proxy types + session browser), change/brand monitoring, and account
management under a single API key — so an agent can acquire data, route around bot walls, track what
changed, and monitor its own spend without switching vendors.

**Headline candidates (lead with 5–6):** all-in-one breadth · owned 100M+ IP network / 6 proxy types ·
129-platform structured scraping · AI brand monitoring (novel) · change monitoring · production ops.

---

## 2. Information architecture — invert the framing (platform first)

v1's flaw: it makes the *MCP server* look like the product. Founder's model: **platform = core, MCP = add-on, ecosystem = momentum.**

Proposed sections:

1. **Hero** — what Novada *is*: web-data + proxy **infrastructure** for AI agents (100M+ IPs, 195 countries). Links to novada.com + developer.novada.com. (No repo link in hero.)
2. **What Novada does** — the capability table above, grouped by category (not 8 flat rows).
3. **Access layers** (was "Core") — `novada-mcp` (flagship) · `novada-search-mcp` · `novada-proxy` → framed as *how agents reach the platform*.
4. **SDKs & official libraries** (was "Ecosystem") — `novada-python`, `novada-go`. First-party, not "community extras."
5. **Integrations & extensions** (was "Skills") — Chrome extension + agent skills, in plain English. + a **"Coming soon: LangChain · CrewAI · n8n · Zapier"** momentum line.
6. **Connect** (was "Community & Support") — social badges.

Set the **org description** (currently null): `Web data & proxy infrastructure for AI agents — 100M+ IPs, 195 countries.`

Momentum signals: npm-version badges per repo (live, zero upkeep), a "coming soon" integrations row, optional "what's new" one-liner.

---

## 3. Copy — positive framing, no comparison (founder directive)

**Remove entirely:** the 4-bullet competitor list (Tavily/Firecrawl/Bright Data/roll-your-own).
**Also remove the indirect jabs:** "~25 tools **instead of 69**", "consolidate **Tavily + Firecrawl + a proxy vendor**", and "**Measured against Firecrawl, Tavily, Bright Data**".

**New "Why Novada?"** (describe the problem space generically, then our strength — no names):
> AI agents need clean, current web data to do real work. The typical approach stitches together a
> search tool, a scraper, and a proxy vendor — three installs, three bills, three failure surfaces.
> Novada collapses that into one MCP server on an unblocking layer we own, not rent.

**Advantage bullets (positive only):** all-in-one by design · we own the network (100M+ IPs / 195
countries, no reseller markup) · token-efficient tool surface · built for the hard pages (anti-bot,
JS, geo) · production-grade ops · flexible deployment (unified MCP, focused variants, Python/Go SDKs).

---

## 4. Visual — cut to premium (Vercel/Supabase lesson: restraint)

- **Remove emoji from badge CTAs** (`🚀`/`📚`/`⚡`) — biggest premium-killer; text-only on violet.
- **One violet, not four** — normalize every Novada badge to `#6C40E2` (v1 uses 4 different purples).
- **Drop both `---` dividers** — use whitespace + heading weight for rhythm.
- **Don't badge every item** — float-badges only in the Access-layers section; SDKs/integrations as clean lists.
- **Cut AI-generic filler** — fold "Who builds with Novada" into the hero line; rename "Community & Support".
- Logo at height=56 is fine.

---

## 5. Resolved tensions + open forks

**Resolved by orchestrator:**
- IA agent suggested adding a "Benchmarks & Comparisons" section → **overruled** per founder's "no comparison" steer + the benchmark isn't public (and `compet-intel` is going private). Omit for now.
- "Keep the table" (visual) vs "table undersells" (capability) → **keep a table, but expand to the 10 categories** (§1).
- Breadth vs restraint → **breadth via structure** (category table + sectioned repos), **restraint in prose** (kill bullet walls, dividers, emoji). Full tool list lives in the novada-mcp README + developer.novada.com, not the org page.

**Forks for founder:**
- F1. Feature **AI brand monitoring** prominently (novel, marketable) or keep it as a secondary capability?
- F2. Confirm: **omit any comparison/benchmark** on the org page entirely for now?
- F3. Org page = headline categories only, with deep detail pushed to docs/repo — agree?

---

## 6. Still pending (owner-only, carried from v1 — I lack admin)

- ⚠️ `compet-intel` still **public** — `gh repo edit NovadaLabs/compet-intel --visibility private --accept-visibility-change-consequences`
- Org description still null (set per §2).
- Descriptions for `novada-python`, `novada-go`, `novada-scraper-skill`, `novada-webunblocker-skill`.
