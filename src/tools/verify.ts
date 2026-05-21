import type { VerifyParams, NovadaSearchResult } from "./types.js";
import { submitSearchScrapeTask, pollSearchResult, parseScraperSearchResults } from "./search.js";

interface QueryResult {
  results: NovadaSearchResult[];
  failed: boolean;
}

async function runSearchQuery(query: string, apiKey: string): Promise<QueryResult> {
  try {
    const taskId = await submitSearchScrapeTask(apiKey, "google.com", "google_search", query, 5, "q");
    const data = await pollSearchResult(apiKey, taskId);
    const results = parseScraperSearchResults(data);
    return { results, failed: false };
  } catch {
    return { results: [], failed: true };
  }
}

export async function novadaVerify(params: VerifyParams, apiKey: string): Promise<string> {
  const { claim, context } = params;
  const ctx = context ? ` ${context}` : "";

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

  // Collect evidence
  const supportingEvidence = supportingResult.results.filter(r => r.description || r.snippet);
  const contradictingEvidence = skepticalResult.results.filter(r => r.description || r.snippet);

  const supportCount = supportingEvidence.length;
  const contradictCount = contradictingEvidence.length;

  // Determine verdict
  let verdict: "supported" | "unsupported" | "contested" | "insufficient_data";
  let confidence: number;

  // Partial failure: one of the key queries failed — confidence is unreliable
  const dataIncomplete = supportingResult.failed || skepticalResult.failed;

  // Neutral (fact-check) results count toward support — fact-check pages that
  // co-occur with a true claim generally confirm it, not refute it.
  const neutralCount = neutralResult.results.filter(r => r.description || r.snippet).length;
  const adjustedSupport = supportCount + neutralCount;

  if (adjustedSupport === 0 && contradictCount === 0) {
    verdict = "insufficient_data";
    confidence = 0;
  } else {
    const total = adjustedSupport + contradictCount;
    const score = adjustedSupport / total;

    if (score >= 0.6) {
      verdict = "supported";
    } else if (score <= 0.3) {
      verdict = "unsupported";
    } else {
      verdict = "contested";
    }

    // Cap confidence at 60 when a key query failed — data is one-sided
    const rawConfidence = Math.round(Math.abs(score - 0.5) * 200);
    confidence = dataIncomplete ? Math.min(rawConfidence, 60) : rawConfidence;
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

  // Sources Mentioning the Claim section
  lines.push(`## Supporting Evidence (${supportingEvidence.length} sources)`);
  lines.push(``);
  if (supportingEvidence.length === 0) {
    lines.push(`_No supporting sources found._`);
  } else {
    for (let i = 0; i < supportingEvidence.length; i++) {
      const r = supportingEvidence[i];
      const title = r.title || "Untitled";
      const snippet = r.description || r.snippet || "";
      lines.push(`${i + 1}. **${title}**`);
      lines.push(`   ${snippet}`);
      lines.push(``);
    }
  }
  lines.push(``);

  // Contradicting Evidence section
  lines.push(`## Contradicting Evidence (${contradictingEvidence.length} sources)`);
  lines.push(``);
  if (contradictingEvidence.length === 0) {
    lines.push(`_No contradicting sources found._`);
  } else {
    for (let i = 0; i < contradictingEvidence.length; i++) {
      const r = contradictingEvidence[i];
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
  lines.push(`- For "contested": use novada_extract on the most relevant source URLs above for full context.`);
  if (verdict === "insufficient_data") {
    lines.push(`- No strong signal from search. Use novada_research for a deeper multi-source investigation.`);
  }
  if (verdict === "contested") {
    lines.push(`- Sources disagree. Use novada_extract on both supporting and contradicting URLs above to read the full arguments.`);
  }
  if (confidence < 40) {
    lines.push(`- Low confidence (${confidence}/100). More specific claim wording may improve accuracy.`);
  }

  // Top URLs from query 1 (supporting)
  const supportUrls = supportingResult.results
    .map(r => r.url || r.link)
    .filter(Boolean)
    .slice(0, 3) as string[];
  lines.push(`- Supporting URLs: ${supportUrls.length > 0 ? supportUrls.join(", ") : "none"}`);

  // Top URLs from query 2 (contradicting)
  const contradictUrls = skepticalResult.results
    .map(r => r.url || r.link)
    .filter(Boolean)
    .slice(0, 3) as string[];
  lines.push(`- Contradicting URLs: ${contradictUrls.length > 0 ? contradictUrls.join(", ") : "none"}`);

  // Neutral sources hint if any
  const neutralUrls = neutralResult.results
    .map(r => r.url || r.link)
    .filter(Boolean)
    .slice(0, 2) as string[];
  if (neutralUrls.length > 0) {
    lines.push(`- Fact-check sources: ${neutralUrls.join(", ")}`);
  }

  return lines.join("\n");
}
