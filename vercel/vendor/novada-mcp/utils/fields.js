import * as cheerio from "cheerio";
/** Confidence per source — single source of truth so callers don't re-derive. */
const SOURCE_CONFIDENCE = {
    jsonld: 0.95,
    microdata: 0.9,
    infobox: 0.85,
    table: 0.8,
    pattern: 0.6,
    heading: 0.45,
    llm: 0.5,
    unresolved: 0,
};
/** Price patterns: $9.99, €1,299.00, £49, ¥2000, 99.99 USD */
const PRICE_PATTERNS = [
    /(?:price|cost|was|now)[:\s]*([€$£¥₹]\s*[\d,]+(?:\.\d{2})?)/i,
    /([€$£¥₹]\s*[\d,]+(?:\.\d{2})?)/,
    /([\d,]+(?:\.\d{2})?\s*(?:USD|EUR|GBP|JPY|CAD|AUD))/i,
];
/** Date patterns */
const DATE_PATTERNS = [
    /(?:published|updated|posted|date)[:\s]*([A-Z][a-z]+ \d{1,2},?\s+\d{4})/i,
    /(?:published|updated|posted|date)[:\s]*(\d{4}-\d{2}-\d{2})/i,
    /(\d{1,2}\s+[A-Z][a-z]+\s+\d{4})/,
];
/** Author patterns */
const AUTHOR_PATTERNS = [
    /(?:by|author|written by)[:\s]+([A-Z][a-zA-Z\s.]{2,40}?)(?:\s*[,|\n|·])/i,
    /\*\*(?:by|author)[:\s]*\*\*\s*([A-Z][a-zA-Z\s.]{2,40})/i,
];
/** Rating patterns: 4.5/5, 4.5 stars, ★4.7 */
const RATING_PATTERNS = [
    /(\d+(?:\.\d+)?)\s*(?:\/\s*5|out of 5|stars?|★)/i,
    /(?:rating|rated|score)[:\s]*(\d+(?:\.\d+)?)/i,
];
/** Availability patterns */
const AVAILABILITY_PATTERNS = [
    /(in stock|out of stock|available|unavailable|ships? in \d+|pre-?order|sold out|backorder)/i,
];
/** Title patterns: first H1, or "title: X" */
const TITLE_PATTERNS = [
    /^#\s+(.{2,200}?)(?:\s*\n|$)/m,
    /^##\s+(.{2,200}?)(?:\s*\n|$)/m,
    /^title[:\s]+(.{2,200}?)(?:\s*\n|$)/im,
];
/** Description patterns: "description: X" or first substantial sentence */
const DESCRIPTION_PATTERNS = [
    /(?:description|summary)[:\s]+(.{10,300}?)(?:\n|$)/i,
    /^(?!#)([A-Z][^.!?\n]{30,250}[.!?])\s*$/m,
    /^(?!#)([A-Z][^.!?\n]{15,200})$/m,
];
/** Stars/watchers — GitHub link-wrapped counts and inline formats */
const STARS_PATTERNS = [
    /\[(?:Star|⭐|star)\s*([\d,.]+[kKmM]?)\]/i,
    /(?:star[s]?)[:\s]+([\d]+\.?[\d]*[kKmMbB]?)/i,
    /(?:star[s]?\s*[:·]\s*)([\d,.]+[kKmM]?)/i,
    /\*\*([\d,.]+)\*\*\s*stars?/i,
    /([\d,.]+[kKmM]?)\s+stars?/i,
];
/** Programming language — GitHub percentage stats and inline labels */
const LANGUAGE_PATTERNS = [
    /^([A-Z][a-zA-Z+#]{1,20})\s+\d{1,3}(?:\.\d+)?%\s*$/m,
    /([A-Za-z+#]+)\s+\d+\.?\d*%/,
    /(?:language|lang(?:uage)?)[:\s]+([A-Za-z+#]{2,20})/i,
    /\*\*([A-Z][a-zA-Z+#]{1,20})\*\*\s+\d{1,3}(?:\.\d+)?%/,
];
/** License — inline labels, link text, and prose */
const LICENSE_PATTERNS = [
    /(?:license|licence)[:\s]+([A-Z][A-Za-z\s\-.]{2,40}?)(?:\n|$)/i,
    /licensed under (?:the )?([^.]+license[^.]*)/i,
    /\[([^\]]*(?:MIT|Apache|GPL|BSD|ISC|CC BY|LGPL|MPL|AGPL)[^\]]*)\]/i,
    /(MIT|Apache[\s-]\d+\.\d+|GPL(?:v\d+)?|BSD[\s-]\d+-[Cc]lause|ISC|LGPL)\s+[Ll]icense/,
    /\b(MIT|Apache[\s-]\d+\.\d+|GPL(?:v\d+)?|BSD[\s-]\d+-[Cc]lause|ISC|LGPL)\b/i,
];
/**
 * Ratios like P/E values. ONLY the label-anchored form — a bare decimal (e.g. a
 * "3.21%" change or a "4.30 PM" time elsewhere in prose) must never resolve a
 * ratio field, so we deliberately do NOT fall back to a generic `\d+.\d+` match.
 *
 * NOTE: there are deliberately NO bare PERCENT/BIG_NUMBER patterns here. A field like
 * `change` or `market cap` or `volume` must NOT have an unanchored entry in PATTERN_MAP:
 * step 7 (matchPatterns over the whole markdown) would otherwise fire on the FIRST
 * percent / big-number ANYWHERE on the page — e.g. extractFields(['change'], …,
 * 'satisfaction improved 95% last year') would confidently return '95%'. Those finance
 * fields resolve only via the label-aware layers (table / adjacent / tolerant-regex /
 * proximity), each of which anchors the value to its label. P/E stays here because the
 * pattern itself carries the `p/e`/`ratio` label.
 */
const RATIO_PATTERNS = [
    /(?:p\/?e|ratio)[:\s]*(\d+(?:\.\d+)?)/i,
];
const PATTERN_MAP = {
    title: TITLE_PATTERNS,
    description: DESCRIPTION_PATTERNS,
    "meta description": DESCRIPTION_PATTERNS,
    price: PRICE_PATTERNS,
    cost: PRICE_PATTERNS,
    date: DATE_PATTERNS,
    published: DATE_PATTERNS,
    "published date": DATE_PATTERNS,
    updated: DATE_PATTERNS,
    author: AUTHOR_PATTERNS,
    "written by": AUTHOR_PATTERNS,
    rating: RATING_PATTERNS,
    score: RATING_PATTERNS,
    availability: AVAILABILITY_PATTERNS,
    stock: AVAILABILITY_PATTERNS,
    stars: STARS_PATTERNS,
    star: STARS_PATTERNS,
    "programming language": LANGUAGE_PATTERNS,
    language: LANGUAGE_PATTERNS,
    license: LICENSE_PATTERNS,
    licence: LICENSE_PATTERNS,
    // Finance / stat fields: ONLY label-anchored P/E lives here. change / market cap /
    // volume are intentionally absent — see RATIO_PATTERNS note — so an unanchored
    // percent or big-number elsewhere on the page can never resolve them. They are
    // covered by the label-aware table / adjacent / tolerant-regex / proximity layers.
    pe: RATIO_PATTERNS,
    "p/e": RATIO_PATTERNS,
    "pe ratio": RATIO_PATTERNS,
    "p/e ratio": RATIO_PATTERNS,
};
/**
 * Field-alias map: normalize agent-friendly field names to the canonical key used by
 * PATTERN_MAP and the label-matching layers. Lower-cased keys → canonical lower-cased name.
 * Applied to derive `lower` before any layer runs.
 */
const FIELD_ALIASES = {
    "stock price": "price",
    "share price": "price",
    "current price": "price",
    "pe ratio": "pe",
    "p/e ratio": "pe",
    "p/e": "pe",
    "price to earnings": "pe",
    "market capitalization": "market cap",
    "mkt cap": "market cap",
    "marketcap": "market cap",
    "change percent": "change",
    "percent change": "change",
    "% change": "change",
    "day change": "change",
    "52 week range": "52 week",
    "52-week range": "52 week",
    "fifty two week range": "52 week",
};
/** Resolve a field name to its canonical lower-cased form via the alias map. */
function canonicalField(field) {
    const lower = field.toLowerCase().trim();
    return FIELD_ALIASES[lower] ?? lower;
}
function matchPatterns(text, patterns) {
    for (const pattern of patterns) {
        const m = text.match(pattern);
        if (m?.[1])
            return m[1].trim();
    }
    return null;
}
/**
 * Fuzzy label-match score: exact (3) > startsWith (2) > includes (1) > 0.
 * Bidirectional includes so "mkt cap" matches "market cap" cells and vice-versa.
 */
function labelMatchScore(label, field) {
    const l = label.toLowerCase().trim();
    const f = field.toLowerCase().trim();
    if (!l || !f)
        return 0;
    if (l === f)
        return 3;
    if (l.startsWith(f) || f.startsWith(l))
        return 2;
    if (l.includes(f) || f.includes(l))
        return 1;
    return 0;
}
/** Extract first non-empty line from a markdown section whose heading matches `field`. */
function matchHeadingSection(text, field) {
    const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const lines = text.split("\n");
    let inSection = false;
    const sectionLines = [];
    const headingRe = new RegExp(`^#+\\s+${escapedField}\\s*$`, "i");
    const nextHeadingRe = /^#+\s/;
    for (const line of lines) {
        if (!inSection) {
            if (headingRe.test(line)) {
                inSection = true;
            }
            continue;
        }
        // Stop at next heading
        if (nextHeadingRe.test(line))
            break;
        sectionLines.push(line);
    }
    if (!inSection || sectionLines.length === 0)
        return null;
    const firstNonEmpty = sectionLines.find(l => l.trim().length > 2);
    return firstNonEmpty?.trim() ?? null;
}
/**
 * Like matchHeadingSection but returns a reason alongside the value.
 * Zero impact on existing callers of matchHeadingSection.
 */
export function matchHeadingSectionWithReason(text, field) {
    const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const lines = text.split("\n");
    let inSection = false;
    const sectionLines = [];
    const headingRe = new RegExp(`^#+\\s+${escapedField}\\s*$`, "i");
    const nextHeadingRe = /^#+\s/;
    for (const line of lines) {
        if (!inSection) {
            if (headingRe.test(line)) {
                inSection = true;
            }
            continue;
        }
        if (nextHeadingRe.test(line))
            break;
        sectionLines.push(line);
    }
    if (!inSection) {
        return { value: null, reason: "no_heading_match" };
    }
    const firstNonEmpty = sectionLines.find(l => {
        const t = l.trim();
        if (t.length <= 2)
            return false;
        if (t.startsWith("```") || t.startsWith("~~~"))
            return false;
        return true;
    });
    if (!firstNonEmpty) {
        return { value: null, reason: "section_empty" };
    }
    return { value: firstNonEmpty.trim(), reason: "matched" };
}
/** Extract field value from Wikipedia-style infobox tables. Accepts a pre-loaded $ to avoid reparsing. */
function extractFromInfobox($, fieldName) {
    const rows = $("table.infobox tr, table.vcard tr");
    const best = { score: 0, value: null };
    for (let i = 0; i < rows.length; i++) {
        const th = $(rows[i]).find("th").text().trim();
        const td = $(rows[i]).find("td").text().trim();
        if (!th || !td)
            continue;
        const score = labelMatchScore(th, fieldName);
        if (score > 0 && score > best.score) {
            best.score = score;
            best.value = td.slice(0, 200);
        }
    }
    return best.value;
}
/** Extract field value by matching table column headers. Accepts a pre-loaded $. */
function extractFromTableHeaders($, fieldName) {
    let result = null;
    $("table").each((_, table) => {
        if (result)
            return; // already found
        const headers = $(table).find("th").map((__, th) => $(th).text().trim().toLowerCase()).get();
        const colIdx = headers.findIndex(h => h.includes(fieldName.toLowerCase()));
        if (colIdx >= 0) {
            const firstRow = $(table).find("tbody tr").first();
            const cell = firstRow.find("td").eq(colIdx).text().trim();
            if (cell) {
                result = cell.slice(0, 200);
            }
        }
    });
    return result;
}
/**
 * Extract field value from finance/spec row-label tables where the label sits in the
 * first cell and the value in the second (e.g. "| Market Cap | 233.37B |"), plus
 * <dl> definition lists (<dt> label / <dd> value). Ranked + shape-constrained:
 *  - require >= 2 cells in a <tr>
 *  - reject rows where the "value" cell is itself long prose (> 80 chars) — likely not a stat
 *  - pick the highest fuzzy label-match score across all candidate rows
 * Accepts a pre-loaded $.
 */
function extractFromLabelValueRows($, fieldName) {
    const best = { score: 0, value: null };
    const consider = (rawLabel, rawValue) => {
        const label = rawLabel.trim();
        const value = rawValue.trim();
        if (!label || !value)
            return;
        // Shape constraint: a stat value is short. Long second cells are prose, not values.
        if (value.length > 80)
            return;
        const score = labelMatchScore(label, fieldName);
        if (score > 0 && score > best.score) {
            best.score = score;
            best.value = value.slice(0, 200);
        }
    };
    // Row-label tables: first cell = label, second cell = value.
    $("tr").each((_, tr) => {
        const cells = $(tr).find("th, td");
        if (cells.length < 2)
            return;
        const labelCell = $(cells[0]).text();
        const valueCell = $(cells[1]).text();
        consider(labelCell, valueCell);
    });
    // Definition lists: dt → dd pairs.
    $("dl").each((_, dl) => {
        const dts = $(dl).find("dt");
        dts.each((__, dt) => {
            const label = $(dt).text();
            const dd = $(dt).next("dd");
            if (dd.length)
                consider(label, dd.text());
        });
    });
    return best.value;
}
/** Extract field value from Schema.org microdata (itemprop attributes). Accepts a pre-loaded $. */
function extractFromMicrodata($, fieldName) {
    const el = $(`[itemprop="${fieldName}"], [itemprop="${fieldName.toLowerCase()}"]`).first();
    if (el.length) {
        const val = (el.attr("content") || el.text().trim()).slice(0, 200);
        return val || null;
    }
    return null;
}
/**
 * Whole-word class-token match. `word` matches a class token only when it appears as a
 * full sub-token bounded by start/end of the token or a `-`/`_` separator. This rejects
 * the substring false positives that `[class*='…']` produces:
 *   - "change" must NOT match `exchange-rate`   (preceded by "ex", no boundary)
 *   - "change" must NOT match `changelog-version` (followed by "log", no boundary)
 *   - "price"  must NOT match `price-disclaimer`  via the value (handled by numeric guard)
 * but it SHOULD still match `change`, `change-positive`, `stock-change`, `pct-change`.
 */
function classTokenHasWord(className, word) {
    if (!className)
        return false;
    const w = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // (^|-|_)word(-|_|$) within each whitespace-separated class token.
    const re = new RegExp(`(?:^|[-_])${w}(?:[-_]|$)`, "i");
    return className.split(/\s+/).some((tok) => re.test(tok));
}
/** A hero stat value is a number (optionally currency / sign / %% / K-M-B-T suffix). */
function looksLikeStatValue(v) {
    if (!/\d/.test(v))
        return false; // must contain a digit
    // Reject prose: a real hero value has very few letters (a currency code or K/M/B/T at most).
    const letters = (v.match(/[A-Za-z]/g) ?? []).length;
    return letters <= 4;
}
/**
 * Hero stat blocks: a value sits in a sibling/descendant element flagged by class, with
 * no tabular label — e.g. `<span class="price">$72.13</span>`, `<span class="change">+1.24%</span>`.
 *
 * Targets each field via a small set of class WORD-tokens (matched with whole-word
 * boundaries, not substrings) plus exact data-testid / itemprop hints, then requires the
 * captured text to look like a numeric stat value. Both gates are needed: `exchange-rate`,
 * `changelog-version`, and `price-disclaimer` widgets are ubiquitous on finance pages and
 * a substring selector would mis-resolve them at high confidence. Accepts a pre-loaded $.
 */
function extractFromAdjacentPairs($, canonical) {
    // class word-tokens to look for, plus exact attribute selectors that are already safe.
    const HINTS = {
        price: { classWords: ["price"], exact: ["[data-testid='price']", "[itemprop='price']"] },
        change: { classWords: ["change", "pct", "percent"], exact: ["[data-testid='change']"] },
        "market cap": { classWords: ["market-cap", "mktcap", "marketcap"], exact: ["[data-testid='market-cap']"] },
    };
    const hint = HINTS[canonical];
    if (!hint)
        return null;
    const accept = (raw) => {
        const val = raw.trim();
        // Hero values are short; ignore containers that swallowed the page, and reject prose.
        if (val && val.length <= 60 && looksLikeStatValue(val))
            return val.slice(0, 200);
        return null;
    };
    // 1. Exact attribute selectors (data-testid / itemprop) — no substring ambiguity.
    for (const sel of hint.exact) {
        const el = $(sel).first();
        if (el.length) {
            const v = accept(el.text());
            if (v)
                return v;
        }
    }
    // 2. Class word-token scan. Pull a candidate set with a cheap substring selector, then
    //    keep only elements whose className contains the word as a whole token.
    for (const word of hint.classWords) {
        let found = null;
        $(`[class*='${word.split("-")[0]}']`).each((_, el) => {
            if (found)
                return;
            const className = $(el).attr("class") ?? "";
            if (!classTokenHasWord(className, word))
                return;
            const v = accept($(el).text());
            if (v)
                found = v;
        });
        if (found)
            return found;
    }
    return null;
}
/**
 * Canonical fields whose value is always numeric. For these, the tolerant and proximity
 * layers must reject a captured value that has no digit, so a heading-like prose line
 * (e.g. "Market Cap     refers to total value of shares outstanding") can never resolve
 * the field to a sentence.
 */
const STAT_FIELDS = new Set([
    "change",
    "market cap",
    "volume",
    "pe",
    "price",
    "52 week",
]);
/**
 * Tolerant labelled-value regex over markdown. Handles forms a colon-only matcher misses:
 *  - GFM pipe rows:  "| Market Cap | 233.37B |"
 *  - multi-space:    "Market Cap     233.37B"
 *  - colon/equals:   "Market Cap: 233.37B"  /  "Market Cap = 233.37B"
 *  - en-dash range:  "52 Week Range — 60.10 - 88.41"
 * Anchored to the (escaped) field/alias label. Value capture stops at row/line/pipe end.
 *
 * `requireDigit` (set for STAT_FIELDS) makes the non-pipe branch reject a captured value
 * with no digit — the multi-space alternation otherwise grabs the next prose line and
 * mis-resolves a numeric stat to a sentence. The GFM pipe branch is structural (a data
 * table cell) so it is left unguarded.
 */
function tolerantLabelledValue(markdown, fieldName, requireDigit = false) {
    const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
        // GFM pipe table cell: | Label | Value | (structural — no digit guard)
        { re: new RegExp(`\\|\\s*${escaped}\\s*\\|\\s*([^|\\n]{1,80}?)\\s*\\|`, "i"), guardDigit: false },
        // Label followed by colon / equals / en-dash / 2+ spaces, then value to EOL.
        { re: new RegExp(`(?:^|\\n)\\s*(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*(?::|=|—|–|\\s{2,})\\s*([^\\n|]{1,80})`, "i"), guardDigit: requireDigit },
    ];
    for (const { re, guardDigit } of patterns) {
        const m = markdown.match(re);
        if (m?.[1]) {
            const v = m[1].trim().replace(/\*\*/g, "").replace(/\s*\|\s*$/, "").trim();
            if (v && (!guardDigit || /\d/.test(v)))
                return v;
        }
    }
    return null;
}
/**
 * Number-near-label proximity for finance stats. When the label and its number are not on
 * the same "Label: value" line but are close together (e.g. a stat card rendered as
 * "Market Cap\n233.37B" or "Market Cap 233.37B 1.2%"), grab the FIRST number-shaped token
 * within a short window after the label. Runs after the structured layers so it only
 * salvages prose. Looks for percent, K/M/B/T big-numbers, currency, or ratios.
 */
function numberNearLabel(markdown, fieldName) {
    const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Window: label, then up to ~40 chars of separators/words, then a number-shaped token.
    const NUMBER_TOKEN = "([+-]?[€$£¥₹]?\\s*[\\d,]+(?:\\.\\d+)?\\s*[KkMmBbTt%]?)";
    const re = new RegExp(`${escaped}[^\\dKkMmBbTt%+-]{0,40}?${NUMBER_TOKEN}`, "i");
    const m = markdown.match(re);
    if (m?.[1]) {
        const v = m[1].trim();
        if (v && /\d/.test(v))
            return v;
    }
    return null;
}
/**
 * Build the non-silent agent_instruction emitted on an unresolved field, listing the
 * layers that were attempted so the agent knows the null is explained, not silent.
 */
function unresolvedInstruction(field, attempted) {
    return `'${field}' not found in ${attempted.join("/")}; the value may be in the page body — re-read the content, or retry with render="render" to fetch JS-rendered values.`;
}
/**
 * Env-gated LLM extraction hook. DISABLED by default and intentionally unimplemented:
 * wiring a real model call would add a new dependency / network round-trip that is out of
 * scope for NOV-564. Left as a single seam so a future change can drop the layer in without
 * touching the chain. Returns null unless NOVADA_FIELDS_LLM is truthy AND an implementation
 * is supplied (none is today), so behavior is a guaranteed no-op now.
 */
function llmExtractStub(_field, _markdown, _html) {
    if (!process.env.NOVADA_FIELDS_LLM)
        return null;
    // No implementation by design (no new dep). Treated as unavailable.
    return null;
}
/** Make a resolved result with the canonical confidence for its source. */
function resolved(field, value, source, attempted) {
    return { field, value, source, confidence: SOURCE_CONFIDENCE[source], attempted };
}
/**
 * Extract requested fields from structured data + HTML layers + markdown fallback.
 *
 * Chain order (per field):
 *   jsonld → infobox → table-header → label-rows/dl → microdata → adjacent (hero) →
 *   known patterns → generic colon pattern → tolerant labelled-value → number-near-label →
 *   heading section → (llm stub, off) → unresolved
 *
 * cheerio is loaded once per call (shared across fields and layers).
 * Unresolved fields are NON-SILENT: value=null + agent_instruction explaining the miss.
 */
export function extractFields(fields, structuredData, markdown, html) {
    // Load cheerio once per call (not per field, not per layer).
    const $ = html ? cheerio.load(html) : null;
    return fields.map(field => {
        const lower = field.toLowerCase().trim();
        const canonical = canonicalField(field);
        const attempted = [];
        // 1. Structured data (jsonld/meta) — exact then fuzzy key match. Try both the raw
        //    field and its canonical alias so "stock price" can hit a "price" key.
        attempted.push("jsonld");
        if (structuredData?.fields) {
            const sdKeys = Object.keys(structuredData.fields);
            for (const probe of [lower, canonical]) {
                const exact = sdKeys.find(k => k.toLowerCase() === probe);
                const fuzzy = exact ?? sdKeys.find(k => k.toLowerCase().includes(probe) || probe.includes(k.toLowerCase()));
                if (fuzzy) {
                    return resolved(field, structuredData.fields[fuzzy], "jsonld", attempted);
                }
            }
        }
        if ($) {
            // 2. Infobox (Wikipedia-style)
            attempted.push("infobox");
            const infoboxValue = extractFromInfobox($, canonical) ?? extractFromInfobox($, field);
            if (infoboxValue)
                return resolved(field, infoboxValue, "infobox", attempted);
            // 3. Table header
            attempted.push("table");
            const tableValue = extractFromTableHeaders($, canonical) ?? extractFromTableHeaders($, field);
            if (tableValue)
                return resolved(field, tableValue, "table", attempted);
            // 4. Label/value rows + definition lists (finance row tables)
            attempted.push("label-rows");
            const rowValue = extractFromLabelValueRows($, canonical) ?? extractFromLabelValueRows($, field);
            if (rowValue)
                return resolved(field, rowValue, "table", attempted);
            // 5. Microdata (Schema.org itemprop)
            attempted.push("microdata");
            const microdataValue = extractFromMicrodata($, canonical) ?? extractFromMicrodata($, field);
            if (microdataValue)
                return resolved(field, microdataValue, "microdata", attempted);
            // 6. Adjacent hero stat blocks (.price, [class*=change]). Matched by class/attribute
            //    token, not a real table row — score it at the pattern tier, not table confidence.
            attempted.push("adjacent");
            const adjacentValue = extractFromAdjacentPairs($, canonical);
            if (adjacentValue)
                return resolved(field, adjacentValue, "pattern", attempted);
        }
        // 7. Known pattern matching in markdown (canonical first, then raw field key).
        attempted.push("pattern");
        const patterns = PATTERN_MAP[canonical] ?? PATTERN_MAP[lower];
        if (patterns) {
            const value = matchPatterns(markdown, patterns);
            if (value)
                return resolved(field, value, "pattern", attempted);
        }
        // 8. Generic "field: value" / "**field**: value" inline match. `[:\s]+` also matches
        //    a multi-space gap, so for numeric stat fields require the captured value to carry a
        //    digit — otherwise "Market Cap   refers to total value…" resolves the stat to prose.
        const isStatField = STAT_FIELDS.has(canonical);
        const genericPattern = new RegExp(`(?:^|\\n)(?:\\*\\*)?${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\*\\*)?[:\\s]+([^\\n]{3,100})`, "im");
        const gm = markdown.match(genericPattern);
        if (gm?.[1]) {
            const gv = gm[1].trim().replace(/\*\*/g, "");
            if (gv && (!isStatField || /\d/.test(gv)))
                return resolved(field, gv, "pattern", attempted);
        }
        // 9. Tolerant labelled-value (GFM pipe, multi-space, =, en-dash). Canonical then raw.
        //    Digit-guarded for stat fields (see tolerantLabelledValue).
        attempted.push("tolerant-regex");
        const tolerant = tolerantLabelledValue(markdown, canonical, isStatField) ??
            tolerantLabelledValue(markdown, field, isStatField);
        if (tolerant)
            return resolved(field, tolerant, "pattern", attempted);
        // 10. Number-near-label proximity (finance). Run AFTER table/row layers so the
        //     52-week-range hyphen and similar don't get clipped to a single token first.
        attempted.push("proximity");
        const near = numberNearLabel(markdown, canonical) ?? numberNearLabel(markdown, field);
        if (near)
            return resolved(field, near, "pattern", attempted);
        // 11. Heading section fallback: "## Field\nvalue"
        attempted.push("heading");
        const headingValue = matchHeadingSection(markdown, field);
        if (headingValue)
            return resolved(field, headingValue, "heading", attempted);
        // 12. LLM layer (env-gated, off by default — guaranteed no-op today).
        attempted.push("llm");
        const llmValue = llmExtractStub(field, markdown, html);
        if (llmValue)
            return resolved(field, llmValue, "llm", attempted);
        // Unresolved — NON-SILENT.
        return {
            field,
            value: null,
            source: "unresolved",
            confidence: 0,
            attempted,
            agent_instruction: unresolvedInstruction(field, attempted),
        };
    });
}
/** Map a resolved FieldResult source to the diagnostic method label. */
function sourceToDiagnosticMethod(source) {
    switch (source) {
        case "jsonld":
            return "meta-tag";
        case "infobox":
            return "infobox";
        case "table":
            return "table-header";
        case "microdata":
            return "microdata";
        case "heading":
            return "heading-match";
        default:
            return "pattern-match";
    }
}
/**
 * Like extractFields but also returns per-field diagnostics explaining why each null occurred.
 * Reuses the unified extractFields chain so the two code paths can never drift, then derives
 * diagnostics from each FieldResult's source + attempted list.
 */
export function extractFieldsWithDiagnostics(fields, structuredData, markdown, htmlLength, html) {
    // Short-circuit: page content too short to be real.
    if (htmlLength < 500) {
        const results = [];
        const diagnostics = [];
        for (const field of fields) {
            results.push({
                field,
                value: null,
                source: "unresolved",
                confidence: 0,
                attempted: [],
                agent_instruction: `page HTML < 500 chars, likely blocked or empty. Retry with render="render" or check the URL.`,
            });
            diagnostics.push({
                field,
                matched: false,
                reasonCode: "page_too_short",
                reasonText: `page HTML < 500 chars, likely blocked or empty response`,
                attempted: [],
            });
        }
        return { results, diagnostics };
    }
    const results = extractFields(fields, structuredData, markdown, html);
    const diagnostics = results.map(r => {
        if (r.source !== "unresolved") {
            return { field: r.field, matched: true, method: sourceToDiagnosticMethod(r.source), attempted: r.attempted };
        }
        // Unresolved — derive the most descriptive reason from the heading fallback.
        const headingResult = matchHeadingSectionWithReason(markdown, r.field);
        const hadPatterns = (PATTERN_MAP[canonicalField(r.field)] ?? PATTERN_MAP[r.field.toLowerCase().trim()]) !== undefined;
        if (headingResult.reason === "section_empty") {
            return {
                field: r.field,
                matched: false,
                reasonCode: "section_empty",
                reasonText: `heading found but section had no non-fence content`,
                attempted: r.attempted,
            };
        }
        if (hadPatterns) {
            return {
                field: r.field,
                matched: false,
                reasonCode: "no_pattern_match",
                reasonText: `fallback pattern search found no match`,
                attempted: r.attempted,
            };
        }
        return {
            field: r.field,
            matched: false,
            reasonCode: "no_heading_match",
            reasonText: `no "${r.field}" heading found in page`,
            attempted: r.attempted,
        };
    });
    return { results, diagnostics };
}
//# sourceMappingURL=fields.js.map