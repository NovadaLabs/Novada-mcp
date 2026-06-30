# Proxy & Browser Tools

Novada provides 6 proxy types for routing your own HTTP requests, plus 2 browser automation tools for interactive page workflows.

> These tools return proxy credentials and browser session handles for **your own HTTP clients** (curl, requests, axios). They do not fetch pages themselves. For page extraction, use `novada_extract` or `novada_crawl` — they handle proxy routing internally.

---

## Proxy Tools — Quick Reference

| Tool | Zone | IP Source | Anti-Bot Strength | Geo-Targeting | Sticky Session | Required Params |
|------|------|-----------|-------------------|---------------|----------------|-----------------|
| `novada_proxy_residential` | `zone-res` | 100M+ real home ISP IPs | Strongest | country, city | session_id | format |
| `novada_proxy_isp` | `zone-isp` | ISP-assigned IPs | Strong | n/a (ignored) | session_id | format |
| `novada_proxy_mobile` | `zone-mob` | 4G/5G cellular IPs | Strong | country, carrier | session_id | format |
| `novada_proxy_datacenter` | `zone-dcp` | Datacenter IPs | Weak | country | session_id | format |
| `novada_proxy_static` | per-IP creds | Dedicated static ISP IP | Strong | country (required) | session_id (required) | country, session_id, format |
| `novada_proxy_dedicated` | per-IP creds | Exclusive datacenter IP | Medium | n/a | session_id (required) | session_id, format |

### Escalation Path

When a proxy type gets blocked, escalate upward:

```
datacenter → isp → residential → mobile
  (fastest)                        (strongest)
```

---

## Proxy Type Details

### novada_proxy_residential

Real home ISP addresses from a 100M+ IP pool. Best anti-bot bypass for geo-restricted or protected pages.

**When to use:** Anti-bot protected pages, geo-restricted content, platforms that block datacenter IPs.

**Parameters:**
- `country` — ISO 2-letter code (e.g. `us`, `gb`, `de`). Optional.
- `city` — City-level targeting (e.g. `london`, `new-york`). Requires `country`.
- `session_id` — Same ID = same IP across requests. Optional.
- `format` — `url` (default), `env`, or `curl`.

**Example output (`format: "url"`):**
```
## Residential Proxy Configuration
zone: residential
targeting: US / new-york
session: my-session (sticky IP)
proxy_url: http://user-zone-res-region-us-city-newyork-session-my-session:***@proxy.novada.com:7777
```

---

### novada_proxy_isp

ISP-assigned IPs that look like genuine home users. Ideal for social media and ecommerce platforms.

**When to use:** Social media scraping, ecommerce platforms, any site that distinguishes home users from datacenter IPs.

**Parameters:**
- `country` — Accepted by schema but **has no effect on the backend**. Use `novada_proxy_residential` for geo-targeting.
- `session_id` — Sticky IP routing. Optional.
- `format` — `url`, `env`, or `curl`.

---

### novada_proxy_mobile

4G/5G IPs from real mobile devices on cellular networks.

**When to use:** Mobile-targeted content, app APIs, platforms that serve different content to mobile vs desktop.

**Parameters:**
- `country` — ISO 2-letter code. Optional.
- `carrier` — Carrier-level targeting (e.g. `verizon`, `att`, `t-mobile`). Optional.
- `session_id` — Sticky IP routing. Optional.
- `format` — `url`, `env`, or `curl`.

**Tip:** Pair with a mobile User-Agent header for full mobile simulation.

---

### novada_proxy_datacenter

Fastest and most cost-effective. Best for high-volume scraping of non-protected targets.

**When to use:** APIs, public data feeds, high-volume scraping without aggressive anti-bot.

**Parameters:**
- `country` — ISO 2-letter code. Optional.
- `session_id` — Sticky IP routing. Optional.
- `format` — `url`, `env`, or `curl`.

**Limitation:** Datacenter IPs are detectable by advanced bot-protection systems. Escalate to ISP or residential if blocked.

---

### novada_proxy_static

A dedicated static ISP IP that never changes for a given `session_id` + `country` pair.

**When to use:** Account management, login-dependent workflows, platforms that flag IP changes as suspicious.

**Parameters:**
- `country` — **Required.** Each country has a distinct pool of dedicated IPs.
- `session_id` — **Required.** Determines which dedicated IP is assigned.
- `format` — `url`, `env`, or `curl`.

**Setup:** Static proxies use per-IP credentials (not zone-based routing). Purchase IPs at `dashboard.novada.com/overview/proxies/` and set `NOVADA_STATIC_PROXY_LIST` env var with format `IP:PORT:USER:PASS` (one per line).

---

### novada_proxy_dedicated

An exclusive datacenter IP not shared with any other user. Clean reputation, zero contamination risk.

**When to use:** High-trust platforms, workflows needing a pristine IP with no negative history.

**Parameters:**
- `session_id` — **Required.** Maps to your exclusive dedicated IP.
- `format` — `url`, `env`, or `curl`.

**Setup:** Like static proxies, dedicated proxies use per-IP credentials. Set `NOVADA_DEDICATED_PROXY_LIST` env var with format `IP:PORT:USER:PASS` (one per line).

---

## Output Formats

All 6 proxy tools support 3 output formats:

| Format | Returns | Use Case |
|--------|---------|----------|
| `url` | Proxy URL + Node.js/Python usage examples | Programmatic HTTP clients |
| `env` | Shell `export` commands for `HTTP_PROXY`/`HTTPS_PROXY` | Terminal sessions, shell scripts |
| `curl` | `curl --proxy` flag ready to paste | Quick CLI testing |

**Password masking:** All outputs show `***` in place of the password. The agent reads `NOVADA_PROXY_PASS` from the environment at runtime.

---

## Auto-Provisioning

Zone-based proxies (residential, ISP, mobile, datacenter) support automatic credential resolution:

```
Priority 1: Explicit env vars
  NOVADA_PROXY_USER + NOVADA_PROXY_PASS + NOVADA_PROXY_ENDPOINT → no API call needed

Priority 2: Auto-fetch via NOVADA_API_KEY
  NOVADA_PROXY_ENDPOINT set but user/pass missing →
  fetches first active sub-account from POST /v1/proxy_account/list
  using NOVADA_API_KEY as Bearer token. Cached 6 hours.
```

**Minimum config for zone-based proxies:**
```json
{
  "env": {
    "NOVADA_API_KEY": "your-api-key",
    "NOVADA_PROXY_ENDPOINT": "proxy-host:port"
  }
}
```

User/pass are fetched automatically from your account's first active proxy sub-account.

**For static and dedicated proxies:** These require per-IP credentials. Set `NOVADA_STATIC_PROXY_LIST` or `NOVADA_DEDICATED_PROXY_LIST` manually.

---

## Proxy Account Management

Two additional tools manage proxy sub-accounts via the Developer API:

| Tool | Action | Key Detail |
|------|--------|------------|
| `novada_proxy_account_list` | List sub-accounts | Requires `product` code (1=Residential, 2=ISP, 3=Datacenter, 4=Unlimited, 7=Unblocker, 9=Mobile) |
| `novada_proxy_account_create` | Create sub-account | **Write operation** with 2-step confirm gate. Without `confirm: true`, returns a dry-run preview only. |

---

## Browser Tools

Two tools provide cloud browser automation via Novada's Browser API. Both require the `NOVADA_BROWSER_WS` environment variable.

### novada_browser

Full browser automation via CDP (Chrome DevTools Protocol) WebSocket. Connects to Novada's cloud Chromium instance using `playwright-core`.

**Actions supported (up to 20 per call):**
- `navigate` — Go to URL. Supports `wait_until`: `load`, `domcontentloaded` (default), `networkidle`.
- `click` — Click a CSS selector.
- `type` — Fill text into a CSS selector.
- `screenshot` — Full-page screenshot (returns base64 PNG).
- `snapshot` — Raw HTML of current page (truncated at 30K chars).
- `aria_snapshot` — Accessibility tree as YAML. ~70% smaller than HTML, semantic selectors.
- `evaluate` — Execute arbitrary JavaScript.
- `wait` — Wait for a CSS selector or a fixed delay.
- `scroll` — Scroll `up`, `down`, `top`, or `bottom`.
- `hover` — Hover over a CSS selector.
- `press_key` — Press a keyboard key (e.g. `Enter`, `Tab`, `Escape`).
- `select` — Select option in a `<select>` element.
- `close_session` — Release a named session (must be only action in call).
- `list_sessions` — List active session IDs (must be only action in call).

**Session management:**
- Pass `session_id` to reuse the same browser page across calls. Preserves cookies, localStorage, login state.
- Warm reuse: ~1.5s. Cold start: ~8s.
- Sessions expire after 10 minutes of inactivity.

**Parameters:**
- `actions` — Array of actions (1-20).
- `timeout` — Total timeout in ms (default 60000, max 120000).
- `session_id` — Optional. Sticky session for multi-call flows.
- `country` — ISO 2-letter code for browser exit node geo-targeting.

**Example:**
```json
{
  "actions": [
    { "action": "navigate", "url": "https://example.com", "wait_until": "domcontentloaded" },
    { "action": "click", "selector": "#login-button" },
    { "action": "type", "selector": "#email", "text": "user@example.com" },
    { "action": "screenshot" }
  ],
  "timeout": 60000,
  "session_id": "login-flow-1"
}
```

---

### novada_browser_flow

Multi-step browser automation via Novada's REST API (`POST /v1/browser_flow/browser_flow_use`). Simpler action set, server-side execution.

**Actions supported (up to 20 per call):**
- `click` — CSS selector.
- `scroll` — `up` or `down`.
- `wait` — Fixed delay.
- `type` — Fill text into CSS selector.
- `screenshot` — Capture page.

**Parameters:**
- `url` — **Required.** Page to open.
- `actions` — Array of actions (1-20).
- `country` — ISO 2-letter code. Optional.
- `session_id` — Sticky session. Optional.

**Key difference from `novada_browser`:**
- `novada_browser` uses CDP WebSocket directly — more action types, richer error detail, requires `playwright-core`.
- `novada_browser_flow` uses a REST API — simpler setup (no playwright dependency), but fewer action types.
- If `novada_browser_flow` fails, fall back to `novada_browser`.

---

## Browser Setup

```json
{
  "env": {
    "NOVADA_API_KEY": "your-api-key",
    "NOVADA_BROWSER_WS": "wss://username:password@upg-scbr2.novada.com"
  }
}
```

- `NOVADA_API_KEY` — Required for `novada_browser_flow` (REST API auth).
- `NOVADA_BROWSER_WS` — Required for `novada_browser` (CDP connection). Get credentials at `dashboard.novada.com/overview/browser/`. Format: `wss://user:pass@host`.

**SPA tip:** Use `wait_until: "domcontentloaded"` (default) for React, X/Twitter, TikTok. Never use `"networkidle"` for SPAs — they continuously poll and will timeout at 30s.

**Geo-restrictions:** TikTok is banned in some regions. Pass `country: "us"` for geo-restricted platforms.

---

## When to Use What

| Goal | Tool |
|------|------|
| Extract content from a URL | `novada_extract` (proxies handled internally) |
| Route your own HTTP requests through a proxy | `novada_proxy_*` |
| Interactive browser automation (click, type, login) | `novada_browser` |
| Simple multi-step browser flow without playwright | `novada_browser_flow` |
| Render JS-heavy page and get raw HTML | `novada_unblock` |
