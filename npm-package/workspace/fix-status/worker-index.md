# worker-index fix status

## INC-168 — Remove ghost params from novada_unblock

DONE. Removed the following line from the `novada_unblock` description in `src/index.ts`:

> `**Note:** wait_ms, block_resources, auto_runs are accepted but not yet implemented — they have no effect in the current version.`

Note: `wait_ms`, `block_resources`, `auto_runs` params are defined in `UnblockParamsSchema` (in `src/tools/types.ts`) which is outside this worker's scope. Only the description text was removed per instructions.

## INC-169 — Fix "129 platforms" contradiction

DONE. Changed all 3 platform-count "129" occurrences in `src/index.ts`:

| Location | Before | After |
|---|---|---|
| `novada_scrape` description (line ~214) | `Supports 129 platforms` | `Supports 13 platforms (~78 operations)` |
| `novada_scraper_submit` description (line ~407) | `For 129 supported platforms` | `For 13 active platforms` |
| `--help` CLI text (line ~963) | `Structured data from 129 platforms` | `Structured data from 13 active platforms (~78 operations, e.g. Amazon, TikTok)` |

## tsc result

`npx tsc --noEmit` — clean, no errors.
