# Account Management & Advanced

## Account Management Tools

All account tools authenticate via `NOVADA_DEVELOPER_API_KEY` (falls back to `NOVADA_API_KEY`).

| Tool | Description | Key Params |
|------|-------------|------------|
| `novada_account_summary` | Single-call dashboard. Runs wallet + plan balances + capture logs in parallel, returns unified headline + per-section detail. | -- |
| `novada_wallet_balance` | Read master wallet balance (currency credit). | -- |
| `novada_wallet_usage_record` | Paginated wallet transaction / usage history. | `page`, `page_size` (max 200), `start_time`/`end_time` (YYYY-MM-DD) |
| `novada_plan_balance_all` | Per-product quota balance across 6 products (residential/isp/mobile/datacenter/static/capture) in parallel. | `products` (optional subset) |
| `novada_traffic_daily` | Aggregate daily traffic consumption across 5 proxy products in parallel. | `start_time`/`end_time` (YYYY-MM-DD), `products` (optional subset) |
| `novada_capture_logs` | Paginated capture-task logs for auditing and debugging. | `page`, `page_size` (max 200), `status` (success/failed/all), `start_time`/`end_time` |

### Proxy Sub-Account Management

| Tool | Description | Key Params |
|------|-------------|------------|
| `novada_proxy_account_create` | Create a proxy sub-account. **WRITE** -- two-step confirm gate. Without `confirm: true`, returns a dry-run preview. | `product` (1=Residential, 2=ISP, 3=Datacenter, 4=Unlimited, 7=Unblocker, 9=Mobile), `account`, `password`, `confirm` |
| `novada_proxy_account_list` | List proxy sub-accounts. | `product` (required), `page`, `limit` (max 200), `status`, `account` |
| `novada_ip_whitelist` | Manage IP whitelist for proxy products. Supports add/list/delete/remark via `action` discriminator. | `action` (add/list/del/remark), `product` (1=Residential, 4=Unlimited, 5=Static ISP), `confirm` for writes |

### Write Safety Gate

`novada_proxy_account_create` and `novada_ip_whitelist` (actions `add` and `del`) are gated by a two-step confirmation:

1. Call without `confirm` -- returns a `confirmation_required` preview with masked credentials.
2. Show the preview to the human user.
3. Re-call with the same parameters plus `confirm: true` only after explicit approval.

Agents must never set `confirm: true` without human consent.

### Choosing the Right Balance Tool

| Question | Tool |
|----------|------|
| "How much credit do I have?" | `novada_wallet_balance` |
| "Do I have quota left on residential/mobile/...?" | `novada_plan_balance_all` |
| "How much traffic did I use this week?" | `novada_traffic_daily` |
| "Give me a full account snapshot" | `novada_account_summary` |
| "What did I spend money on?" | `novada_wallet_usage_record` |

---

## Advanced Features

### Discovery & Diagnostics

| Tool | Description | Auth Required |
|------|-------------|---------------|
| `novada_setup` | Environment diagnostics with step-by-step setup instructions. Returns status of all env vars and config snippets for Claude Code / Cursor / VS Code / Windsurf. | No |
| `novada_discover` | List all available tools with name, category, and status (active/todo). Filter by category. | Yes |
| `novada_health` | Quick check: which Novada products are active on your API key. Returns status table for 5 products. | Yes |
| `novada_health_all` | Extended health check: tests all 6 product endpoints in parallel. Returns per-product latency, status, and activation links for inactive products. | Yes |

**Recommended startup sequence for agents:**

```
1. novada_setup          -- verify env vars are configured
2. novada_health_all     -- confirm which products are reachable
3. novada_discover       -- see full tool catalog
```

### AI Brand Monitoring

| Tool | Description | Key Params |
|------|-------------|------------|
| `novada_ai_monitor` | Check how AI models (ChatGPT, Perplexity, Grok, Claude, Gemini) reference a brand or product. Returns per-model sentiment, key claims, competitor mentions, source URLs. | `brand` (required), `models` (default: chatgpt, perplexity, grok), `topics` (optional filter) |

Use cases:
- Track how AI search engines recommend your product vs competitors.
- Detect inaccurate claims about your brand across AI platforms.
- Monitor competitive positioning in AI-generated responses.

### Tool Filtering

Reduce tool count by exposing only the categories you need:

```bash
# Individual tools
NOVADA_TOOLS="extract,search,crawl"

# Category bundles
NOVADA_GROUPS="search,proxy"

# Both set = union
NOVADA_TOOLS="extract" NOVADA_GROUPS="account"
```

Available group bundles:

| Group | Tools Included |
|-------|---------------|
| `search` | search, extract, crawl, map, research, verify, ai_monitor, monitor |
| `proxy` | proxy, proxy_residential, proxy_isp, proxy_datacenter, proxy_mobile, proxy_static, proxy_dedicated |
| `browser` | browser, browser_flow |
| `scraper` | scrape, scraper_submit, scraper_status, scraper_result |
| `health` | health, health_all, discover, setup |
| `account` | wallet_balance, wallet_usage_record, proxy_account_create, proxy_account_list, traffic_daily, plan_balance_all, capture_logs, account_summary, ip_whitelist |

`novada_health` and `novada_setup` are always included regardless of filter, so agents can diagnose issues.

---

## Output Pipeline

All tools that produce structured results can save output to the local filesystem.

**Directory structure:**

```
~/Downloads/novada-mcp/
  2026-06-23/
    scrape_amazon_com_143052001.json
    extract_example_com_143055123.md
    search_react_hooks_143100456.csv
```

**Naming convention:** `{tool}_{domain_or_hint}_{HHmmssSSS}.{format}`

**Supported formats:**

| Format | Extension | Content |
|--------|-----------|---------|
| JSON | `.json` | Pretty-printed with 2-space indent |
| CSV | `.csv` | Auto-generated headers from all record keys, proper escaping |
| Markdown | `.md` | Raw text or stringified JSON |

The output directory is created automatically on first write. Each day gets its own subdirectory (`YYYY-MM-DD`).
