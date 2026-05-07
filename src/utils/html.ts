import * as cheerio from "cheerio";
import { detectJsHeavyContent } from "./http.js";

/** Elements to completely remove before content extraction */
const REMOVE_TAGS = [
  "script", "style", "noscript", "svg", "iframe", "nav", "footer",
  "header", "aside", "form",
];

/** CSS selectors for boilerplate regions to remove */
const BOILERPLATE_SELECTORS = [
  "[class*='sidebar']", "[id*='sidebar']",
  "[class*='menu']", "[id*='menu']",
  "[class*='cookie']", "[id*='cookie']",
  "[class*='banner']", "[id*='banner']",
  "[class*='popup']", "[id*='popup']",
  "[class*='modal']", "[id*='modal']",
  "[class*='ad-']", "[class*='advertisement']",
  "[class*='footer']", "[id*='footer']",
  "[class*='header']", "[id*='header']",
  "[role='navigation']", "[role='banner']", "[role='contentinfo']",
  // Table-layout navigation patterns (e.g. Hacker News, old-school sites)
  "table[class*='nav']", "table[id*='nav']",
  "td[class*='nav']", "td[id*='nav']",
  "tr[class*='nav']", "tr[id*='nav']",
  "[class*='topbar']", "[id*='topbar']",
  "[class*='toolbar']", "[id*='toolbar']",
  "[class*='breadcrumb']", "[id*='breadcrumb']",
  // Colored header/nav cells (table-layout sites like HN use bgcolor on nav bars)
  "td[bgcolor]:not([bgcolor=''])",
  "th[bgcolor]:not([bgcolor=''])",
];

/** Content area selectors in priority order */
const CONTENT_SELECTORS = [
  "main",
  "article",
  "[role='main']",
  "[class*='content']",
  "[class*='article']",
  "[class*='post']",
  "[class*='entry']",
  "[id*='content']",
  "[id*='article']",
];

/**
 * Score a candidate element for content density.
 * Higher score = more likely to be the main content area.
 * Based on a simplified version of Mozilla Readability's scoring algorithm.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scoreCandidateElement($: any, el: any): number {
  const $el = $(el);
  const text = $el.text().replace(/\s+/g, " ").trim();
  const textLen = text.length;
  if (textLen < 25) return 0;

  const links = $el.find("a");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkTextLen = links.map((_: number, a: any) => $(a).text().length).get().reduce((a: number, b: number) => a + b, 0);
  const linkDensity = textLen > 0 ? linkTextLen / textLen : 1;

  // heading bonus: having headings means structured content
  const headings = $el.find("h1,h2,h3,h4").length;
  const headingBonus = Math.min(headings * 5, 25);

  // paragraph bonus: real content has paragraphs
  const paragraphs = $el.find("p").length;
  const paragraphBonus = Math.min(paragraphs * 3, 30);

  return Math.round(textLen * (1 - linkDensity) + headingBonus + paragraphBonus);
}

/**
 * Extract main content from HTML using cheerio.
 * Tries semantic selectors first, then density scoring, then falls back to boilerplate removal.
 */
export function extractMainContent(html: string, baseUrl?: string, maxChars = 25000): string {
  if (!html || !html.trim()) return "";

  const $ = cheerio.load(html);

  // Remove non-content elements
  for (const tag of REMOVE_TAGS) {
    $(tag).remove();
  }

  // Remove comments
  $("*").contents().filter(function () {
    return this.type === "comment";
  }).remove();

  // Try semantic content selectors
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let $content: any = null;
  for (const selector of CONTENT_SELECTORS) {
    const $el = $(selector).first();
    if ($el.length && ($el.text() || "").trim().length > 200) {
      $content = $el;
      break;
    }
  }

  // Density scoring pass: find the highest-scoring candidate element
  // when no semantic selector matched
  if (!$content) {
    let bestScore = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let bestEl: any = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $("div, section, article, main").each((_: number, el: any) => {
      const textLen = $(el).text().replace(/\s+/g, " ").trim().length;
      if (textLen <= 150) return;
      const score = scoreCandidateElement($, el);
      if (score > bestScore) {
        bestScore = score;
        bestEl = $(el);
      }
    });

    if (bestScore > 100 && bestEl) {
      $content = bestEl;
    }
  }

  // Fallback: use body with boilerplate removed
  if (!$content) {
    for (const selector of BOILERPLATE_SELECTORS) {
      $(selector).remove();
    }
    $content = $("body");
  }

  if (!$content || !$content.length) return "";

  // Convert to markdown-like text
  const lines: string[] = [];

  /** Render an element's inline content as markdown, preserving links/emphasis */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function inlineMarkdown($el: any, baseUrl?: string): string {
    let md = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $el.contents().each((_: number, node: any) => {
      if (node.type === "text") {
        md += (node.data || "").replace(/\s+/g, " ");
      } else if (node.type === "tag") {
        const tag = (node.tagName || "").toLowerCase();
        const $node = $(node);
        const inner = inlineMarkdown($node, baseUrl);
        if (tag === "a") {
          const href = $node.attr("href");
          const resolved = href ? resolveHref(href, baseUrl) : null;
          md += resolved && inner.trim() ? `[${inner.trim()}](${resolved})` : inner;
        } else if (tag === "strong" || tag === "b") {
          md += inner.trim() ? `**${inner.trim()}**` : inner;
        } else if (tag === "em" || tag === "i") {
          md += inner.trim() ? `*${inner.trim()}*` : inner;
        } else if (tag === "code") {
          md += inner.trim() ? `\`${inner.trim()}\`` : inner;
        } else {
          md += inner;
        }
      }
    });
    return md;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // Exclude td/th — tables handled separately below to avoid duplication
  $content.find("h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, dt, dd").filter((_: number, el: any) => {
    // Skip elements inside tables to prevent duplicate content
    return $(el).parents("table").length === 0 || ["dt", "dd"].includes((el.tagName || "").toLowerCase());
  }).each((_: number, el: any) => {
    const $el = $(el);
    const tag = (el.tagName || "").toLowerCase();
    const text = tag === "pre"
      ? $el.text()
      : $el.text().replace(/\s+/g, " ").trim();
    if (!text) return;

    if (tag.match(/^h[1-6]$/)) {
      const level = parseInt(tag[1]);
      lines.push(`\n${"#".repeat(level)} ${text}\n`);
    } else if (tag === "li") {
      lines.push(`- ${inlineMarkdown($el, baseUrl).replace(/\s+/g, " ").trim()}`);
    } else if (tag === "blockquote") {
      lines.push(`> ${text}`);
    } else if (tag === "pre") {
      lines.push(`\`\`\`\n${text}\n\`\`\``);
    } else {
      // p, dt, dd — preserve inline formatting
      lines.push(inlineMarkdown($el, baseUrl).replace(/\s+/g, " ").trim());
    }
  });

  // Handle tables — render top-level tables and data tables nested in layout wrappers.
  // Rules:
  //   layout-in-layout  → skip (parent cell extraction handles it via inlineMarkdown)
  //   data-in-data      → skip (parent data table already renders it)
  //   data-in-layout    → RENDER (e.g. Wikipedia infobox inside page layout wrapper)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $content.find("table").each((_: number, table: any) => {
    const $table = $(table);

    // Check for <th> in thead, direct tr children, or tbody rows (covers Wikipedia infoboxes
    // and other tables that use <th scope="row"> inside <tbody> instead of <thead>)
    const hasHeaders = $table.children("thead").children("tr").children("th").length > 0
      || $table.children("tr").children("th").length > 0
      || $table.children("tbody").children("tr").children("th").length > 0;

    if ($table.parents("table").length > 0) {
      if (!hasHeaders) return; // nested layout table — skip, handled by cell extraction
      // Nested data table: only render if every ancestor table is a layout table
      // (i.e. no ancestor has <th> direct children). If an ancestor is itself a data
      // table this table is already captured, so skip to avoid duplication.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nestedInDataTable = $table.parents("table").filter((__: number, t: any) =>
        $(t).children("thead").children("tr").children("th").length > 0 ||
        $(t).children("tr").children("th").length > 0
      ).length > 0;
      if (nestedInDataTable) return;
      // Fall through: data table inside layout wrapper — render it
    }

    const rows: string[][] = [];
    // Use only direct-child rows (add both <tbody>/<thead> wrappers and bare <tr>s)
    const $directRows = $table.children("tbody, thead, tfoot").children("tr")
      .add($table.children("tr"));
    $directRows.each((__, tr) => {
      const cells: string[] = [];
      // Direct cell children only — avoids traversing into nested tables.
      // Exception: if a cell contains a nested table (e.g. HN's story list inside
      // a layout wrapper), extract each nested row as a separate paragraph so that
      // individual list items don't collapse into a single wall of text.
      $(tr).children("th, td").each((___, cell) => {
        const $cell = $(cell);
        const $nestedTable = $cell.children("table").first();
        if ($nestedTable.length > 0) {
          const nestedLines: string[] = [];
          $nestedTable.find("tr").each((__, nestedTr) => {
            const rowText = $(nestedTr).children("td, th")
              .map((_: number, td: unknown) => inlineMarkdown($(td as never), baseUrl).trim())
              .get()
              .filter((t: string) => t.length > 0)
              .join(" ");
            if (rowText) nestedLines.push(rowText);
          });
          if (nestedLines.length > 0) cells.push(nestedLines.join("\n\n"));
        } else {
          const text = $cell.text().replace(/\s+/g, " ").trim();
          if (text) cells.push(text);
        }
      });
      if (cells.length) rows.push(cells);
    });

    if (!rows.length) return;

    if (hasHeaders) {
      // Render as markdown table (data table)
      const header = `| ${rows[0].join(" | ")} |`;
      const separator = `| ${rows[0].map(() => "---").join(" | ")} |`;
      const body = rows.slice(1).map(r => `| ${r.join(" | ")} |`).join("\n");
      lines.push(`\n${header}\n${separator}\n${body}\n`);
    } else {
      // Layout table — extract as plain text (one line per row, cells joined with " — ")
      const textLines = rows
        .map(cells => cells.join(" — "))
        .filter(t => t.length > 0);
      if (textLines.length > 0) {
        lines.push(`\n${textLines.join("\n\n")}\n`);
      }
    }
  });

  const result = lines.join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (result.length <= maxChars) return result;

  // Truncate at the last double-newline (paragraph boundary) before the limit
  const boundary = result.lastIndexOf("\n\n", maxChars);
  return (boundary > maxChars * 0.8 ? result.slice(0, boundary) : result.slice(0, maxChars)).trim();
}

export interface StructuredData {
  type: string;
  fields: Record<string, string>;
  raw?: string;
}

/** Priority order for schema.org @type selection */
const TYPE_PRIORITY: string[] = [
  "Product",
  "Article", "NewsArticle", "BlogPosting",
  "Event",
  "Person",
  "Organization",
  "WebPage",
];

/** Strip schema.org URL prefix from availability values */
function stripSchemaPrefix(value: string): string {
  return value.replace(/^https?:\/\/schema\.org\//i, "");
}

/** Coerce an arbitrary JSON value to a short string */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coerceToString(value: any, maxLen = 100): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if (value.name && typeof value.name === "string") return value.name;
    const s = JSON.stringify(value);
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  }
  return null;
}

/** Extract fields for a given schema.org type from a parsed JSON-LD object */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFields(type: string, obj: Record<string, any>): Record<string, string> {
  const fields: Record<string, string> = {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function set(key: string, value: any, transform?: (s: string) => string): void {
    const s = coerceToString(value);
    if (s) fields[key] = transform ? transform(s) : s;
  }

  if (type === "Product") {
    set("name", obj.name);
    const offers = obj.offers;
    if (offers && typeof offers === "object") {
      set("price", offers.price ?? obj.price);
      set("currency", offers.priceCurrency ?? obj.priceCurrency);
      set("availability", offers.availability ?? obj.availability, stripSchemaPrefix);
    } else {
      set("price", obj.price);
      set("currency", obj.priceCurrency);
      set("availability", obj.availability, stripSchemaPrefix);
    }
    set("description", obj.description);
    set("brand", obj.brand);
    set("ratingValue", obj.aggregateRating?.ratingValue);
    set("reviewCount", obj.aggregateRating?.reviewCount);
    set("sku", obj.sku);
  } else if (type === "Article" || type === "NewsArticle" || type === "BlogPosting") {
    set("headline", obj.headline);
    set("author", obj.author?.name ?? obj.author);
    set("datePublished", obj.datePublished);
    set("dateModified", obj.dateModified);
    set("description", obj.description);
    set("publisher", obj.publisher?.name ?? obj.publisher);
    if (obj.articleBody) {
      fields.articleBody = coerceToString(obj.articleBody) ?? "";
    }
  } else if (type === "Event") {
    set("name", obj.name);
    set("startDate", obj.startDate);
    set("endDate", obj.endDate);
    const loc = obj.location;
    if (loc && typeof loc === "object") {
      set("location", loc.name ?? loc.address?.streetAddress ?? loc.address);
    } else {
      set("location", loc);
    }
    set("description", obj.description);
    set("organizer", obj.organizer?.name ?? obj.organizer);
  } else if (type === "Person") {
    set("name", obj.name);
    set("jobTitle", obj.jobTitle);
    set("description", obj.description);
    set("url", obj.url);
  } else if (type === "Organization") {
    set("name", obj.name);
    set("description", obj.description);
    set("url", obj.url);
    set("telephone", obj.telephone);
  } else {
    // WebPage / fallback
    set("name", obj.name);
    set("description", obj.description);
    set("url", obj.url);
  }

  // Remove empty-string values that slipped through
  for (const k of Object.keys(fields)) {
    if (!fields[k]) delete fields[k];
  }

  return fields;
}

/**
 * Extract the highest-priority schema.org JSON-LD structured data block from HTML.
 * Returns null if no valid JSON-LD is found.
 */
export function extractStructuredData(html: string): StructuredData | null {
  if (!html) return null;

  const $ = cheerio.load(html);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidates: Array<{ priority: number; type: string; obj: Record<string, any>; raw: string }> = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html() || "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // skip malformed
    }

    // Normalise to array — some pages wrap multiple objects in a top-level array
    const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj = item as Record<string, any>;
      const rawType: unknown = obj["@type"];
      const types = Array.isArray(rawType) ? rawType : [rawType];

      for (const t of types) {
        if (typeof t !== "string") continue;
        const idx = TYPE_PRIORITY.findIndex(p => p.toLowerCase() === t.toLowerCase());
        const priority = idx === -1 ? TYPE_PRIORITY.length : idx;
        candidates.push({ priority, type: t, obj, raw: JSON.stringify(obj).slice(0, 200) });
      }
    }
  });

  if (!candidates.length) return null;

  // Pick the highest-priority (lowest index) candidate
  candidates.sort((a, b) => a.priority - b.priority);
  const best = candidates[0];
  const fields = extractFields(best.type, best.obj);

  return { type: best.type, fields, raw: best.raw };
}

export interface ExtractionQuality {
  score: number;      // 0-100
  signals: string[];  // human-readable reasons (for debugging)
}

/**
 * Score the quality of an extraction result on a 0-100 scale.
 * Additive signals, clamped to [0, 100].
 */
export function scoreExtraction(
  html: string,
  markdown: string,
  usedMode: string,
  hasStructuredData: boolean
): ExtractionQuality {
  let score = 0;
  const signals: string[] = [];

  // Structured data
  if (hasStructuredData) {
    score += 30;
    signals.push("structured_data:+30");
  }

  // Content length
  const contentLen = markdown.length;
  if (contentLen < 200) {
    score -= 20;
    signals.push("content_tiny:-20");
  } else if (contentLen >= 5000) {
    score += 20;
    signals.push("content_long:+20");
  } else if (contentLen >= 1000) {
    score += 10;
    signals.push("content_medium:+10");
  }

  // Link density: count [text](url) patterns in markdown
  const linkMatches = markdown.match(/\[[^\]]+\]\([^)]+\)/g);
  const linkCount = linkMatches ? linkMatches.length : 0;
  // Rough word count for density: split on whitespace
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;
  if (wordCount > 0) {
    const density = linkCount / wordCount;
    if (density >= 0.05 && density <= 0.4) {
      score += 10;
      signals.push("link_density_ok:+10");
    }
  }

  // Has H2 or H3 headings
  const hasHeadings = /^## |^### /m.test(markdown);
  if (hasHeadings) {
    score += 10;
    signals.push("has_headings:+10");
  }

  // Has at least one code block
  const hasCodeBlock = /```/.test(markdown);
  if (hasCodeBlock) {
    score += 5;
    signals.push("has_code_block:+5");
  }

  // Mode bonus/penalty
  if (usedMode === "static") {
    score += 10;
    signals.push("mode_static:+10");
  } else if (usedMode === "render") {
    score += 5;
    signals.push("mode_render:+5");
  } else if (usedMode === "render-failed") {
    score -= 15;
    signals.push("mode_render_failed:-15");
  }
  // browser: 0 points, no signal

  // Bot challenge detected in HTML
  if (detectJsHeavyContent(html)) {
    score -= 40;
    signals.push("bot_challenge:-40");
  }

  // Truncation penalty
  if (markdown.length >= 25000) {
    score -= 5;
    signals.push("truncated:-5");
  }

  // Clamp to [0, 100]
  score = Math.max(0, Math.min(100, score));

  return { score, signals };
}

/** Extract page title from HTML */
export function extractTitle(html: string): string {
  if (!html) return "Untitled";
  const $ = cheerio.load(html);
  return $("title").first().text().trim() || $("h1").first().text().trim() || "Untitled";
}

/** Extract meta description from HTML */
export function extractDescription(html: string): string {
  if (!html) return "";
  const $ = cheerio.load(html);
  return (
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    ""
  ).trim();
}

/** Resolve a single href to an absolute URL */
function resolveHref(href: string, baseUrl?: string): string | null {
  if (href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) return null;
  if (href.startsWith("//")) return `https:${href}`;
  if (baseUrl && !href.startsWith("http")) {
    try { return new URL(href, baseUrl).href; }
    catch { return null; }
  }
  return href.startsWith("http") ? href : null;
}

/**
 * Extract all meaningful links from HTML.
 * Navigation links (from <nav>, <header>) are returned first for better site mapping.
 */
export function extractLinks(html: string, baseUrl?: string): string[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const navLinks: string[] = [];
  const bodyLinks: string[] = [];
  const seen = new Set<string>();

  // Priority 1: Navigation and header links (site structure)
  $("nav a[href], header a[href], [role='navigation'] a[href]").each((_, el) => {
    const url = resolveHref($(el).attr("href") || "", baseUrl);
    if (url && !seen.has(url)) {
      seen.add(url);
      navLinks.push(url);
    }
  });

  // Priority 2: All other links
  $("a[href]").each((_, el) => {
    const url = resolveHref($(el).attr("href") || "", baseUrl);
    if (url && !seen.has(url)) {
      seen.add(url);
      bodyLinks.push(url);
    }
  });

  return [...navLinks, ...bodyLinks];
}
