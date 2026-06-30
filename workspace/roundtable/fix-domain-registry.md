# Fix Agent 2 — Domain Registry Update

## Summary

**22 entries changed** (2 updated, 20 new added). `tsc --noEmit` passed with zero errors.

---

## Entries Updated (2)

| Domain | Before | After |
|--------|--------|-------|
| `reuters.com` | static, SSR news | render, cloudflare, residential — CF + soft paywall |
| `medium.com` | static, SSR | render, cloudflare, residential — CF + metered paywall |

---

## Batch A — New CF-protected / content sites (5 added, 2 updated above)

| Domain | Method | Provider | Proxy |
|--------|--------|----------|-------|
| `netflixtechblog.com` | render | cloudflare | residential |
| `openai.com` | render | cloudflare | residential |
| `martinfowler.com` | render | cloudflare | residential |
| `gatesnotes.com` | render | cloudflare | residential |
| `economist.com` | render | cloudflare | residential |
| `blog.cloudflare.com` | browser | cloudflare | — |

Note: `reuters.com` and `medium.com` were already present (updated in place).

---

## Batch B — JS-heavy SPA / dev-tool domains (15 added)

| Domain | Method | Provider | Notes |
|--------|--------|----------|-------|
| `react.dev` | render | — | SPA docs |
| `nextjs.org` | render | — | SPA docs |
| `vitejs.dev` | render | — | SPA docs, slow |
| `svelte.dev` | render | — | SPA docs |
| `angular.dev` | render | — | SPA docs |
| `tailwindcss.com` | render | — | SPA docs |
| `vercel.com` | render | — | SPA |
| `supabase.com` | render | — | SPA |
| `linear.app` | render | — | SPA |
| `notion.so` | render | — | SPA |
| `figma.com` | render | cloudflare | residential |
| `replit.com` | render | — | slow-loading SPA |
| `codesandbox.io` | render | — | SPA |
| `discord.com` | browser | cloudflare | TLS fingerprinting |

Note: `medium.com` was already present (updated in place, counted in Batch A).

---

## tsc Result

```
npx tsc --noEmit
(exit 0, no output — clean)
```

---

## Implementation Notes

- The brief used `notes` (plural) and `provider: "none"` — neither is valid in the schema. Fixed silently:
  - `notes` → `note` (matches `DomainEntry.note: string`)
  - `provider: "none"` → omitted (field is optional; `AntiBotProvider` does not include "none")
- `blog.cloudflare.com` resolves correctly via exact match before the subdomain-stripping loop would match `cloudflare.com`, so it gets its own `browser` entry as intended.

---

## Expected Impact

| Category | Domains | Impact |
|----------|---------|--------|
| CF-protected content (Batch A) | 7 | Previously falling back to static, likely returning bot-challenge HTML. Now routed through Web Unblocker with residential proxy. |
| SPA docs / dev tools (Batch B) | 13 render | Previously triggering slow auto-detection probe. Now skipping probe, going straight to render. |
| Heavy fingerprinting (discord, blog.cloudflare) | 2 browser | Correctly escalated to full CDP — would have failed or returned empty via unblocker. |
| Total residential-tier additions | +9 | Increases residential proxy warning count; expected, intentional. |
