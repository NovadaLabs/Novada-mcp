# Firecrawl Anti-Bot Research

**Date:** 2026-06-24
**Researcher:** competitive research agent

---

## Executive Summary

Firecrawl's claimed "100% anti-bot success" is marketing copy. The **actual measured success rate on heavily protected sites is 33.69%** (Proxyway late-2025 benchmark, dead last of 10 providers). The real story is that Fire-engine — their proprietary anti-bot layer — is **closed-source and cloud-only**, meaning self-hosted instances have zero anti-bot capability. The hosted product does handle Cloudflare/DataDome reliably for moderate protection, but enterprise-grade CAPTCHAs and the most aggressive bot-protection systems still slip through.

---

## 1. What Is Fire-engine?

### Status: Proprietary / Closed-Source / Cloud-Only

Fire-engine was announced August 6, 2024 as "a scraping primitive designed to increase Firecrawl's scraping capabilities." It replaced third-party services (Fetch, Playwright) as Firecrawl's default backend.

**What Firecrawl says Fire-engine does (from announcement blog):**
- Efficient Headless Browser Management at scale
- Persistent Browser Sessions (keeps browsers running to reduce startup times)
- Advanced Web Interaction Techniques — "browser-based, browserless, and proprietary approaches"
- Intelligent Request Handling — smart proxy selection + advanced queuing

**What it is NOT:**
- Not open source. Confirmed closed-source in GitHub issue #468 (2024-07-28). The question "is fire-engine proprietary to mendable or open source?" received confirmation it is proprietary.
- Not available in self-hosted Firecrawl. Multiple sources (apiclaw.io, use-apify.com, thunderbit.com) confirm: "Fire-engine (the anti-bot layer) is proprietary and cloud-only."
- Not replaceable by self-hosted workarounds. GitHub issue #2257 (Oct 2025) documents that self-hosted Firecrawl with Playwright fails with `SCRAPE_ALL_ENGINES_FAILED` on Cloudflare-protected sites where Browserless.io on the same IP succeeds — confirming the problem is fingerprinting, not IP reputation.

**What Fire-engine likely contains (inferred from technical evidence):**
1. Built-in residential proxy network (confirmed: "proxy rotation — built-in residential proxy network so you don't need a separate proxy provider" — use-apify.com review)
2. Puppeteer-stealth equivalent or stronger fingerprint masking
3. Automated `cf_clearance` cookie management
4. Smart routing: static fetch → headless browser → stealth browser fallback chain

---

## 2. How Firecrawl Handles Cloudflare Specifically

### Hosted Product (Fire-engine active)
- Handles Cloudflare and DataDome "reliably" for standard protection (Mode 2: automated JS challenge)
- Known limitation: "Very aggressive bot protection (some enterprise-grade CAPTCHAs) can still slip through without manual intervention" — use-apify.com
- No native CAPTCHA solving — a gap vs. Bright Data and Zyte

### Self-Hosted (Fire-engine absent)
- Fails with 403 Forbidden on Cloudflare-protected targets
- The `playwright` engine gets fingerprinted and blocked
- GitHub issue #2257 documents: Browserless.io on same server/IP bypasses the same target that Firecrawl's Playwright fails on — proving it's fingerprinting, not IP blocking
- Warning appears in self-host logs: `⚠️ WARNING: No proxy server provided. Your IP address may be blocked.`

### How Cloudflare's detection works (what Fire-engine must defeat):
1. **TLS fingerprinting** — inspects cipher suites, negotiation order, low-level traits
2. **HTTP header analysis** — checks user-agent, cookies, header ordering
3. **JavaScript fingerprinting** — browser version, OS, installed fonts, hardware characteristics
4. **Behavioral analysis** — request rate, mouse movements, click patterns, idle times
5. **Turnstile CAPTCHA** — if JS challenge fails, escalates to interactive CAPTCHA

Standard headless Playwright fails at step 3-4 because its navigator properties expose automation (`navigator.webdriver = true`, CDP artifacts, missing plugins, suspicious TLS handshake).

---

## 3. Browser Fingerprinting Evasion Techniques

### What Firecrawl's hosted product likely uses (inferred)

The self-hosted issue (#2257) explicitly says: "Browserless.io likely incorporates more advanced anti-detection techniques by default (similar to libraries like `puppeteer-extra-stealth`) that are not present in Firecrawl's current Playwright implementation."

This suggests the hosted Fire-engine uses stealth techniques that the open-source version does not. Industry-standard techniques for defeating fingerprinting:

| Technique | What It Fixes |
|-----------|---------------|
| `puppeteer-extra-plugin-stealth` | Removes 12+ automation signals: `navigator.webdriver`, Chrome runtime, plugin list, language, permissions API |
| TLS client hello spoofing | Makes TLS handshake match Chrome 130+ not headless Chromium |
| User-agent spoofing + consistent profile | Matching UA to matching Accept-Language, screen res, fonts |
| Canvas fingerprint noise | Adds pixel-level noise to canvas renders to defeat canvas fingerprinting |
| WebGL fingerprint spoofing | Randomizes or normalizes GPU renderer strings |
| CDP traffic obfuscation | Prevents detection of Chrome DevTools Protocol usage |
| Human-like mouse/scroll behavior | Random micro-movements, natural timing |
| Persistent session reuse | `cf_clearance` cookie reuse across requests (valid ~15 days) |

Fire-engine's "persistent browser sessions" feature directly enables `cf_clearance` cookie reuse — once a session passes Cloudflare, subsequent requests from that session skip the challenge.

### Firecrawl's own Puppeteer blog (Feb 2026) confirms:
> "The `puppeteer-extra-plugin-stealth` package masks automation signals that anti-bot systems detect. It modifies browser fingerprints like navigator.webdriver, Chrome runtime, plugin lists..."

---

## 4. Proxy Strategy

### Cloud/Hosted Fire-engine:
- Built-in residential proxy rotation confirmed by multiple sources
- "Built-in residential proxy network so you don't need a separate proxy provider" (use-apify.com)
- Intelligent/smart proxy selection (from official Fire-engine announcement)
- No fixed outbound IPs — uses rotating pool (confirmed in Firecrawl docs: "Firecrawl does not use a fixed set of outbound IPs")

### Self-Hosted:
- Zero proxy infrastructure — must bring your own
- "No managed proxy network — you bring your own" (apiclaw.io)
- Self-host costs for proxies typically $500–$5,000/month for residential pool (ScrapeGraphAI cost analysis)

**The residential proxy + stealth browser combination is the core of what Fire-engine does.** Cloudflare's challenge is passed because: (1) the IP looks like a real home user, (2) the browser fingerprint matches real Chrome, (3) behavioral signals look human.

---

## 5. Performance Benchmarks

### Proxyway Late-2025 Benchmark (independent, 15 protected sites, 6,000 pages each)

| Provider | Success Rate @ 2 req/s | Success Rate @ 10 req/s |
|----------|------------------------|-------------------------|
| Zyte (top performer) | 93.14% | — |
| Scrapfly | ~98% (self-reported) | — |
| **Firecrawl** | **33.69%** | **26.69%** |

Firecrawl scored **dead last** of 10 providers on protected sites.

### Scrapeway Ongoing Benchmark
- Firecrawl overall success rate: **65.4%** (above 59.5% industry average)
- Strong on easy targets; poor on protected ones

### Site-by-site breakdown (from Thunderbit analysis):
| Difficulty | Examples | Firecrawl Success Rate |
|------------|----------|----------------------|
| Easy | Blogs, docs, public SaaS | 85–98% |
| Moderate | Product catalogs, basic protection | 53–65% |
| Hard | Amazon, LinkedIn, Cloudflare-heavy | 0–33% |

### Latency:
- Static pages: 2–6 seconds
- JS-heavy SPAs: 5–15 seconds
- Average in Proxyway test: 7.92 seconds ("fail fast" strategy — returns failures quickly rather than retrying)

---

## 6. The Self-Host Gap Is the Moat

The most important strategic insight from this research:

**Fire-engine IS the product.** The open-source code is a loss leader. The hosted version adds:
1. Residential proxy network (brings IP reputation)
2. Persistent stealth browser sessions (brings fingerprint masking)
3. Smart routing engine (selects cheapest method that will succeed)
4. `cf_clearance` cookie pooling (amortizes Cloudflare solve cost across requests)

Without Fire-engine, self-hosted Firecrawl is Playwright + basic fetch — both of which are trivially detected by Cloudflare.

From GitHub issue #2257, the conclusion is explicit: "A potential solution or feature request would be to enhance Firecrawl's Playwright engine with more robust anti-fingerprinting capabilities... This would significantly improve the reliability of the self-hosted solution." — but this hasn't been built into the OSS version, and likely won't be (it would eliminate the key cloud moat).

---

## 7. What "100% Success" Actually Means

The "100% success" claim is not supported by any independent benchmark. Sources:
- Firecrawl's own website says "96% web coverage including protected sites" (from apiclaw.io citing firecrawl.dev)
- Proxyway independent: 33.69% on heavy protection
- Thunderbit analysis: "dead last" among 10 providers
- Use-apify.com: "Note: the open-source self-hosted version does not include Fire-engine, so Cloudflare-protected sites will block self-hosted deployments"

**Most likely origin of "100%":** Firecrawl may have used this in marketing for easy/moderate sites only, or for a specific subset of tests. It does not reflect performance on any curated set of anti-bot-protected sites.

---

## 8. Analysis Questions

### Q1: What is fire-engine? Open source or closed?
**Closed-source, cloud-only proprietary system.** Confirmed in GitHub issue #468 and multiple 2026 reviews. The OSS Firecrawl repo on GitHub contains none of Fire-engine's anti-bot code.

### Q2: How does Firecrawl handle Cloudflare challenges specifically?
Via Fire-engine in hosted mode: residential IPs + stealth browser fingerprinting + persistent `cf_clearance` cookie reuse. In self-hosted mode: it doesn't. The Playwright engine gets fingerprinted and blocked.

### Q3: What browser fingerprinting evasion do they use?
Most likely `puppeteer-extra-plugin-stealth` equivalent (possibly custom) in Fire-engine. The open-source Playwright implementation has no such evasion — which is exactly why issue #2257 documents it failing where Browserless.io succeeds.

### Q4: Do they use residential proxies automatically for anti-bot pages?
Yes — in hosted/cloud mode. Built-in residential proxy rotation is explicitly documented as a feature. No residential proxies in self-hosted mode.

### Q5: What's the latency cost of their anti-bot solution?
- Average: 7.92 seconds per request in Proxyway test (but Firecrawl uses "fail fast" — low latency but low success rate)
- 5–15 seconds for JS-heavy pages on cloud
- Persistent browser sessions reduce this by avoiding browser cold starts per request

### Q6: Can Novada replicate this with our Browser API + proxy combination?
**Yes, substantially.** We have the two key ingredients:
1. Novada Browser API (CDP Chromium) — can apply stealth patches
2. Novada residential proxies — provides IP reputation layer

The gap: we need the **orchestration layer** that connects them intelligently:
- Auto-detect when a page requires stealth mode vs. simple HTTP fetch
- Apply `puppeteer-extra-plugin-stealth` or equivalent to Browser API sessions
- Route through residential proxies automatically when browser escalation triggers
- Cache/reuse `cf_clearance` cookies within sessions

Our current `render` mode for Web Unblocker does some of this. The question is how well our fingerprint masking compares to Fire-engine's. This should be benchmarked.

### Q7: What would a "Novada fire-engine" look like?

**Proposed architecture for "Novada Anti-Bot Stack":**

```
Request → Route Decision Engine
  │
  ├── Level 0: Static HTTP fetch (no proxy, raw)
  │     → success: return, cost: $0
  │     → 403/CAPTCHA: escalate
  │
  ├── Level 1: Static fetch + residential proxy
  │     → success: return, cost: low
  │     → still blocked: escalate
  │
  ├── Level 2: Stealth headless browser + residential proxy
  │     Uses puppeteer-extra-stealth or playwright-stealth
  │     TLS fingerprint spoofing (JA3/JA4 masking)
  │     Canvas/WebGL/font fingerprint normalization
  │     navigator.webdriver = false, CDP artifacts removed
  │     → success: cache cf_clearance, return
  │     → CAPTCHA: escalate
  │
  └── Level 3: Human-in-the-loop CAPTCHA solve
        Third-party solver (2captcha, Capsolver) or
        Turnstile token generation
        → success: return with solved session
```

**Key additions vs. current Novada extract:**
1. Auto-escalation between levels (currently manual via `render` param)
2. `cf_clearance` cookie pool — solve once, reuse across N requests for same domain
3. Playwright stealth patches applied to Browser API (not just raw CDP)
4. TLS fingerprint spoofing at the HTTP client level for Level 0/1
5. Behavioral simulation (random delays, scroll patterns) in Level 2

**Benchmark target:** Scrapfly's 98% success rate is the bar. Zyte's 93.14% is the floor. Both use similar architecture — stealth browser + residential proxies + smart routing.

---

## 9. Competitive Positioning

| Provider | Anti-Bot Success (Protected) | Proxy Included | Open Source Core | Price/1K pages |
|----------|------------------------------|----------------|------------------|----------------|
| Zyte | 93.14% | Yes | No | $1.01–$16.08 |
| Scrapfly | ~98% | Yes (residential) | No | Up to $4.65/page |
| Bright Data | High (enterprise) | Yes (150M IPs) | No | Variable |
| **Firecrawl** | **33.69%** (protected) / 65.4% overall | Yes (cloud only) | **Yes (AGPL)** | $0.83/1K |
| Crawl4AI | N/A (bring your own) | No | Yes (Apache 2.0) | Free + your infra |
| **Novada (current)** | Unknown (needs benchmark) | Yes | No | — |

**Novada's opportunity:** We have residential proxies + Browser API. If we add proper stealth configuration and auto-escalation, we can compete with Scrapfly/Zyte on success rate while offering better pricing than Bright Data. Firecrawl's open-source core + Fire-engine cloud moat strategy is a useful model — but we should not replicate the proprietary split (it creates self-host frustration).

---

## 10. Sources

| Source | URL | Key Finding |
|--------|-----|-------------|
| Firecrawl Fire-engine announcement | https://www.firecrawl.dev/blog/introducing-fire-engine-for-firecrawl | Official description: persistent sessions, smart proxy selection, proprietary techniques |
| GitHub issue #468 | https://github.com/firecrawl/firecrawl/issues/468 | Fire-engine confirmed proprietary/closed-source |
| GitHub issue #2257 | https://github.com/firecrawl/firecrawl/issues/2257 | Self-host Playwright fails where Browserless.io succeeds; fingerprinting confirmed root cause |
| use-apify.com Firecrawl Review 2026 | https://use-apify.com/blog/firecrawl-review-2026 | Fire-engine cloud-only; proxy rotation built-in; handles Cloudflare/DataDome |
| Thunderbit Firecrawl Review | https://thunderbit.com/blog/firecrawl-review-and-alternatives | Proxyway benchmark: 33.69% on protected, dead last of 10; Scrapeway: 65.4% overall |
| Prospeo Firecrawl Alternatives | https://prospeo.io/s/firecrawl-alternatives | Proxyway 2025: 33.69% @ 2req/s, 26.69% @ 10req/s; Zyte 93.14% |
| apiclaw.io comparison | https://apiclaw.io/en/blog/firecrawl-vs-building-custom-crawler-2026 | Fire-engine cloud-only confirmed; no proxy in self-host |
| Bright Data Cloudflare guide | https://brightdata.com/blog/web-data/bypass-cloudflare | Technical detail on Cloudflare TLS/JS/behavioral fingerprinting mechanisms |
| Firecrawl advanced scraping docs | https://docs.firecrawl.dev/advanced-scraping-guide | Smart Wait, mobile UA, actions API details |
| GitHub discussion #2819 | https://github.com/firecrawl/firecrawl/discussions/2819 | Firecrawl 3.0 rebuild: "open-source + local-first by default" — may change the closed moat strategy |
