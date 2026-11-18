/**
 * F3 honest-isError completeness guard (independent review, round 4 — final).
 *
 * History of why this file looks the way it does (do not simplify back to an
 * earlier shape without re-reading this):
 *  - Rounds 1-2: `FAILURE_HEADER_LITERALS` was hand-maintained by re-reading
 *    tools/*.ts. Missed 3 real failures (browser_flow.ts x2, monitor.ts).
 *  - Round 3: replaced manual re-reading with a scanner — but the scanner
 *    FILTERED candidates by a keyword list (`Error|Failed|Unavailable|
 *    Incomplete|Invalid|Refused|Denied`). That filter was itself the bug:
 *    `browser.ts`'s "## Browser API — Not Configured" / "## Browser API —
 *    Missing Dependency" are real, currently-shipping failures that contain
 *    NONE of those words, so the scanner never even considered them
 *    candidates. The registry-coverage check also missed this because it only
 *    asked "does this file have ANY failure signal", and browser.ts already
 *    passed via the unrelated "## Browser Mode Unavailable" literal elsewhere
 *    in the same file — one real signal masked two real gaps.
 *  - Round 4 (this version): NO keyword filter, NO per-file "any signal"
 *    shortcut. Every markdown heading literal findable by static scan across
 *    npm-package/src/tools/** (recursive) must appear in EXACTLY ONE of
 *    FAILURE_HEADER_LITERALS or SUCCESS_OR_NEUTRAL_HEADERS (_core/errors.ts) —
 *    full stop, no heuristic decides what counts as "a candidate" anymore.
 *    The registry-coverage check now requires every failure heading found IN
 *    A GIVEN TOOL'S FILE to itself be in FAILURE_HEADER_LITERALS, not just
 *    "the file has some signal somewhere".
 *
 * Heading extraction: a backtick immediately followed by `#` or `##`, then any
 * run of characters that are neither a backtick nor a real newline — handles
 * both a single-line array element (stops at the closing backtick) and a
 * multi-line template literal's opening line (stops at the real newline, no
 * backtick needed). Lines whose text before the match (trimmed) starts with
 * `//`, `*`, or contains `/*` are skipped — these are heading strings
 * MENTIONED in a comment/JSDoc (e.g. browser.ts:15-18's comment literally
 * quotes "## Browser Mode Unavailable" in prose), not a formatter emitting
 * one. Directory walk is RECURSIVE (round 4: the round-3 scanner's
 * `readdirSync` was flat — harmless today since tools/ has no subfolders, but
 * a latent gap the reviewer flagged).
 *
 * Classification key (`headingClassificationKey`, exported from
 * _core/errors.ts so this file and that file's documentation can never
 * drift apart): the full trimmed heading for a non-interpolated string, or
 * the fixed substring before the first `${` for an interpolated one (a
 * caller-interpolated heading like `` `## Research: ${topic}` `` can never be
 * matched by its FULL text at runtime either — see errors.ts's H1 history —
 * so classifying by the reviewable fixed prefix is the correct unit both for
 * this static audit and for runtime safety).
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  FAILURE_HEADER_LITERALS,
  SUCCESS_OR_NEUTRAL_HEADERS,
  FAILURE_STATUS_RE,
  FAILURE_AGENT_STATUS_RE,
  headingClassificationKey,
} from "../../src/_core/errors.js";
import { REGISTERED_TOOL_NAMES } from "../../src/tools/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = resolve(__dirname, "../../src/tools");

const HEADING_RE = /`(#{1,2})[^`\n]*/g;

/** Recursive directory walk — round 4: round 3's `readdirSync(TOOLS_DIR)` was
 *  non-recursive (flagged by the reviewer as a latent gap). Safe to run on an
 *  arbitrary root — used both for the real TOOLS_DIR and the mutation-probe
 *  scratch directory below. */
function walkTsFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkTsFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

interface FoundHeading {
  file: string; // relative to `root`
  heading: string;
}

/** Extracts every formatter-emitted (non-comment) heading literal under `root`. */
function findAllHeadings(root: string): FoundHeading[] {
  const found: FoundHeading[] = [];
  for (const filePath of walkTsFiles(root)) {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const lineOffsets: number[] = [];
    let pos = 0;
    for (const l of lines) {
      lineOffsets.push(pos);
      pos += l.length + 1;
    }
    HEADING_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HEADING_RE.exec(content)) !== null) {
      const idx = m.index;
      let lineNo = 0;
      for (let i = 0; i < lineOffsets.length; i++) {
        if (lineOffsets[i] <= idx) lineNo = i;
        else break;
      }
      const lineText = lines[lineNo] ?? "";
      const colInLine = idx - lineOffsets[lineNo];
      const prefix = lineText.slice(0, colInLine).trim();
      const isComment = prefix.startsWith("//") || prefix.startsWith("*") || prefix.includes("/*");
      if (isComment) continue;
      const raw = m[0].slice(1); // strip leading backtick
      const heading = raw.replace(/\s+$/, "");
      found.push({ file: filePath.replace(root + "/", ""), heading });
    }
  }
  return found;
}

/**
 * Returns every heading under `root` whose classification key is in NEITHER
 * `literals` nor `allowlist` — i.e. the completeness gap. Takes both tables
 * as parameters (not read from the module directly) so the mutation probes
 * can exercise it against a modified copy without touching the real tables.
 */
function findUnclassified(
  root: string,
  literals: ReadonlySet<string>,
  allowlist: ReadonlyMap<string, string>
): FoundHeading[] {
  return findAllHeadings(root).filter(({ heading }) => {
    const key = headingClassificationKey(heading);
    return !literals.has(key) && !allowlist.has(key);
  });
}

describe("F3 completeness — EVERY heading in tools/** is classified (no keyword filter)", () => {
  it("every heading literal found by the recursive scan is in FAILURE_HEADER_LITERALS or SUCCESS_OR_NEUTRAL_HEADERS", () => {
    const gaps = findUnclassified(TOOLS_DIR, FAILURE_HEADER_LITERALS, SUCCESS_OR_NEUTRAL_HEADERS);
    expect(
      gaps,
      gaps.length > 0
        ? `Unclassified heading(s) found — add each (or its headingClassificationKey() prefix) to ` +
          `FAILURE_HEADER_LITERALS or SUCCESS_OR_NEUTRAL_HEADERS in _core/errors.ts:\n` +
          gaps.map((g) => `  ${g.file}: ${JSON.stringify(g.heading)}`).join("\n")
        : undefined
    ).toEqual([]);
  });

  // Mutation probe (a): removing one real entry from FAILURE_HEADER_LITERALS
  // must make the scan report the heading it used to cover as unclassified.
  it("MUTATION PROBE (a): removing a real literal from FAILURE_HEADER_LITERALS makes the scan report it as unclassified", () => {
    const REMOVED = "## Browser API — Not Configured";
    expect(FAILURE_HEADER_LITERALS.has(REMOVED)).toBe(true); // sanity: really in the real table
    const mutated = new Set([...FAILURE_HEADER_LITERALS].filter((h) => h !== REMOVED));
    const gaps = findUnclassified(TOOLS_DIR, mutated, SUCCESS_OR_NEUTRAL_HEADERS);
    expect(gaps.some((g) => g.heading === REMOVED && g.file === "browser.ts")).toBe(true);
  });

  // Mutation probe (b) (reviewer's explicit ask): inject a brand-new,
  // never-seen heading into a SCRATCH COPY of a real tool file (never the
  // real source tree) and prove the scan — against the REAL, unmodified
  // tables — reports it as unclassified. This is the direct proof that an
  // engineer adding a genuinely new failure heading in the future, without
  // updating _core/errors.ts, fails CI.
  describe("MUTATION PROBE (b): a brand-new heading added to a tool file is caught as unclassified", () => {
    let scratchDir: string | undefined;
    afterEach(() => {
      if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
      scratchDir = undefined;
    });

    it("reports the injected heading as a gap against the real tables", () => {
      scratchDir = mkdtempSync(join(tmpdir(), "failure-envelope-probe-"));
      const injected = [
        `export function scratchFormatter(): string {`,
        `  return [`,
        `    \`## Foo — Not Available\`,`,
        `    \`detail line\`,`,
        `  ].join("\\n");`,
        `}`,
        ``,
      ].join("\n");
      writeFileSync(join(scratchDir, "scratch_tool.ts"), injected, "utf8");

      const gaps = findUnclassified(scratchDir, FAILURE_HEADER_LITERALS, SUCCESS_OR_NEUTRAL_HEADERS);
      expect(gaps.some((g) => g.heading === "## Foo — Not Available" && g.file === "scratch_tool.ts")).toBe(true);
    });
  });
});

// ─── Registry-wide failure-path coverage (independent review ask #3, tightened round 4) ──

/**
 * Tool name → implementing file(s), hand-derived from core.ts's dispatch()
 * switch (the single source of truth for which function handles each name).
 * novada_scrape_<platform> tools are NOT listed individually — all 14 route
 * through platform_scraper.ts's shared factory (core.ts: `PLATFORM_SCRAPER_HANDLERS`,
 * checked before the switch) — one entry per CLASS, not per instance.
 */
const TOOL_NAME_TO_FILES: Record<string, string[]> = {
  novada_search: ["search.ts"],
  novada_extract: ["extract.ts"],
  novada_crawl: ["crawl.ts"],
  novada_research: ["research.ts"],
  novada_map: ["map.ts"],
  novada_site_copy: ["site_copy.ts"],
  novada_search_feedback: ["search_feedback.ts"],
  novada_scrape: ["scrape.ts"],
  novada_ai_monitor: ["ai_monitor.ts"],
  novada_monitor: ["monitor.ts"],
  novada_verify: ["verify.ts"],
  novada_proxy: ["proxy.ts"],
  novada_browser: ["browser.ts"],
  novada_browser_flow: ["browser_flow.ts"],
  novada_account: ["account.ts"],
  novada_proxy_account_create: ["proxy_account_create.ts"],
  novada_proxy_account_list: ["proxy_account_list.ts"],
  novada_ip_whitelist: ["ip_whitelist.ts"],
  novada_capture_apikey: ["capture_apikey.ts"],
  novada_static_ip_mgmt: ["static_ip_mgmt.ts"],
  novada_discover: ["discover.ts"],
  novada_setup: ["setup.ts"],
  novada_session_stats: ["session_stats.ts"],
};
/** Prefix rule for the 14 novada_scrape_<platform> tools (checked first). */
const PLATFORM_SCRAPER_FILES = ["platform_scraper.ts"];

function listToolFiles(): string[] {
  return readdirSync(TOOLS_DIR).filter((f) => f.endsWith(".ts"));
}

/**
 * Per-file failure headings — round 4 tightening: returns the ACTUAL set of
 * headings in `file` that classify as failures (i.e. are in
 * FAILURE_HEADER_LITERALS by key), not a boolean "has some signal". Combined
 * with the global exhaustive-classification test above (which guarantees
 * every heading everywhere is in one of the two tables), this closes the
 * round-3 masking bug directly: a tool is "failure-literal-covered" only if
 * ITS OWN file contains a heading that round-trips through
 * FAILURE_HEADER_LITERALS — an unrelated classified-failure heading
 * elsewhere in a shared file no longer counts as covering a DIFFERENT
 * failure heading in that same file (the exact browser.ts bug: "## Browser
 * Mode Unavailable" being present never excused "## Browser API — Not
 * Configured" / "## Browser API — Missing Dependency" from needing their own
 * classification — now enforced by the exhaustive test, and this function
 * lets the registry test show WHICH literals a tool's file actually uses).
 */
function failureHeadingsInFile(file: string): string[] {
  const content = readFileSync(join(TOOLS_DIR, file), "utf8");
  const found = findAllHeadings(TOOLS_DIR).filter((h) => h.file === file);
  // findAllHeadings already walked the whole dir; reuse is simpler than a
  // second scan function — filter to this file's entries.
  void content;
  const out: string[] = [];
  for (const { heading } of found) {
    const key = headingClassificationKey(heading);
    if (FAILURE_HEADER_LITERALS.has(key)) out.push(heading);
  }
  return [...new Set(out)];
}

function fileHasStatusMarkerSignal(file: string): boolean {
  const content = readFileSync(join(TOOLS_DIR, file), "utf8");
  return FAILURE_STATUS_RE.test(content) || FAILURE_AGENT_STATUS_RE.test(content);
}

/** A tool is covered if EITHER its file(s) contain at least one failure
 *  heading (which — by the exhaustive test above — is guaranteed to be a
 *  real FAILURE_HEADER_LITERALS entry, not a maybe), OR a failure-shaped
 *  status marker. */
function toolIsCovered(files: string[]): boolean {
  return files.some((f) => failureHeadingsInFile(f).length > 0 || fileHasStatusMarkerSignal(f));
}

describe("F3 completeness — every registered tool name has a documented failure path", () => {
  it("every tool in REGISTERED_TOOL_NAMES is either covered by its OWN file's failure heading(s)/status marker, or explicitly listed as throws-only", () => {
    const unmapped: string[] = [];
    for (const name of REGISTERED_TOOL_NAMES) {
      const files = name.startsWith("novada_scrape_") && name !== "novada_scrape"
        ? PLATFORM_SCRAPER_FILES
        : TOOL_NAME_TO_FILES[name];
      if (!files) unmapped.push(name);
    }
    expect(unmapped, unmapped.length > 0
      ? `Tool name(s) in REGISTERED_TOOL_NAMES have no entry in TOOL_NAME_TO_FILES — add one: ${unmapped.join(", ")}`
      : undefined
    ).toEqual([]);
  });

  it("every TOOL_NAME_TO_FILES file actually exists under src/tools/", () => {
    const allFiles = new Set(listToolFiles());
    const missing: string[] = [];
    for (const files of Object.values(TOOL_NAME_TO_FILES)) {
      for (const f of files) if (!allFiles.has(f)) missing.push(f);
    }
    for (const f of PLATFORM_SCRAPER_FILES) if (!allFiles.has(f)) missing.push(f);
    expect(missing).toEqual([]);
  });

  it("documents the throws-only tools — snapshot asserted against toolIsCovered(), not hand-trusted", () => {
    const throwsOnly = Object.entries(TOOL_NAME_TO_FILES)
      .filter(([, files]) => !toolIsCovered(files))
      .map(([name]) => name)
      .sort();
    // Verified by hand for each entry (round 3/4 reports): novada_ai_monitor
    // and novada_proxy fold per-sub-query/optional-verification failures into
    // an AGGREGATE success-shaped result (same partial-success pattern as
    // novada_research's status:partial) rather than ever returning a
    // whole-call failure string — throws-only is correct for the WHOLE tool
    // call, not a gap. The rest never emit a failure-shaped string at all by
    // the exhaustive scan above.
    expect(throwsOnly).toEqual([
      "novada_account",
      "novada_ai_monitor",
      "novada_capture_apikey",
      "novada_crawl",
      "novada_discover",
      "novada_ip_whitelist",
      "novada_map",
      "novada_proxy",
      "novada_proxy_account_create",
      "novada_proxy_account_list",
      "novada_scrape",
      "novada_search_feedback",
      "novada_session_stats",
      "novada_setup",
      "novada_site_copy",
      "novada_static_ip_mgmt",
    ]);
  });

  it("browser.ts specifically is covered by its OWN 3 failure headings, not masked by one covering for the others (round-3 bug, direct regression test)", () => {
    const headings = failureHeadingsInFile("browser.ts").sort();
    expect(headings).toEqual([
      "## Browser API — Missing Dependency",
      "## Browser API — Not Configured",
      "## Browser Mode Unavailable",
    ]);
  });
});
