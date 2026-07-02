import type { VerifyParams, NovadaSearchResult } from "./types.js";
import { submitSearchScrapeTask, resolveSearchResults } from "./search.js";
import { makeNovadaError, NovadaErrorCode } from "../_core/errors.js";
import { classifyAuthority } from "../utils/authority.js";

// FIX-4: Max claim length — prevents excessively long claims from blowing up search queries
const CLAIM_MAX_LENGTH = 1000;

/**
 * FIX-4: Sanitize a claim before embedding it into search query strings.
 * Strips CRLF, null bytes, and HTML/JS that could cause false 'supported' verdicts
 * via injection into SERP context, and removes leading javascript: scheme.
 */
function sanitizeClaim(claim: string): string {
  return claim
    .replace(/[\r\n\0]+/g, " ")        // collapse CRLF + null-byte to space
    .replace(/javascript:/gi, "")       // strip javascript: scheme
    .replace(/<[^>]*>/g, " ")          // strip HTML tags that embed context
    .replace(/\s{2,}/g, " ")           // collapse runs of whitespace
    .trim();
}

// ─── F7-B: Hedged/association claim detection ─────────────────────────────────

/**
 * Hedging language that signals associative / probabilistic claims rather than
 * direct factual assertions.  When a claim uses these words AND the skeptical
 * search returns zero contradicting sources, we cap confidence and never emit
 * "supported" at high confidence — the search balance alone cannot confirm or
 * deny a probabilistic claim.
 */
const HEDGE_PATTERN = /\b(associated with|linked to|may\b|might\b|could\b|correlated|correlates|possibly|potentially|suggests?|appears? to|seems? to|some evidence|emerging evidence)\b/i;

/** True when the claim contains hedging/association language. */
function isHedgedClaim(claim: string): boolean {
  return HEDGE_PATTERN.test(claim);
}

// ─── F7-C: Redirect-poisoned URL detection ────────────────────────────────────

/**
 * Indicators that a URL is a redirect/authentication intermediary rather than
 * the actual content source.  These appear in:
 *   - signOut/logout flows (signOut in path or query)
 *   - SSO redirect params (redirect=, redirect_uri=)
 *   - Cross-domain source wrappers (source=<other-domain> in query)
 *   - Nested document viewers (file=http... in query)
 */
const REDIRECT_PATH_RE = /\/sign[Oo]ut|\/logout|\/log-out/;
const REDIRECT_QUERY_PARAMS = ["redirect", "redirect_uri", "redirecturi", "returnurl", "return_url", "signout"];
const CROSS_DOMAIN_PARAMS = ["source", "file", "url", "src"];

/**
 * Returns true if the URL contains redirect or cross-domain proxy indicators
 * that suggest it's an authentication/redirect intermediary, not the actual
 * content source.  Preference: reject rather than silently include.
 *
 * Handles four cases:
 *   1. signOut/logout in the outer URL pathname
 *   2. Explicit SSO redirect query params (redirect=, redirect_uri=, etc.)
 *   3. Cross-domain wrapper param values that start with http(s):// (explicit absolute URL)
 *   4. Cross-domain wrapper param values whose DECODED path contains signOut/logout
 *      (e.g. file=/index.php/login/signOut?source=.otherdomain.com)
 */
function isRedirectPoisonedUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    // 1. Check outer path for signOut/logout segments
    if (REDIRECT_PATH_RE.test(parsed.pathname)) return true;
    // Check query parameters
    const params = parsed.searchParams;
    for (const key of params.keys()) {
      const lk = key.toLowerCase();
      // 2. Explicit redirect params
      if (REDIRECT_QUERY_PARAMS.includes(lk)) return true;
      // 3 & 4. Cross-domain wrapper params
      if (CROSS_DOMAIN_PARAMS.includes(lk)) {
        const val = params.get(key) ?? "";
        // 3. Explicit absolute URL in param value
        if (/^https?:\/\//i.test(val)) return true;
        // 4. Decoded path value contains signOut/logout (e.g. file=/…/signOut?…)
        if (REDIRECT_PATH_RE.test(val)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

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
    throw makeNovadaError(
      NovadaErrorCode.INVALID_PARAMS,
      "claim is required and must be a non-empty string",
      "claim: missing or empty"
    );
  }

  // FIX-4: Validate and sanitize claim before embedding in search queries.
  if (params.claim.length > CLAIM_MAX_LENGTH) {
    throw makeNovadaError(
      NovadaErrorCode.INVALID_PARAMS,
      `claim exceeds maximum length of ${CLAIM_MAX_LENGTH} characters (got ${params.claim.length}).`,
      `claim_length:${params.claim.length} max:${CLAIM_MAX_LENGTH}`
    );
  }
  // FIX-4: Reject null bytes and CRLF at input validation level
  if (/[\0\r\n]/.test(params.claim)) {
    throw makeNovadaError(
      NovadaErrorCode.INVALID_PARAMS,
      "claim must not contain null bytes or newline characters.",
      "claim: contains CRLF or null"
    );
  }
  // FIX-4: Reject javascript: scheme in claim
  if (/^javascript:/i.test(params.claim.trim())) {
    throw makeNovadaError(
      NovadaErrorCode.INVALID_PARAMS,
      "claim must not start with the javascript: scheme.",
      "claim: javascript: scheme"
    );
  }

  // FIX-4: Sanitize before embedding in search queries (defense in depth even after above)
  const claim = sanitizeClaim(params.claim);
  // Also sanitize context to prevent injection through that field
  const context = params.context ? sanitizeClaim(params.context) : undefined;
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

      // F7-B: Hedged/association claim confidence cap.
      // When the claim contains hedging language (associated with, may, correlated…)
      // AND the skeptical query returned zero contradicting sources, search balance
      // alone cannot confirm a probabilistic/associative claim at high confidence.
      // Absence of debunking keywords is not the same as scientific consensus.
      if (isHedgedClaim(claim) && contradictCount === 0) {
        const HEDGE_CONFIDENCE_CAP = 70;
        confidence = Math.min(confidence, HEDGE_CONFIDENCE_CAP);
        // "supported" at high confidence is inappropriate: downgrade to contested
        // to honestly represent that keyword absence ≠ scientific agreement.
        if (verdict === "supported") {
          verdict = "contested";
        }
      }
    }
  }

  // F7-D: Classify authority of all evidence sources for the low-authority warning.
  // A "scientific" claim is one that has hedge language (associated with / may / correlated)
  // or explicitly invokes research/study/clinical evidence language.
  const SCIENTIFIC_CLAIM_PATTERN = /\b(study|studies|research|trial|clinical|evidence|risk|association|correlation|data|published|journal|peer[- ]review)\b/i;
  const isScientificClaim = isHedgedClaim(claim) || SCIENTIFIC_CLAIM_PATTERN.test(claim);
  const allEvidenceSources = [...relevantSupportSources, ...relevantContradictSources];
  const hasHighAuthority = allEvidenceSources.some(r =>
    classifyAuthority(r.url || r.link) === "authoritative"
  );
  const hasOnlyLowAuthority =
    allEvidenceSources.length > 0 &&
    allEvidenceSources.every(r => {
      const tier = classifyAuthority(r.url || r.link);
      return tier === "social" || tier === "neutral";
    }) &&
    allEvidenceSources.some(r => classifyAuthority(r.url || r.link) === "social");

  // F7-C: Filter redirect-poisoned URLs from the evidence URL lists.
  // The source objects are used for display (title/snippet) but their URLs must
  // not appear in agent-facing URL hints if they contain redirect indicators.
  function sanitizeEvidenceUrls(sources: NovadaSearchResult[]): string[] {
    return sources
      .map(r => r.url || r.link)
      .filter((u): u is string => Boolean(u))
      .filter(u => !isRedirectPoisonedUrl(u));
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

  // F7-A: Provenance-honest bucket labels.
  // "Supporting" / "Contradicting" imply stance verification which the keyword-
  // retrieval model cannot do.  Replace with provenance-accurate headings that
  // describe how sources were retrieved (query keyword matching), not what they
  // mean (stance agreement/disagreement).  The verdict line still carries the
  // overall verdict; these section headings describe the retrieval provenance.
  lines.push(`## Sources matching the claim wording (${relevantSupportSources.length} sources)`);
  lines.push(``);
  if (relevantSupportSources.length === 0) {
    lines.push(`_No sources matching the claim wording found._`);
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

  // F7-A: Provenance-honest: negation-query results (used to be "Contradicting Evidence").
  lines.push(`## Sources matching a negation of the claim (${relevantContradictSources.length} sources)`);
  lines.push(``);
  if (relevantContradictSources.length === 0) {
    lines.push(`_No sources matching a negation of the claim found._`);
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
  // F7-A: Always emit the keyword-match caveat so agents know bucket membership
  // reflects retrieval provenance, not verified stance.
  lines.push(`- Bucket membership reflects keyword match (query provenance), NOT verified stance. A source in "matching the claim wording" may debunk it; a source in "matching a negation" may discuss the claim approvingly. Treat as retrieval signal, not stance classification.`);
  lines.push(`- Verdict is based on search result balance, not deep reasoning. Treat as a signal, not a definitive answer.`);
  lines.push(`- 'supported' requires multiple independent relevant sources with no refutation; 'insufficient_data' means the claim's terms did not appear in enough sources to judge.`);
  if (verdict === "insufficient_data") {
    lines.push(`- No relevant evidence found in search. Use novada_research for a deeper multi-source investigation, or rephrase the claim with more specific terms.`);
  }
  if (verdict === "contested") {
    lines.push(`- Sources disagree. Use novada_extract on both claim-matching and negation-matching URLs above to read the full arguments.`);
  }
  if (verdict === "unsupported") {
    lines.push(`- Sources actively refute this claim. Use novada_extract on the negation-matching URLs above to confirm.`);
  }
  if (confidence < 40 && verdict !== "insufficient_data") {
    lines.push(`- Low confidence (${confidence}/100). More specific claim wording may improve accuracy.`);
  }
  // F7-D: Low-authority warning for scientific claims where all sources are social/PR.
  if (isScientificClaim && hasOnlyLowAuthority) {
    lines.push(`- Warning: all evidence sources are from social media or press-release domains. For scientific/medical claims, verify against primary literature (PubMed, NIH, peer-reviewed journals) before acting on this verdict.`);
  }

  // Top URLs from claim-matching sources (relevant only) — F7-C: strip redirect-poisoned URLs.
  const supportUrls = sanitizeEvidenceUrls(relevantSupportSources).slice(0, 3);
  lines.push(`- Supporting URLs: ${supportUrls.length > 0 ? supportUrls.join(", ") : "none"}`);

  // INC-196: Use FILTERED contradicting sources (only items with genuine dispute markers),
  // not the raw skepticalResult.results. Also dedup against supporting URLs.
  // F7-C: strip redirect-poisoned URLs.
  const supportUrlSet = new Set(supportUrls);
  const contradictUrls = sanitizeEvidenceUrls(relevantContradictSources)
    .filter(u => !supportUrlSet.has(u))
    .slice(0, 3);
  lines.push(`- Contradicting URLs: ${contradictUrls.length > 0 ? contradictUrls.join(", ") : "none"}`);

  lines.push(``);
  lines.push(`## Agent Action`);
  // F7-A: keyword-match caveat in the agent_instruction field for machine consumers.
  lines.push(`agent_instruction: verdict=${verdict} confidence=${confidence} | bucket_labels=keyword_match_provenance_not_stance | next: novada_research for deeper investigation | next: novada_extract on source URLs for full context${hasOnlyLowAuthority && isScientificClaim ? " | warning: verify_against_primary_literature" : ""}${!hasHighAuthority && isScientificClaim && !hasOnlyLowAuthority ? " | note: no_authoritative_sources_found" : ""}`);
  return lines.join("\n");
}
