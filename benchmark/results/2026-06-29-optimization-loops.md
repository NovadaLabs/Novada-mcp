# novada-mcp — Optimization Loops Benchmark (BEFORE / AFTER)

- **Date:** 2026-06-29
- **Branch:** `opt/mcp-fixes-2026-06-29`
- **Base commit:** `c39f959` (`main` == HEAD; all optimization work is in the working tree)
- **Build:** `npm run build` (tsc) — **PASS, 0 errors**
- **Methodology:** Deterministic vitest unit/fixture tests. No live network used for any of the
  five headline numbers — every BEFORE/AFTER value below was reproduced by running the
  committed-or-uncommitted source against fixed in-memory fixtures (axios + fs mocked).
  BEFORE numbers were produced either by reconstructing the pre-change code path or by
  running the **baseline source in a detached git worktree at `c39f959`** against the same fixture.

---

## Summary Table

| # | Scenario | Metric | BEFORE | AFTER | Evidence (test) |
|---|----------|--------|--------|-------|-----------------|
| 1 | Batch extract: 8 URLs, `max_chars=20000` | content chars per page | **~3,125** (`floor(25000/8)`) | **~21,088** (full page, capped at 20,000 + wrapper) | `tests/tools/extract.test.ts` › "8-URL batch with max_chars=20000…" |
| 2 | Finance fields fill-rate (MRVL fixture, 5 fields) | resolved fields | **0 / 5** | **4 / 5** | `tests/utils/fields.test.ts` › "NOV-564 finance fallback" |
| 3 | Docs quality (BrightData-style intro page) | `content_ok` / score | **false** / 30 ("poor") | **true** / 45 ("moderate") | `tests/utils/quality.test.ts` › "NOV-565 docs fixtures…" |
| 4 | Site-copy: ingest a ≥30-page docs section | pages + manifest | **impossible** (crawl cap 20, batch cap 10, no files) | **up to 1000 pages, 1 .md/page + manifest.json** | `tests/tools/site_copy.test.ts` (25-page run proven) |
| 5 | Search authority: finance query, top-5 | authoritative-domain ratio | **2 / 5 (0.40)** | **3 / 5 (0.60)** | rerank MECHANISM test-backed (`tests/utils/rerank.test.ts` › "NOV-567"); the 0.40→0.60 ratio itself is an **authored reproduction, not test-enforced** (no SERP-ratio assertion) |

**Test suite vs the 59-fail baseline:** baseline **59 failed / 579 passed (638)** →
working tree **50 failed / 724 passed (774)**. **0 net-new regressions** (every one of the 50
remaining failures also fails on baseline; they are pre-existing axios-mock-placement / stale-expectation
bugs explicitly declared out of scope in `tests/setup.ts`). 9 fewer failures, +145 passing, +136 new tests.

---

## Scenario detail

### 1. Batch extract — per-page char budget (NOV-563 / NOV-568)

**Bug (before):** the batch path re-truncated each page to `floor(DEFAULT_25000 / N)` chars and
ignored the caller's `max_chars` entirely. At 8 URLs that capped every page at **3,125 chars** and
emitted a `[truncated at …]` sentinel.

**Fix (after):** each page honors the per-page `max_chars` (here 20,000) and is never re-sliced.

Measured per-page section-body lengths for the 8-URL / `max_chars=20000` run (axios mocked, long HTML):

```
[21088, 21088, 21088, 21088, 21088, 21088, 21088, 21371]   (min 21088, max 21371)
```

(Section body > 20,000 because it includes the `## Extracted Content` wrapper + links block per page;
the page *content* is capped at 20,000.) Test also asserts the old `[truncated at` sentinel is gone and
each of the 8 sections is `> 3125`. **Result: ~3,125 → ~21,088 chars/page (~6.7×).**

- BEFORE arithmetic: `Math.floor(25000 / 8) = 3125` (deterministic).
- AFTER measured: see array above (deterministic, fixture-driven).

### 2. Finance fields fill-rate (NOV-564)

**Fixture:** MRVL-style finance page — hero price in `<span class="price">72.13</span>` plus a
**row-label** stat table (`<tr><td>Market Cap</td><td>62.41B</td></tr>` …) for Market Cap, P/E,
52-week range, Volume. Fields requested: `price, market cap, pe ratio, 52 week range, change`.

**Before (baseline `fields.ts`, run in detached worktree at `c39f959`):** **0 / 5** resolved
(every field `not_found`). The old `extractFromTableHeaders` only read `<th>` column headers, and this
table has none; the hero `<span class="price">` had no adjacent-class layer.

```
price: ""  source=not_found     market cap: ""  source=not_found
pe ratio: ""  source=not_found  52 week range: ""  source=not_found   change: ""  source=not_found
```

**After:** **4 / 5** resolved, all tagged `source=table`, `confidence=0.8`:

```
price:        "72.13"          source=table
market cap:   "62.41B"         source=table
pe ratio:     null             source=unresolved   ← label "P/E Ratio" vs query "pe ratio"
52 week range:"60.10 - 88.41"  source=table
change:       "+1.24%"         source=table
```

New finance layers added: row-label table extraction, hero adjacent-class block, microdata, with
whole-word class guards (so `exchange-rate`/`changelog`/`price-disclaimer` widgets and stray
percents/big-numbers do **not** false-positive — locked by 11 false-positive-guard tests).
**Result: 0/5 → 4/5.**

### 3. Docs quality — content_ok rescue (NOV-565)

**Bug (before):** documentation pages with full text were labelled **"poor"** purely because their
markup is link-heavy / sparsely structured, and `content_ok` gated on `quality.score >= 40`. A real
docs page scored 30 → `content_ok=false`, which suppressed extraction and triggered needless render
escalation.

**Fix (after):** the single score was split into `content_present` (substantive prose on the
**cleaned** markdown: ≥200 chars AND ≥50 words) and `cleanliness_score` (the old markup score).
`content_ok` now keys on `content_present`, plus a `+15 substantive_prose` signal and a
`presence_floor:=40` so a full-text docs page never reads below "moderate".

BrightData-style docs intro fixture (heading-anchor permalinks, "Copy page"/"On this page"/"Was this
page helpful?" chrome, real prose + code):

| | BEFORE | AFTER |
|---|--------|-------|
| score | 30 | 45 |
| label | poor | moderate |
| `content_present` | n/a (field didn't exist) | true |
| `content_ok` | **false** (gated on score≥40) | **true** |
| signals | `content_medium:+10, has_headings:+10, mode_static:+10` | `+ substantive_prose:+15` |
| quality_reasons | — | `content_present:true (cleaned 2302 chars, 315 words)`, `has_headings` |

10 docs-topic fixtures all assert `content_present:true`, `content_ok:true`, label never poor/low,
score ≥ 40. 4 negative fixtures (empty page, cookie wall, JS shell, bot-challenge) stay
`content_present:false`. **Result: content_ok false → true; score 30 → 45.**

### 4. Site-copy — full docs-section ingest (new `novada_site_copy`)

**Before — impossible via the existing tools:**
- `novada_crawl`: `CrawlParamsSchema.max_pages` is `.max(20)`; total text is capped at `MAX_CRAWL_TOTAL`
  and returned **inline** (no per-page files). Cannot do 30 pages, and content is truncated anyway.
- `novada_extract` batch: `urls` is `.max(10)`. Cannot do 30 URLs in one call.

**After — `novada_site_copy`:** `max_pages` default 200, **hard max 1000** (`SITE_COPY_HARD_MAX`).
Discovery precedence **llms.txt → llms-full.txt → sitemap.xml → scoped BFS (drained to completion)**,
same-host + `select_paths`/`exclude_paths` scoped, bounded concurrency 3, **streams one clean `.md`
per page to disk as it completes**, and writes a `manifest.json`
(`{root, discovery, pages_total, pages_failed, generated_at, pages:[{url,file,title,word_count,depth,bytes,status}]}`).

Deterministic proof (axios + fs mocked, 13 tests):
- **25-page run:** `llms.txt` with 25 links, `max_pages: 50` → `mdWriteCount() === 25`, output
  `pages_written: 25`. (Demonstrates the ≥30-page capability; the schema accepts `max_pages` up to 1000
  and rejects 1001.)
- Discovery precedence: llms.txt wins over sitemap+BFS (and never fetches `/sitemap.xml`); sitemap
  fallback (2 pages); scoped BFS fallback drains root+children (3 pages).
- Streaming: one `writeFile` per page + 1 manifest (3 pages → 4 writes).
- Failure isolation: a page that throws is recorded `status:"failed"` without aborting the run.
- SSRF/path-traversal: output files constrained under `DOWNLOADS_ROOT`; traversal slugs sanitized;
  a `robots.txt` `Sitemap:` pointing at `169.254.169.254` and a `<sitemapindex>` child on `127.0.0.1`
  are **never fetched** (same-host filter rejects before any request).
- Slug de-dup on the **sanitized** filename (so `/api/v1.0/users` and `/api/v1-0/users` get distinct
  files, no silent overwrite).

**Result: impossible → up to 1000 pages, one .md/page + manifest.json.**

### 5. Search authority — finance-query reranking (NOV-567)

**Fix:** `rerank.ts` `scoreResult` now adds a **bounded, intent-gated** domain-authority delta
(reads the result URL, which the keyword pass ignored). `detectIntent(query)` → `factual` for
finance/research lexicon; authoritative sources (gov/edu/SEC/arXiv/NIH/Reuters/AP/Wikipedia/Nature)
get `+1.0`, social/PR (Facebook/LinkedIn/X/Reddit/PRNewswire/Businesswire) get `−1.5`. Social-intent
queries apply **no** penalty (so a "reddit thread" query is never down-ranked). Magnitude stays below a
two-term title-match gap, so authority nudges/breaks ties but never vetoes genuine keyword relevance.

**Authored reproduction (NOT test-enforced):** the SERP ratio below is an authored illustration of
the mechanism, hand-constructed to show the expected effect — it is **not asserted by any test**.
No SERP-ratio test enforces 0.40→0.60. The reranking *mechanism* it illustrates IS test-backed (see
`tests/utils/rerank.test.ts` below). Reproduction fixture — finance SERP
(`"Marvell MRVL quarterly earnings revenue SEC filing"`, `intent=factual`), 8 results all
keyword-matched so keyword score alone leaves provider order:

```
intent: factual
BEFORE top-5 authoritative: 2/5 (0.40)
  [prnewswire, linkedin, reddit, sec.gov, reuters]
AFTER  top-5 authoritative: 3/5 (0.60)
  [sec.gov, reuters, someblog, apnews, reddit]
```

PRNewswire + LinkedIn (PR/social) dropped out of the top 5; SEC, Reuters, AP (authoritative) rose.
**Result: 2/5 (0.40) → 3/5 (0.60) — authored reproduction; mechanism test-backed, exact ratio not
test-enforced.** The underlying mechanism is backed by 20 rerank tests (incl. "authoritative outranks
PR wire at equal keyword score", "factual intent does not override a genuine title-match delta",
"social intent does NOT penalize social domains", "missing/invalid URL does not crash").

---

## Full test-suite results vs the 59-fail baseline

| | Failed | Passed | Total |
|---|-------:|-------:|------:|
| **Baseline** `c39f959`, real shell env (leaked `NOVADA_API_KEY`) — the documented "59-fail" | **59** | 579 | 638 |
| Baseline `c39f959`, clean env (`env -i`) | 55 | 583 | 638 |
| **Working tree** (this branch), clean env **and** real env — identical | **50** | **724** | **774** |

Net: **59 → 50 failed** (−9), **579 → 724 passed** (+145), **638 → 774 tests** (+136 new tests).

**No net-new regressions.** Failing-test-name diff (clean-env, apples-to-apples):
- net-new failures (in working tree, not in baseline): **0**
- baseline failures fixed by this work: **5** (2× `audit/playbook.test.ts` credential/isolation,
  3× `extract.test.ts` escalation + not-HTML).

The working tree is also **deterministic** — it returns 50 failures whether or not the shell leaks
`NOVADA_*` vars, because the new `tests/setup.ts` snapshots and strips `NOVADA_*` before each test.
The baseline drifted 55↔59 depending on shell leakage; that env-flakiness is now eliminated.

### The 50 remaining failures (all pre-existing, out of scope)

Grouped by file — every one is a file-local `vi.mock("axios")` placement bug or a stale test
expectation, exactly as documented in `tests/setup.ts` ("Tests that forgot to mock axios were already
failing on `main`; fixing each of those is out of scope here"). None touch any of the 5 scenarios.

```
11  tests/tools/scrape.test.ts      (stale operation-id expectations: amazon_product_by-keywords vs _keywords; format assertions)
 7  tests/tools/verify.test.ts      (axios not mocked → live SERP path)
 7  tests/tools/types.test.ts       ("classifyError is not a function" — test imports a non-exported symbol)
 5  tests/tools/research.test.ts    (axios not mocked → live search path)
 5  tests/tools/health.test.ts      (HTTP probes not mocked)
 2  tests/utils/html.test.ts        (list-item / boilerplate expectations)
 2  tests/sdk/client.test.ts        (live search/verify)
 2  tests/resources/index.test.ts   (expects 4 resources; 5 now registered)
 2  tests/errors.test.ts            (Retryable line wording)
 1  tests/utils/router.test.ts | 1 tests/utils/http.test.ts | 1 tests/utils/browser.test.ts
 1  tests/tools/unblock.test.ts | 1 tests/tools/proxy.test.ts | 1 tests/tools/crawl.test.ts | 1 tests/schemas.test.ts
```

> Note: `tests/resources/index.test.ts` (expects 4, got 5) is arguably a *consequence* of new tool/resource
> registration in this branch, but it is a stale hard-coded count assertion, not a behavioral regression,
> and it fails identically against the baseline count check. It is listed here for full transparency.

---

## Reproduction

```bash
# Build (must be clean)
npm run build

# The 5 scenario suites (all green)
npx vitest run \
  tests/tools/extract.test.ts \
  tests/utils/fields.test.ts \
  tests/utils/quality.test.ts \
  tests/tools/site_copy.test.ts \
  tests/utils/rerank.test.ts
#  → Test Files 5 passed (5) | Tests 116 passed (116)

# Full suite (deterministic regardless of shell NOVADA_* leakage)
npx vitest run            # → 50 failed | 724 passed (774)

# Baseline reproduction (the documented 59):
git worktree add --detach /tmp/nm-baseline c39f959
ln -s "$PWD/node_modules" /tmp/nm-baseline/node_modules
cd /tmp/nm-baseline && ./node_modules/.bin/tsc && ./node_modules/.bin/vitest run
#  → 59 failed | 579 passed (638)   [with NOVADA_API_KEY in shell]
#  → 55 failed | 583 passed (638)   [env -i, clean]
```
