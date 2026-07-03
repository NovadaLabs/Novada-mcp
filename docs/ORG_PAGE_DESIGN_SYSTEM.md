# NovadaLabs GitHub Org — Design System

Single source of truth for the org profile page (and any repo README that wants to match).
Tokens are lifted from the live landing site (`landing/index.html`), not invented — so GitHub,
the website, and npm all read as one brand.

## 1. Color

| Token | Hex | Use |
| --- | --- | --- |
| **Violet (primary)** | `#6C40E2` | Primary CTAs, flagship badge, links, brand accents |
| Violet bright | `#5B2EEB` | Secondary brand items, hover |
| Violet deep | `#431FD5` | Pressed / dense accents |
| Violet light | `#9863F0` | Tertiary badges (proxy), highlights |
| Violet pale | `#C9B4FB` / `#E9E4FF` | Backgrounds, dividers (web only) |
| Ink | `#0A142F` | Body text (light mode), dark badges |
| Ink bg | `#0F0C1E` | Dark-mode background |
| Card dark | `#1D1A33` | Dark-mode surface |
| Surface light | `#F8F7FC` | Light-mode surface |
| Muted | `#677489` | Secondary text |

**Rule:** Novada-first items use the violet family. Third-party ecosystem items keep their
*recognizable* brand colors (Python `#3776AB`, Go `#00ADD8`, Chrome `#4285F4`, npm `#CB3837`,
Discord `#5865F2`, X `#000000`) so they're scannable. Don't violet-wash everything.

## 2. Typography

| Role | Font | Notes |
| --- | --- | --- |
| Display / headings | **Hanken Grotesk** (700–800) | tracking `-0.025em` |
| Body / UI | Hanken Grotesk (400–500) | tracking `-0.01em` |
| Mono / code | **IBM Plex Mono** | install commands, tool names |
| CJK | Noto Sans SC | only if zh content is added |

GitHub READMEs can't load custom fonts — typography applies to the **logo asset** and any
SVG/image headers you commit. Markdown body inherits GitHub's font; keep it clean instead.

## 3. Badge system (shields.io)

All section badges use `style=for-the-badge`. Fixed palette so the page looks composed:

| Slot | Color | Logo |
| --- | --- | --- |
| Get Started (primary CTA) | `6C40E2` | — |
| Documentation | `0F0C1E` | `book` |
| Install / npm | `CB3837` | `npm` |
| Flagship stars | `6C40E2` | `github` |
| Cloud API | `0F0C1E` | `cloudflare` |
| Search MCP | `5B2EEB` | `anthropic` |
| Proxy MCP | `9863F0` | `tor-project` |
| Skills | `9061FF` | `anthropic` |
| Python / Go / Chrome | brand colors | `python` / `go` / `googlechrome` |
| Discord / X / LinkedIn | brand colors | `discord` / `x` / `linkedin` |

## 4. Layout pattern (the Firecrawl skeleton, Novada skin)

1. **Hero** (centered): logo → `<h3>` one-line promise → `<p>` subtitle → 3 CTA badges.
2. **Stat badges** (centered): npm version, downloads, license, X follow.
3. `---`
4. **Why Novada?** — the fragmentation problem, named competitors, the one-line fix.
5. **What Novada does** — capability table (Tool | Job).
6. **Built for production** — 4 differentiators; lead with the owned-proxy-network moat.
7. **Core / Ecosystem / Skills** — each item: `### Title` + right-aligned badge + bold repo link + one-line description + `<br clear="right"/>`.
8. **Who builds with Novada** — 3 personas.
9. **Community & Support** — centered social badges.
10. `---`
11. **Footer CTA** — tagline + get-key link + 3 quick links.

## 5. Voice

- Promise line: **"One MCP server. All web data."** (already the npm tagline — keep it everywhere)
- Differentiator vs Firecrawl: **we own the proxy network, they rent.** 100M+ IPs / 195 countries.
- Tone: direct, benchmark-backed, no hype words. Name competitors plainly (Tavily / Firecrawl / Bright Data) — it's already in the npm README and it works.

## 6. Logo & assets (done)

- [x] **Theme-aware logo via `<picture>`** — `profile/logo-light.png` (black "nova", light theme) + `profile/logo-dark.png` (white "nova", dark theme). Both rendered from the brand SVG (`#6B41DE`) at 1000×206 with `@resvg/resvg-js`; sources kept as `logo.svg` / `logo-dark.svg`. Dark variant = `sed 's/"black"/"white"/g'` on the source.
- [x] Social/docs confirmed: X `@Novada_Proxy`, Discord `discord.gg/DgmrpTs86c`, LinkedIn `company/novadalabs`, docs `developer.novada.com`.
- ⚠️ **When replacing a logo, use a NEW filename.** GitHub's camo image proxy caches by URL — overwriting `logo.png` in place keeps serving the old (blank) image. That bit us once.
