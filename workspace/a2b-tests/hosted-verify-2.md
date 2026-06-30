# Hosted MCP Verification: INC-194 to INC-197

Date: 2026-06-26T14:29Z
Source: local build (`~/Projects/novada-mcp/build/`)
API Key: `1f35...adfa`

## Results

| INC | Title | Status | Detail |
|-----|-------|--------|--------|
| INC-194 | Setup key display consistency | PASS | Key masked as `1f35...adfa` in setup output. Effective key logic uses `NOVADA_DEVELOPER_API_KEY ?? NOVADA_API_KEY`. |
| INC-195 | Health vs health_all hosted detection | PASS | LOCAL: both show "Not configured -- set NOVADA_BROWSER_WS". HOSTED (VERCEL=1): both show "Not available on hosted -- requires WebSocket transport." Consistent across both tools. |
| INC-196 | Verify self-contradiction | PASS | With inactive Search API, returns "Verify Unavailable" + clear fix instructions instead of fabricating contradicting "0" counts. No self-contradiction. |
| INC-197 | Proxy error format (env missing) | PASS | Returns friendly markdown (`## Proxy Configuration / status: not configured`) with actionable fix steps instead of throwing an unhandled error. |

## INC-194 Detail

Setup output key lines:
```
NOVADA_API_KEY              1f35...adfa  -- covers search, extract, crawl, research...
Unified API Key: NOVADA_API_KEY covers search, extract, research, crawl, scrape...
```

Key masking: first 4 + last 4 chars shown, consistent format.

## INC-195 Detail

### Local environment (no VERCEL env)
- `health` browser line: `Browser API | Not configured -- set NOVADA_BROWSER_WS env var`
- `health_all` browser line: `Browser API | Not configured | Set NOVADA_BROWSER_WS (wss://user:pass@host format)`

### Hosted environment (VERCEL=1)
- `health` browser line: `Browser API | Not configured -- Not available on hosted -- requires WebSocket transport. Use local MCP server for browser features.`
- `health_all` browser line: `Browser API | Not configured | Not available on hosted -- requires WebSocket transport not supported on Vercel Edge/Lambda. Use local MCP server.`

Both tools correctly detect hosted vs local and adjust messaging. No false "set env var" advice on hosted.

## INC-196 Detail

With Search API not activated on this key, verify returns:
```
## Verify Unavailable

Search returned 0 results for all 3 queries. Scraper API (search) is not activated on this account.

Verdict cannot be determined -- this is a service activation issue, not genuine ambiguity about the claim.

Fix: Activate Scraper API at https://dashboard.novada.com/overview/scraper/
```

No contradicting-sources bug (old behavior: would show "Contradicting Sources: 0" alongside contradicting evidence).

## INC-197 Detail

With proxy env vars unset, `novadaProxyResidential({format:'url'})` returns:
```
## Proxy Configuration
status: not configured

Proxy credentials could not be resolved. Either:
- Set NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT...
```

Friendly markdown output with actionable instructions, not a thrown error.

## Summary

4/4 INC fixes verified. All produce correct, agent-friendly output.
