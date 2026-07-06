# novada-mcpserver

**Novada Hosted MCP server** — deployed at `https://mcp.novada.com/mcp`.

This is the **deployment surface** for Novada's existing MCP tools (which live in [`novada-mcp`](https://github.com/NovadaLabs/novada-mcp) npm package). It wraps those tools in a remote Streamable HTTP MCP transport so AI clients (Claude Desktop / Cursor / Cline / Windsurf / VS Code) can use them via one URL — zero install.

## Repo layout

```
novada-mcpserver/
├── vercel/            ← ACTIVE — Vercel Edge Function (deployed)
│   ├── api/mcp.ts
│   ├── vercel.json
│   └── README.md      ← deploy walkthrough
├── worker/            ← FALLBACK — CF Workers port (kept for reference, blocked by CF subdomain limitation)
├── landing/           ← novada.com/mcp install landing page
├── docs/              ← 5 user/ops docs (README, ARCHITECTURE, INSTALL, DEPLOY, DIRECTORIES)
└── scripts/           ← reserved
```

## Deploy quickstart

See `vercel/README.md` for full walkthrough. TL;DR:

1. Push this repo to GitHub.
2. Import in Vercel → set Root Directory to `vercel/`.
3. Add env vars + Vercel KV.
4. CNAME `mcp.novada.com` → `cname.vercel-dns.com` at AWS Route 53.

## Related

- npm package: [`novada-mcp`](https://npmjs.com/package/novada-mcp) (the local MCP server — runs via `npx novada-mcp`)
- Source: [`NovadaLabs/novada-mcp`](https://github.com/NovadaLabs/novada-mcp)
- This repo wraps that package's tools behind an HTTP endpoint at the edge.
