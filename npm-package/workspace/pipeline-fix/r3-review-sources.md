# R3 Review: research sources table
**Reviewer**: R3
**File**: src/tools/research.ts
**Verdict**: REQUEST_CHANGES

---

## Checklist Results

### 1. Table renders correctly — PASS
Live run confirmed. Five rows rendered cleanly in proper GFM table format. No layout breakage observed.

```
| # | Title | URL | Notes |
|---|-------|-----|-------|
| 1 | [What's the benefits...](https://...) | https://... | full content extracted |
```

### 2. Pipe escaping — PARTIAL PASS
Title (`safeLabel`) and Notes (`safeNote`) are escaped via `.replace(/\|/g, "\\|")`. Correct.

URL column (column 3) is **not** escaped — same raw URL appears twice: once in the markdown link href and once as a standalone cell value. Bare pipe characters in HTTP URLs are invalid per RFC 3986, so this is not an active bug. However the duplicate URL column creates redundancy (see issue #2 below).

### 3. Citation format "Source[1]" — ISSUE
The table supports indexed citation but the format `Source[1]` is non-standard and introduces friction:

- Standard academic/technical markdown citation is `[1]` or `[[1]]`
- `Source[1]` is not a recognized shorthand in any major markdown spec or agent prompt convention
- Agents receiving this output have no schema for how to emit the citation — the Agent Hints section and Agent Action line do not mention the citation format at all

The table enables indexing; the citation format is not enforced or documented anywhere in the output. This is an incomplete contract.

### 4. Notes column value — LOW ISSUE
Notes column has exactly two possible values: `"full content extracted"` or `"snippet only"`. This binary state adds marginal value as a dedicated column:

- It duplicates information already conveyed by `**sources_extracted**: N full + M snippet-only` in the header
- An agent parsing the table has to read the Notes column to know extraction quality, but the header already gives the aggregate counts
- The column does help when an agent wants to decide which specific source to `novada_extract` next — this is the only real value it adds

Net assessment: low noise, marginal signal. Acceptable but not necessary.

### 5. Zero sources edge case — PASS
Line 395-397: when `totalSources === 0`, the table is replaced with `_No sources fetched._`. Correct fallback. Header correctly shows `**sources**: 0`.

### 6. Header count vs table rows — BUG (HIGH)

**This is the most significant issue.**

`totalSources` (line 381) equals `sourceRows.length` = `extractedContents.length + extractFailedSources.length`. This only covers the **top 5 sources** (`topSources = sources.slice(0, 5)`).

Meanwhile `findingBullets` (lines 226–228) iterates the full `sources` array which is `uniqueSources.values()` sliced to **15** (line 148).

So in a typical run returning 8–15 unique sources:
- Header shows `**sources**: 3` (e.g. 3 extracted + 0 failed)
- Key Findings shows 8–15 bullet entries
- Sources table shows only 3 rows

An agent reading the output sees 10 findings but only 3 citable sources. The count in the header ("sources: 3") is not wrong per se, but it is misleading relative to the Key Findings section which implies broader coverage. The label "sources" in the header is ambiguous — it reads as total unique sources found, not "sources with full or snippet extraction."

**Fix**: Either rename the header field to `**extracted_sources**` to make the scope explicit, or expand `sourceRows` to cover all sources (not just top-5 extracted) with a `"search result only"` note tier.

---

## Summary

| # | Check | Result |
|---|-------|--------|
| 1 | Table renders | PASS |
| 2 | Pipe escaping | PASS (URLs technically safe, but duplicate URL column is noisy) |
| 3 | Citation format | LOW — undocumented contract, no agent guidance on how to emit |
| 4 | Notes column value | LOW — acceptable but redundant with header aggregate |
| 5 | Zero sources edge case | PASS |
| 6 | Header count vs table rows | HIGH — "sources: N" in header undercounts vs Key Findings |

**Block reason**: Item 6 — the header `**sources**: N` creates a misleading signal. An agent or human reading "sources: 3" while the Key Findings section lists 12 bullets will either distrust the output or miss 9 citable sources. This needs a label rename or a scope expansion before merge.

---

## Required Fix

In `formatResearchOutput`, line 409:

```typescript
// CURRENT — ambiguous, undercounts vs Key Findings
`**Query**: ${args.query} | **sources**: ${totalSources} | **depth**: ${args.depth}`

// OPTION A — rename to clarify scope (minimal change)
`**Query**: ${args.query} | **extracted_sources**: ${totalSources} | **depth**: ${args.depth}`

// OPTION B — show both counts (most informative)
`**Query**: ${args.query} | **sources**: ${uniqueSourcesTotal} (${totalSources} extracted) | **depth**: ${args.depth}`
```

Option A requires no structural change. Option B requires passing `sources.length` through `formatResearchOutput`'s args (currently not passed).

The citation format gap (item 3) should also be addressed by adding one line to Agent Hints:
```
- Cite sources by index: Source[1], Source[2] (see Sources table above).
```
