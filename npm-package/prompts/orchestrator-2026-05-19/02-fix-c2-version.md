# Fix C2: Sync VERSION with package.json

## Problem
`/Users/tongwu/Projects/novada-mcp/src/config.ts` line 1 has `VERSION = "0.0.1"` hardcoded. The real version in `package.json` is different. MCP clients see the wrong version.

## Fix
1. Read `src/config.ts` — find the VERSION constant
2. Read `package.json` — get the actual version
3. Change `config.ts` to read version from package.json at build time. Two options:
   - Option A (simple): `import pkg from '../package.json' assert { type: 'json' }; export const VERSION = pkg.version;`
   - Option B (if JSON import not supported): Read at runtime with `require('../package.json').version`
   - Option C: Use a build script that writes the version
4. Also check `src/index.ts` for the `--help` output that hardcodes "Tools (23)" count — make it dynamic using `TOOLS.length`
5. Run `npm run build` to confirm

## Verification
- `node -e "const {VERSION} = require('./build/config.js'); console.log(VERSION)"` should print the package.json version, NOT "0.0.1"
- Build must pass
