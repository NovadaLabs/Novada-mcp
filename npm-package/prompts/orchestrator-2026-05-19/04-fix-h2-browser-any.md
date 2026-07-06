# Fix H2: Type `page` Parameter in browser.ts

## Problem
In `/Users/tongwu/Projects/novada-mcp/src/tools/browser.ts` line 223:
```typescript
async function executeAction(page: any, action: BrowserAction): Promise<ActionResult>
```
The `page` is typed as `any`, undermining TypeScript safety on all page operations including `page.evaluate(action.script)` which runs arbitrary JS.

## Fix
1. Read `src/tools/browser.ts` — find all `page: any` occurrences
2. Check if `playwright-core` is in `package.json` dependencies
3. If yes: `import type { Page } from 'playwright-core';` and type `page: Page`
4. If not available (browser uses CDP directly): create a minimal interface:
   ```typescript
   interface BrowserPage {
     goto(url: string, options?: { waitUntil?: string }): Promise<void>;
     evaluate(script: string): Promise<unknown>;
     click(selector: string): Promise<void>;
     // ... other used methods
   }
   ```
5. Replace all `page: any` with the proper type
6. Also fix the `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comments — remove them once the type is fixed
7. Run `npm run build`

## Verification
- `grep -n "page: any" src/tools/browser.ts` should return 0 results
- Build passes
