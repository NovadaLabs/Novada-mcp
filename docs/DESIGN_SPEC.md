# Novada MCP — Brand Design Spec (extracted from novada.com, 2026-06-12)

Authoritative visual system for `landing/index.html` + `landing/playground.html`.
Extracted via computed-style scrape of https://www.novada.com.

## ⛔ HARD RULE: NO mint / green anywhere
The current pages use mint `#10d49c` as an accent. novada.com has **zero** green.
Remove all mint. Accent is **violet/purple** + (sparingly) soft pink.

## Color tokens

| Token | Value | Use |
|---|---|---|
| `violet-light` | `#9863f0` | gradient start, light accents |
| `violet` | `#6c40e2` | primary violet, links, accent text |
| `violet-deep` | `#431fd5` | gradient end, deep accent |
| `violet-alt` | `#5d34f2` / `#7953fa` | secondary violets |
| `ink` | `#191228` | dark CTA band background, darkest text |
| `ink-text` | `#0a142f` | headings on light bg (near-black navy) |
| `slate` | `#677489` | body / muted text |
| `gray` | `#565656` | secondary text |
| `paper` | `#ffffff` | primary background |
| `tint-violet` | `#f5eeff` | soft violet section tint |
| `tint-cool` | `#f7f8fc` | cool gray section tint |
| `tint-blue` | `rgba(14,63,126,0.08)` | soft blue chip/card tint |
| `hero-wash` | `rgba(174,179,217,0.35)` | hero periwinkle mid-stop |

## Signature gradients

- **Hero highlight text** (the one hero accent word):
  `background: linear-gradient(45deg,#9863f0 0,#6c40e2 51%,#431fd5 100%); -webkit-background-clip:text; -webkit-text-fill-color:transparent;`
- **Hero section background** (LIGHT, not dark):
  `linear-gradient(180deg, #fff 0%, rgba(174,179,217,0.35) 50%, #fff 100%)`
- **Dark CTA band** (e.g. Free-tier card / footer CTA): solid `#191228`, radius `17px`.

## Typography
- Font family: **Hanken Grotesk** (Google Fonts sibling of HKGrotesk). Already imported. Keep.
- h1: very large (clamp ~48–82px), weight 600–700, color `#0a142f` (near-black), tight line-height (~1.1).
- h2: ~36–52px, weight 600.
- body: 16px, line-height 1.5–1.6, color `#677489` (slate) for paragraphs, `#0a142f` for emphasis.
- Headings use the display font; body uses Hanken Grotesk / IBM Plex Sans. Mono stays IBM Plex Mono.

## Components

### Buttons
- **Primary**: `background:#191228` (or violet `#6c40e2` for the single hero CTA), white text, `border-radius:10px`, padding ~`12px 24px`, weight 600, NO heavy shadow (subtle or none). On novada.com primary is black radius-10.
- **Secondary**: white background, dark text (`#0a142f`), `border-radius:50px` (pill), thin border `1px solid #e7e2f5` or none, weight 500.
- Hover: primary → slight darken or violet; secondary → light violet tint bg `#f5eeff`.

### Cards
- `background:#fff; border-radius:10px; box-shadow: rgba(18,17,39,0.08) 0px 10px 50px 0px; border:none` (or 1px hairline `#eee` optional).
- Generous padding (~28–32px).
- Hover (optional): lift `translateY(-2px)` + slightly stronger shadow.

### Sections
- Default white. Alternate with soft tints `#f7f8fc` / `#f5eeff` for rhythm.
- LIGHT hero (white→periwinkle wash). The current DARK hero must become light.
- Dark band ONLY for high-emphasis CTA (free-tier / footer) using `#191228` radius-17.

### Nav / header
- White / near-white, subtle bottom border `#eee` or soft violet `#e3daff`.
- Logo + "MCP" chip. Links dark `#0a142f`, hover violet `#6c40e2`.
- Primary nav CTA button: black radius-10 ("Get API key").

## ⛔ DO-NOT-TOUCH (content correctness already verified)
The restyle is **visual only**. Builders MUST NOT change:
1. Any human-readable copy / wording (EN or ZH).
2. Any `<span class="en">` / `<span class="zh">` bilingual structure (keep both, keep classes).
3. MCP install snippets — every `data-copy="..."`, every `<pre>` config block, exact field
   names (`type:streamableHttp`, `serverUrl`, `--transport http`, `bearer_token_env_var`, etc.),
   URLs (`https://mcp.novada.com/mcp`, `dashboard.novada.com/sign-up/`), the `sk-eu-novada-YOUR_KEY` placeholders.
4. Playground JS: `PG_TOOLS`, `PG_ENDPOINT`, `pg-*` element IDs, `localStorage` logic,
   the fetch call, `syncRunButton`, key-required gating. NO demo token may be reintroduced.
5. Tool names, counts ("25/26 tools"), quota numbers ("1,000"), the `#install/#tools/#free/#faq` anchors.
6. `<script src="https://cdn.tailwindcss.com">` — keep Tailwind CDN.
7. Lang-toggle, tab, copy-button JS.

Allowed changes: the `<style>` block, `tailwind.config` color/font tokens, Tailwind utility
classes on elements, section background classes, button/card/hero class treatments, decorative
elements (gradient washes, chips, dividers). Swap `bg-mint*`/`text-mint*`/`shadow-mint*` →
violet/ink equivalents. Convert the dark hero to the light periwinkle-wash hero with a
gradient-clipped highlight word.

## Self-check before declaring done
- [ ] `grep -c mint` in the file → 0 (no mint left)
- [ ] All `data-copy` values byte-identical to before
- [ ] Count of `<span class="zh">` unchanged vs before
- [ ] Count of `<span class="en">` unchanged vs before
- [ ] `PG_ENDPOINT`, `PG_TOOLS`, `pg-token`, `syncRunButton` all still present (playground)
- [ ] No `playground-demo` / demo-token reintroduced
- [ ] Page still has exactly the same section anchors (#install #tools #free #faq)
- [ ] Tailwind CDN script intact
