# Genome Spec — Firecrawl + Linear Design Teardown

## Purpose

Blueprint for future Astro/Next.js migration of mcp.novada.com.
Engineers should use this as a reference when migrating the current single-file HTML site to a
component-based framework. Values marked "requires browser inspection" were not recoverable from
static source and need a live DevTools session to confirm.

---

## Firecrawl.dev Teardown

Scraped: 2026-06-17. Source: HTML + CSS chunks from firecrawl.dev (Next.js / Qwik hybrid, Tailwind
utility classes, `var(--heat-*)` custom token system).

### Colors

Firecrawl uses a semantic design token system built on a primary "heat" orange brand color.
All tokens extracted from the embedded `:root` style block in the HTML.

**Brand / Accent**

| Token | Light mode | Dark mode | Notes |
|---|---|---|---|
| `--heat-100` (primary brand) | `#fa5d19` (orange) | `#fa5d19` | Unchanged — brand is always this orange |
| `--heat-40` (tint) | `#fa5d1966` | `#fa5d1966` | Used for glows, selection highlight |
| `--heat-20` | `#fa5d1933` | `#fa5d1933` | Hover states, selection bg |
| `--accent-black` | `#262626` | `#f5f5f5` | Swaps to near-white in dark |
| `--accent-white` | `#ffffff` | `#ffffff` | Constant white |
| `--accent-amethyst` | `#9061ff` | `#a07aff` | Purple accent |
| `--accent-bluetron` | `#2a6dfb` | `#5a8ffc` | Blue accent |
| `--accent-crimson` | `#eb3424` | `#f05545` | Red/error |
| `--accent-forest` | `#42c366` | `#5cd47f` | Green/success |
| `--accent-honey` | `#ecb730` | `#f0c550` | Yellow/warning |

**Surfaces / Backgrounds**

| Token | Light | Dark |
|---|---|---|
| `--surface` | `#ffffff` | `#171717` |
| `--surface-raised` | `#ffffff` | `#1f1f1f` |
| `--background-base` | `#f9f9f9` | `#0a0a0a` |
| `--background-lighter` | `#fbfbfb` | `#141414` |

**Borders**

| Token | Light | Dark |
|---|---|---|
| `--border-faint` | `#ededed` | `#2a2a2a` |
| `--border-muted` | `#e8e8e8` | `#333333` |
| `--border-loud` | `#e6e6e6` | `#404040` |

**Shadow system** (from inline styles — layered, very subtle):
```
box-shadow:
  0px 0px 44px 0px rgba(0,0,0,0.02),
  0px 88px 56px -20px rgba(0,0,0,0.03),
  0px 56px 56px -20px rgba(0,0,0,0.02),
  0px 32px 32px -20px rgba(0,0,0,0.03),
  0px 16px 24px -12px rgba(0,0,0,0.03),
  0px 0px 0px 1px rgba(0,0,0,0.05),
  0px 0px 0px 10px #F9F9F9
```
Card inner shadow:
```
box-shadow: 0px 6px 12px 0px rgba(0,0,0,0.02) inset,
            0px 0.75px 0.75px 0px rgba(0,0,0,0.02) inset,
            0px 0.25px 0.25px 0px rgba(0,0,0,0.04) inset
```

### Typography

**Font families** (extracted from CSS `@font-face` and `font-family` declarations):

| Role | Family | Fallback |
|---|---|---|
| Primary sans | `suisse` (custom) | `suisse Fallback`, then system sans |
| Monospace / code | `GeistMono` | `ui-monospace`, `SFMono-Regular`, `Roboto Mono`, `Menlo`, `Monaco` |
| Code secondary | `Roboto Mono` | system mono stack |

Note: "suisse" refers to Suisse Int'l, a paid typeface from Swiss Typefaces. In practice,
any geometric/grotesque sans (Inter, Plus Jakarta Sans) would be a compatible substitution.

**Text scale**: requires browser inspection — Tailwind utility classes obscure the exact rem
values in static CSS (classes like `text-4xl`, `text-xl` used but Tailwind config not inlined).

**Observed heading hierarchy from page content:**
- Hero H1: Very large display — likely 56–80px at desktop. Single strong statement.
  Example: "Power AI agents with clean web data"
- Section H2: Medium display (~36–48px) with an eyebrow label above (e.g., "// Developer First //")
- Feature card H3: ~20–24px, semibold
- Body copy: ~15–16px, regular weight

**Text treatment:**
- `::selection` uses `--heat-20` background + `--heat-100` text color (brand orange)
- `-webkit-font-smoothing: antialiased` applied globally
- `text-rendering: optimizeLegibility` applied globally

### Page Structure

Sections in order (numbered pagination visible: `[01/06]` etc.):

```
1. Nav bar
   - Logo left | Nav links center/right | GitHub star count | "Sign up" CTA button
   - Sticky, height ~60px, blurred backdrop

2. Hero
   - Eyebrow badge: "🔥 You can now try Firecrawl for free..."
   - H1: "Power AI agents with clean web data"
   - Subhead: "The API to search, scrape, and interact with the web at scale. Also open source."
   - Two CTAs: "Start for free" (primary, orange) + "Setup for agents"
   - Right/center: animated JSON/code output widget showing live scrape results cycling
   - Below hero: "Trusted by 150,000+ companies" logo strip with auto-scroll

3. Features section [01/06 — 04/06]
   - Section eyebrow: "// Main Features // Developer First // Start scraping today"
   - Layout: alternating or grid-based feature highlights
   - Each feature: icon/demo widget left, text right (or stacked on mobile)
   - Feature 1 — Search: web search returning full content
   - Feature 2 — Scrape: Markdown/JSON/screenshot output tabs
   - Feature 3 — Interact: action sequence demo (click, scroll, type)
   - Feature 4 — Agent-ready: one-command MCP/CLI setup

4. Performance/Reliability section [02/06]
   - Benchmark callouts: "96% of the web", "P95 latency 3.4s", "93% fewer tokens"
   - Animated latency counter: URL list with ms timers cycling
   - Token efficiency comparison: HTML tree vs clean markdown

5. Use Cases [04/06]
   - Grid of 5–6 use-case cards: Deep research, AI chats, Agent tools, Onboarding, Lead enrichment
   - Each card links to dedicated page
   - Live demo widget embedded in hero area of this section

6. Testimonials [05/06]
   - Auto-scrolling tweet carousel (horizontal)
   - No borders, card-free: just quote text + avatar + handle

7. Pricing section (separate /pricing page, linked from nav)
   - Toggle: Monthly / Yearly
   - 4 tier cards: Free ($0), Hobby ($16/mo), Standard ($83/mo), Growth ($333/mo)
   - "Recommended" badge on Standard tier
   - Credit table below cards

8. FAQ [06/06]
   - Accordion layout, grouped by category (General, API, Billing)

9. Footer
   - 5-column link grid: Products | Use Cases | Documentation | Company | Community
   - YC badge, SOC II badge
   - Copyright + legal links
```

### Key Components

**Nav:**
- Logo + text wordmark left
- Links: Products, Resources, Pricing, Docs, Blog, Playground
- Right: GitHub star count (live, formatted: "133.8K"), "Sign up" button
- Sticky with `backdrop-filter: blur` on scroll — background goes from transparent to surfaced

**Hero layout:**
- Left column: text + CTAs (~50% width)
- Right column: animated code/JSON demo widget (~50% width)
- Floating badge above H1 with hot emoji prefix and orange tint bg
- Dark-mode default (page opens dark)

**Feature cards:**
- Bordered container with subtle inner shadow
- Icon/graphic at top
- Label, title, description copy
- Tab switcher (Python / Node.js / cURL / CLI) for code samples
- Code block: dark bg `#0a0a0a`, `GeistMono` font, syntax highlighted

**CTA buttons:**
- Primary: solid orange (`#fa5d19`), white text, rounded-full or ~8px radius
- Secondary: outline style, `1px solid --border-muted`, neutral text
- Hover: slight brightness shift

**Social proof bar:**
- `[XX / YY]` section numbering used throughout (e.g., `[01 / 06]`)
- Company logos in grayscale strip, auto-marquee scroll
- Tweet cards: borderless, just text + avatar

**Pagination eyebrow pattern:**
```
[01 / 06] · Main Features // Developer First // Start scraping today
```
This is a distinctive design element — numbered section indicator + category breadcrumb.

### Motion

Extracted from `@keyframes` declarations and CSS animation properties:

- **`fade-in-up`**: `opacity: 0 → 1`, `translateY(10px → 0)`, duration `0.5s`, easing `ease-out`.
  Applied to hero text on load.
- **`bounce`**: Standard Tailwind bounce keyframe. Used on scroll-down indicators.
- **`ping`**: `scale(1 → 2)` + `opacity(1 → 0)`. Badge pulse effect (green dot on status).
- **`pulse`**: `opacity: 0.5` at midpoint. Used on loading states in the live demo widget.
- **`snowfall`**: `opacity: 0.7` + `translateY + rotate`. Decorative particle effect.
- **`cursor-blink`**: `opacity: 0 → 1`, 0.7s interval. Blinking cursor in code demos.
- **`spin`**: `rotate(360deg)`. Used on loading spinners.
- **`spin-reverse`**: Reverse spin for animated logo/loader.
- **Auto-scrolling marquee**: Company logos and tweet carousel scroll horizontally via CSS
  `animation` with a translate transform — no JS scroll. Two identical strips placed end-to-end
  for seamless loop.
- **Tab switching**: Instant class swap, no transition visible in static CSS —
  requires browser inspection for exact transition.
- **Live demo widget**: Cycling JSON/code output — JS-driven, not CSS animation.
  Simulates a scrape completing in real-time with highlighted tokens changing.

**Design differentiators vs plain site:**
1. Numbered section pagination `[NN / NN]` gives the page a magazine/editorial feel
2. Brand color used for text selection highlight (orange) — tactile brand reinforcement
3. Layered multi-stop shadow system (7 shadow values on feature cards) creates depth without dark backgrounds
4. Live interactive code widget in hero — not a static screenshot
5. `::selection` and `-webkit-font-smoothing` polish applied globally

---

## Linear.app Teardown

Scraped: 2026-06-17. Source: HTML + CSS chunks from linear.app
(Next.js, styled-components + custom CSS variable system, Inter Variable font).

### Colors

Linear uses a two-mode (light / dark) semantic token system. The homepage defaults to **dark mode**.
All tokens from the largest CSS chunk (`f92ebf3e538fed61.css`).

**Dark mode (default on homepage)**

| Token | Value | Usage |
|---|---|---|
| `--color-bg-primary` | `#08090a` | Main page background — near-black |
| `--color-bg-secondary` | `#1c1c1f` | Raised panels, sidebars |
| `--color-bg-tertiary` | `#232326` | Card backgrounds |
| `--color-bg-quaternary` | `#28282c` | Hover states on cards |
| `--color-bg-marketing` | `#010102` | Hero area — absolute darkest |
| `--color-bg-panel` | `#0f1011` | Modal/overlay backgrounds |
| `--color-border-primary` | `#23252a` | Default dividers |
| `--color-border-secondary` | `#34343a` | Stronger borders |
| `--color-border-tertiary` | `#3e3e44` | Loudest borders |
| `--color-text-primary` | `#f7f8f8` | Headings, key text |
| `--color-text-secondary` | `#d0d6e0` | Body copy |
| `--color-text-tertiary` | `#8a8f98` | Labels, metadata |
| `--color-text-quaternary` | `#62666d` | Placeholders, disabled |
| `--color-link-primary` | `#828fff` | Link color |
| `--color-link-hover` | `#ffffff` | Link hover |
| `--color-accent` | `#7170ff` | Brand purple — CTAs, active states |
| `--color-accent-hover` | `#828fff` | Accent hover |
| `--color-accent-tint` | `#18182f` | Accent background tint |
| `--color-brand-bg` | `#5e6ad2` | Button primary |
| `--color-brand-text` | `#ffffff` | Button text |

**Light mode token overrides** (requires browser inspection for full set — dark is primary)

**Semantic color palette** (from CSS, used in product UI indicators):

| Name | Value | Usage |
|---|---|---|
| `--color-blue` | `#4ea7fc` | Info, link |
| `--color-red` | `#eb5757` | Error, danger |
| `--color-green` | `#27a644` | Success, done status |
| `--color-orange` | `#fc7840` | Warning |
| `--color-yellow` | `#f0bf00` | Caution |
| `--color-indigo` | `#5e6ad2` | Brand / Linear purple |
| `--color-teal` | `#00b8cc` | Feature highlight |

**Gradients used on marketing page:**
```css
/* Purple gradient on feature text */
linear-gradient(285.49deg, #bac0cb -14.61%, #767caf 106.06%)

/* Accent purple sweep */
linear-gradient(92.88deg, #be05ff 9.16%, #a954ff 43.89%, #a771ff 64.72%)

/* Hero fade-out to background */
radial-gradient(52.53% 57.5% at 50% 100%, rgba(8,9,10,0) 0, rgba(8,9,10,.5) 100%),
linear-gradient(180deg, #08090a 10%, var(--color-text-secondary) 100%)
```

### Typography

**Font families** (from CSS `--font-*` vars and `font-family` declarations):

| Role | Family | Fallback |
|---|---|---|
| Primary sans | `Inter Variable` | `SF Pro Display`, `-apple-system`, system sans |
| Display/serif | `Tiempos Headline` | `ui-serif`, Georgia, Times |
| Monospace | `Berkeley Mono` | `ui-monospace`, `SF Mono`, Menlo |
| Emoji | `Apple Color Emoji` | `Segoe UI Emoji`, Noto Color Emoji |

**Type scale** (from `--text-*` CSS vars):

| Scale name | Size | Line height | Letter spacing |
|---|---|---|---|
| `text-large` | `1.0625rem` (17px) | `1.6` | `0` |
| `text-regular` | `0.9375rem` (15px) | `1.6` | `-0.011em` |
| `text-small` | `0.875rem` (14px) | `calc(21/14)` ≈ 1.5 | `-0.013em` |
| `text-mini` | `0.8125rem` (13px) | `1.5` | `-0.01em` |
| `text-micro` | `0.75rem` (12px) | `1.4` | `0` |
| `text-tiny` | `0.625rem` (10px) | `1.5` | `-0.015em` |

**Heading sizes (title scale):** Defined as `--title-5` through `--title-8` vars with responsive
breakpoints at 1024px and 640px — exact px values require browser inspection, but the hero
headline is extremely large (60–80px range, `line-height: 1`).

**Font weights** (from CSS vars):
- `--font-weight-light`: `300`
- `--font-weight-normal`: `400`
- `--font-weight-medium`: `510`
- `--font-weight-semibold`: `590`
- `--font-weight-bold`: `680`

Note: Non-standard weights (510, 590, 680) rely on variable font axes — only works with
`Inter Variable`. Standard weight fallbacks should be 400/500/600/700.

**Letter-spacing pattern:** Negative letter-spacing on body text (`-0.011em`) and especially on
smaller sizes (`-0.013em`) — creates the "optically tight" feel that distinguishes Linear from
typical web typography.

### Page Structure

Linear homepage is a full-screen narrative scroll divided into 5 numbered workflow sections
plus hero, testimonials, and footer.

```
1. Nav bar
   - Logo left | "Product", "Resources", "Customers", "Pricing" links
   - Right: "Contact", "Docs", "Open app" (primary CTA), "Log in", "Sign up"
   - Sticky, transparent then surfaced on scroll

2. Hero
   - Full-viewport height
   - H1: "The product development system for teams and agents"
   - Subhead: "Purpose-built for planning and building products. Designed for the AI era."
   - CTA: "New Coding Sessions →" (inline link, subtle)
   - Right side / below: animated product UI mockup — real-looking app screenshot with
     live-updating content (kanban board, issue list, AI agent activity)
   - The product mockup IS the hero — text is secondary to the UI demo

3. Feature pillars (3 items, card format)
   - "Built for purpose" — shaped by world-class teams
   - "Powered by AI agents" — PRDs to PRs
   - "Designed for speed" — reduce noise, ship fast

4. Workflow sections (5 numbered: 1.0–5.0)
   1.0 Intake → Backlog: AI triage, customer requests auto-converted to issues
   2.0 Plan →: Roadmap, initiatives, visual timeline with Gantt-like view
   3.0 Build →: Issues, agents, MCP, Git automations, Cycles
   4.0 Diffs →: Code review with structural diff viewer
   5.0 Monitor →: Analytics, Pulse weekly summary, Dashboards

   Each section: sticky-scroll reveals content on the right as you scroll.
   Left column: numbered section + sub-nav tabs (e.g., "1.1 Intake", "1.2 Triage")
   Right column: live-looking product UI with animated state changes

5. Testimonials
   - Auto-scrolling carousel (horizontal, no arrows visible)
   - Quote + name + title + company
   - Examples: Gabriel Peal (OpenAI), Nik Koblov (Ramp), Kaz Nejatian (Opendoor)

6. Footer CTA
   - "Built for the future. Available today."
   - "Get started" + "Contact sales" side by side

7. Footer nav
   - 5 columns: Product | Features | Company | Resources | Connect
   - App download links
```

### Key Components

**Nav:**
- Minimal, links only — no mega-menu on homepage
- "Open app" is the sole CTA button — purple brand color, medium weight
- No background until scroll, then `backdrop-filter: blur` + `--color-bg-secondary` tint

**Hero layout:**
- Text left, UI mockup right — classic SaaS hero split
- The mockup is a "fake app" built in HTML/CSS that actually animates: status changes, agent
  activity logs updating, issue counts moving
- Background: `#000212` (near-black with slight blue warmth) + radial gradient fade at bottom

**Workflow cards:**
- Sticky scroll implementation: section label sticks to left, content scrolls into view on right
- Tab row below section number (`1.1 / 1.2 / 1.3 / 1.4`) acts as sub-navigation
- Border-radius: `--radius-8` (8px) on cards, `--radius-16` on larger containers
- Card background: `--color-bg-secondary` or `--color-bg-tertiary`
- 1px border: `--color-border-primary`

**Issue list UI (product mockup):**
- Issue IDs like `ENG-2085`, priorities shown with colored dots
- Status columns: Backlog, Todo, In Progress, Done — each with count badge
- Very compact row height (~36px), monospace-ish ID prefix

**Diff viewer component:**
- Side-by-side code diff with `--` / `++` line indicators
- Red/green color for deletions/additions: `rgba(235,87,87,0.08)` bg tint
- Header row shows filename path

**CTA buttons:**
- Primary: `--color-brand-bg` (#5e6ad2 purple), white text, `--radius-rounded` (pill)
- Invert: `--color-button-invert-bg` (#e5e5e6) — used for secondary actions
- Size: `--min-tap-size: 44px` minimum height

**Easing curves** (from CSS vars, very deliberate motion system):
```css
--ease-out-expo: cubic-bezier(0.19, 1, 0.22, 1)   /* primary panel reveals */
--ease-out-quint: cubic-bezier(0.23, 1, 0.32, 1)   /* hero elements */
--ease-in-quad: cubic-bezier(0.55, 0.085, 0.68, 0.53)
--ease-out-quad: cubic-bezier(0.25, 0.46, 0.45, 0.94)
```

**Transition speeds:**
```css
--speed-quickTransition: 0.1s
--speed-regularTransition: 0.25s
--speed-highlightFadeIn: 0s     /* instant highlight */
--speed-highlightFadeOut: 0.15s /* quick fade out */
```

### Motion

- **Section reveal (scroll-triggered):** Content panels slide in from bottom-right as the user
  scrolls. The sticky left column holds the section number while right content transitions.
  Easing: `ease-out-expo`. Duration: ~0.4–0.6s estimated (exact requires DevTools).

- **Product mockup animation:** Issue statuses update, agent activity logs stream in,
  progress counters increment — all running on a JS interval. Simulates a live Linear workspace.

- **Shimmer sweep:** `@keyframes SlackIssue_shimmerSweep__SLG8B` — `background-position: 150% 0 → 0`.
  Used on skeleton loading states and the product demo streaks.

- **Context menu entry:** `scale(0.9) opacity(0) → scale(1) opacity(1)` on open,
  `scale(1) → scale(0.9)` on close. Duration ~0.15s.

- **Header mobile menu:** `opacity(0) → opacity(1)` with horizontal slide from right.

- **Cursor blink:** `@keyframes Blink_blink` — `visibility: hidden` at 50%. On code panels.

- **Gradient text:** `--utils_gradientText` uses `box-decoration-break: clone` with
  `background-clip: text` + purple gradient. Applied to key product phrases in hero.

- **Auto-scroll carousel (testimonials):** CSS marquee using `animation: scroll linear infinite`.
  Two identical elements create seamless loop — no JS required.

- **Highlight pulse:** `@keyframes Collapsibles_highlight` — flashes
  `background-color: var(--bg)` and `border-color: var(--border)` briefly (20%–80% hold).
  Used to draw attention to newly-created issues or triage items.

---

## Synthesis: What Novada MCP Should Borrow

### 1. Numbered section pagination (Firecrawl)

Pattern: `[01 / 06] · Category // Subcategory // Page title`

Gives pages an editorial, "you are here" feel without a sidebar TOC.
Especially useful on single-page scrollers where sections would otherwise feel disconnected.
Implement as a fixed-position section counter that updates on scroll intersection.

### 2. Hero with live API demo widget (Firecrawl)

Instead of a static screenshot, show a cycling JSON/Markdown output widget that simulates
a real MCP tool call completing. For Novada MCP, this means: an animated panel cycling through
`novada_scrape`, `novada_search`, `novada_extract` outputs with syntax-highlighted results.
This makes the API tangible before the user reads a single word of copy.

### 3. Linear's negative letter-spacing on body text

Setting `letter-spacing: -0.011em` on `text-regular` and tighter on smaller sizes creates the
"expensive product" feel without changing the font. Pair with `Inter Variable` for the same effect.
Easy Tailwind implementation: `tracking-tight` on body, `tracking-tighter` on captions.

### 4. Linear's sticky-scroll workflow sections

For the Novada MCP features section: implement a sticky left column showing the tool name
(e.g., `novada_scrape`, `novada_search`) while the right panel scrolls through demos,
code snippets, and output formats. Each section gets a sub-tab row (`1.1 / 1.2 / 1.3`).
Implementation: `position: sticky; top: Npx` on left column, standard scroll on right.

### 5. Firecrawl's layered shadow + inner shadow cards

Firecrawl's feature cards use 7-stop outer shadows with near-zero opacity values instead of
a single `box-shadow`. This creates physical depth without colored glows.
Add an inner shadow (`inset 0px 6px 12px 0px rgba(0,0,0,0.02)`) on top to simulate a
recessed surface. The result: cards feel three-dimensional even in light mode.

---

*Scraped and synthesized 2026-06-17. CSS values extracted from static build artifacts;
values marked "requires browser inspection" need a live DevTools session on the respective page.*
