---
name: novada-proxy
description: >-
  Choose the right Novada proxy type, format, and targeting options. Covers the
  6 proxy types (residential/isp/mobile/datacenter/static/dedicated), when each
  applies, critical constraints per type, the escalation ladder, and when NOT to
  use proxy tools at all. Trigger: any task requiring geo-targeted HTTP requests,
  IP rotation, or bypassing IP-based rate limits using your own HTTP client.
---

# novada-proxy — Proxy Type Selection Guide

Proxy tools return configuration **for your own HTTP client** (curl, axios, requests, etc.).
They do NOT perform any requests themselves.

> **Critical rule:** `novada_extract`, `novada_crawl`, `novada_scrape`, and `novada_research`
> handle proxy routing internally. Call a proxy tool only when YOU need to make the HTTP
> request — not when a Novada extraction tool does it for you.

---

## The 6 proxy types

| Type | Tool | Best for | Key constraint |
|------|------|----------|----------------|
| **residential** | `novada_proxy_residential` | Anti-bot pages, geo-restricted content | Strongest bypass; city requires country |
| **isp** | `novada_proxy_isp` | Social media, ecommerce, long sessions | `country` param accepted but **silently ignored** (no country targeting on ISP zone) |
| **mobile** | `novada_proxy_mobile` | Mobile-targeted APIs and app content | Pair with a mobile User-Agent for full simulation |
| **datacenter** | `novada_proxy_datacenter` | High-volume, non-protected targets | Fastest and cheapest; blocked by most anti-bot |
| **static** | `novada_proxy_static` | Account-bound workflows, same IP every call | Requires **both** `country` AND `session_id`; uses per-IP credentials from `NOVADA_STATIC_PROXY_LIST` |
| **dedicated** | `novada_proxy_dedicated` | Clean exclusive IP, no contamination risk | Requires `session_id`; uses per-IP credentials from `NOVADA_DEDICATED_PROXY_LIST` |

---

## Type details

### residential
100M+ real home ISP IPs. Strongest anti-bot bypass. Supports country + city geo-targeting.

- `city` requires `country` to be set first
- Supports `session_id` for sticky IP across a multi-step workflow
- Use when: the target blocks datacenter/ISP IPs, or you need a specific city

### isp
ISP-assigned IPs that appear as real home users. Ideal for social and ecommerce platforms.

- **`country` is silently ignored** — the ISP zone does not support country targeting
- Supports `session_id` for sticky routing
- If ISP is blocked, escalate to `residential`

### mobile
4G/5G mobile carrier IPs. Best when a platform serves different content to mobile vs desktop.

- Optional `carrier` param (e.g. `"verizon"`)
- Supports `country` and `session_id`
- Pair with a mobile `User-Agent` header in your HTTP client

### datacenter
Fastest and cheapest. No IP reputation benefit.

- Supports `country` and `session_id`
- Use for: public APIs, high-volume scraping of unprotected targets
- Most anti-bot systems will block these — escalate to `isp` or `residential` if blocked

### static
Dedicated ISP IP that never changes for a given account + country.

- **Requires `country`** (determines the IP pool)
- **Requires `session_id`** (determines which dedicated IP is assigned)
- Uses per-IP credentials, not zone-based routing
- Configure `NOVADA_STATIC_PROXY_LIST` (format: `IP:PORT:USER:PASS` per line)
- `city` is silently dropped — only `country` + `session_id` apply
- Use when: a platform flags IP changes as suspicious (account logins, checkout flows)

### dedicated
Exclusive datacenter IP not shared with any other user. Clean reputation, zero contamination.

- **Requires `session_id`** (determines your exclusive IP)
- Does NOT support `country` targeting
- Uses per-IP credentials from `NOVADA_DEDICATED_PROXY_LIST` (same format as static)
- `city` is silently dropped

---

## Escalation ladder (when blocked)

```
datacenter → isp → residential
```

Start with the cheapest that might work; escalate when you get blocked or rate-limited.
Mobile sits between isp and residential for mobile-targeted platforms.

---

## Format choice

All proxy tools accept a `format` param:

| Format | Output | Best when |
|--------|--------|-----------|
| `url` (default) | Proxy URL string | Node.js, Python, any HTTP client that takes a URL |
| `env` | Shell `export` commands | Shell scripts, setting up a terminal session |
| `curl` | `--proxy` flag snippet | Quick one-off curl commands |

---

## When NOT to use proxy tools

- **`novada_extract`** — handles proxying internally; do not add a proxy on top
- **`novada_crawl`** — handles proxying internally
- **`novada_scrape`** — handles proxying internally
- **`novada_research`** — handles proxying internally

Use proxy tools only when **your own HTTP client** needs to route through a Novada IP.

---

## Quick call patterns

```json
// Residential, US, sticky session
{
  "type": "residential",
  "country": "us",
  "session_id": "my-workflow-1",
  "format": "url"
}

// ISP, shell setup (country ignored on ISP zone)
{
  "type": "isp",
  "session_id": "social-session",
  "format": "env"
}

// Static, requires country + session_id
{
  "type": "static",
  "country": "gb",
  "session_id": "account-login-1",
  "format": "curl"
}
```
