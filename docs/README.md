# Novada Hosted MCP

> **Status:** v0.1 — KR-5 (June 2026)
> **Endpoint:** `https://mcp.novada.com/mcp`
> **Free tier:** 5,000 calls / month / API key

---

## What is Novada Hosted MCP?

A remote Model Context Protocol server that gives AI agents and chat apps instant access to Novada's web data tools (search, scrape, extract, crawl, map, browser, verify, research, 6 proxy types) via one URL.

---

## Why hosted?

- **Zero install for end users** — no Node, no Python, no local CLI. Add a URL, use the tools.
- **Better distribution** — listed in every MCP directory; one-click install in Cursor, Claude Desktop, etc.
- **Edge-fast** — Cloudflare Workers runs requests near the user.
- **Always latest** — no client upgrade required when we ship new tools.

---

## Quick Start

```text
URL:        https://mcp.novada.com/mcp?token=YOUR_API_KEY
Get a key:  https://www.novada.com/signup    (5000 free calls/mo)
Then add to your AI client → see INSTALL.md
```

---

## Tools exposed

All 25 Novada web-data tools are available through the single endpoint:

| Tool        | What it does                                              |
|-------------|------------------------------------------------------------|
| `search`    | Web / SERP search across Google, Bing, Baidu, Naver, …     |
| `scrape`    | Render a single URL → markdown / HTML / screenshot         |
| `extract`   | Structured extraction with schema (JSON output)            |
| `crawl`     | Multi-page crawl of a site                                 |
| `map`       | Discover all URLs on a site (sitemap-style)                |
| `browser`   | Full headless browser session (click, fill, navigate)      |
| `verify`    | Source verification — check claim against live web         |
| `research`  | Multi-hop deep research with citations                     |
| `proxy`     | 6 proxy types — residential, datacenter, mobile, ISP, …    |

---

## Repo layout

```
hosted/
├── landing/     # install landing page (mcp.novada.com)
├── worker/      # Cloudflare Worker source (MCP server impl)
├── docs/        # ← you are here
└── scripts/     # utilities (token gen, KV inspection, deploy helpers)
```

---

## Documentation

| File               | Audience               | Purpose                                  |
|--------------------|------------------------|------------------------------------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Engineers              | How the system works end-to-end          |
| [INSTALL.md](./INSTALL.md)           | **End users**          | Step-by-step setup for every MCP client  |
| [DEPLOY.md](./DEPLOY.md)             | Ops / maintainers      | First-time deploy + ongoing runbook      |
| [DIRECTORIES.md](./DIRECTORIES.md)   | Marketing / growth     | MCP-directory submission checklist       |

---

## License & contact

Source: MIT. Service: subject to Novada Terms (`novada.com/terms`). Contact: `support@novada.com`.
