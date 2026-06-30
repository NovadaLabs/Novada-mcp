import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { StructuredData } from "./html.js";

/**
 * Where a field value was resolved from, in chain order.
 * - jsonld      → JSON-LD / meta structured data (was "structured_data")
 * - infobox     → Wikipedia-style infobox table
 * - table       → table column-header match (was "table_header")
 * - microdata   → Schema.org itemprop attribute
 * - pattern     → known/generic regex pattern in markdown
 * - heading     → "## Field\nvalue" markdown section fallback
 * - llm         → reserved for the (currently disabled) LLM extraction layer
 * - unresolved  → not found by any layer (was "not_found"); value is null
 */
export type FieldSource =
  | "jsonld"
  | "infobox"
  | "table"
  | "microdata"
  | "pattern"
  | "heading"
  | "llm"
  | "unresolved";

export interface FieldResult {
  field: string;
  /** Resolved value, or null when source === "unresolved". */
  value: string | null;
  source: FieldSource;
  /** Heuristic 0–1 confidence; jsonld/microdata high, proximity/heading lower. */
  confidence: number;
  /** Layers attempted (in order) before resolving/giving up. Diagnostics use this. */
  attempted?: string[];
  /** Non-silent guidance set only when source === "unresolved". */
  agent_instruction?: string;
}

/** Confidence per source — single source of truth so callers don't re-derive. */
const SOURCE_CONFIDENCE: Record<FieldSource, number> = {
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

const PATTERN_MAP: Record<string, RegExp[]> = {
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
const FIELD_ALIASES: Record<string, string> = {
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
function canonicalField(field: string): string {
  const lower = field.toLowerCase().trim();
  return FIELD_ALIASES[lower] ?? lower;
}

/** Best fuzzy-label match accumulator (score 0 + null value = no match yet). */
interface LabelMatch {
  score: number;
  value: string | null;
}

function matchPatterns(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

/**
 * Fuzzy label-match score: exact (3) > startsWith (2) > includes (1) > 0.
 * Bidirectional includes so "mkt cap" matches "market cap" cells and vice-versa.
 */
function labelMatchScore(label: string, field: string): number {
  const l = label.toLowerCase().trim();
  const f = field.toLowerCase().trim();
  if (!l || !f) return 0;
  if (l === f) return 3;
  if (l.startsWith(f) || f.startsWith(l)) return 2;
  if (l.includes(f) || f.includes(l)) return 1;
  return 0;
}

/** Extract first non-empty line from a markdown section whose heading matches `field`. */
function matchHeadingSection(text: string, field: string): string | null {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = text.split("\n");
  let inSection = false;
  const sectionLines: string[] = [];
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
    if (nextHeadingRe.test(line)) break;
    sectionLines.push(line);
  }
  if (!inSection || sectionLines.length === 0) return null;
  const firstNonEmpty = sectionLines.find(l => l.trim().length > 2);
  return firstNonEmpty?.trim() ?? null;
}

export interface HeadingSectionResult {
  value: string | null;
  reason: "matched" | "no_heading_match" | "section_empty";
}

/**
 * Like matchHeadingSection but returns a reason alongside the value.
 * Zero impact on existing callers of matchHeadingSection.
 */
export function matchHeadingSectionWithReason(text: string, field: string): HeadingSectionResult {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = text.split("\n");
  let inSection = false;
  const sectionLines: string[] = [];
  const headingRe = new RegExp(`^#+\\s+${escapedField}\\s*$`, "i");
  const nextHeadingRe = /^#+\s/;
  for (const line of lines) {
    if (!inSection) {
      if (headingRe.test(line)) {
        inSection = true;
      }
      continue;
    }
    if (nextHeadingRe.test(line)) break;
    sectionLines.push(line);
  }
  if (!inSection) {
    return { value: null, reason: "no_heading_match" };
  }
  const firstNonEmpty = sectionLines.find(l => {
    const t = l.trim();
    if (t.length <= 2) return false;
    if (t.startsWith("```") || t.startsWith("~~~")) return false;
    return true;
  });
  if (!firstNonEmpty) {
    return { value: null, reason: "section_empty" };
  }
  return { value: firstNonEmpty.trim(), reason: "matched" };
}

/**
 * Candidate values harvested from the DOM in a SINGLE pass (NOV-577 perf).
 *
 * The previous design re-walked the whole DOM once per requested field per layer
 * (O(fields × DOM)): extractFromInfobox queried `table.infobox tr` again for every
 * field, extractFromLabelValueRows re-ran `$("tr").each` for every field, etc. We now
 * collect every label→value candidate ONCE here, then each field resolves against these
 * in-memory arrays — O(DOM + fields × candidates). Matching semantics (labelMatchScore,
 * shape constraints, ordering) are byte-for-byte identical to the per-field queries.
 */
interface DomCandidates {
  /** infobox/vcard rows: { label = <th>, value = <td> } (both already trimmed, value sliced to 200). */
  infoboxRows: Array<{ label: string; value: string }>;
  /** Per-table column headers (lower-cased) + that table's first tbody-row cells. Order = DOM order. */
  tables: Array<{ headers: string[]; firstRowCells: string[] }>;
  /** Row-label pairs (table tr cell0/cell1 + dl dt/dd), shape-constrained (value ≤ 80 chars). */
  labelValueRows: Array<{ label: string; value: string }>;
  /** itemprop → value, keyed by lower-cased prop name (first occurrence wins, value sliced to 200). */
  microdata: Map<string, string>;
  /**
   * Elements carrying a class attribute, plus their (trimmed) text — for the hero-stat scan.
   * `context` is the element's own class/id PLUS its ancestors' class/id tokens (lower-cased,
   * space-joined) so the price layer can tell a product-price node from one nested in a
   * cart / basket / order-summary container (NOV #13). Collected in the same single pass.
   */
  classedEls: Array<{ className: string; text: string; context: string }>;
  /** Exact attribute-selector hits used by the hero-stat layer (data-testid / itemprop). */
  attrHits: Map<string, string>;
}

/** data-testid / itemprop selectors the hero-stat layer probes — collected once up front. */
const HERO_ATTR_SELECTORS = [
  "[data-testid='price']", "[itemprop='price']",
  "[data-testid='change']",
  "[data-testid='market-cap']",
];

/**
 * Walk the parsed document ONCE and harvest every candidate the field layers need.
 * Each field then resolves from these arrays instead of re-querying `$`.
 */
function collectDomCandidates($: CheerioAPI): DomCandidates {
  const infoboxRows: Array<{ label: string; value: string }> = [];
  const tables: Array<{ headers: string[]; firstRowCells: string[] }> = [];
  const labelValueRows: Array<{ label: string; value: string }> = [];
  const microdata = new Map<string, string>();
  const classedEls: Array<{ className: string; text: string; context: string }> = [];
  const attrHits = new Map<string, string>();

  // Infobox / vcard rows (Wikipedia-style): th = label, td = value.
  $("table.infobox tr, table.vcard tr").each((_, tr) => {
    const th = $(tr).find("th").text().trim();
    const td = $(tr).find("td").text().trim();
    if (!th || !td) return;
    infoboxRows.push({ label: th, value: td.slice(0, 200) });
  });

  // Per-table column headers + first tbody row (for header-column matching).
  $("table").each((_, table) => {
    const $table = $(table);
    const headers = $table.find("th").map((__, th) => $(th).text().trim().toLowerCase()).get();
    const firstRow = $table.find("tbody tr").first();
    const firstRowCells = firstRow.find("td").map((__, td) => $(td).text().trim()).get();
    tables.push({ headers, firstRowCells });
  });

  // Row-label pairs: table rows (cell0 = label, cell1 = value) + <dl> dt/dd pairs.
  // Shape constraint matches extractFromLabelValueRows: skip values > 80 chars (prose, not a stat).
  const considerRow = (rawLabel: string, rawValue: string) => {
    const label = rawLabel.trim();
    const value = rawValue.trim();
    if (!label || !value) return;
    if (value.length > 80) return;
    labelValueRows.push({ label, value: value.slice(0, 200) });
  };
  $("tr").each((_, tr) => {
    const cells = $(tr).find("th, td");
    if (cells.length < 2) return;
    considerRow($(cells[0]).text(), $(cells[1]).text());
  });
  $("dl").each((_, dl) => {
    $(dl).find("dt").each((__, dt) => {
      const dd = $(dt).next("dd");
      if (dd.length) considerRow($(dt).text(), dd.text());
    });
  });

  // Microdata: itemprop → value (content attr or text). First occurrence wins.
  $("[itemprop]").each((_, el) => {
    const prop = ($(el).attr("itemprop") ?? "").toLowerCase().trim();
    if (!prop || microdata.has(prop)) return;
    const val = ($(el).attr("content") || $(el).text().trim()).slice(0, 200);
    if (val) microdata.set(prop, val);
  });

  // Hero-stat candidates: every element with a class, plus exact attr-selector hits.
  // `context` = own class/id + every ancestor's class/id (lower-cased) so the price layer
  // can detect a value nested in a cart / order-summary container (NOV #13). Built from the
  // already-parsed parents — no extra DOM walk beyond this single `[class]` iteration.
  $("[class]").each((_, el) => {
    const className = $(el).attr("class") ?? "";
    if (!className) return;
    const ctxTokens: string[] = [];
    // self first, then ancestors (cheerio $(el).parents() returns nearest-first).
    const selfId = $(el).attr("id");
    ctxTokens.push(className);
    if (selfId) ctxTokens.push(selfId);
    $(el).parents().each((__, p) => {
      const pc = $(p).attr("class");
      const pi = $(p).attr("id");
      if (pc) ctxTokens.push(pc);
      if (pi) ctxTokens.push(pi);
    });
    classedEls.push({ className, text: $(el).text().trim(), context: ctxTokens.join(" ").toLowerCase() });
  });
  for (const sel of HERO_ATTR_SELECTORS) {
    const el = $(sel).first();
    if (el.length && !attrHits.has(sel)) attrHits.set(sel, el.text().trim());
  }

  return { infoboxRows, tables, labelValueRows, microdata, classedEls, attrHits };
}

/** Extract field value from Wikipedia-style infobox tables. Reads pre-collected rows. */
function extractFromInfobox(cand: DomCandidates, fieldName: string): string | null {
  const best: LabelMatch = { score: 0, value: null };
  for (const row of cand.infoboxRows) {
    const score = labelMatchScore(row.label, fieldName);
    if (score > 0 && score > best.score) {
      best.score = score;
      best.value = row.value;
    }
  }
  return best.value;
}

/** Extract field value by matching table column headers. Reads pre-collected tables. */
function extractFromTableHeaders(cand: DomCandidates, fieldName: string): string | null {
  const needle = fieldName.toLowerCase();
  for (const table of cand.tables) {
    const colIdx = table.headers.findIndex(h => h.includes(needle));
    if (colIdx >= 0) {
      const cell = table.firstRowCells[colIdx];
      if (cell) return cell.slice(0, 200);
    }
  }
  return null;
}

/**
 * Extract field value from finance/spec row-label tables where the label sits in the
 * first cell and the value in the second (e.g. "| Market Cap | 233.37B |"), plus
 * <dl> definition lists (<dt> label / <dd> value). Ranked + shape-constrained:
 *  - require >= 2 cells in a <tr>
 *  - reject rows where the "value" cell is itself long prose (> 80 chars) — likely not a stat
 *  - pick the highest fuzzy label-match score across all candidate rows
 * Reads pre-collected label/value rows.
 */
function extractFromLabelValueRows(cand: DomCandidates, fieldName: string): string | null {
  const best: LabelMatch = { score: 0, value: null };
  for (const row of cand.labelValueRows) {
    const score = labelMatchScore(row.label, fieldName);
    if (score > 0 && score > best.score) {
      best.score = score;
      best.value = row.value;
    }
  }
  return best.value;
}

/** Extract field value from Schema.org microdata (itemprop attributes). Reads pre-collected map. */
function extractFromMicrodata(cand: DomCandidates, fieldName: string): string | null {
  return cand.microdata.get(fieldName.toLowerCase()) ?? null;
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
function classTokenHasWord(className: string, word: string): boolean {
  if (!className) return false;
  const w = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // (^|-|_)word(-|_|$) within each whitespace-separated class token.
  const re = new RegExp(`(?:^|[-_])${w}(?:[-_]|$)`, "i");
  return className.split(/\s+/).some((tok) => re.test(tok));
}

/** A hero stat value is a number (optionally currency / sign / %% / K-M-B-T suffix). */
function looksLikeStatValue(v: string): boolean {
  if (!/\d/.test(v)) return false; // must contain a digit
  // Reject prose: a real hero value has very few letters (a currency code or K/M/B/T at most).
  const letters = (v.match(/[A-Za-z]/g) ?? []).length;
  return letters <= 4;
}

/**
 * NOV #13 — cart/basket/order-summary container tokens. A price-shaped value whose element
 * context (own + ancestor class/id) carries one of these is a running cart total, NOT the
 * product price, and must never be returned as the price. Whole-word matched so legitimate
 * product classes ("price", "product-price", "list-price") are never caught — only
 * cart/basket/minicart/subtotal/order-total/line-item style containers are.
 */
const CART_CONTEXT_RE = /(?:^|[-_ ])(?:cart|minicart|basket|bag|subtotal|grand-?total|order-?total|cart-?total|line-?item|line-?items|checkout)(?:[-_ ]|$)/i;

/** True when the element's class/id context places its value inside a cart/order-summary block. */
function isCartContext(context: string): boolean {
  if (!context) return false;
  return context.split(/\s+/).some((tok) => CART_CONTEXT_RE.test(tok));
}

/**
 * A "zero total" money value: currency-prefixed (or bare) all-zero amount such as "$0.00",
 * "€0,00", "0.00", "$0". Empty carts render these as the running total; returning one as the
 * product price is the canonical confidently-wrong answer NOV #13 guards against. Used only to
 * downgrade an otherwise-accepted price candidate, never to accept one.
 */
const ZERO_MONEY_RE = /^[+\-]?[€$£¥₹]?\s*0+(?:[.,]0+)?\s*(?:USD|EUR|GBP|JPY|CAD|AUD)?$/i;
function looksLikeZeroTotal(v: string): boolean {
  return ZERO_MONEY_RE.test(v.trim());
}

/**
 * Hero stat blocks: a value sits in a sibling/descendant element flagged by class, with
 * no tabular label — e.g. `<span class="price">$72.13</span>`, `<span class="change">+1.24%</span>`.
 *
 * Targets each field via a small set of class WORD-tokens (matched with whole-word
 * boundaries, not substrings) plus exact data-testid / itemprop hints, then requires the
 * captured text to look like a numeric stat value. Both gates are needed: `exchange-rate`,
 * `changelog-version`, and `price-disclaimer` widgets are ubiquitous on finance pages and
 * a substring selector would mis-resolve them at high confidence. Reads pre-collected candidates.
 */
function extractFromAdjacentPairs(cand: DomCandidates, canonical: string): string | null {
  // class word-tokens to look for, plus exact attribute selectors that are already safe.
  const HINTS: Record<string, { classWords: string[]; exact: string[] }> = {
    price: { classWords: ["price"], exact: ["[data-testid='price']", "[itemprop='price']"] },
    change: { classWords: ["change", "pct", "percent"], exact: ["[data-testid='change']"] },
    "market cap": { classWords: ["market-cap", "mktcap", "marketcap"], exact: ["[data-testid='market-cap']"] },
  };
  const hint = HINTS[canonical];
  if (!hint) return null;

  // NOV #13: only the money/price field is at risk of grabbing a cart running-total. Other
  // hero stats (change / market cap) live on finance pages with no cart, so the cart guard is
  // scoped to price to avoid touching their behavior.
  const guardCart = canonical === "price";

  const accept = (raw: string): string | null => {
    const val = raw.trim();
    // Hero values are short; ignore containers that swallowed the page, and reject prose.
    if (val && val.length <= 60 && looksLikeStatValue(val)) return val.slice(0, 200);
    return null;
  };

  // 1. Exact attribute selectors (data-testid / itemprop) — no substring ambiguity.
  //    [itemprop='price'] is authoritative product data, so it is NOT cart-guarded.
  for (const sel of hint.exact) {
    const raw = cand.attrHits.get(sel);
    if (raw !== undefined) {
      const v = accept(raw);
      if (v) return v;
    }
  }

  // 2. Class word-token scan. Iterate the pre-collected classed elements (DOM order) and
  //    keep only those whose className contains the word as a whole token. classTokenHasWord
  //    was always the authoritative gate; the old [class*=…] selector was just a pre-filter.
  //    For price, skip any candidate whose context is a cart/order-summary block or whose value
  //    is a $0.00-style running total — those are de-prioritized (see findCartTotalPriceOnly,
  //    which converts a "cart-total was the only price" case into an explained null).
  for (const word of hint.classWords) {
    for (const el of cand.classedEls) {
      if (!classTokenHasWord(el.className, word)) continue;
      const v = accept(el.text);
      if (!v) continue;
      if (guardCart && (isCartContext(el.context) || looksLikeZeroTotal(v))) continue;
      return v;
    }
  }

  return null;
}

/**
 * NOV #13: was a price-shaped value found ONLY inside a cart/order-summary container (or as a
 * $0.00-style running total)? Called only after every price layer (including the cart-guarded
 * adjacent scan) has declined, so a real product price elsewhere always wins first. When this
 * returns the offending cart value, the chain emits null + an agent_instruction instead of
 * confidently returning the wrong total. Returns null when no cart-only price exists.
 */
function findCartTotalPriceOnly(cand: DomCandidates): string | null {
  for (const el of cand.classedEls) {
    if (!classTokenHasWord(el.className, "price")) continue;
    const val = el.text.trim();
    if (!val || val.length > 60 || !looksLikeStatValue(val)) continue;
    if (isCartContext(el.context) || looksLikeZeroTotal(val)) return val.slice(0, 200);
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
 * A STAT_FIELDS value must BE a number (optionally currency / sign / % / K-M-B-T) or a
 * numeric range — not prose that merely CONTAINS a digit. Rejects "top 5 holdings" while
 * allowing "233.37B", "$1,234.50", "-5.15%", "60.10 - 88.41".
 * (NOV-574: the old `/\d/.test(v)` guard let a stray digit in a prose span resolve a
 * numeric stat field to a sentence.)
 */
const STAT_VALUE_RE = /^[+\-]?[€$£¥₹]?\s*[\d,]+(?:\.\d+)?\s*[%KkMmBbTt]?(?:\s*[-–—]\s*[+\-]?[€$£¥₹]?\s*[\d,]+(?:\.\d+)?\s*[%KkMmBbTt]?)?$/;
export function isStatValue(v: string): boolean {
  return STAT_VALUE_RE.test(v.trim());
}

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
function tolerantLabelledValue(markdown: string, fieldName: string, requireDigit = false): string | null {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns: Array<{ re: RegExp; guardDigit: boolean }> = [
    // GFM pipe table cell: | Label | Value | (structural — no digit guard)
    { re: new RegExp(`\\|\\s*${escaped}\\s*\\|\\s*([^|\\n]{1,80}?)\\s*\\|`, "i"), guardDigit: false },
    // Label followed by colon / equals / en-dash / 2+ spaces, then value to EOL.
    { re: new RegExp(`(?:^|\\n)\\s*(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*(?::|=|—|–|\\s{2,})\\s*([^\\n|]{1,80})`, "i"), guardDigit: requireDigit },
  ];
  for (const { re, guardDigit } of patterns) {
    const m = markdown.match(re);
    if (m?.[1]) {
      const v = m[1].trim().replace(/\*\*/g, "").replace(/\s*\|\s*$/, "").trim();
      if (v && (!guardDigit || isStatValue(v))) return v;
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
function numberNearLabel(markdown: string, fieldName: string): string | null {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Window: label, then up to ~40 chars of separators/words, then a number-shaped token.
  const NUMBER_TOKEN = "([+-]?[€$£¥₹]?\\s*[\\d,]+(?:\\.\\d+)?\\s*[KkMmBbTt%]?)";
  const re = new RegExp(`${escaped}[^\\dKkMmBbTt%+-]{0,40}?${NUMBER_TOKEN}`, "i");
  const m = markdown.match(re);
  if (m?.[1]) {
    const v = m[1].trim();
    if (v && /\d/.test(v)) return v;
  }
  return null;
}

/**
 * Build the non-silent agent_instruction emitted on an unresolved field, listing the
 * layers that were attempted so the agent knows the null is explained, not silent.
 */
function unresolvedInstruction(field: string, attempted: string[]): string {
  return `'${field}' not found in ${attempted.join("/")}; the value may be in the page body — re-read the content, or retry with render="render" to fetch JS-rendered values.`;
}

/**
 * Env-gated LLM extraction hook. DISABLED by default and intentionally unimplemented:
 * wiring a real model call would add a new dependency / network round-trip that is out of
 * scope for NOV-564. Left as a single seam so a future change can drop the layer in without
 * touching the chain. Returns null unless NOVADA_FIELDS_LLM is truthy AND an implementation
 * is supplied (none is today), so behavior is a guaranteed no-op now.
 */
function llmExtractStub(_field: string, _markdown: string, _html: string | undefined): string | null {
  if (!process.env.NOVADA_FIELDS_LLM) return null;
  // No implementation by design (no new dep). Treated as unavailable.
  return null;
}

/** Make a resolved result with the canonical confidence for its source. */
function resolved(field: string, value: string, source: FieldSource, attempted: string[]): FieldResult {
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
 * cheerio is loaded once per call AND the DOM is walked once up front (NOV-577): every
 * label→value candidate the HTML layers need is harvested by collectDomCandidates, then each
 * field resolves against those in-memory arrays — O(DOM + fields × candidates) instead of the
 * old O(fields × DOM) where each layer re-queried `$` per requested field.
 * Unresolved fields are NON-SILENT: value=null + agent_instruction explaining the miss.
 */
export function extractFields(
  fields: string[],
  structuredData: StructuredData | null,
  markdown: string,
  html?: string,
  /**
   * NOV-577: optional pre-parsed document. When the caller (extract.ts) already loaded the
   * same `html` into cheerio for its title/description/links/structured-data readers, it passes
   * that `$` here so this function skips a redundant cheerio.load. When omitted, `html` is parsed
   * as before, so the public signature and every existing caller stay unchanged.
   */
  preloaded$?: CheerioAPI | null
): FieldResult[] {
  // Harvest all DOM candidates in a single pass. Reuse the caller's parsed document when given,
  // else parse `html` once here.
  const $ = preloaded$ ?? (html ? cheerio.load(html) : null);
  const cand = $ ? collectDomCandidates($) : null;

  return fields.map(field => {
    const lower = field.toLowerCase().trim();
    const canonical = canonicalField(field);
    const attempted: string[] = [];

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

    if (cand) {
      // 2. Infobox (Wikipedia-style)
      attempted.push("infobox");
      const infoboxValue = extractFromInfobox(cand, canonical) ?? extractFromInfobox(cand, field);
      if (infoboxValue) return resolved(field, infoboxValue, "infobox", attempted);

      // 3. Table header
      attempted.push("table");
      const tableValue = extractFromTableHeaders(cand, canonical) ?? extractFromTableHeaders(cand, field);
      if (tableValue) return resolved(field, tableValue, "table", attempted);

      // 4. Label/value rows + definition lists (finance row tables)
      attempted.push("label-rows");
      const rowValue = extractFromLabelValueRows(cand, canonical) ?? extractFromLabelValueRows(cand, field);
      if (rowValue) return resolved(field, rowValue, "table", attempted);

      // 5. Microdata (Schema.org itemprop)
      attempted.push("microdata");
      const microdataValue = extractFromMicrodata(cand, canonical) ?? extractFromMicrodata(cand, field);
      if (microdataValue) return resolved(field, microdataValue, "microdata", attempted);

      // 6. Adjacent hero stat blocks (.price, [class*=change]). Matched by class/attribute
      //    token, not a real table row — score it at the pattern tier, not table confidence.
      attempted.push("adjacent");
      const adjacentValue = extractFromAdjacentPairs(cand, canonical);
      if (adjacentValue) return resolved(field, adjacentValue, "pattern", attempted);
    }

    // NOV #13: for a money/price field, a bare $0.00-style value pulled from markdown is far
    // likelier a cart running-total than the product price. Skip it in the markdown layers so we
    // fall through to the cart-only safety net (explained null) rather than confidently emit $0.00.
    const isPriceField = canonical === "price";
    const skipAsCartZero = (v: string): boolean => isPriceField && looksLikeZeroTotal(v);

    // 7. Known pattern matching in markdown (canonical first, then raw field key).
    attempted.push("pattern");
    const patterns = PATTERN_MAP[canonical] ?? PATTERN_MAP[lower];
    if (patterns) {
      const value = matchPatterns(markdown, patterns);
      if (value && !skipAsCartZero(value)) return resolved(field, value, "pattern", attempted);
    }

    // 8. Generic "field: value" / "**field**: value" inline match. `[:\s]+` also matches
    //    a multi-space gap, so for numeric stat fields require the captured value to carry a
    //    digit — otherwise "Market Cap   refers to total value…" resolves the stat to prose.
    const isStatField = STAT_FIELDS.has(canonical);
    const genericPattern = new RegExp(
      `(?:^|\\n)(?:\\*\\*)?${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\*\\*)?[:\\s]+([^\\n]{3,100})`,
      "im"
    );
    const gm = markdown.match(genericPattern);
    if (gm?.[1]) {
      const gv = gm[1].trim().replace(/\*\*/g, "");
      if (gv && (!isStatField || /\d/.test(gv)) && !skipAsCartZero(gv)) return resolved(field, gv, "pattern", attempted);
    }

    // 9. Tolerant labelled-value (GFM pipe, multi-space, =, en-dash). Canonical then raw.
    //    Digit-guarded for stat fields (see tolerantLabelledValue).
    attempted.push("tolerant-regex");
    const tolerant =
      tolerantLabelledValue(markdown, canonical, isStatField) ??
      tolerantLabelledValue(markdown, field, isStatField);
    if (tolerant && !skipAsCartZero(tolerant)) return resolved(field, tolerant, "pattern", attempted);

    // 10. Number-near-label proximity (finance). Run AFTER table/row layers so the
    //     52-week-range hyphen and similar don't get clipped to a single token first.
    attempted.push("proximity");
    const near = numberNearLabel(markdown, canonical) ?? numberNearLabel(markdown, field);
    if (near && !skipAsCartZero(near)) return resolved(field, near, "pattern", attempted);

    // 11. Heading section fallback: "## Field\nvalue"
    attempted.push("heading");
    const headingValue = matchHeadingSection(markdown, field);
    if (headingValue) return resolved(field, headingValue, "heading", attempted);

    // 12. LLM layer (env-gated, off by default — guaranteed no-op today).
    attempted.push("llm");
    const llmValue = llmExtractStub(field, markdown, html);
    if (llmValue) return resolved(field, llmValue, "llm", attempted);

    // NOV #13: price specifically — no real product price resolved above, but a price-shaped
    // value DID exist inside a cart/order-summary block (or as a $0.00 running total). Surface
    // an explained null instead of the confidently-wrong cart total. Runs last so any genuine
    // product price always wins first.
    if (isPriceField && cand) {
      const cartOnly = findCartTotalPriceOnly(cand);
      if (cartOnly) {
        return {
          field,
          value: null,
          source: "unresolved" as const,
          confidence: 0,
          attempted,
          agent_instruction: `'${field}' only matched a cart/order-summary total (${cartOnly}), not the product price — this is likely a running cart total, not the item's price. Re-read the product/price container, or retry with render="render" to fetch the JS-rendered product price.`,
        };
      }
    }

    // Unresolved — NON-SILENT.
    return {
      field,
      value: null,
      source: "unresolved" as const,
      confidence: 0,
      attempted,
      agent_instruction: unresolvedInstruction(field, attempted),
    };
  });
}

export type DiagnosticMethod = "heading-match" | "pattern-match" | "meta-tag" | "infobox" | "table-header" | "microdata";
export type DiagnosticReasonCode =
  | "no_heading_match"
  | "section_empty"
  | "no_pattern_match"
  | "page_too_short";

export interface FieldDiagnostic {
  field: string;
  matched: boolean;
  /** Only set when matched === true */
  method?: DiagnosticMethod;
  /** Only set when matched === false */
  reasonCode?: DiagnosticReasonCode;
  /** Human-readable explanation for reasonCode */
  reasonText?: string;
  /** Layers attempted (mirrors FieldResult.attempted) — diagnostics surface this. */
  attempted?: string[];
}

/** Map a resolved FieldResult source to the diagnostic method label. */
function sourceToDiagnosticMethod(source: FieldSource): DiagnosticMethod {
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
export function extractFieldsWithDiagnostics(
  fields: string[],
  structuredData: StructuredData | null,
  markdown: string,
  htmlLength: number,
  html?: string,
  /** NOV-577: forward the caller's pre-parsed document so extractFields skips a redundant
   *  cheerio.load (mirrors extractFields' own preloaded$ param). */
  preloaded$?: CheerioAPI | null
): { results: FieldResult[]; diagnostics: FieldDiagnostic[] } {
  // Short-circuit: page content too short to be real.
  if (htmlLength < 500) {
    const results: FieldResult[] = [];
    const diagnostics: FieldDiagnostic[] = [];
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

  const results = extractFields(fields, structuredData, markdown, html, preloaded$);
  const diagnostics: FieldDiagnostic[] = results.map(r => {
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
