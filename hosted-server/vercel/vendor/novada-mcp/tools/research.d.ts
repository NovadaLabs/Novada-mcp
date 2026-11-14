import type { ResearchParams } from "./types.js";
import type { ProgressReporter } from "./crawl.js";
/** Extract candidate comparands from a comparison question. Groups adjacent
 *  comparand tokens into one phrase (comma or list-connector = hard
 *  boundary even between two capitalized tokens, so "O2, Telekom" stays two
 *  comparands while "Deutsche Telekom" — no separator between them — stays
 *  one). Stops entirely once ≥2 comparands have been found and the list is
 *  closed by an ordinary word, so trailing topic/location words ("in
 *  Germany: prices, speeds...") are never misread as more comparands. */
export declare function extractComparands(question: string): string[];
export declare function novadaResearch(params: ResearchParams, apiKey: string, onProgress?: ProgressReporter): Promise<string>;
/** Generate diverse search queries for broader research coverage.
 *
 * F14-2: Use the full `topic` string (not a truncated 4-word keyPhrase) as the
 * base for all derived sub-queries so that named entities (proper nouns at word
 * positions 5+) survive into search sub-queries. The keyPhrase is still derived
 * for the reddit/hn social queries where shorter phrases work better.
 *
 * research-query-quality-2026-11-14: three further fixes layered on top of
 * the above, driven by a live owner report (German business-broadband
 * question → irrelevant, near-duplicate results):
 *  1. Comparison questions (EN "vs"/"compare X, Y and Z" and DE "Vergleich"/
 *     comma lists) now get ONE targeted query per comparand + the residual
 *     topic phrase, plus one side-by-side query — instead of the full
 *     question padded with a generic suffix (which produced near-duplicate
 *     searches and truncated multi-word entities like "Deutsche Telekom").
 *  2. The generic (non-comparison) suffix table is now per-language
 *     (DOMAIN_SUFFIXES_BY_LANG) and the social/HN filler queries — which
 *     have no clean non-English equivalent — are skipped entirely for a
 *     detected non-English question rather than appending English filler.
 *  3. "2024 2025 trends" / "best practices 2025" are now computed from
 *     `new Date()` at call time, never hard-coded.
 * Every generated query is deduped (case/whitespace-insensitive) before
 * returning, so no future suffix addition can reintroduce a near-duplicate.
 */
export declare function generateSearchQueries(question: string, deep: boolean, comprehensive: boolean, focus?: string): string[];
//# sourceMappingURL=research.d.ts.map