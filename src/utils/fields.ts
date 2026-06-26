import * as cheerio from "cheerio";
import type { StructuredData } from "./html.js";

export interface FieldResult {
  field: string;
  value: string;
  source: "structured_data" | "infobox" | "table_header" | "microdata" | "pattern" | "heading" | "not_found";
}

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
};

function matchPatterns(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

/** Extract first non-empty line from a markdown section whose heading matches `field`. */
function matchHeadingSection(text: string, field: string): string | null {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match the heading line, then capture everything until the next heading (or end of string).
  // Uses the 'i' flag for case-insensitive heading match; no 'm' flag so ^ matches start of string,
  // but we split on \n and find the heading line manually for reliability.
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

/** Extract field value from Wikipedia-style infobox tables. */
function extractFromInfobox(html: string, fieldName: string): string | null {
  const $ = cheerio.load(html);
  const rows = $("table.infobox tr, table.vcard tr");
  for (let i = 0; i < rows.length; i++) {
    const th = $(rows[i]).find("th").text().trim().toLowerCase();
    const td = $(rows[i]).find("td").text().trim();
    if (th && td && th.includes(fieldName.toLowerCase())) {
      return td.slice(0, 200);
    }
  }
  return null;
}

/** Extract field value by matching table column headers. */
function extractFromTableHeaders(html: string, fieldName: string): string | null {
  const $ = cheerio.load(html);
  let result: string | null = null;
  $("table").each((_, table) => {
    if (result) return; // already found
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

/** Extract field value from Schema.org microdata (itemprop attributes). */
function extractFromMicrodata(html: string, fieldName: string): string | null {
  const $ = cheerio.load(html);
  const el = $(`[itemprop="${fieldName}"], [itemprop="${fieldName.toLowerCase()}"]`).first();
  if (el.length) {
    const val = (el.attr("content") || el.text().trim()).slice(0, 200);
    return val || null;
  }
  return null;
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
}

/**
 * Extract requested fields from structured data + markdown fallback.
 * When raw HTML is provided, additional cheerio-based layers (infobox, table headers, microdata)
 * are tried between structured data and regex patterns.
 */
export function extractFields(
  fields: string[],
  structuredData: StructuredData | null,
  markdown: string,
  html?: string
): FieldResult[] {
  return fields.map(field => {
    const lower = field.toLowerCase().trim();

    // 1. Check structured data first (exact and fuzzy key match)
    if (structuredData?.fields) {
      const sdKeys = Object.keys(structuredData.fields);
      const exact = sdKeys.find(k => k.toLowerCase() === lower);
      const fuzzy = exact ?? sdKeys.find(k => k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase()));
      if (fuzzy) {
        return { field, value: structuredData.fields[fuzzy], source: "structured_data" as const };
      }
    }

    // 2. Infobox extraction (Wikipedia-style tables)
    if (html) {
      const infoboxValue = extractFromInfobox(html, field);
      if (infoboxValue) return { field, value: infoboxValue, source: "infobox" as const };
    }

    // 3. Table header matching
    if (html) {
      const tableValue = extractFromTableHeaders(html, field);
      if (tableValue) return { field, value: tableValue, source: "table_header" as const };
    }

    // 4. Microdata extraction (Schema.org itemprop)
    if (html) {
      const microdataValue = extractFromMicrodata(html, field);
      if (microdataValue) return { field, value: microdataValue, source: "microdata" as const };
    }

    // 5. Pattern matching in markdown
    const patterns = PATTERN_MAP[lower];
    if (patterns) {
      const value = matchPatterns(markdown, patterns);
      if (value) return { field, value, source: "pattern" as const };
    }

    // 6. Generic: look for "field: value" or "**field**: value" in markdown
    const genericPattern = new RegExp(
      `(?:^|\\n)(?:\\*\\*)?${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\*\\*)?[:\\s]+([^\\n]{3,100})`,
      "im"
    );
    const gm = markdown.match(genericPattern);
    if (gm?.[1]) return { field, value: gm[1].trim().replace(/\*\*/g, ""), source: "pattern" as const };

    // 7. Heading section fallback: "## FieldName\nvalue"
    const headingValue = matchHeadingSection(markdown, field);
    if (headingValue) return { field, value: headingValue, source: "heading" as const };

    return { field, value: "", source: "not_found" as const };
  });
}

/**
 * Like extractFields but also returns per-field diagnostics explaining why each null occurred.
 * When raw HTML is provided, additional cheerio-based layers (infobox, table headers, microdata)
 * are tried between structured data and regex patterns.
 */
export function extractFieldsWithDiagnostics(
  fields: string[],
  structuredData: StructuredData | null,
  markdown: string,
  htmlLength: number,
  html?: string
): { results: FieldResult[]; diagnostics: FieldDiagnostic[] } {
  const results: FieldResult[] = [];
  const diagnostics: FieldDiagnostic[] = [];

  for (const field of fields) {
    const lower = field.toLowerCase().trim();

    // Short-circuit: page content too short to be real
    if (htmlLength < 500) {
      results.push({ field, value: "", source: "not_found" });
      diagnostics.push({
        field,
        matched: false,
        reasonCode: "page_too_short",
        reasonText: `page HTML < 500 chars, likely blocked or empty response`,
      });
      continue;
    }

    // 1. Structured data
    if (structuredData?.fields) {
      const sdKeys = Object.keys(structuredData.fields);
      const exact = sdKeys.find(k => k.toLowerCase() === lower);
      const fuzzy = exact ?? sdKeys.find(k => k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase()));
      if (fuzzy) {
        results.push({ field, value: structuredData.fields[fuzzy], source: "structured_data" });
        diagnostics.push({ field, matched: true, method: "meta-tag" });
        continue;
      }
    }

    // 2. Infobox extraction (Wikipedia-style tables)
    if (html) {
      const infoboxValue = extractFromInfobox(html, field);
      if (infoboxValue) {
        results.push({ field, value: infoboxValue, source: "infobox" });
        diagnostics.push({ field, matched: true, method: "infobox" });
        continue;
      }
    }

    // 3. Table header matching
    if (html) {
      const tableValue = extractFromTableHeaders(html, field);
      if (tableValue) {
        results.push({ field, value: tableValue, source: "table_header" });
        diagnostics.push({ field, matched: true, method: "table-header" });
        continue;
      }
    }

    // 4. Microdata extraction (Schema.org itemprop)
    if (html) {
      const microdataValue = extractFromMicrodata(html, field);
      if (microdataValue) {
        results.push({ field, value: microdataValue, source: "microdata" });
        diagnostics.push({ field, matched: true, method: "microdata" });
        continue;
      }
    }

    // 5. Known pattern matching
    const patterns = PATTERN_MAP[lower];
    if (patterns) {
      const value = matchPatterns(markdown, patterns);
      if (value) {
        results.push({ field, value, source: "pattern" });
        diagnostics.push({ field, matched: true, method: "pattern-match" });
        continue;
      }
    }

    // 6. Generic inline "field: value" pattern
    const genericPattern = new RegExp(
      `(?:^|\\n)(?:\\*\\*)?${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\*\\*)?[:\\s]+([^\\n]{3,100})`,
      "im"
    );
    const gm = markdown.match(genericPattern);
    if (gm?.[1]) {
      results.push({ field, value: gm[1].trim().replace(/\*\*/g, ""), source: "pattern" });
      diagnostics.push({ field, matched: true, method: "pattern-match" });
      continue;
    }

    // 7. Heading section fallback — use instrumented version to get reason
    const headingResult = matchHeadingSectionWithReason(markdown, field);
    if (headingResult.value !== null) {
      results.push({ field, value: headingResult.value, source: "heading" });
      diagnostics.push({ field, matched: true, method: "heading-match" });
      continue;
    }

    // Not found — determine best reason code
    if (headingResult.reason === "section_empty") {
      results.push({ field, value: "", source: "not_found" });
      diagnostics.push({
        field,
        matched: false,
        reasonCode: "section_empty",
        reasonText: `heading found but section had no non-fence content`,
      });
    } else if (patterns) {
      // Had known patterns but none matched
      results.push({ field, value: "", source: "not_found" });
      diagnostics.push({
        field,
        matched: false,
        reasonCode: "no_pattern_match",
        reasonText: `fallback pattern search found no match`,
      });
    } else {
      // No heading, no patterns — heading miss is the most descriptive reason
      results.push({ field, value: "", source: "not_found" });
      diagnostics.push({
        field,
        matched: false,
        reasonCode: "no_heading_match",
        reasonText: `no "${field}" heading found in page`,
      });
    }
  }

  return { results, diagnostics };
}
