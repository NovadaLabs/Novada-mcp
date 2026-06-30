import type { VerifyParams, NovadaSearchResult } from "./types.js";
import { submitSearchScrapeTask, resolveSearchResults } from "./search.js";

interface QueryResult {
  results: NovadaSearchResult[];
  failed: boolean;
}

async function runSearchQuery(query: string, apiKey: string): Promise<QueryResult> {
  try {
    const submitted = await submitSearchScrapeTask(apiKey, "google.com", "google_search", query, 5, "q");
    const results = await resolveSearchResults(apiKey, submitted);
    return { results, failed: false };
  } catch {
    return { results: [], failed: true };
  }
}

// ─── Relevance gating ─────────────────────────────────────────────────────────

/** Tokens too generic to prove a source is actually ABOUT the claim. */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "been",
  "being", "of", "to", "in", "on", "at", "by", "for", "with", "from", "that",
  "this", "these", "those", "it", "its", "as", "than", "then", "into", "about",
  "over", "under", "most", "some", "any", "all", "more", "less", "very", "not",
  "no", "do", "does", "did", "has", "have", "had", "will", "would", "can", "could",
  "should", "may", "might", "must", "between", "during", "their", "there", "they",
]);

/**
 * Extract the load-bearing terms from a claim — words ≥4 chars that aren't
 * stopwords (plus any 4+ digit number, e.g. years). These are what a source
 * must actually mention before we count it as evidence for/against the claim.
 * If this is empty, the claim is unverifiable noise (no checkable nouns).
 */
function extractKeyTerms(claim: string): string[] {
  const tokens = claim.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const terms = new Set<string>();
  for (const t of tokens) {
    if (/^\d{4,}$/.test(t)) { terms.add(t); continue; }   // years / long numbers are signal
    if (t.length < 4) continue;                            // drop short filler
    if (STOP_WORDS.has(t)) continue;
    terms.add(t);
  }
  return [...terms];
}

/** A source is RELEVANT only if its title/snippet actually mentions a key term. */
function isRelevant(r: NovadaSearchResult, keyTerms: string[]): boolean {
  if (keyTerms.length === 0) return false;
  const hay = `${r.title || ""} ${r.description || r.snippet || ""}`.toLowerCase();
  return keyTerms.some(term => hay.includes(term));
}

export async function novadaVerify(params: VerifyParams, apiKey: string): Promise<string> {
  if (!params.claim || typeof params.claim !== 'string' || params.claim.trim().length === 0) {
    return JSON.stringify({ verdict: 'error', message: 'claim is required and must be a non-empty string' });
  }

  const { claim, context } = params;
  const ctx = context ? ` ${context}` : "";
  const keyTerms = extractKeyTerms(claim);

  // Generate 3 strategically angled queries
  const queries = [
    `"${claim}" evidence study research${ctx}`,                                                       // Supporting (positive-stance terms reduce debunking noise)
    `"${claim}" debunked refuted disproved misinformation myth${ctx}`,                              // Skeptical (avoids "false/wrong" which match logic-exercise pages)
    `fact check "${claim.split(" ").slice(0, 10).join(" ")}"${ctx}`,                                // Neutral (10-word limit preserves key claim phrases)
  ];

  // Run all 3 in parallel — partial failures OK
  const settled = await Promise.allSettled(
    queries.map(q => runSearchQuery(q, apiKey))
  );

  const queryResults: QueryResult[] = settled.map(r =>
    r.status === "fulfilled" ? r.value : { results: [], failed: true }
  );

  const [supportingResult, skepticalResult, neutralResult] = queryResults;

  // All 3 queries failed — search is unavailable, not a genuine verdict
  if (queryResults.every(r => r.failed && r.results.length === 0)) {
    return [
      `## Verify Unavailable`,
      ``,
      `Search returned 0 results for all 3 queries. Scraper API (search) is not activated on this account.`,
      ``,
      `**Verdict cannot be determined** — this is a service activation issue, not genuine ambiguity about the claim.`,
      ``,
      `**Fix:** Activate Scraper API at https://dashboard.novada.com/overview/scraper/`,
      ``,
      `## Agent Instruction`,
      `agent_status: search_unavailable | action: activate_scraper_api | do_not_interpret_as: genuine_insufficient_data`,
    ].join("\n");
  }

  // Dispute markers: snippets must contain genuine disagreement language to count as contradicting.
  // This filters out academic papers that cite the claim as a TRUE example (e.g. in hallucination studies)
  // but are returned by the skeptical query due to keyword co-occurrence.
  const DISPUTE_MARKERS = /\b(false|incorrect|myth|debunked|refuted|disproved|disproven|misinformation|misleading|fabricated|fake|hoax|no evidence|not true|never happened|claim is wrong|contrary to|denied|denies|denying|untrue|baseless|unfounded)\b/i;

  // FIX #3(a): a source only counts as evidence if it is actually RELEVANT to the
  // claim — its text must mention one of the claim's key terms. Without this gate,
  // verify returned 'supported' for false/gibberish claims purely from keyword
  // co-occurrence in unrelated SERP snippets.
  const supportingEvidence = supportingResult.results
    .filter(r => (r.description || r.snippet || r.title))
    .filter(r => isRelevant(r, keyTerms));

  const neutralEvidence = neutralResult.results
    .filter(r => (r.description || r.snippet || r.title))
    .filter(r => isRelevant(r, keyTerms));

  const allContradicting = skepticalResult.results
    .filter(r => (r.description || r.snippet || r.title))
    .filter(r => isRelevant(r, keyTerms));
  // FIX #3(b): refutation signals → contradicting evidence.
  const contradictingEvidence = allContradicting.filter(r =>
    DISPUTE_MARKERS.test(`${r.title || ""} ${r.description || r.snippet || ""}`)
  );

  // Neutral (fact-check) results count toward support — fact-check pages that
  // co-occur with a true claim generally confirm it, not refute it — UNLESS the
  // fact-check page itself carries a refutation marker, in which case it counts
  // against the claim.
  const neutralRefuting = neutralEvidence.filter(r =>
    DISPUTE_MARKERS.test(`${r.title || ""} ${r.description || r.snippet || ""}`)
  );
  const neutralSupporting = neutralEvidence.filter(r => !neutralRefuting.includes(r));

  // De-dup by URL so the same page returned by two queries isn't double-counted
  // as two "independent" sources (matters for the ≥2-source rule below).
  const supportUrlKeys = new Set<string>();
  const relevantSupportSources = [...supportingEvidence, ...neutralSupporting].filter(r => {
    const key = (r.url || r.link || r.title || "").trim().toLowerCase();
    if (!key) return true;
    if (supportUrlKeys.has(key)) return false;
    supportUrlKeys.add(key);
    return true;
  });

  const contradictUrlKeys = new Set<string>();
  const relevantContradictSources = [...contradictingEvidence, ...neutralRefuting].filter(r => {
    const key = (r.url || r.link || r.title || "").trim().toLowerCase();
    if (!key) return true;
    if (contradictUrlKeys.has(key)) return false;
    contradictUrlKeys.add(key);
    return true;
  });

  const supportCount = relevantSupportSources.length;
  const contradictCount = relevantContradictSources.length;

  // Partial failure: one of the key queries failed — confidence is unreliable
  const dataIncomplete = supportingResult.failed || skepticalResult.failed;

  // Determine verdict
  let verdict: "supported" | "unsupported" | "contested" | "insufficient_data";
  let confidence: number;

  // FIX #3(d): gibberish / uncheckable claim — no key terms at all → cannot verify.
  // FIX #3(a): no source actually mentions the claim's terms → insufficient_data,
  // NOT 'supported'. This is the core bug: keyword overlap alone can never yield
  // 'supported' anymore.
  if (keyTerms.length === 0 || (supportCount === 0 && contradictCount === 0)) {
    verdict = "insufficient_data";
    confidence = 0;
  } else {
    const total = supportCount + contradictCount;
    const score = supportCount / total;

    if (score <= 0.3) {
      // Clearly more refutation than support.
      verdict = "unsupported";
    } else if (score >= 0.6 && supportCount >= 2 && contradictCount === 0) {
      // FIX #3(c): 'supported' requires MULTIPLE independent relevant sources AND
      // no refutation. A single relevant hit, or any refutation present, is not
      // enough to assert the claim is true.
      verdict = "supported";
    } else if (contradictCount > 0) {
      // Support and refutation coexist → genuinely disputed.
      verdict = "contested";
    } else {
      // Some support but below the bar for 'supported' (e.g. only one relevant
      // source). Honest answer: not enough to confirm.
      verdict = "insufficient_data";
    }

    if (verdict === "insufficient_data") {
      confidence = 0;
    } else {
      // FIX #3(c): confidence is derived from evidence balance but is NEVER 100
      // from overlap alone — hard-capped at 85, and lower when data is one-sided
      // due to a failed query.
      const CONFIDENCE_CEILING = 85;
      const rawConfidence = Math.round(Math.abs(score - 0.5) * 200 * 0.85);
      confidence = Math.min(rawConfidence, CONFIDENCE_CEILING);
      if (dataIncomplete) confidence = Math.min(confidence, 60);
      // Floor: a clear verdict shouldn't read as near-zero confidence.
      if ((verdict === "supported" || verdict === "unsupported") && confidence < 40) {
        confidence = 40;
      }
    }
  }

  // Build output
  const lines: string[] = [
    `## Claim Verification`,
    ``,
    `claim: "${claim}"`,
    `verdict: ${verdict}`,
    `confidence: ${confidence}  (0 = completely uncertain, 100 = all evidence agrees)${dataIncomplete ? " — note: one search query failed, data may be one-sided" : ""}`,
    ``,
    `---`,
    ``,
  ];

  // Supporting evidence section (relevant sources only)
  lines.push(`## Supporting Evidence (${relevantSupportSources.length} sources)`);
  lines.push(``);
  if (relevantSupportSources.length === 0) {
    lines.push(`_No relevant supporting sources found._`);
  } else {
    for (let i = 0; i < relevantSupportSources.length; i++) {
      const r = relevantSupportSources[i];
      const title = r.title || "Untitled";
      const snippet = r.description || r.snippet || "";
      lines.push(`${i + 1}. **${title}**`);
      lines.push(`   ${snippet}`);
      lines.push(``);
    }
  }
  lines.push(``);

  // Contradicting Evidence section (relevant + refuting sources only)
  lines.push(`## Contradicting Evidence (${relevantContradictSources.length} sources)`);
  lines.push(``);
  if (relevantContradictSources.length === 0) {
    lines.push(`_No contradicting sources found._`);
  } else {
    for (let i = 0; i < relevantContradictSources.length; i++) {
      const r = relevantContradictSources[i];
      const title = r.title || "Untitled";
      const snippet = r.description || r.snippet || "";
      lines.push(`${i + 1}. **${title}**`);
      lines.push(`   ${snippet}`);
      lines.push(``);
    }
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(`## Agent Hints`);
  lines.push(`- Verdict is based on search result balance, not deep reasoning. Treat as a signal, not a definitive answer.`);
  lines.push(`- 'supported' requires multiple independent relevant sources with no refutation; 'insufficient_data' means the claim's terms did not appear in enough sources to judge.`);
  if (verdict === "insufficient_data") {
    lines.push(`- No relevant evidence found in search. Use novada_research for a deeper multi-source investigation, or rephrase the claim with more specific terms.`);
  }
  if (verdict === "contested") {
    lines.push(`- Sources disagree. Use novada_extract on both supporting and contradicting URLs above to read the full arguments.`);
  }
  if (verdict === "unsupported") {
    lines.push(`- Sources actively refute this claim. Use novada_extract on the contradicting URLs above to confirm.`);
  }
  if (confidence < 40 && verdict !== "insufficient_data") {
    lines.push(`- Low confidence (${confidence}/100). More specific claim wording may improve accuracy.`);
  }

  // Top URLs from supporting sources (relevant only)
  const supportUrls = relevantSupportSources
    .map(r => r.url || r.link)
    .filter((u): u is string => Boolean(u))
    .slice(0, 3);
  lines.push(`- Supporting URLs: ${supportUrls.length > 0 ? supportUrls.join(", ") : "none"}`);

  // INC-196: Use FILTERED contradicting sources (only items with genuine dispute markers),
  // not the raw skepticalResult.results. Also dedup against supporting URLs.
  const supportUrlSet = new Set(supportUrls);
  const contradictUrls = relevantContradictSources
    .map(r => r.url || r.link)
    .filter((u): u is string => Boolean(u))
    .filter(u => !supportUrlSet.has(u))
    .slice(0, 3);
  lines.push(`- Contradicting URLs: ${contradictUrls.length > 0 ? contradictUrls.join(", ") : "none"}`);

  lines.push(``);
  lines.push(`## Agent Action`);
  lines.push(`agent_instruction: verdict=${verdict} confidence=${confidence} | next: novada_research for deeper investigation | next: novada_extract on source URLs for full context`);
  return lines.join("\n");
}
