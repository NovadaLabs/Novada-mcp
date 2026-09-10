/**
 * assert-node.ts — fail LOUD on Node <20 instead of silently misbehaving (A-11).
 *
 * package.json declares `"engines": { "node": ">=20.0.0" }`, but npm's default
 * engines check is a WARNING, not a hard stop — no `engine-strict` .npmrc ships
 * in this package. On an unsupported runtime the server previously continued
 * past startup into whatever runtime error it happened to hit first (missing
 * native fetch/streams/structuredClone, etc.), instead of a clear one-line
 * diagnosis at the door.
 *
 * Import this as the FIRST import in every entry point (index.ts, cli.ts),
 * before the MCP SDK or any other heavy import — so the version check runs at
 * module load, ahead of anything that could itself fail confusingly on an old
 * runtime.
 */
export const MIN_NODE_MAJOR = 20;
/** Parses the major version number out of a Node version string, e.g. "20.11.24" or "v18.20.4". Returns 0 if unparsable. */
export function parseNodeMajor(versionString) {
    const cleaned = versionString.replace(/^v/, "");
    const major = Number.parseInt(cleaned.split(".")[0] ?? "", 10);
    return Number.isFinite(major) ? major : 0;
}
/**
 * Checks the running Node major version and exits with a clear stderr message
 * if it is below MIN_NODE_MAJOR. Accepts an injectable version string + exit
 * function so the gate is unit-testable without spawning a real old-Node
 * process (see tests/utils/assert-node.test.ts for the injected-version unit
 * tests, and tests/fixtures/node-gate-old.ts + the spawn-based test for proof
 * against the REAL default-arg auto-run path below).
 *
 * A major of 0 (unparsable version string) is treated as "cannot verify" and
 * does NOT trigger the gate — never false-positive-block a runtime whose
 * version string this function doesn't recognize.
 */
export function assertNodeVersion(versionString = process.versions.node, exit = (code) => process.exit(code)) {
    const major = parseNodeMajor(versionString);
    if (major === 0 || major >= MIN_NODE_MAJOR)
        return;
    console.error(`[novada] FATAL: novada-mcp requires Node.js ${MIN_NODE_MAJOR}.0.0 or later ` +
        `(this process is running Node ${versionString}). Older runtimes are missing APIs ` +
        `this package depends on (native fetch/streams, structuredClone) and would fail ` +
        `with confusing errors mid-request instead of failing here. ` +
        `Upgrade Node (e.g. 'nvm install ${MIN_NODE_MAJOR} && nvm use ${MIN_NODE_MAJOR}') and retry.`);
    exit(1);
}
// Run immediately on import — this module's entire purpose is a load-time gate.
assertNodeVersion();
//# sourceMappingURL=assert-node.js.map