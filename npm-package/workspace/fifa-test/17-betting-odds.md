# Test 17 — Betting Odds Extraction: France vs Norway

**Date:** 2026-06-26
**Objective:** Search for France vs Norway betting odds, extract structured predictions

---

## Step 1: Search

- **Tool:** `novadaSearch`
- **Query:** `France vs Norway odds betting prediction 2026`
- **Engine:** Google | **Results:** 3
- **Response size:** 1391 chars
- **Top URL found:** https://www.covers.com/world-cup/france-vs-norway-prediction-picks-odds-friday-6-26-2026

**Verdict:** PASS -- search returned a relevant, fresh betting predictions article (published 2026-06-26)

---

## Step 2: Extract

- **Tool:** `novadaExtract`
- **URL:** covers.com (France vs Norway prediction page)
- **Mode:** static (auto-selected) | **Quality:** 80/100 (excellent)
- **Response size:** ~103K chars | **Latency:** ~9.4s
- **Content truncated:** yes (102,496 chars total)

### Field Extraction (fields param)

| Field | Result |
|-------|--------|
| odds | -- (dash) |
| prediction | -- (dash) |
| france | Lineup extracted (4-2-3-1): Maignan; Kounde, Upamecano, Saliba, Digne; Kone, Rabiot; Dembele, Olise, Barcola; Mbappe |
| norway | Partial context about needing to beat France for group top spot |
| draw | -- (dash) |

**Field extraction quality: PARTIAL** -- `fields` param failed to pull numeric odds. The odds were embedded in article body text, not in structured data elements.

### Actual Odds (extracted from full markdown body)

| Market | Pick | Odds | Notes |
|--------|------|------|-------|
| **Moneyline** | France | **-163** (opening), **-145** (current), **-144** (article body) | Playable up to -150 |
| **Total** | Over 2.5 | **-149** | Playable up to -160 |
| **Goal Scorer** | Kylian Mbappe | **+105** | 4 goals from 12 shots, 1.99 xG |

### Expert Prediction (Covers.com / Jason Ence)

- **Best Bet:** France moneyline (-145)
- **Over/Under Pick:** Over 2.5 goals (-149)
- **Goal Scorer Pick:** Kylian Mbappe anytime (+105)
- **Rationale:** France defense outstanding; Norway must win for group top spot creating open game; Mbappe chasing Messi all-time WC goal record

---

## Issues Found

### INC-200: `fields` param returns dashes for odds/prediction/draw

**Severity:** MEDIUM
**Description:** When `fields: ['odds', 'prediction', 'draw']` is passed to `novadaExtract`, the extraction returns `--` dashes instead of actual values. The odds data IS present in the markdown body (e.g., `-163`, `-145`, `+105`) but the field extraction logic fails to locate and return it.

**Root cause hypothesis:** The `fields` extraction relies on JSON-LD structured data first, then falls back to pattern matching. Covers.com embeds odds inline in article prose, not in structured data or labeled HTML elements, so the pattern matcher cannot reliably identify them.

**Impact:** Agents relying on `fields` for structured betting data get empty results and must parse the full markdown themselves.

**Workaround:** Use `format:'markdown'` without `fields` and parse odds from the body text using regex patterns like `/[+-]\d{3}\b/`.

---

## Summary

| Metric | Value | Status |
|--------|-------|--------|
| Search relevance | Exact match (covers.com prediction article) | PASS |
| Search latency | <2s | PASS |
| Extract content | 102K chars, full article body with odds data | PASS |
| Extract quality score | 80/100 | PASS |
| Extract latency | ~9.4s | ACCEPTABLE |
| Field extraction (odds) | Returned dashes, not numeric odds | FAIL |
| Field extraction (lineup) | France lineup extracted correctly | PASS |
| Structured data (JSON-LD) | Article metadata (author, dates, publisher) | PASS |

**Overall: PASS with caveat** -- The pipeline successfully found and extracted real-time betting odds content. The data is all there in the markdown. However, the `fields` parameter cannot reliably extract numeric odds from article prose, which is a known limitation (INC-200).
