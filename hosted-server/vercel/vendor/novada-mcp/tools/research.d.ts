import type { ResearchParams } from "./types.js";
import type { ProgressReporter } from "./crawl.js";
/** Extract candidate comparands from a comparison question. Groups adjacent
 *  comparand tokens into one phrase (comma or list-connector = hard
 *  boundary even between two capitalized tokens, so "O2, Telekom" stays two
 *  comparands while "Deutsche Telekom" — no separator between them — stays
 *  one; "A vs B vs C vs D" stays four, since "vs" is a connector, not a
 *  list-terminator). A generic noun right after a single-word comparand ends
 *  that phrase at one word instead of extending it to two. Stops entirely
 *  once ≥2 comparands have been found and the list is closed by an ordinary
 *  word, so trailing topic/location words ("in Germany: prices, speeds...")
 *  are never misread as more comparands. */
export declare function extractComparands(question: string): string[];
export declare function novadaResearch(params: ResearchParams, apiKey: string, onProgress?: ProgressReporter): Promise<string>;
/** Generate diverse search queries for broader research coverage.
 *
 * F14-2: Use the full `topic` string (not a truncated 4-word keyPhrase) as the
 * base for all derived sub-queries so that named entities (proper nouns at word
 * positions 5+) survive into search sub-queries.
 *
 * research-query-quality-2026-11-14 (round 1 + round 2 review fixes):
 *  1. Comparison questions — EN "vs"/"compare X, Y and Z", DE "Vergleich"/
 *     comma lists, FR "comparaison"/"entre...et", ES "comparación"/
 *     "entre...y", and "vs"-CHAINS of any length ("A vs B vs C vs D") — now
 *     get ONE targeted query per comparand + the residual topic phrase, plus
 *     one side-by-side query, instead of the full question padded with a
 *     generic suffix. Comparison connectors (and/und/et/y, vs/versus/gegen/
 *     contre/contra) are ONE shared table (LIST_CONNECTOR_WORDS), not a
 *     comma-only special case, so a 3+-item "vs"-chain is never truncated.
 *  2. The generic (non-comparison) suffix table is per-language (en/de/fr/
 *     es). A genuinely unsupported language (detectLanguage returns
 *     "unknown" — different script) gets ZERO filler suffixes appended
 *     (fail safe) rather than a guessed-English or guessed-translated one.
 *  3. "2024 2025 trends" / "best practices 2025" are computed from
 *     `new Date()` at call time, never hard-coded.
 *  4. A per-comparand query is only emitted when the topic residual is
 *     non-empty — a bare 1-token query ("TCP") is skipped in favor of the
 *     side-by-side query ("TCP vs UDP"), which always has disambiguating
 *     context.
 * Every generated query is deduped (case/whitespace-insensitive) before
 * returning, so no future suffix addition can reintroduce a near-duplicate.
 */
export declare function generateSearchQueries(question: string, deep: boolean, comprehensive: boolean, focus?: string): string[];
//# sourceMappingURL=research.d.ts.map