/**
 * C1 (#39, 2026-11-18 reliability program): ONE search-engine-fallback race
 * policy, shared by novada_search (search.ts's `novadaSearch`) and
 * novada_research (research.ts's `searchWithFallback`) — both submit a SERP
 * query to the same Scraper API `/request` endpoint and hit the exact same
 * transient-failure class (upstream 5xx, "serp capture failed", no-task_id).
 * Before this fix the two tools had INDEPENDENTLY-written race logic for that
 * one failure class: research.ts raced 2 fallback engines after its primary
 * attempt failed/emptied; search.ts's `novadaSearch` had only a same-engine
 * single retry (`withSingleSerpRetry`, _core/submit-retry.ts) and surfaced the
 * raw error with no second engine ever attempted. Class-not-instance: fixing
 * the fallback-race behavior in only one of the two search tools left the
 * other exposed to the identical upstream blip (same shape as the
 * submit-retry.ts module's own history — see that file's doc comment).
 *
 * This module owns ONLY the generic "race N attempts, first non-empty wins"
 * control flow. It has no notion of which engines exist or how to submit to
 * them — each caller supplies its own list of `FallbackAttempt`s (a label +
 * an async fn), so search.ts's 3-engine universe (google/duckduckgo/yandex)
 * and research.ts's internal fallback pair (duckduckgo/bing, used only
 * server-side — not part of novada_search's public `engine` enum) stay
 * independent while sharing the ONE race mechanism.
 */
/** Sentinel so an attempt that legitimately completes with zero results can
 *  be skipped by `Promise.any` (so a slower-but-non-empty attempt still
 *  wins) without being confused for a genuine thrown failure. */
class EmptyAttemptResult extends Error {
    label;
    constructor(label) {
        super(`empty results from ${label}`);
        this.label = label;
    }
}
/**
 * Race every attempt in `attempts` in parallel; the first to resolve with a
 * NON-EMPTY result array wins (`Promise.any` semantics — slower attempts are
 * simply ignored once one wins, not cancelled). Returns an empty outcome when
 * every attempt either threw or completed empty; `hadError` is `false` only
 * when EVERY "loss" was a legitimate empty result (no thrown error anywhere),
 * so a genuinely-empty SERP across all engines is never misreported as a
 * failure, and a genuine failure is never misreported as an empty SERP.
 */
export async function raceEngineFallbacks(attempts) {
    if (attempts.length === 0) {
        return { results: [], servedBy: null, hadError: false };
    }
    const wrapped = attempts.map((a) => a.run().then((results) => {
        if (results.length === 0)
            throw new EmptyAttemptResult(a.label);
        return { results, label: a.label };
    }));
    try {
        const won = await Promise.any(wrapped);
        return { results: won.results, servedBy: won.label, hadError: false };
    }
    catch (err) {
        const errors = err instanceof AggregateError ? err.errors : [err];
        const hadError = errors.some((e) => !(e instanceof EmptyAttemptResult));
        return { results: [], servedBy: null, hadError };
    }
}
//# sourceMappingURL=search-fallback.js.map