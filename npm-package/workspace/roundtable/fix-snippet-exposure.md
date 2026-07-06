# Fix: Snippet Exposure in novadaSearch Output

## Result Object Shape

`NovadaSearchResult` (src/tools/types.ts:197):
```ts
interface NovadaSearchResult {
  title?: string;
  url?: string;
  link?: string;
  description?: string;   // primary description field
  snippet?: string;        // fallback/alias
  published?: string;
  date?: string;
}
```

`parseScraperSearchResults` (search.ts:227-228) already resolves both:
```ts
snippet: (item.snippet ?? item.description) ?? "",
description: (item.description ?? item.snippet) ?? "",
```

So both fields are populated on every result. The markdown renderer reads `r.description || r.snippet` (line 462).

## What Was Missing

The snippet was already being read and cleaned — but:
1. The heading used `### N. Title` (no markdown link)
2. The URL was on a separate `url: ...` line
3. No truncation was applied (could be very long)
4. The snippet was labeled `snippet: text` instead of flowing text

The JSON output path already exposed `snippet` correctly (line 421).

## Diff Applied

**File:** `src/tools/search.ts` — markdown loop (lines ~455–483)

```diff
-    lines.push(`### ${i + 1}. ${r.title || "Untitled"}`);
-    lines.push(`url: ${url}`);
-    lines.push(`snippet: ${cleanSnippet}`);
+    lines.push(`## ${i + 1}. [${r.title || "Untitled"}](${url})`);
+    // published stays if present
+    lines.push(cleanSnippet);   // flowing text, no label prefix
```

Also changed truncation logic:
```diff
-    const cleanSnippet = rawSnippet
-      .replace(...)
-      .trim() || "No description";
+    const fullSnippet = rawSnippet.replace(...).trim();
+    const cleanSnippet = fullSnippet.length > 200
+      ? fullSnippet.slice(0, 197) + "..."
+      : fullSnippet || "No description";
```

## tsc Result

```
(no output — clean)
```

Exit code 0.

## Sample Output Before / After

### Before
```
## Search Results
results:3 | engine:google (via scraper-api) | source: live | reranked:true

---

### 1. Firecrawl — Web Scraping API
url: https://www.firecrawl.dev
snippet: Turn any website into LLM-ready data. Scrape, crawl, and extract structured data from any webpage.

### 2. Firecrawl Documentation
url: https://docs.firecrawl.dev
snippet: Complete documentation for the Firecrawl API...

```

### After
```
## Search Results
results:3 | engine:google (via scraper-api) | source: live | reranked:true

---

## 1. [Firecrawl — Web Scraping API](https://www.firecrawl.dev)
Turn any website into LLM-ready data. Scrape, crawl, and extract structured data from any webpage.

## 2. [Firecrawl Documentation](https://docs.firecrawl.dev)
Complete documentation for the Firecrawl API...

```

Agents can now scan the heading (title + url in one line) and read the snippet as natural text below — no parsing of `url:` / `snippet:` label prefixes required.

## JSON Path

Already correct before this fix (line 421):
```ts
snippet: r.description || r.snippet || "",
```
No change needed.
