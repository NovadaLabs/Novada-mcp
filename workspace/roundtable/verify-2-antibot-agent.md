# verify-2-antibot-agent.md
Agent: Sonnet 4.6 (fresh, no prior context)
Date: 2026-06-23

---

## Descriptions read

### novada_extract (lines 160-168)
```
Extract clean content from any URL. Handles Cloudflare, DataDome, Kasada automatically
via auto-escalation (static → JS render → Browser CDP).

Use for: Reading pages, batch-extracting search results, pulling structured fields.
Works on anti-bot pages automatically.
Key rule: Leave render="auto" (default).
```

### novada_proxy_residential (lines 237-245)
```
Route requests through residential IPs — real home ISP addresses from a 100M+ IP pool.
Best anti-bot bypass for geo-restricted or protected pages.

Not for: novada_extract or novada_crawl — they handle proxy routing internally.
Requires: NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars.
```

### Server description (line 648)
```
Novada MCP — unified web data API. ONE API KEY (NOVADA_API_KEY) covers all products:
search, extract, research, crawl, scrape, unblock, and proxy auto-provisioning.
Optional: NOVADA_BROWSER_WS for browser automation, NOVADA_PROXY_ENDPOINT for proxy routing.
Call novada_health_all() to verify which products are active.
```

---

## Q&A from descriptions alone

### 1. Would I know to use residential proxy for airbnb.com?

No. `novada_extract` says it "handles Cloudflare, DataDome, Kasada automatically" and "works on anti-bot pages automatically." An agent reading only the extract description has no reason to reach for `novada_proxy_residential` first — the extract tool claims to handle anti-bot natively. The proxy description even reinforces this with an explicit "Not for: novada_extract — they handle proxy routing internally."

The only signal that airbnb might need something special is the tool's own quality output (`quality:5/100, content_ok:false` in the actual result), but that feedback is only visible after the call, not from the description.

**Verdict: No, an agent would not know to use residential proxy upfront. It would try novada_extract first.**

### 2. Would I know the proxy is auto-provisioned from NOVADA_API_KEY?

Partially. The server description mentions "proxy auto-provisioning" as part of what NOVADA_API_KEY covers. However, `novada_proxy_residential` explicitly lists "Requires: NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars" — which directly contradicts the auto-provisioning claim for that specific tool. An agent reading both would be confused: the server says one key is enough; the tool says three credentials are required.

**Verdict: Uncertain. The server description hints at auto-provisioning but the tool description says separate credentials are required. An agent would not confidently assume auto-provisioning.**

### 3. Would I assume separate NOVADA_PROXY_USER/PASS credentials are needed?

Yes. `novada_proxy_residential` explicitly lists `NOVADA_PROXY_USER`, `NOVADA_PROXY_PASS`, `NOVADA_PROXY_ENDPOINT` under "Requires." This is the only hard requirement statement in that tool's description. An agent following tool descriptions literally would assume these three env vars are mandatory, separate from NOVADA_API_KEY.

**Verdict: Yes, agent would assume separate credentials are required.**

### 4. What would my first tool call be?

```
novada_extract(url="https://www.airbnb.com/", render="auto", format="markdown")
```

Rationale: The extract description says it handles anti-bot automatically. The proxy tool explicitly says "Not for: novada_extract." There is no signal in the descriptions to skip straight to proxy. The agent would call extract first, observe the low quality result, then consider escalation.

---

## Pipeline verification

Command run:
```bash
cd /Users/tongwu/Projects/novada-mcp && \
  NOVADA_WEB_UNBLOCKER_KEY=b27ad6e6834dd36407b00f4e502e055e \
  NOVADA_PROXY_ENDPOINT=1b9b0a2b9011e022.vtv.na.novada.pro:7777 \
  NOVADA_PROXY_USER=tongwu_TRDI7X \
  NOVADA_PROXY_PASS=_Asd1644asd_ \
  NOVADA_API_KEY=$NOVADA_API_KEY \
  node -e "const {novadaExtract}=require('./build/tools/extract.js'); \
    novadaExtract({url:'https://www.airbnb.com/',render:'auto',format:'markdown',max_chars:300}, \
    process.env.NOVADA_API_KEY).then(r=>console.log(r.slice(0,300)))"
```

Output:
```
## Extracted Content
url: https://www.airbnb.com/
mode: render | source: live | quality:5/100 (low) | content_ok:false
fetched_at: 2026-06-23T12:57:43.673Z
extraction_quality: n/a
title: Airbnb: Vacation Rentals, Cabins, Beach Houses, Unique Homes & Experiences
description: Get an Airbnb for every k...
```

Pipeline runs. The function is callable and returns output. However:
- `quality: 5/100 (low)` — render mode hit Airbnb but extracted minimal content
- `content_ok: false` — signals the extraction did not produce usable body content
- Title and meta description were captured (from HTML `<head>`), but page body was not

This is the exact failure mode an agent would encounter without explicit guidance to escalate to residential proxy or `render="render"` mode for this domain.

---

## DX gap identified

The description chain creates an incorrect mental model for anti-bot sites:

1. Agent reads `novada_extract`: "handles anti-bot automatically" → tries it
2. Gets `quality:5/100, content_ok:false` → knows it failed but does not know why or what to try next
3. Reads `novada_proxy_residential`: "Not for novada_extract" → ruled out
4. No description tells the agent: "when extract quality is low on known anti-bot sites, retry with render='render' + residential proxy pre-fetch"

The auto-escalation claim in `novada_extract` is misleading for Airbnb-class sites. "Works on anti-bot pages automatically" does not hold here. The description should either:
- Qualify the claim ("handles most anti-bot pages; for heavy bot detection like Airbnb, set render='render'")
- Or add an `agent_instruction` in the low-quality response directing the agent to the next escalation step

Current state: agent is left guessing after the first failure.
