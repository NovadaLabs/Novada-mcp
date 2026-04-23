import type { StructuredData } from "./html.js";

export interface FieldResult {
  field: string;
  value: string;
  source: "structured_data" | "pattern" | "not_found";
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

const PATTERN_MAP: Record<string, RegExp[]> = {
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
};

function matchPatterns(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m?.[1]) return m[1].trim();
  }
  return null;
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

    return { field, value: "", source: "not_found" };
  });
}
