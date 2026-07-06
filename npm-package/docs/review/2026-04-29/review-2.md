# Cross-Review 2 — MCP Interface & Product

**Reviewer:** Agent (MCP Interface & Product) | **Date:** 2026-04-29 | **Version:** novada-search v0.8.3

---

## Agent UX: Critical Gaps

### 1. An LLM cannot reliably select the right tool without prior knowledge

The `novada://guide` resource is excellent once an agent reads it. The problem is the agent has no signal to read it first. The `server.json` manifest — the first thing any MCP client (Smithery, LobeHub, Claude Code) reads — describes only 6 of 11 tools. An LLM bootstrapping from manifest alone will never discover `novada_scrape`, `novada_verify`, `novada_unblock`, `novada_browser`, or `novada_health`.

Even among the 6 declared tools, enum parameters (`engine`, `strategy`, `render`, `method`) have no `.describe()` text. An agent encountering `engine: z.enum(["google","bing","duckduckgo","yahoo","yandex"])` sees five opaque values with no basis for choosing. It will either default to the first value or hallucinate criteria.

### 2. Parameter names diverge from intuition in three tools — and two divergences cause crashes

The functional test confirmed:
- `novada_research` — schema uses `question`, every other tool uses `query`. Passing `query` triggers an uncaught `TypeError: Cannot read properties of undefined (reading 'length')` at `resolveDepth()`. No Zod validation catches it. The tool crashes instead of returning an error string.
- `novada_extract` — batch mode uses `url` (array), but `urls` (plural) is intuitive for batch. Passing `urls` causes a `TypeError: Invalid URL` crash.
- `novada_unblock` — uses `method` for the same concept that `novada_extract` calls `render`. Agents that learn one will fail validation on the other.

These are not documentation problems — two of three are runtime crashes. An agent has no way to recover from a crash; it has no error string to read.

### 3. Error messages stop at diagnosis — they do not prescribe next steps

The current error template produces:
```
Error [RATE_LIMITED]: Too many requests
(This error is retryable)
```

An agent receiving this does not know: wait how long? use exponential backoff? switch tools? The retryable flag is present but the guidance is absent. On `INVALID_PARAMS`, the Zod error path reports `render: Invalid enum value` without appending the valid values (`["auto","static","render","browser"]`). The agent knows something is wrong but not what the correct value is.

The `novada_unblock` false mode label (Bug 1 in the advanced report) compounds this: when `NOVADA_WEB_UNBLOCKER_KEY` is absent, the tool silently falls back to a static fetch but reports `method: render | cost: medium` and states "Rendered via Web Unblocker (JS execution enabled)." An agent trusts this output, concludes JS rendering succeeded, and stops trying alternatives — on a JS-heavy page that actually returned a shell or challenge page.

---

## Developer Experience Issues

### Getting-started flow is 5+ steps, not ≤5

The EN README "Quick Install" section is:
1. Run `claude mcp add novada -- npx -y novada-search`
2. Add API key to Claude's MCP config JSON manually
3. Get key at dashboard.novada.com
4. (Implied) Understand which tools need which additional keys — this requires reading a separate table
5. (Implied) Understand that `novada_search` and `novada_scrape` require product activation beyond just having a key

The ZH README simplifies this correctly to a single command with the key inline:
```bash
claude mcp add novada -e NOVADA_API_KEY=你的密钥 -- npx -y novada-search
```

The EN README should adopt this single-command form. The 2-step split (install, then manually edit JSON) is unnecessary friction.

### Package name `novada-search` is misrepresented in one badge

The EN README header badge reads `tools-10` but the actual implementation has 11 tools (`novada_scrape`, `novada_verify`, `novada_unblock`, `novada_browser`, `novada_health`, plus the 6 original). The badge is stale. The ZH README badge reads `工具数-5` — which refers to an even older version. Both badges are wrong.

### `server.json` declares npm package version 0.6.9 — two minor versions behind

Smithery and LobeHub parse `packages[].version` from `server.json`. When this says `0.6.9` but `package.json` says `0.8.3`, automated marketplaces may serve a stale install command or suppress the latest version. This is a silent distribution bug.

---

## LobeHub Score: What's Missing

Current reported score: **61/100**. Estimated ceiling without changes: ~65/100 due to accumulated drift.

| Criterion | Current Status | What Needs to Happen |
|---|---|---|
| Tools declared in manifest | 6/11 (55%) — server.json at v0.6.9 | Add all 11 tools to server.json; bump version to 0.8.3 |
| Tool descriptions (quality) | Good for 6 declared; missing 5 | Write descriptions for scrape, verify, unblock, browser, health in server.json |
| Prompts declared in manifest | 3/5 (60%) — scrape_platform_data and browser_stateful_workflow missing | Add both to server.json prompts array |
| Resources declared in manifest | 3/4 (75%) — novada://scraper-platforms missing | Add to server.json resources array |
| Manifest version sync | 0.6.9 vs 0.8.3 — 2 minor versions behind | Sync server.json version and packages[].version to 0.8.3 |
| Skill file present | Yes — skills/novada-agent/SKILL.md exists | No change needed for presence; update content for 11 tools |
| Skill file covers all tools | SKILL.md says "5 Novada MCP tools", covers only original 5 | Update SKILL.md to document all 11 tools |
| LICENSE file | MIT badge present in README; need to verify LICENSE file exists | Confirm LICENSE file at root; LobeHub checks file presence |
| package.json keywords | Present and comprehensive | No change needed |
| LobeHub JSON avatar | Set to "🌐" — valid | No change needed |
| LobeHub JSON description | Accurate and complete for 11 tools | Description text is accurate but "5 engines" framing undersells the product |
| GitHub repo URL in lobehub JSON | `github.com/Goldentrii/novada-mcp` — check if this matches actual repo | If repo moved to NovadaLabs org, ZH README links to `NovadaLabs/novada-search` while lobehub JSON links to `Goldentrii/novada-mcp` — inconsistent |

**Estimated score after manifest sync (6→11 tools, 3→5 prompts, 3→4 resources, version sync):** ~78/100
**Estimated score after SKILL.md update and LICENSE confirmation:** ~82-85/100

The single highest-leverage action is the `server.json` sync. It unlocks 3 criterion upgrades simultaneously (tools, prompts, resources) and removes the version drift that suppresses distribution.

---

## README Consistency (EN vs ZH)

Five inconsistencies found between the two READMEs:

**1. Tool count** — EN badge: `tools-10` (wrong, should be 11). ZH badge: `工具数-5` (very wrong, frozen at v0.6.x). Neither matches actual implementation.

**2. Test count** — EN badge: `tests-258`. ZH badge: `测试用例-124`. These are different numbers referencing different versions. The ZH README was last updated at v0.7.0 when test count was 124.

**3. Install command** — ZH README has the cleaner single-command install with API key inline (`claude mcp add novada -e NOVADA_API_KEY=你的密钥 -- npx -y novada-search`). EN README requires two steps. EN should match ZH here.

**4. GitHub org in star badge** — EN links to `Goldentrii/novada-search`, ZH links to `NovadaLabs/novada-search`. These are different GitHub organizations. Only one can be correct, and both READMEs pointing to different orgs creates trust confusion.

**5. Version history section** — ZH README prominently features a `v0.7.0 更新内容` section. EN README has no equivalent version history section. New features added in v0.8.0 and v0.8.3 are undocumented in both READMEs.

**6. Tool scope** — ZH README CLI examples show only 6 commands (`search`, `extract`, `crawl`, `map`, `research`, and the proxy implied). EN README CLI shows 9 commands including `scrape`, `verify`, and `proxy`. ZH README users would not know `nova scrape` or `nova verify` exist.

---

## Competitive Positioning Gaps

The README comparison section (under "Why Novada") focuses on **proxy infrastructure** (100M+ IPs, 195 countries, anti-bot bypass). This is accurate but it is not our primary differentiator versus the three named competitors.

**What we're not communicating:**

**vs Firecrawl** — Firecrawl is a crawler/extractor. It has no SERP, no structured platform scraping (Amazon/Reddit/TikTok), no proxy config generation, no fact-verification tool. Our differentiator is **breadth**: one MCP that covers the entire data-acquisition pipeline from search → extract → verify. The current README frames us as "another extractor with better proxies." The correct frame is "the only MCP that goes from question to verified answer without leaving the tool."

**vs Tavily** — Tavily is a search API. It has no extraction, crawling, browser automation, or structured scraping. Our differentiator is **depth beyond search**: after Tavily gives you URLs, you still need another tool to read them. We go end-to-end. The comparison table in the README should show this — currently it only lists proxy-related rows.

**vs Bright Data** — Bright Data has no MCP, no agent-native interface, no decision tree for tool selection, no prompts or resources. Our differentiator is **agent-first design**: Bright Data is an infrastructure product that requires integration work. We are ready to use from any MCP client in one command. The 129-platform scraper is directly comparable to Bright Data's scraping API but with zero-config MCP access.

**The unique angle we're not stating anywhere:** novada-search is the only web data MCP that includes an embedded Agent Tool Selection Guide (`novada://guide`) — an LLM-readable decision tree that teaches agents *how to use the tool correctly* rather than assuming they'll figure it out. This is a genuine product differentiator and it appears nowhere in the README, LobeHub description, or lobehub JSON.

---

## Top 5 Product Improvements

1. **Sync server.json to v0.8.3 with all 11 tools, 5 prompts, 4 resources.** This is the highest-ROI single change: fixes LobeHub score by ~17 points, fixes Smithery discoverability for 5 hidden tools, removes a version trust gap that any technical evaluator will notice. Effort: 1 hour.

2. **Fix the two crash bugs before anything else ships.** `novada_research` crashing on `query` and `novada_extract` crashing on `urls` are P0 correctness failures. An agent encountering either crash for the first time will classify the entire MCP as unreliable. Fix: add null guard in `resolveDepth()`, add `urls` alias to extract schema. Effort: 30 minutes.

3. **Fix `novada_unblock` false mode label when `NOVADA_WEB_UNBLOCKER_KEY` is absent.** This is a silent misinformation bug. The tool reporting `method: render` when it performed a static fetch will cause agents to trust wrong output on JS-heavy pages — the exact use case `novada_unblock` is supposed to solve. Fix: detect key absence in router before hardcoding mode. Effort: 1 hour.

4. **Rewrite the competitive positioning section in the README** to frame the differentiator as "end-to-end pipeline, not just extraction" and call out the `novada://guide` resource as an agent-native capability that competitors lack. The current framing (proxy infrastructure) undersells the product on the dimensions agents and developers actually care about. Effort: 2 hours.

5. **Update SKILL.md and align EN/ZH READMEs on tool count, test count, and install command.** SKILL.md saying "5 tools" while the server has 11 is a consistency trap for any agent that reads it alongside the manifest. The README badge drift (EN: 10 tools, ZH: 5 tools, actual: 11) reduces trust in the documentation. Fix: update SKILL.md to cover all 11 tools, sync badge numbers, standardize install command to the single-command ZH form. Effort: 2 hours.

---

*Report generated: 2026-04-29 | Reviewer 2: MCP Interface & Product | Codebase: novada-search v0.8.3*
