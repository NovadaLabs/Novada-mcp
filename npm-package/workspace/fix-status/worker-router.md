# worker-router fix status

**File:** src/utils/router.ts
**tsc --noEmit:** PASS (0 errors)

## Fix 1 — INC-171: DOMAIN_REGISTRY lookup in routeFetch

Added `import { lookupDomain } from "./domains.js"` at the top of the file.

At the start of `routeFetch`, before any existing forced-mode checks, inserted a guard block
scoped to `renderMode === "auto"` only (forced modes are unaffected):

```typescript
if (renderMode === "auto") {
  const domainHint = lookupDomain(url);
  if (domainHint?.method === "browser") {
    // jump straight to browser — skip static and render probes
    return { html: await fetchViaBrowser(...), mode: "browser", cost: "high" };
  }
  if (domainHint?.method === "render") {
    // jump straight to render
    return { html: normalizeToString(response.data), mode: "render", cost: "medium" };
  }
  // "static" hint or no hint — fall through to normal auto chain
}
```

Known domains (e.g. LinkedIn, TikTok with `method: "browser"`) now skip all probes
and go directly to the optimal tier.

## Fix 2 — INC-175: Surface swallowed browser fallback errors

Declared `let lastBrowserError: Error | undefined` near the top of the auto-mode block.

Changed all 3 bare `catch {}` blocks in the browser fallback path to:

```typescript
catch (err) {
  lastBrowserError = err as Error;
}
```

Final failure paths now include the error message in the returned HTML prefix:

- Bot-challenge path: `render-failed: bot challenge detected (browser also tried and failed: <message>)\n\n<static html>`
- Render-error path: `render-failed: <render error>; browser also tried and failed: <browser error>\n\n<static html>`

Agents calling `novada_extract` in `render-failed` mode will now see exactly why
the browser tier also failed instead of receiving a silent degraded response.
