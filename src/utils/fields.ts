import type { StructuredData } from "./html.js";

export interface FieldResult {
  field: string;
  value: string;
  source: "structured_data" | "pattern" | "heading" | "not_found";
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

/**
 * Extract requested fields from structured data + markdown fallback.
 */
export function extractFields(
  fields: string[],
  structuredData: StructuredData | null,
  markdown: string
): FieldResult[] {
  return fields.map(field => {
    const lower = field.toLowerCase().trim();

    // 1. Check structured data first (exact and fuzzy key match)
    if (structuredData?.fields) {
      const sdKeys = Object.keys(structuredData.fields);
      const exact = sdKeys.find(k => k.toLowerCase() === lower);
      const fuzzy = exact ?? sdKeys.find(k => k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase()));
      if (fuzzy) {
        return { field, value: structuredData.fields[fuzzy], source: "structured_data" };
      }
    }

    // 2. Pattern matching in markdown
    const patterns = PATTERN_MAP[lower];
    if (patterns) {
      const value = matchPatterns(markdown, patterns);
      if (value) return { field, value, source: "pattern" };
    }

    // 3. Generic: look for "field: value" or "**field**: value" in markdown
    const genericPattern = new RegExp(
      `(?:^|\\n)(?:\\*\\*)?${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\*\\*)?[:\\s]+([^\\n]{3,100})`,
      "im"
    );
    const gm = markdown.match(genericPattern);
    if (gm?.[1]) return { field, value: gm[1].trim().replace(/\*\*/g, ""), source: "pattern" };

    // 4. Heading section fallback: "## FieldName\nvalue"
    const headingValue = matchHeadingSection(markdown, field);
    if (headingValue) return { field, value: headingValue, source: "heading" };

    return { field, value: "", source: "not_found" };
  });
}
