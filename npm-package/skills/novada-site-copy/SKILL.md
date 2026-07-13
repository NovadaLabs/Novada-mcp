---
name: novada-site-copy
description: >-
  Copy an entire docs site or knowledge base to disk as clean markdown for
  offline use, RAG ingestion, or full-site analysis. Covers when to use
  site_copy vs crawl, the manifest-only return contract, discovery order,
  path filters, the hosted-endpoint limitation, and a RAG pipeline recipe.
  Trigger: requests to copy a whole site, ingest docs into a vector store,
  or build a local markdown corpus from a documentation site.
---

# novada-site-copy — Whole-Site Copying and RAG Ingestion

`novada_site_copy` copies an entire website (or a scoped section) to your local disk as
clean markdown — one `.md` file per page — and returns a **compact manifest**, not page bodies.

---

## site_copy vs crawl — pick the right tool

| | `novada_site_copy` | `novada_crawl` |
|---|---|---|
| **Returns** | Manifest (file paths + metadata) — read the files separately | Page bodies inline |
| **Scale** | Up to 1000 pages (default 200) | Up to 20 pages |
| **Use when** | Whole docs site, RAG corpus, offline ingest | ≤ 20 pages, need content inline |
| **Environment** | **Local only** (`npx novada-mcp`) | Local + hosted |
| **Files on disk** | Yes, streamed to `~/Downloads/novada-mcp/` | No |

**Decision rule:** > 20 pages or want a file corpus → `site_copy`. ≤ 20 pages inline → `crawl`.

---

## Critical: site_copy returns a manifest, not page bodies

The tool writes each page to `~/Downloads/novada-mcp/<date>/<domain>/site-copy/<slug>.md`
as it completes, then writes `manifest.json` with per-page metadata:

```json
{
  "root": "https://docs.example.com",
  "discovery": "llms.txt",
  "pages_total": 42,
  "pages_failed": 0,
  "generated_at": "2026-07-06T12:00:00Z",
  "pages": [
    {
      "url": "https://docs.example.com/api/auth",
      "file": "/Users/you/Downloads/novada-mcp/2026-07-06/docs.example.com/site-copy/api-auth.md",
      "title": "Authentication",
      "word_count": 1240,
      "depth": 1,
      "bytes": 8432,
      "status": "ok"
    }
  ]
}
```

**After site_copy completes:**
1. Read `manifest.json` to get the file list
2. Open specific `.md` files you need (use the `file` field paths)
3. Do NOT re-fetch the pages — the local `.md` files are the canonical copy

---

## Discovery order (automatic, no configuration needed)

The tool tries these in order, stopping at the first that yields URLs:

1. `llms.txt` at `<origin>/llms.txt` — canonical flat page index (fastest)
2. `llms-full.txt` at `<origin>/llms-full.txt`
3. `sitemap.xml` — standard sitemap discovery
4. Scoped BFS — breadth-first crawl, drained to `max_pages` ceiling

The `discovery` field in the manifest tells you which method was used.

---

## Path filters

Use `select_paths` and `exclude_paths` to scope what gets copied.
Globs: `*` matches within a path segment, `**` matches across segments.

```json
{
  "url": "https://docs.example.com",
  "select_paths": ["/api/**", "/guides/**"],
  "exclude_paths": ["/blog/**", "/changelog/**"]
}
```

---

## Key parameters

| Param | Default | Notes |
|-------|---------|-------|
| `url` | — | Required. Starting URL |
| `max_pages` | 200 | Hard max: 1000. Safety ceiling, not a target |
| `max_depth` | 5 | BFS link hops (only used when sitemap/llms.txt not found) |
| `render` | `"auto"` | `"auto"`: static first, escalates on JS-heavy. `"render"`: always JS |
| `select_paths` | — | Glob allowlist (up to 20 patterns) |
| `exclude_paths` | — | Glob denylist (up to 20 patterns) |
| `include_subdomains` | false | Include subdomains of the root host |
| `project` | site domain | Groups output under a named subfolder |

---

## Hosted-endpoint limitation (known gap)

**`novada_site_copy` does NOT work on `mcp.novada.com` (the hosted endpoint).**

The tool writes pages to `~/Downloads` on the local filesystem. Vercel and AWS Lambda
run on read-only serverless filesystems — `writeFile` throws `EROFS`. The tool detects
this and returns an actionable error instead of crashing.

To use `site_copy`, run the local MCP server:

```bash
npx novada-mcp
```

If you are on the hosted endpoint and need multi-page content, use `novada_crawl` instead
(it returns page bodies inline and works on both local and hosted).

---

## RAG pipeline recipe

```
1. novada_site_copy → copy site to ~/Downloads/.../site-copy/
2. Read manifest.json → get list of {file, title, url, word_count}
3. For each .md file in the manifest:
   a. Read file content
   b. Chunk into ~512-token segments (split on headers or paragraphs)
   c. Embed each chunk (e.g. text-embedding-3-small)
   d. Store in vector DB with metadata: {url, title, file, chunk_index}
4. Query time: embed query → nearest-neighbor search → retrieve chunks → cite sources
```

---

## Quick call pattern

```json
{
  "url": "https://docs.example.com",
  "select_paths": ["/api/**"],
  "max_pages": 100,
  "render": "auto"
}
```

After it returns, read the manifest and open the `.md` files you need — do not re-fetch.
