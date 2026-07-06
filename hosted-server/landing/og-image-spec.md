# Novada MCP — OG Image Spec

## Dimensions
1200 × 630 px (standard Open Graph / Twitter Card large image)

## Source file
`landing/og-image.html` — self-contained, no JS, no external images.

## Screenshot command

Using Playwright CLI:
```bash
npx playwright screenshot \
  --browser chromium \
  --viewport-size "1200,630" \
  --full-page \
  og-image.html og-image.png
```

Or via `playwright` if installed globally:
```bash
playwright screenshot --browser chromium --viewport-size 1200,630 og-image.html og-image.png
```

Output: `landing/og-image.png` — reference this in `<meta property="og:image">`.

## Text content (exact)

| Zone | Text |
|------|------|
| Top-right wordmark | `novada` + `MCP` tag |
| Eyebrow | `Hosted MCP Server` |
| Headline line 1 | `One URL. 25 web-data tools.` ("25 web-data tools" in mint) |
| Headline line 2 | `Zero install.` (muted white) |
| Descriptor | `search · scrape · extract · crawl · map · verify · research · 6 proxy types` |
| Endpoint pill | `https://mcp.novada.com/mcp` with mint live dot |
| Bottom-right badges | `Claude Desktop` `Cursor` `Cline` `Codex` |

## Color decisions

| Token | Hex | Usage |
|-------|-----|-------|
| Background base | `#0c0a17` | Ink dark — matches landing hero |
| Background gradient | `#161226` | Ink-800 tint at bottom |
| Violet glow | `#5b2eeb` @ 40% | Top-left radial — brand anchor |
| Mint glow | `#10d49c` @ 14% | Bottom-right radial — live/active signal |
| Grid mesh | `#5b2eeb` @ 5% | 60 px grid overlay — subtle depth without noise |
| Headline | `#fbfaff` | Paper — maximum contrast on dark |
| Mint accent | `#10d49c` | "25 web-data tools" + endpoint dot + eyebrow |
| Muted subline | `rgba(251,250,255,0.45)` | "Zero install." — hierarchy without a second color |
| Descriptor | `rgba(251,250,255,0.38)` | Low-priority, scannable tag cloud |
| Endpoint pill bg | `rgba(22,18,38,0.85)` | Ink-800 glassy — code-block aesthetic |
| Badges | `rgba(255,255,255,0.05)` border | Ghost pills — show ecosystem without visual noise |

## Fonts

- **Space Grotesk 700** — headline, wordmark, subline (geometric, technical, brand-consistent)
- **IBM Plex Mono 400/500** — eyebrow, endpoint URL, descriptor, badges (code aesthetic signals developer tool)

## Visual rationale

Dark hero with dual-axis glow (violet top-left, mint bottom-right) mirrors the landing page `grad-hero` treatment exactly, so the OG preview feels like a true crop of the product — not a separate asset. Left-aligned copy gives natural F-pattern scan order on social feeds. The endpoint pill at bottom-left is the CTA anchor: it answers "where do I connect?" before the viewer clicks. Badge row (Claude/Cursor/Cline/Codex) signals ecosystem compatibility without prose.

## HTML meta tag

```html
<meta property="og:image" content="https://novada.com/og-image.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="https://novada.com/og-image.png" />
```
