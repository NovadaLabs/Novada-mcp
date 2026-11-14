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
  /** True when the question is phrased in German — asserts 0 English filler
   *  across every generated query. */
  isGerman?: boolean;
}

const FIXTURES: Fixture[] = [
  {
    label: "DE comma-list, 3 comparands, multi-word entity (owner's reported case)",
    question: "O2, Telekom und Deutsche Telekom Geschäftskunden Internet Vergleich",
    mustAppearSomewhere: ["O2", "Telekom", "Deutsche Telekom"],
    wholeEntities: ["Deutsche Telekom"],
    isGerman: true,
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
    isGerman: true,
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
    isGerman: true,
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
    isGerman: true,
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
    isGerman: true,
  },
  {
    label: "EN comparison-domain question with 'vs' but short (regression: F14-2 zero-hit comparand case)",
    question: "Compare ProxyA vs UnknownBrandXYZ residential proxy performance",
    mustAppearSomewhere: ["ProxyA", "UnknownBrandXYZ"],
  },
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

      if (fx.isGerman) {
        it("no English filler suffix on a German question", () => {
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
