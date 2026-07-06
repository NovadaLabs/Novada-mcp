import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { createRequire } from "node:module";
import type TurndownServiceType from "turndown";
// detectJsHeavyContent is used by extract.ts for render-escalation decisions,
// but no longer used in the quality scorer (removed unfair React SPA penalty).

/**
 * Lazy Turndown singleton (NOV-577 cold-start). Turndown + the GFM plugin are ~heavy and were
 * previously instantiated at module top, so merely importing html.ts (pulled in eagerly via the
 * utils barrel) paid that cost on every process start — even for a request that never converts
 * HTML (e.g. a pure proxy/search call). We now defer the load to first use via createRequire so
 * the dep stays out of the cold-start path while htmlToMarkdown remains synchronous (no signature
 * change ripples into extractMainContent's sync callers in crawl.ts / site_copy.ts).
 */
let turndownInstance: TurndownServiceType | null = null;
function getTurndown(): TurndownServiceType {
  if (turndownInstance) return turndownInstance;
  const require = createRequire(import.meta.url);
  const TurndownService = require("turndown") as typeof TurndownServiceType;
  const { gfm } = require("turndown-plugin-gfm") as { gfm: TurndownServiceType.Plugin };
  const instance = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  instance.use(gfm);
  turndownInstance = instance;
  return instance;
}

/** Convert an HTML string to markdown via Turndown */
function htmlToMarkdown(html: string): string {
  return getTurndown().turndown(html);
}

/** Elements to completely remove before content extraction */
const REMOVE_TAGS = [
  "script", "style", "noscript", "svg", "iframe", "nav", "footer",
  "aside",
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

  // Fix 5 + NOV-578: Conditional <header> removal. Remove site-banner / chrome headers —
  // those carrying nav/logo/brand OR (the previously-leaking case) a bare <header> with no
  // heading of its own (e.g. `<header>Site Header</header>`). Keep an article byline header,
  // i.e. a <header> that wraps the content's own heading (h1-h6), so article markup survives.
  // This runs globally so the density/body-fallback paths get the same strip as the semantic one.
  $('header').each((_, el) => {
    const $el = $(el);
    const hasNavOrLogo = $el.find('nav').length > 0 || $el.find('[class*="logo"], [class*="brand"]').length > 0;
    const hasHeading = $el.find('h1, h2, h3, h4, h5, h6').length > 0;
    // Remove as chrome only if it carries nav/logo, OR it is an explicit/top-level banner, OR it
    // is a heading-less header with little text (e.g. `<header>Site Header</header>`). A heading-less
    // <header> that holds real content (CMS byline/intro) is KEPT — NOV-578 review: strip chrome,
    // never delete article text.
    const isBanner = $el.attr('role') === 'banner' || $el.parent().is('body');
    const isShortChrome = !hasHeading && (isBanner || $el.text().trim().length < 200);
    if (hasNavOrLogo || isShortChrome) {
      $el.remove();
    }
  });

  // Fix 2: Conditional <form> removal — only remove forms with high link density or very little text
  $('form').each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    const links = $el.find('a').length;
    const density = links / Math.max(text.length, 1);
    if (density > 0.3 || text.length < 50) $el.remove();
  });

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
      // Fix 1: Strip nav/sidebar/footer/aside elements nested inside semantic
      // containers (e.g. <nav>/<footer>/<aside> inside <main>, sidebar inside
      // <article>). REMOVE_TAGS already drops top-level nav/footer/aside, but a
      // copy nested inside the matched container would otherwise survive — keep
      // footer/aside here too so the strip is bounded at the extraction point.
      $el.find('nav, footer, aside, [class*="sidebar"], [class*="nav"], [role="navigation"], [class*="menu"]').remove();
      // NOV-578: drop nested <header> chrome (site/section/breadcrumb headers) that
      // leaked into main content. Preserve an article byline header — i.e. a <header>
      // that wraps the content's own heading (h1-h6) — so Fix-5 behaviour is unchanged;
      // remove only headers carrying nav/logo OR no heading at all (pure boilerplate).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $el.find('header').filter((_: number, el: any) => {
        const $h = $(el);
        const navLogo = $h.find('nav, [class*="logo"]').length > 0;
        const noHeading = $h.find('h1, h2, h3, h4, h5, h6').length === 0;
        // Same guard as the global pass: keep a heading-less header that holds real content.
        return navLogo || (noHeading && $h.text().trim().length < 200);
      }).remove();
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

  // Convert content to markdown via Turndown (handles headings, lists, tables,
  // code blocks, links, images, emphasis, blockquotes automatically)
  const contentHtml = $.html($content);
  const result = htmlToMarkdown(contentHtml)
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (result.length <= maxChars) return result;

  // Truncate at the last double-newline (paragraph boundary) before the limit
  const boundary = result.lastIndexOf("\n\n", maxChars);
  return (boundary > maxChars * 0.8 ? result.slice(0, boundary) : result.slice(0, maxChars)).trim();
}

/**
 * Extract full page content from HTML — keeps nav, header, footer, aside, form.
 * Only removes non-renderable tags: script, style, noscript, iframe, svg, canvas.
 * Uses Turndown + GFM plugin for HTML-to-markdown conversion.
 * Target output: 50,000–100,000 chars.
 */
export function extractFullPageContent(html: string, baseUrl?: string): string {
  if (!html || !html.trim()) return "";

  const $ = cheerio.load(html);

  // Remove only non-renderable tags
  $('script, style, noscript, iframe, svg, canvas').remove();

  // Remove HTML comments
  $("*").contents().filter(function () {
    return this.type === "comment";
  }).remove();

  const $body = $("body");
  if (!$body.length) return "";

  // Convert full body to markdown via Turndown
  const bodyHtml = $.html($body);
  return htmlToMarkdown(bodyHtml)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  return extractStructuredDataFrom(cheerio.load(html));
}

/**
 * $-accepting variant of extractStructuredData (NOV-577): read-only, so extract.ts can share
 * one parsed document across the title/description/links/structured-data readers instead of
 * calling cheerio.load four separate times per request.
 */
export function extractStructuredDataFrom($: CheerioAPI): StructuredData | null {
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
  /** 0-100 display score: the floored/mutated value (presence floor + caller quality floors applied). Prefer content_present + cleanliness_score for orthogonal signals. */
  score: number;             // 0-100
  /** True when the page carries substantive prose/content (not a shell, wall, or boilerplate-only page). */
  content_present: boolean;
  /** 0-100 raw additive markup-quality score, captured BEFORE the presence floor (and untouched by caller quality floors). May be lower than `score` when a floor lifts the display value. */
  cleanliness_score: number;
  /** Human-readable reasons explaining content_present + cleanliness (agent-facing). */
  quality_reasons: string[];
  signals: string[];         // human-readable reasons (for debugging)
}

/** Boilerplate phrases that carry no informational content (docs-site chrome). */
const BOILERPLATE_PHRASES: string[] = [
  "Copy page",
  "Building an AI startup?",
  "On this page",
  "Was this page helpful?",
];

/**
 * Strip docs-site boilerplate from cleaned markdown before running quality signals.
 * Removes empty / zero-width anchor links (e.g. `[​](#anchor)`, `[](#section)`)
 * and known no-content chrome phrases. Returns markdown safe to length/word-count.
 */
export function stripBoilerplate(markdown: string): string {
  if (!markdown) return "";
  let out = markdown;

  // Remove markdown links whose visible text is empty or only zero-width/whitespace
  // chars, regardless of target (e.g. heading-anchor "permalink" icons docs sites emit).
  // [​](#x), [](#x), [ ](https://...), [​​](...)
  out = out.replace(/\[[\s​‌‍﻿]*\]\([^)]*\)/g, "");

  // Remove known boilerplate phrases (case-insensitive, whole-line tolerant).
  for (const phrase of BOILERPLATE_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), "");
  }

  // Collapse blank lines left behind by the removals.
  return out
    .split("\n")
    .filter((l, i, arr) => !(l.trim() === "" && (i === 0 || arr[i - 1].trim() === "")))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Count whitespace-delimited words in a string. */
function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Heuristic: does the CLEANED markdown carry substantive content?
 * Substantive = cleaned length >= 200 chars AND word count >= 50.
 * Boilerplate (empty anchors, docs chrome) is stripped before measuring,
 * so a shell/wall page that only renders nav + "Copy page" reads as not-present.
 */
export function hasSubstantiveContent(cleanedMarkdown: string): boolean {
  if (!cleanedMarkdown) return false;
  return cleanedMarkdown.length >= 200 && countWords(cleanedMarkdown) >= 50;
}

/**
 * Score the quality of an extraction result.
 *
 * NOV-565: splits the historical single `score` into two orthogonal signals so
 * docs pages with full text are no longer mislabelled "poor" just because their
 * markup is link-heavy or sparsely structured:
 *   - content_present  — is there real content here? (drives content_ok / escalation)
 *   - cleanliness_score — how clean is the markup? (the raw additive 0-100 score, pre-floor)
 * `score` is the display value: cleanliness_score after the presence floor (and any caller
 * quality floors) are applied, so `score` >= `cleanliness_score` whenever a floor lifts it.
 *
 * All length/link/heading signals run on the CLEANED markdown (boilerplate removed).
 */
export function scoreExtraction(
  html: string,
  markdown: string,
  usedMode: string,
  hasStructuredData: boolean
): ExtractionQuality {
  // Run signals on cleaned markdown so docs-site chrome doesn't skew length/links.
  const cleaned = stripBoilerplate(markdown);
  const content_present = hasSubstantiveContent(cleaned);

  let score = 0;
  const signals: string[] = [];
  const quality_reasons: string[] = [];

  // Structured data bonus (reduced to +10 — pages without JSON-LD shouldn't be penalized heavily)
  if (hasStructuredData) {
    score += 10;
    signals.push("structured_data:+10");
  }

  // Content length (measured on cleaned markdown)
  const contentLen = cleaned.length;
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

  // List items: reward pages with many structured list entries (listings, feeds, search results)
  const listItemCount = (cleaned.match(/^- /gm) ?? []).length;
  if (listItemCount >= 10) {
    score += 10;
    signals.push("has_list_items:+10");
  }

  // Content lines: reward well-structured content with many lines
  const lineCount = cleaned.split("\n").filter(l => l.trim().length > 0).length;
  if (lineCount >= 20) {
    score += 5;
    signals.push("content_lines:+5");
  }

  // Link density: count [text](url) patterns in markdown
  const linkMatches = cleaned.match(/\[[^\]]+\]\([^)]+\)/g);
  const linkCount = linkMatches ? linkMatches.length : 0;
  // Rough word count for density: split on whitespace
  const wordCount = countWords(cleaned);
  if (wordCount > 0) {
    const density = linkCount / wordCount;
    // Upper bound raised from 0.4 to 0.6 — listing pages (Reddit, HN) have link-heavy content
    if (density >= 0.05 && density <= 0.6) {
      score += 10;
      signals.push("link_density_ok:+10");
    }
  }

  // Has H2 or H3 headings
  const hasHeadings = /^## |^### /m.test(cleaned);
  if (hasHeadings) {
    score += 10;
    signals.push("has_headings:+10");
  }

  // Has at least one code block
  const hasCodeBlock = /```/.test(cleaned);
  if (hasCodeBlock) {
    score += 5;
    signals.push("has_code_block:+5");
  }

  // Substantive prose: real content with structure (NOV-565). Rescues docs/article pages
  // whose markup is link-heavy or otherwise scores low on the additive signals.
  if (content_present && hasHeadings) {
    score += 15;
    signals.push("substantive_prose:+15");
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

  // Truncation penalty (measured on cleaned markdown)
  if (contentLen >= 25000) {
    score -= 5;
    signals.push("truncated:-5");
  }

  // Quality floor: substantial content (>20k chars) should never score below 50
  if (contentLen > 20000 && score < 50) {
    score = 50;
    signals.push("content_floor:=50");
  }

  // Clamp to [0, 100]
  score = Math.max(0, Math.min(100, score));

  // Capture the raw additive markup score BEFORE the presence floor so callers can
  // distinguish "actual markup cleanliness" from the floored display score.
  const cleanliness_score = score;

  // Presence floor (NOV-565): a page with real content must not read as "poor".
  // Lift cleanliness to 40 (the "moderate" boundary) so content_ok consumers and
  // the qualityLabel never label a full-text docs page below "moderate".
  if (content_present && score < 40) {
    score = 40;
    signals.push("presence_floor:=40");
  }

  // Agent-facing reasons (concise, parseable).
  quality_reasons.push(
    content_present
      ? `content_present:true (cleaned ${contentLen} chars, ${wordCount} words)`
      : `content_present:false (cleaned ${contentLen} chars, ${wordCount} words — below 200char/50word threshold)`
  );
  if (hasStructuredData) quality_reasons.push("has_structured_data");
  if (hasHeadings) quality_reasons.push("has_headings");
  if (hasCodeBlock) quality_reasons.push("has_code_block");
  if (linkCount > 0 && wordCount > 0 && linkCount / wordCount > 0.6) {
    quality_reasons.push("link_heavy (density>0.6)");
  }

  return {
    score,
    content_present,
    cleanliness_score,
    quality_reasons,
    signals,
  };
}

export function qualityLabel(score: number): string {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "moderate";
  if (score >= 20) return "poor";
  return "low";
}

/** Extract page title from HTML */
export function extractTitle(html: string): string {
  if (!html) return "Untitled";
  return extractTitleFrom(cheerio.load(html));
}

/** $-accepting variant of extractTitle (NOV-577): read-only, shareable across readers. */
export function extractTitleFrom($: CheerioAPI): string {
  return $("title").first().text().trim() || $("h1").first().text().trim() || "Untitled";
}

/** Extract meta description from HTML */
export function extractDescription(html: string): string {
  if (!html) return "";
  return extractDescriptionFrom(cheerio.load(html));
}

/** $-accepting variant of extractDescription (NOV-577): read-only, shareable across readers. */
export function extractDescriptionFrom($: CheerioAPI): string {
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
  return extractLinksFrom(cheerio.load(html), baseUrl);
}

/** $-accepting variant of extractLinks (NOV-577): read-only, shareable across readers. */
export function extractLinksFrom($: CheerioAPI, baseUrl?: string): string[] {
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

// ─── NOV-668: Kufer/webbasys Availability Detection ──────────────────────────

/** Normalized availability status values for Kufer/webbasys VHS sites */
export type KuferAvailabilityStatus =
  | "ausgebucht"
  | "buchbar"
  | "waitlist"
  | "closed"
  | `${number}_places`
  | "unknown";

export interface KuferAvailabilityResult {
  /** True when this page looks like a Kufer overview/listing page (no per-course status text). */
  is_overview_page: boolean;
  /** Normalized status (only meaningful when is_overview_page is false). */
  status: KuferAvailabilityStatus;
  /** Raw sibling text extracted from the DOM (for debugging). */
  raw_text: string | null;
  /** Rendered as a markdown block suitable for injection into the extract output. */
  markdown_block: string;
}

/**
 * NOV-668: Detect Kufer/webbasys course availability from a parsed cheerio DOM.
 *
 * German VHS sites using the Kufer webbasys platform encode availability in a CSS
 * sprite image whose `alt` is always the generic "Keine Internetanmeldung möglich".
 * The actual status is in the SIBLING TEXT NODE that follows the <img> element.
 *
 * Detection trigger: HTML contains `kursampeln` or `kbs_set12_sprite` in asset paths,
 * OR `kufer` / `webbasys` appears in the page URL or asset hrefs.
 *
 * Must be called with the RAW parsed `$doc` (before markdown conversion strips inline styles).
 */
export function detectKuferAvailability(
  $: CheerioAPI,
  pageUrl: string,
): KuferAvailabilityResult | null {
  const html = $.html() ?? "";

  // Detection: is this a Kufer page?
  const isKufer =
    /kursampeln/i.test(html) ||
    /kbs_set12_sprite/i.test(html) ||
    /kufer/i.test(html) ||
    /webbasys/i.test(html) ||
    /kufer/i.test(pageUrl) ||
    /webbasys/i.test(pageUrl);

  if (!isKufer) return null;

  // Find all sprite images (the availability traffic lights)
  const spriteImgs = $('img[src*="kursampeln"], img[style*="kbs_set12_sprite"], img[src*="trans.png"]').filter((_, el) => {
    const style = $(el).attr("style") ?? "";
    const src = $(el).attr("src") ?? "";
    return style.includes("kbs_set12") || src.includes("kursampeln") || style.includes("kursampeln");
  });

  // Overview-trap: sprite image(s) present but no sibling status text
  // (overview/listing pages show icons for many courses without individual text)
  if (spriteImgs.length === 0) {
    // No sprite images at all — not a Kufer course page we can parse
    return null;
  }

  const rawTexts: string[] = [];
  const statuses: KuferAvailabilityStatus[] = [];

  spriteImgs.each((_, el) => {
    // Walk the sibling nodes within the same parent to find status text
    const parent = $(el).parent();
    let siblingText = "";
    parent.contents().each((_, node) => {
      if (node.type === "text") {
        siblingText += (node.data ?? "").trim() + " ";
      } else if (node.type === "tag" && node.tagName !== "img") {
        // Capture text in adjacent inline elements (span, b, etc.) but NOT <a> links
        // — link text is navigation/course-name, not a status keyword
        if (node.tagName !== "a") {
          siblingText += $(node).text().trim() + " ";
        }
      }
    });
    siblingText = siblingText.trim();
    rawTexts.push(siblingText);
    statuses.push(normalizeKuferStatus(siblingText));
  });

  // Overview-trap: presence of a RECOGNIZED status keyword in sibling text,
  // NOT mere presence of any text. Link text ("Spanisch Anfänger") is navigation,
  // not a status signal — it must NOT suppress the overview-page warning.
  const hasStatusKeyword = statuses.some(s => s !== "unknown");
  const isOverviewPage = !hasStatusKeyword;

  if (isOverviewPage) {
    const block = [
      `## Kufer Availability`,
      `⚠️ agent_instruction: Kufer overview page — availability here is NOT reliable (icon alt text is generic). Fetch the individual course detail page for the real status.`,
    ].join("\n");
    return {
      is_overview_page: true,
      status: "unknown",
      raw_text: null,
      markdown_block: block,
    };
  }

  // For single-course detail pages, pick the first recognized status
  const primaryIdx = statuses.findIndex(s => s !== "unknown");
  const primaryStatus = primaryIdx !== -1 ? statuses[primaryIdx] : (statuses[0] ?? "unknown");
  // Raw text: use the text that matched the status keyword, not arbitrary link text
  const primaryText = primaryIdx !== -1 ? (rawTexts[primaryIdx] ?? null) : null;

  const statusLabel = kuferStatusLabel(primaryStatus);
  const block = [
    `## Kufer Availability`,
    `availability_status: ${primaryStatus}`,
    `status_label: ${statusLabel}`,
    ...(primaryText ? [`raw_text: ${primaryText}`] : []),
  ].join("\n");

  return {
    is_overview_page: false,
    status: primaryStatus,
    raw_text: primaryText,
    markdown_block: block,
  };
}

/** Normalize raw German VHS sibling text to a typed status token */
function normalizeKuferStatus(text: string): KuferAvailabilityStatus {
  if (!text) return "unknown";
  const t = text.toLowerCase();

  if (/ausgebucht/.test(t)) return "ausgebucht";
  if (/warteliste/.test(t)) return "waitlist";
  if (/anmeldung\s+geschlossen/.test(t)) return "closed";
  if (/buchbar/.test(t)) return "buchbar";

  // "N Plätze frei" — extract number
  const placesMatch = text.match(/(\d+)\s+plät/i);
  if (placesMatch) return `${parseInt(placesMatch[1], 10)}_places` as KuferAvailabilityStatus;

  return "unknown";
}

/** Human-readable label for a normalized Kufer status */
function kuferStatusLabel(status: KuferAvailabilityStatus): string {
  if (status === "ausgebucht") return "fully booked";
  if (status === "buchbar") return "bookable";
  if (status === "waitlist") return "waitlist only";
  if (status === "closed") return "registration closed";
  if (status === "unknown") return "unknown";
  if (status.endsWith("_places")) return `${status.replace("_places", "")} places available`;
  return status;
}

// ─── NOV-671: Table-preserving truncation ────────────────────────────────────

/**
 * NOV-671: Truncate markdown content at max_chars while preserving any table
 * that falls in the last ~30% of the content.
 *
 * If a table starts within the last 30% of total content and would be cut by
 * a naive slice, we instead trim boilerplate/prose above it and keep the table intact.
 * Falls back to standard paragraph-boundary truncation when no table is at risk.
 */
export function truncatePreservingTable(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;

  // Find the last markdown table header row (| col | col |)
  const tablePattern = /^(\|[^\n]+\|)\n(\|[-: |]+\|)\n/m;
  const tableStartIdx = findLastTableStart(content);

  if (tableStartIdx !== -1 && tableStartIdx > content.length * 0.7) {
    // Table sits in the last 30% — it would be at risk from naive truncation.
    // Find where the table ends
    const tableEnd = findTableEnd(content, tableStartIdx);

    if (tableEnd <= maxChars) {
      // The full table fits within maxChars: standard truncation is fine
      // (table won't be cut). Fall through.
    } else {
      // Table extends beyond maxChars. Try to keep it by trimming content before it.
      const tableBlock = content.slice(tableStartIdx, tableEnd);
      const tableLen = tableBlock.length;

      if (tableLen <= maxChars) {
        // We have room to fit the table; trim prefix content to make room
        const prefixBudget = maxChars - tableLen;
        const prefix = content.slice(0, tableStartIdx);
        const trimmedPrefix = prefix.length > prefixBudget
          ? prefix.slice(prefix.length - prefixBudget)
          : prefix;
        return (trimmedPrefix + tableBlock).slice(0, maxChars);
      }
      // Table itself is larger than maxChars: fall through to standard truncation
    }
  }

  // Standard paragraph-boundary truncation
  const boundary = content.lastIndexOf("\n\n", maxChars);
  return (boundary > maxChars * 0.8 ? content.slice(0, boundary) : content.slice(0, maxChars)).trim();
}

/** Find the start index of the last markdown table in content, or -1 if none. */
function findLastTableStart(content: string): number {
  // A markdown table header row starts with | and is followed by a separator row
  const tableHeaderRe = /^\|[^\n]+\|\n\|[-: |]+\|/gm;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = tableHeaderRe.exec(content)) !== null) {
    lastMatch = m;
  }
  return lastMatch ? lastMatch.index : -1;
}

/** Find the end index of a markdown table starting at tableStartIdx. */
function findTableEnd(content: string, tableStartIdx: number): number {
  const lines = content.slice(tableStartIdx).split("\n");
  let i = 0;
  let charCount = tableStartIdx;
  for (const line of lines) {
    if (i > 1 && !line.trimStart().startsWith("|")) {
      // First non-table line after the header + separator
      break;
    }
    charCount += line.length + 1; // +1 for \n
    i++;
  }
  return Math.min(charCount, content.length);
}
