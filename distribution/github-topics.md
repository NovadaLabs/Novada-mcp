# GitHub repo topics — OWNER-GATED

**Status: not applied.** This is guidance for the owner to paste into GitHub settings; no
automation in this repo changes repository topics (that's a live GitHub API/UI action, out of
scope for a file-producing worker under REDLINE).

## Current state (as of the 2026-09-02 audit, finding B-5)

`repos/NovadaLabs/Novada-mcp` topics = `["ai-agents", "claude", "llm", "mcp", "web-scraping"]` (5 of
the 20 GitHub allows). Missing the terms a buying developer actually searches and the terms this
repo already claims elsewhere (`package.json` keywords already include `firecrawl-alternative` /
`tavily-alternative`, but GitHub topics do not).

## Recommended topic list

Add these 3 (5 existing + 3 = 8 total; keeps headroom under GitHub's 20-topic cap for later
additions):

- `firecrawl-alternative`
- `mcp-server`
- `model-context-protocol`
- `web-scraping` *(already present — listed for completeness of the target set)*
- `ai-agents` *(already present)*
- `claude` *(already present)*
- `llm` *(already present)*
- `mcp` *(already present)*

Net new topics to add: `firecrawl-alternative`, `mcp-server`, `model-context-protocol`.

## Why these three

- `firecrawl-alternative` — `github.com/topics/firecrawl-alternative` is the **#1 organic result**
  for the search "firecrawl alternative MCP" (finding B-3/B-5, evidence E18b). The repo isn't on it
  today; `package.json` already claims the term as an npm keyword, so this closes the gap between
  npm search surface and GitHub topic surface for the same claim.
- `mcp-server` / `model-context-protocol` — the two most generic, highest-traffic MCP-ecosystem
  topics; Firecrawl/Tavily/BrightData's GitHub repos all carry both.

## How to apply (owner action — REDLINE, not automated here)

1. Go to `https://github.com/NovadaLabs/Novada-mcp`.
2. Click the gear icon next to "About" (top right of the repo page).
3. In "Topics", add: `firecrawl-alternative`, `mcp-server`, `model-context-protocol`.
4. Save.

No CLI/API call is included here on purpose — topic changes are a publicly-visible repo edit and
fall under the REDLINE gate (no GitHub state change without explicit owner approval).
