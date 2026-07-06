# Loop 1 - W1: Turndown Integration

## Status: DONE

## Changes Made

### File: `src/utils/html.ts`

**1. Turndown + GFM import and configured instance (top of file)**
- Added `import TurndownService from "turndown"` and `import { gfm } from "turndown-plugin-gfm"`
- Created shared `turndown` instance with atx headings, fenced code blocks, `-` bullets
- Created `htmlToMarkdown(html)` wrapper function
- Removed unused `detectJsHeavyContent` import (still used in extract.ts)

**2. `extractMainContent` -- replaced hand-written walker**
- Removed: `escapeMarkdown()`, `inlineMarkdown()` (174 lines of recursive walker)
- Removed: manual heading/list/blockquote/pre/table rendering logic
- Replaced with: `htmlToMarkdown($.html($content))` (3 lines)
- Kept: all cheerio boilerplate removal, content selection, density scoring, truncation logic

**3. `extractFullPageContent` -- replaced hand-written walker**
- Removed: duplicate `escapeMarkdown()`, `inlineMarkdown()`, block-walker, table handler
- Replaced with: `htmlToMarkdown($.html($body))` (3 lines)
- Kept: non-renderable tag removal, comment removal

**4. `scoreExtraction` -- three fixes**
- Reduced `structured_data` bonus from +20 to +10 (was overweighted)
- Removed -40 `bot_challenge` penalty for `detectJsHeavyContent` (unfairly penalized all React/Next.js/Vue SPA pages via `id="root"` detection)
- Added quality floor: if content > 20,000 chars, minimum score = 50

### File: `src/turndown-plugin-gfm.d.ts` (NEW)
- Type declarations for `turndown-plugin-gfm` (no `@types/` package exists on npm)

### Dev dependency added
- `@types/turndown@5.0.6`

## Lines removed vs added
- Removed: ~280 lines of hand-written walker code (two copies of inlineMarkdown + escapeMarkdown + block-level + table rendering)
- Added: ~20 lines (imports, turndown config, htmlToMarkdown wrapper, type declarations)
- Net: ~260 lines removed

## Verification
- `npx tsc --noEmit` -- clean, zero errors

## What Turndown handles automatically
- Headings (h1-h6 -> atx style)
- Links (a -> [text](url))
- Emphasis (strong/b -> **, em/i -> *)
- Code (inline backticks + fenced blocks with language hints)
- Images (img -> ![alt](src))
- Lists (ul/ol -> -/1. with nesting)
- Blockquotes (blockquote -> >)
- Tables (GFM plugin: full pipe-table rendering)
- Strikethrough (GFM plugin: del -> ~~text~~)
- Task lists (GFM plugin: checkbox lists)
