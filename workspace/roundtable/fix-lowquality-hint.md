# Fix: Low-Quality Extract agent_instruction

## Status: DONE — tsc clean

## What was changed

File: `/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts`

### Change 1 — Agent Hints section (~line 760)

Added a simple hint line triggered when `qLabel === "low" && usedMode === "static" && renderMode === "auto"`:

```
- Low quality on static mode — try with render="render" for JS-heavy or anti-bot protected pages.
```

### Change 2 — Agent Action block (~line 781)

Added a new branch before the existing `else` clause:

```
else if (quality.score < 30 && usedMode === "static" && renderMode === "auto")
```

This emits the full structured agent_instruction:

```
status:low_quality | content_ok:false | suggested_fix: retry with render="render" for JS-heavy or
bot-protected pages. If render also returns low quality, try render="browser". For sites like
airbnb.com/booking.com, also ensure NOVADA_PROXY_ENDPOINT is set for residential IP routing.
```

## Why these conditions

- `quality.score < 30`: Score 5/100 (Airbnb case) clearly falls here. The existing auto-escalation
  fires at < 40, but if render doesn't beat static's score the usedMode stays "static". At < 30
  the content is garbage — the agent needs explicit escalation guidance.
- `usedMode === "static"`: Ensures we only fire when no escalation succeeded. If render or browser
  already ran and improved the score, usedMode would be "render" or "browser".
- `renderMode === "auto"`: This is the common default. If user already passed render="render"
  explicitly, they know what they're doing — don't repeat the same suggestion.

## What the Airbnb case looks like after fix

Before:
```
## Agent Action
agent_instruction: status:low_quality quality:5/100 | fix: retry with render="render" | alt: novada_scrape for platform data
```

After:
```
## Agent Hints
- Low quality on static mode — try with render="render" for JS-heavy or anti-bot protected pages.

## Agent Action
agent_instruction: status:low_quality | content_ok:false | suggested_fix: retry with render="render" for JS-heavy or bot-protected pages. If render also returns low quality, try render="browser". For sites like airbnb.com/booking.com, also ensure NOVADA_PROXY_ENDPOINT is set for residential IP routing.
```

## tsc result

```
(no output — clean)
```
