/**
 * research-query-quality-2026-11-14: sub-query generation + comparand
 * extraction unit tests.
 *
 * Owner report (2026-11-14): researching German business broadband
 * ("O2, Telekom, Deutsche Telekom Geschäftskunden Internet") returned
 * irrelevant results. Root causes fixed in research.ts:
 *   1. Sub-queries were the full question + English filler suffixes →
 *      near-duplicate searches, English filler on a German question.
 *   2. keyPhrase used English-only STOP_WORDS → German "und" survived and
 *      truncated "Deutsche Telekom" mid-name.
 *   3. detectDomain/extractComparands didn't fire on comma lists or German
 *      "Vergleich"/"vs" variants → comparison questions got generic suffixes
 *      instead of one query per comparand.
 *   4. Hard-coded stale years ("2024 2025 trends", "best practices 2025").
 *
 * This file tests generateSearchQueries + extractComparands directly
 * (exported from research.ts) rather than through novadaResearch, so the
 * fixture table below can cover ≥12 question shapes cheaply without mocking
 * axios for each one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateSearchQueries, extractComparands } from "../../src/tools/research.js";

// English filler phrases this fix must never append to a non-English-flavored
// comparison query, or to any query derived from a German question.
const ENGLISH_FILLER_MARKERS = [
  "reddit discussion opinions",
  "hacker news discussion",
  "case study examples",
  "overview explained",
  "expert opinion",
  "challenges limitations",
  "best practices",
  "review experience",
  "examples use cases",
  "tutorial step by step",
  "documentation official",
  "comparison table",
  "detailed review",
  "benchmarks performance",
];

function normalizeForDedupCheck(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim();
}

// ──────────────────────────────────────────────────────────────────────────
// Fixture table (≥12 questions): en+de, comparison with 2/3/4 comparands,
// comma lists, multi-word entities, single-topic, how-to.
// ──────────────────────────────────────────────────────────────────────────

interface Fixture {
  label: string;
  question: string;
  /** Every one of these strings must appear (case-insensitive) in ≥1
   *  generated query. For comparison fixtures this is the comparand list. */
  mustAppearSomewhere: string[];
  /** Entities that, if a query contains their FIRST word, must also contain
   *  the full phrase — guards against mid-entity truncation. */
  wholeEntities?: string[];
  /** True when the question is phrased in a non-English language (German,
   *  French, Spanish, or an unsupported script) — asserts 0 English filler
   *  across every generated query (review round 2, MEDIUM #3: en/de/fr/es,
   *  fail-safe for anything else). */
  nonEnglish?: boolean;
}

const FIXTURES: Fixture[] = [
  {
    label: "DE comma-list, 3 comparands, multi-word entity (owner's reported case)",
    question: "O2, Telekom und Deutsche Telekom Geschäftskunden Internet Vergleich",
    mustAppearSomewhere: ["O2", "Telekom", "Deutsche Telekom"],
    wholeEntities: ["Deutsche Telekom"],
    nonEnglish: true,
  },
  {
    label: "EN comma-list (Oxford 'and'), 3 comparands",
    question: "Compare business broadband offers from O2, Telekom and Deutsche Telekom in Germany: prices, speeds, contract terms",
    mustAppearSomewhere: ["O2", "Telekom", "Deutsche Telekom"],
    wholeEntities: ["Deutsche Telekom"],
  },
  {
    label: "EN 'vs', 2 comparands, German nouns in topic tail",
    question: "Vodafone vs O2 Business Mobilfunk Tarife",
    mustAppearSomewhere: ["Vodafone", "O2"],
  },
  {
    label: "DE 'vs' + 'Vergleich', 2 comparands, multi-word entity",
    question: "AWS vs Azure Cloud Kosten Vergleich",
    mustAppearSomewhere: ["AWS", "Azure Cloud"],
    wholeEntities: ["Azure Cloud"],
    nonEnglish: true,
  },
  {
    label: "EN 'Compare X, Y, Z and W' (Oxford comma), 4 comparands",
    question: "Compare Figma, Sketch, Adobe XD and InVision for UI design",
    mustAppearSomewhere: ["Figma", "Sketch", "Adobe XD", "InVision"],
    wholeEntities: ["Adobe XD"],
  },
  {
    label: "EN 'difference between X and Y', 2 comparands, no comma list",
    question: "What is the difference between PostgreSQL and MySQL for analytics workloads?",
    mustAppearSomewhere: ["PostgreSQL", "MySQL"],
  },
  {
    label: "DE 'und' list without comma, 2 comparands",
    question: "O2 und Telekom Geschäftskunden Vergleich",
    mustAppearSomewhere: ["O2", "Telekom"],
    nonEnglish: true,
  },
  {
    label: "EN how-to, single topic (no comparands)",
    question: "how to configure nginx rate limiting",
    mustAppearSomewhere: ["nginx", "rate limiting"],
  },
  {
    label: "DE how-to, single topic (no comparands)",
    question: "Wie konfiguriere ich nginx rate limiting?",
    mustAppearSomewhere: ["nginx"],
    nonEnglish: true,
  },
  {
    label: "EN single-topic, named entity at word position 5+",
    question: "What are the main differences between residential proxies and Novada?",
    mustAppearSomewhere: ["Novada"],
  },
  {
    label: "EN single-topic, multi-word entity at word position 7+",
    question: "What is the current version of the Model Context Protocol SDK for TypeScript?",
    mustAppearSomewhere: ["TypeScript", "Model Context Protocol"],
    wholeEntities: ["Model Context Protocol"],
  },
  {
    label: "DE comparison trigger but only 1 comparand → falls back to generic path (no crash)",
    question: "Vergleich von Cloud-Anbietern",
    mustAppearSomewhere: ["Cloud-Anbietern"],
    nonEnglish: true,
  },
  {
    label: "EN comparison-domain question with 'vs' but short (regression: F14-2 zero-hit comparand case)",
    question: "Compare ProxyA vs UnknownBrandXYZ residential proxy performance",
    mustAppearSomewhere: ["ProxyA", "UnknownBrandXYZ"],
  },

  // ─── Review round 2 additions (2026-11-14) ─────────────────────────────

  {
    label: "EN 3-item 'vs' chain (HIGH #2 regression fixture)",
    question: "Vodafone vs O2 vs 1&1 mobile plans",
    mustAppearSomewhere: ["Vodafone", "O2"],
  },
  {
    label: "EN 4-item 'vs' chain, multi-word trailing entity (HIGH #2 required fixture)",
    question: "AWS vs Azure vs GCP vs Oracle Cloud pricing",
    mustAppearSomewhere: ["AWS", "Azure", "GCP", "Oracle"],
  },
  {
    label: "EN mixed comma-list + 'vs' ('A, B vs C', HIGH #2 required fixture)",
    question: "Spotify, Apple Music vs YouTube Music streaming price",
    mustAppearSomewhere: ["Spotify", "Apple Music", "YouTube Music"],
    wholeEntities: ["Apple Music", "YouTube Music"],
  },
  {
    label: "DE 'gegen' as a vs-equivalent connector",
    question: "Vodafone gegen O2 Mobilfunk",
    mustAppearSomewhere: ["Vodafone", "O2"],
    nonEnglish: true,
  },
  {
    label: "FR comparison ('comparaison entre X et Y', MEDIUM #3 required fixture)",
    question: "Comparaison entre Orange et SFR",
    mustAppearSomewhere: ["Orange", "SFR"],
    nonEnglish: true,
  },
  {
    label: "ES comparison ('comparación entre X y Y', MEDIUM #3 required fixture)",
    question: "Comparación entre Movistar y Vodafone precios",
    mustAppearSomewhere: ["Movistar", "Vodafone"],
    nonEnglish: true,
  },
  {
    label: "EN lowercase-initial brand ('eBay', MEDIUM #4 required fixture)",
    question: "eBay vs Amazon seller fees",
    mustAppearSomewhere: ["eBay", "Amazon"],
  },
  {
    label: "EN camelCase brand ('iPhone') paired with a multi-word entity",
    question: "iPhone vs Samsung Galaxy camera quality",
    mustAppearSomewhere: ["iPhone", "Samsung Galaxy"],
    wholeEntities: ["Samsung Galaxy"],
  },
  {
    label: "DE generic-noun cap: 'Telekom Geschäftskunden' → comparand 'Telekom' only (MEDIUM #4 required fixture)",
    question: "O2 und Telekom Geschäftskunden Vergleich",
    mustAppearSomewhere: ["O2", "Telekom"],
    nonEnglish: true,
  },
  {
    label: "EN/DE generic-noun cap keeps a real 2-word entity whole, drops a trailing common noun (MEDIUM #4 required fixture)",
    question: "Nordrhein-Westfalen vs Baden-Württemberg Bevölkerung",
    mustAppearSomewhere: ["Nordrhein-Westfalen", "Baden-Württemberg"],
    wholeEntities: ["Nordrhein-Westfalen", "Baden-Württemberg"],
  },
  {
    label: "non-Latin script (CJK) — fail-safe to 'unknown' language, zero filler",
    question: "比较一下腾讯和阿里巴巴",
    mustAppearSomewhere: ["腾讯", "阿里巴巴"],
    nonEnglish: true,
  },
];

// Non-comparison inputs that LOOK like a comparand list ("X and Y") but have
// no comparison trigger word — must never produce comparands or a
// comparison-branch query (review round 2, Check 2 non-regression spot-checks).
const NON_COMPARISON_FALSE_POSITIVE_FIXTURES: string[] = [
  "pros and cons of Rust",
  "Barnes and Noble revenue",
  "salt, fat, acid, heat book summary",
  "Bed Bath and Beyond closing stores",
  "Dungeons and Dragons character build",
  "Lewis and Clark expedition history",
];

describe("generateSearchQueries — fixture table (≥12 questions, en+de)", () => {
  for (const fx of FIXTURES) {
    describe(fx.label, () => {
      it("every required entity/comparand appears in ≥1 generated query", () => {
        for (const deep of [false, true]) {
          const queries = generateSearchQueries(fx.question, deep, false);
          for (const entity of fx.mustAppearSomewhere) {
            const found = queries.some(q => q.toLowerCase().includes(entity.toLowerCase()));
            expect(found, `"${entity}" should appear in ≥1 query (deep=${deep}). Queries: ${JSON.stringify(queries)}`).toBe(true);
          }
        }
      });

      if (fx.wholeEntities) {
        it("multi-word entities are never split mid-name", () => {
          const queries = generateSearchQueries(fx.question, true, true);
          for (const entity of fx.wholeEntities!) {
            const firstWord = entity.split(" ")[0].toLowerCase();
            for (const q of queries) {
              const ql = q.toLowerCase();
              // If a query contains the entity's first word as a whole word,
              // it must contain the full entity phrase too.
              if (new RegExp(`\\b${firstWord}\\b`).test(ql)) {
                expect(ql, `query "${q}" contains "${firstWord}" without the full entity "${entity}"`).toContain(entity.toLowerCase());
              }
            }
          }
        });
      }

      if (fx.nonEnglish) {
        it("no English filler suffix on a non-English question", () => {
          for (const deep of [false, true]) {
            for (const comprehensive of [false, true]) {
              const queries = generateSearchQueries(fx.question, deep, comprehensive);
              for (const q of queries) {
                for (const marker of ENGLISH_FILLER_MARKERS) {
                  expect(q.toLowerCase(), `query "${q}" contains English filler "${marker}"`).not.toContain(marker);
                }
              }
            }
          }
        });
      }

      it("no two generated queries are identical after lowercase/whitespace normalization", () => {
        for (const deep of [false, true]) {
          for (const comprehensive of [false, true]) {
            const queries = generateSearchQueries(fx.question, deep, comprehensive);
            const normalized = queries.map(normalizeForDedupCheck);
            const unique = new Set(normalized);
            expect(unique.size, `duplicate queries for deep=${deep} comprehensive=${comprehensive}: ${JSON.stringify(queries)}`).toBe(normalized.length);
          }
        }
      });
    });
  }
});

// Non-comparison inputs that LOOK like a comparand list ("X and Y") but have
// no comparison trigger word — must never trip the ≥2-comparand branch
// (review round 2, Check 2 non-regression spot-checks).
describe("generateSearchQueries / extractComparands — non-comparison false positives", () => {
  for (const question of NON_COMPARISON_FALSE_POSITIVE_FIXTURES) {
    it(`"${question}" never yields ≥2 comparands`, () => {
      expect(extractComparands(question).length).toBeLessThan(2);
    });
  }
});

describe("extractComparands — comparand grouping", () => {
  it("keeps a comma-separated list AND a two-word brand whole, in one pass", () => {
    const comparands = extractComparands("O2, Telekom und Deutsche Telekom Geschäftskunden Internet Vergleich");
    expect(comparands).toEqual(["O2", "Telekom", "Deutsche Telekom"]);
  });

  it("handles an Oxford-comma list (connector before the LAST item, not the second-to-last)", () => {
    const comparands = extractComparands("Compare Figma, Sketch, Adobe XD and InVision for UI design");
    expect(comparands).toEqual(["Figma", "Sketch", "Adobe XD", "InVision"]);
  });

  it("does not bleed into trailing topic/location words after the list closes", () => {
    const comparands = extractComparands(
      "Compare business broadband offers from O2, Telekom and Deutsche Telekom in Germany: prices, speeds, contract terms"
    );
    expect(comparands).toEqual(["O2", "Telekom", "Deutsche Telekom"]);
    expect(comparands).not.toContain("Germany");
  });

  it("returns an empty list for a non-comparison question", () => {
    expect(extractComparands("How does nginx rate limiting work?")).toEqual([]);
  });

  // ─── Review round 2, HIGH #2: "vs" chains ──────────────────────────────

  it("a 3-item 'vs' chain yields all 3 comparands, not just the first 2", () => {
    expect(extractComparands("Vodafone vs O2 vs Telekom mobile plans")).toEqual(["Vodafone", "O2", "Telekom"]);
  });

  it("a 4-item 'vs' chain yields all 4 comparands, not just the first 2", () => {
    expect(extractComparands("AWS vs Azure vs GCP vs Oracle Cloud pricing")).toEqual(["AWS", "Azure", "GCP", "Oracle"]);
  });

  it("'A vs. B' (abbreviated, with a trailing period on 'vs') still yields both comparands", () => {
    expect(extractComparands("AWS vs. Azure")).toEqual(["AWS", "Azure"]);
  });

  it("'A versus B' (spelled out) yields both comparands", () => {
    expect(extractComparands("Figma versus Sketch")).toEqual(["Figma", "Sketch"]);
  });

  it("German 'A gegen B' (vs-equivalent) yields both comparands", () => {
    expect(extractComparands("Vodafone gegen O2 Mobilfunk")).toEqual(["Vodafone", "O2"]);
  });

  it("a mixed comma-list + 'vs' ('A, B vs C') yields all 3 comparands, preserving 2-word entities", () => {
    expect(extractComparands("Spotify, Apple Music vs YouTube Music streaming price")).toEqual([
      "Spotify", "Apple Music", "YouTube Music",
    ]);
  });

  // ─── Review round 2, MEDIUM #3: fr/es comparison questions ─────────────

  it("French 'comparaison entre X et Y' yields both comparands", () => {
    expect(extractComparands("Comparaison entre Orange et SFR")).toEqual(["Orange", "SFR"]);
  });

  it("Spanish 'comparación entre X y Y' yields both comparands", () => {
    expect(extractComparands("Comparación entre Movistar y Vodafone precios")).toEqual(["Movistar", "Vodafone"]);
  });

  // ─── Review round 2, MEDIUM #4: lowercase-initial / camelCase brands ───

  it("a camelCase brand with a lowercase initial ('eBay') is recognized as a comparand", () => {
    expect(extractComparands("eBay vs Amazon seller fees")).toEqual(["eBay", "Amazon"]);
  });

  it("a camelCase brand ('iPhone') paired with a 2-word entity, both kept correctly", () => {
    expect(extractComparands("iPhone vs Samsung Galaxy camera quality")).toEqual(["iPhone", "Samsung Galaxy"]);
  });

  // ─── Review round 2, MEDIUM #4: generic-noun cap on 2-word phrases ─────

  it("a trailing generic noun ('Geschäftskunden') is NOT absorbed into a 1-word comparand", () => {
    expect(extractComparands("O2 und Telekom Geschäftskunden Vergleich")).toEqual(["O2", "Telekom"]);
  });

  it("a real 2-word entity stays whole while a trailing generic noun ('Bevölkerung') is dropped", () => {
    expect(extractComparands("Nordrhein-Westfalen vs Baden-Württemberg Bevölkerung")).toEqual([
      "Nordrhein-Westfalen", "Baden-Württemberg",
    ]);
  });

  it("a generic noun ('Business') between 'vs' and a trailing noun is dropped from the comparand", () => {
    expect(extractComparands("Vodafone vs O2 Business Mobilfunk Tarife")).toEqual(["Vodafone", "O2"]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Hard-coded-year regression: years must come from new Date(), never 2024/2025.
// ──────────────────────────────────────────────────────────────────────────

describe("generateSearchQueries — no hard-coded past years", () => {
  beforeEach(() => {
    // Freeze "now" to a year far from 2024/2025 so a stale literal is
    // unambiguously distinguishable from a computed one.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-03-15T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("comprehensive-depth trend/best-practices queries use the frozen current/previous year, not 2024/2025", () => {
    const queries = generateSearchQueries("Explain quantum computing applications", true, true);
    const joined = queries.join(" | ");
    expect(joined).not.toContain("2024");
    expect(joined).not.toContain("2025");
    expect(joined).toMatch(/2031/);
  });

  it("comprehensive-depth single-topic 'best practices' query uses the frozen current year", () => {
    const queries = generateSearchQueries("What is zero trust networking", true, true);
    const joined = queries.join(" | ");
    expect(joined).not.toContain("2024");
    expect(joined).not.toContain("2025");
    expect(joined).toContain("2031");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Depth semantics unchanged: deep/comprehensive still generate MORE queries
// than quick for a generic (non-comparison) question — same relative scaling
// as before this fix.
// ──────────────────────────────────────────────────────────────────────────

describe("generateSearchQueries — depth scaling unchanged for generic questions", () => {
  it("quick < deep < comprehensive for a non-comparison question", () => {
    const question = "Explain how distributed caching reduces database load";
    const quick = generateSearchQueries(question, false, false);
    const deep = generateSearchQueries(question, true, false);
    const comprehensive = generateSearchQueries(question, true, true);
    expect(quick.length).toBeLessThan(deep.length);
    expect(deep.length).toBeLessThan(comprehensive.length);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// focus param still reaches derived sub-queries (both branches).
// ──────────────────────────────────────────────────────────────────────────

describe("generateSearchQueries — focus param propagation", () => {
  it("applies focus to derived comparison sub-queries", () => {
    const queries = generateSearchQueries("Vodafone vs O2 Business Mobilfunk Tarife", false, false, "5G coverage");
    const derived = queries.slice(1);
    expect(derived.some(q => q.includes("5G coverage"))).toBe(true);
  });

  it("applies focus to derived generic sub-queries", () => {
    const queries = generateSearchQueries("how to configure nginx rate limiting", false, false, "Kubernetes ingress");
    const derived = queries.slice(1);
    expect(derived.some(q => q.includes("Kubernetes ingress"))).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Review round 2, LOW: no bare 1-token sub-queries (append the topic
// residual, or skip and rely on the side-by-side query instead).
// ──────────────────────────────────────────────────────────────────────────

describe("generateSearchQueries — no bare 1-token comparand queries", () => {
  it("a comparison with an empty topic residual never emits a bare single-token query", () => {
    const queries = generateSearchQueries("difference between TCP and UDP", true, true);
    for (const q of queries) {
      const wordCount = q.trim().split(/\s+/).length;
      expect(wordCount, `query "${q}" is a bare single token`).toBeGreaterThan(1);
    }
    // Both comparands still appear — via the side-by-side query, not a bare one.
    expect(queries.some(q => /\btcp\b/i.test(q) && /\budp\b/i.test(q))).toBe(true);
  });

  it("a 2-comparand question with zero residual still produces ≥1 query mentioning both (via side-by-side)", () => {
    const queries = generateSearchQueries("eBay vs Amazon", true, true);
    expect(queries.some(q => /\bebay\b/i.test(q) && /\bamazon\b/i.test(q))).toBe(true);
    for (const q of queries) {
      expect(q.trim().split(/\s+/).length).toBeGreaterThan(1);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Review round 2, MEDIUM #3: unsupported-script language detection fails
// SAFE — zero filler suffixes, never a guessed-English translation.
// ──────────────────────────────────────────────────────────────────────────

describe("generateSearchQueries — unsupported-script language fails safe", () => {
  it("a CJK-script question gets zero English (or any-language) filler suffixes", () => {
    const question = "比较一下腾讯和阿里巴巴云服务";
    const queries = generateSearchQueries(question, true, true);
    for (const q of queries) {
      for (const marker of ENGLISH_FILLER_MARKERS) {
        expect(q.toLowerCase(), `query "${q}" contains filler "${marker}"`).not.toContain(marker);
      }
    }
    // Still returns at least the original question — never throws, never empty.
    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0]).toBe(question);
  });

  it("a Cyrillic-script question gets zero English filler suffixes", () => {
    const question = "сравнение Яндекс и Google";
    const queries = generateSearchQueries(question, true, true);
    for (const q of queries) {
      for (const marker of ENGLISH_FILLER_MARKERS) {
        expect(q.toLowerCase()).not.toContain(marker);
      }
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// C5 (#1, 2026-11-18): query #1 must never seed the raw question verbatim
// when it's long — it's the literal string sent upstream as a sub-query, and
// an over-long one routinely failed the SERP's own query-length limits
// (repro: queries:1/3 succeeded, top_sources:0, failed_queries listing the
// full 98-word question). Fix: bound it with the SAME boundQuery() (search.ts,
// 500-char word-boundary truncation) novada_search already applies to every
// outgoing query, instead of a second truncation policy.
// ──────────────────────────────────────────────────────────────────────────

describe("generateSearchQueries — C5: query #1 is bounded, never the raw long question verbatim", () => {
  // 98 words, no comparison trigger words — same shape as the wave-C repro.
  const LONG_NON_COMPARISON_QUESTION = Array(98).fill("enterprise").map((w, i) => `${w}${i}`).join(" ")
    + " data infrastructure procurement requirements evaluation criteria vendor selection process";

  it("a 90+-word non-comparison question: query #1 is <= 500 chars, not the raw question", () => {
    expect(LONG_NON_COMPARISON_QUESTION.length).toBeGreaterThan(500);
    const queries = generateSearchQueries(LONG_NON_COMPARISON_QUESTION, false, false, "focus-term");
    expect(queries[0].length).toBeLessThanOrEqual(500);
    expect(queries[0]).not.toBe(LONG_NON_COMPARISON_QUESTION);
  });

  it("mirror — a 90+-word COMPARISON question: query #1 is ALSO <= 500 chars (the seed is unconditional, before the comparison branch)", () => {
    const longComparison = "Compare in detail the following platforms across every dimension that matters for an enterprise buyer: "
      + Array(80).fill("FeatureAndCriterionName").map((w, i) => `${w}${i}`).join(", ")
      + " — PlatformAlpha versus PlatformBeta";
    expect(longComparison.length).toBeGreaterThan(500);
    const queries = generateSearchQueries(longComparison, true, true);
    expect(queries[0].length).toBeLessThanOrEqual(500);
    expect(queries[0]).not.toBe(longComparison);
  });

  it("mirror — a SHORT question's query #1 is untouched (boundQuery is a no-op under 500 chars)", () => {
    const short = "What is zero trust networking";
    const queries = generateSearchQueries(short, false, false);
    expect(queries[0]).toBe(short);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// C5 round 3 (#1, RC verifier rc-verify-0951.md): round 1's fix bounded ONLY
// query #1 — sub-queries #2+ still built on the full, UNBOUNDED `topic`
// (`${topic} ${domainSuffixes[n]}`), so a long non-comparison question's
// OTHER sub-queries exceeded the engine's length limit and failed upstream
// live (1/5 then 2/5 succeeded — below the "≥3 ok" bar; the issue map's own
// "long non-comparison + focus case still to verify" note, confirmed not
// fixed by round 1). Fix: EVERY generated query (not just #1) now passes
// through the SAME boundQuery() bound at one place (the final map in
// generateSearchQueries), and a long topic's suffix queries are derived from
// a condensed keyword-based topic rather than the full text + suffix. This
// table covers every combination of question shape × focus × depth the
// review asked for.
// ──────────────────────────────────────────────────────────────────────────

describe("generateSearchQueries — C5 round 3: EVERY generated query is bounded, for every question shape/focus/depth", () => {
  const SHORT_NON_COMPARISON = "What is zero trust networking";
  const LONG_NON_COMPARISON =
    "We are evaluating enterprise data infrastructure vendors for a multi-region deployment and need to understand how modern web scraping and proxy platforms handle residential IP rotation, CAPTCHA solving, JavaScript rendering at scale, compliance with GDPR and CCPA when collecting publicly available data, pricing models for high-volume concurrent requests, SLA guarantees for uptime and latency, and how they compare against building an in-house scraping infrastructure team, across e-commerce, travel, and financial services verticals";
  const SHORT_COMPARISON = "Novada vs Bright Data pricing";
  const LONG_COMPARISON =
    "We need a detailed comparison of Novada versus Bright Data across residential IP rotation, CAPTCHA solving at scale, JavaScript rendering, GDPR and CCPA compliance posture, pricing models for high-volume concurrent requests, SLA guarantees for uptime and latency, and total cost of ownership over a three year horizon for a company processing fifty million page requests per month";

  const QUESTION_SHAPES: { label: string; question: string }[] = [
    { label: "short-non-comparison", question: SHORT_NON_COMPARISON },
    { label: "long-non-comparison", question: LONG_NON_COMPARISON },
    { label: "short-comparison", question: SHORT_COMPARISON },
    { label: "long-comparison", question: LONG_COMPARISON },
  ];
  const FOCUS_VARIANTS: { label: string; focus?: string }[] = [
    { label: "no-focus", focus: undefined },
    { label: "with-focus", focus: "pricing and compliance" },
  ];
  const DEPTH_VARIANTS: { label: string; deep: boolean; comprehensive: boolean }[] = [
    { label: "quick", deep: false, comprehensive: false },
    { label: "deep", deep: true, comprehensive: false },
    { label: "comprehensive", deep: true, comprehensive: true },
  ];

  for (const shape of QUESTION_SHAPES) {
    for (const fv of FOCUS_VARIANTS) {
      for (const dv of DEPTH_VARIANTS) {
        it(`${shape.label} × ${fv.label} × ${dv.label}: every query ≤500 chars, ≥3 distinct queries`, () => {
          const queries = generateSearchQueries(shape.question, dv.deep, dv.comprehensive, fv.focus);
          for (const q of queries) {
            expect(q.length, `query "${q.slice(0, 80)}..." (${q.length} chars) exceeds the 500-char bound`).toBeLessThanOrEqual(500);
          }
          expect(queries.length, `only ${queries.length} distinct queries generated: ${JSON.stringify(queries)}`).toBeGreaterThanOrEqual(3);
        });
      }
    }
  }
});
