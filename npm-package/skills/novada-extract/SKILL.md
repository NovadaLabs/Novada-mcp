# novada_extract — Extraction Specialist Skill

**When to use:** You have a URL and need its content. This is the primary content extraction tool.

## Decision: Which render mode?

| Site type | Recommended | Reason |
|-----------|-------------|--------|
| News, docs, blogs | render=auto (default) | Static fetch works, 112ms avg |
| LinkedIn, Glassdoor, React SPA | render=render | JS-rendered, needs Web Unblocker |
| Behind login, interactive | render=browser | Full Chromium CDP |

**Rule:** Never use render=render for ALL pages. auto is 15-113x faster.

## Batch extraction pattern

```json
{
  "url": ["https://site.com/page1", "https://site.com/page2", "https://site.com/page3"],
  "render": "auto",
  "max_chars": 25000
}
```

Returns one labeled section per URL: `### [1/3] url`.

## Field extraction pattern

```json
{
  "url": "https://amazon.com/product/...",
  "fields": ["price", "rating", "availability", "brand"]
}
```

Checks JSON-LD first, then pattern matching. Returns `## Requested Fields` block.

## Content too long?

Use `max_chars=50000` for long docs. Default is 25000. Max is 100000.

```json
{
  "url": "https://long-doc.com/guide",
  "max_chars": 50000
}
```

## Bot-blocked / empty content?

Escalate: static → render → browser.

```json
{"url": "...", "render": "render"}
```

If still blocked:
```json
{"url": "...", "render": "browser"}
```

## Common Mistakes

- ❌ Setting render=render on all calls — adds 9-16s latency on pages that don't need it
- ❌ Calling novada_extract to check if a URL exists — use novada_map for URL discovery
- ❌ Setting max_chars=100000 by default — use 25000, increase only when needed

## After extraction

- Content looks JS-heavy or incomplete → retry with render=render
- Content is truncated → increase max_chars
- Need more URLs → call novada_map first, then batch extract
