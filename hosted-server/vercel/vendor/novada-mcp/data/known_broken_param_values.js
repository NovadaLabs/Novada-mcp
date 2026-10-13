// ─── Known-broken parameter VALUES ───────────────────────────────────────────
// Round 4 (S1-connector, F7 — final-exam verifier, live-verified 2026-10-13).
//
// Mirrors scraper_catalog.ts's backend_broken OPERATION pattern, one level
// down: an operation itself can be perfectly healthy while one SPECIFIC
// parameter VALUE deterministically fails upstream. Reproduced live:
// novada_scrape_yandex (and the equivalent generic novada_scrape(platform=
// "yandex.com", operation="yandex", ...) call — same catalog op, same param)
// with yandex_domain="yandex.com" fails 4/4 with upstream code 10000 ("serp
// capture failed" / API_DOWN), while yandex_domain="yandex.ru" and
// "yandex.com.tr" succeed in ~3s on the identical query. "Reordering examples
// is not enough" (the exam verifier's own finding) — Directory review requires
// every tool to SUCCEED for valid input, and "yandex.com" is still structurally
// ACCEPTED as a valid value (the catalog's own opts list still contains it) —
// so an agent who picks it from that list, or copies the OLD example, still
// hits a guaranteed failure.
//
// Fix: reject the known-broken value PRE-FLIGHT (before any network call),
// same as scraper_catalog.ts's status flags gate operations — one generic
// table lookup in preflightScrape (scrape.ts), no per-platform if-branch. A
// future platform/param/value combination that goes broken needs ONE new row
// here, never new logic.
//
// Escalation note (NOT fixed here — a backend issue, not an MCP bug): yandex.com
// SERP capture appears broken UPSTREAM at the Novada Scraper API / scraper
// backend level (the catalog param options list still includes it as if
// healthy) — flagged in S1-report.md's Round 4 section for owner escalation.
export const KNOWN_BROKEN_PARAM_VALUES = [
    {
        platform: "yandex.com",
        operation: "yandex",
        param: "yandex_domain",
        value: "yandex.com",
        verifiedOn: "2026-10-13",
        evidence: "4/4 live calls -> upstream code 10000 (\"serp capture failed\" / API_DOWN); " +
            "yandex_domain=\"yandex.ru\" and \"yandex.com.tr\" succeed in ~3s on the identical query",
        workingAlternatives: ["yandex.ru", "yandex.com.tr"],
    },
];
/**
 * Pure lookup — true iff `platform`/`operation`/`param`/`value` exactly matches a
 * row in KNOWN_BROKEN_PARAM_VALUES. `value` is compared as a string (params
 * flowing through MCP tool calls are frequently strings regardless of the
 * caller's JS type, so this coerces rather than requiring strict `===`).
 */
export function findKnownBrokenParamValue(platform, operation, param, value) {
    if (value === undefined || value === null)
        return undefined;
    const stringValue = String(value);
    return KNOWN_BROKEN_PARAM_VALUES.find((row) => row.platform === platform &&
        row.operation === operation &&
        row.param === param &&
        row.value === stringValue);
}
//# sourceMappingURL=known_broken_param_values.js.map