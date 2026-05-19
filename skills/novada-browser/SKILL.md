# novada_browser — Cloud Browser Automation Skill

**When to use:** Interactive flows requiring clicks, form fills, login, or chaining multiple page interactions.

**Requires:** NOVADA_BROWSER_WS environment variable.

## Action reference

| Action | Required params | Use case |
|--------|----------------|----------|
| navigate | url, wait_until | Go to URL |
| click | selector | Click element |
| type | selector, text | Type into input |
| screenshot | — | Capture visual |
| aria_snapshot | — | Get ARIA tree (structural, token-efficient) |
| evaluate | script | Run JS in page context |
| wait | selector?, timeout | Wait for element or time |
| scroll | direction | Scroll page |
| hover | selector | Hover over element |
| press_key | key, selector? | Press keyboard key |
| select | selector, value | Choose dropdown option |
| close_session | — | Release session resources |

## Chaining actions (max 20 per call)

```json
{
  "actions": [
    {"action": "navigate", "url": "https://example.com/login", "wait_until": "domcontentloaded"},
    {"action": "type", "selector": "#email", "text": "user@example.com"},
    {"action": "type", "selector": "#password", "text": "secret"},
    {"action": "click", "selector": "button[type=submit]"},
    {"action": "wait", "selector": ".dashboard", "timeout": 10000},
    {"action": "aria_snapshot"}
  ]
}
```

## Session management

Use session_id to maintain state across calls:
```json
// First call — establishes login session
{"actions": [...login actions...], "session_id": "my-session-1"}

// Second call — reuses cookies/state
{"actions": [{"action": "navigate", "url": "https://example.com/data"}, {"action": "aria_snapshot"}], "session_id": "my-session-1"}
```

Sessions expire after 10 min of inactivity. Call `close_session` to release early.

## Key rules

- Use `wait_until: "domcontentloaded"` — NEVER `networkidle` for SPAs (TikTok, X, React apps never reach networkidle → 30s timeout)
- Prefer `aria_snapshot` over `screenshot` — 10x more token-efficient, parseable by agents
- For geo-restricted sites (TikTok): pass `country: "us"` at top level

## Common patterns

**Get ARIA structure of a page:**
```json
{"actions": [{"action": "navigate", "url": "..."}, {"action": "aria_snapshot"}]}
```

**Take a screenshot:**
```json
{"actions": [{"action": "navigate", "url": "..."}, {"action": "screenshot"}]}
```

**Execute JS and extract data:**
```json
{"actions": [
  {"action": "navigate", "url": "..."},
  {"action": "evaluate", "script": "return document.querySelectorAll('.price').length"}
]}
```
