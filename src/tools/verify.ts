import axios, { AxiosError } from "axios";
import { USER_AGENT } from "../utils/index.js";
import { SCRAPERAPI_BASE } from "../config.js";
import type { VerifyParams, NovadaApiResponse, NovadaSearchResult } from "./types.js";

const SERP_UNAVAILABLE = `## Verify: Search Unavailable

The Novada SERP endpoint is not yet configured for this API key.

**Alternatives while SERP is unavailable:**
- \`novada_extract\` with a direct URL — e.g. \`https://www.google.com/search?q=your+query\`
- \`novada_research\` — multi-source research without a dedicated search API

Contact support@novada.com to enable SERP access for your account.`;

interface QueryResult {
  results: NovadaSearchResult[];
  failed: boolean;
  unavailable: boolean;
}

async function runSearchQuery(query: string, apiKey: string): Promise<QueryResult> {
  try {
    // SERP endpoint: POST scraperapi.novada.com/search with { serpapi_query: { ... } }
    const response = await axios.post(
      `${SCRAPERAPI_BASE}/search`,
      { serpapi_query: { q: query, api_key: apiKey, engine: "google", num: "5" } },
      {
        headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
        timeout: 30000,
      }
    );
    const data: NovadaApiResponse = response.data;
    // code 402 = no SERP quota; code 400 = key missing
    if (data.code === 402 || data.code === 400) {
      return { results: [], failed: true, unavailable: true };
    }
    const results: NovadaSearchResult[] = data.data?.organic_results || data.organic_results || [];
    return { results, failed: false, unavailable: false };
  } catch (error) {
    if (error instanceof AxiosError && (error.response?.status === 404 || error.response?.status === 402)) {
      return { results: [], failed: true, unavailable: true };
    }
    return { results: [], failed: true, unavailable: false };
  }
}

export async function novadaVerify(params: VerifyParams, apiKey: string): Promise<string> {
  const { claim, context } = params;
  const ctx = context ? ` ${context}` : "";

  // Generate 3 strategically angled queries
  const queries = [
    `"${claim}" evidence study research${ctx}`,                                                       // Supporting (positive-stance terms reduce debunking noise)
    `"${claim}" false wrong incorrect debunked${ctx}`,                                               // Skeptical
    `fact check "${claim.split(" ").slice(0, 10).join(" ")}"${ctx}`,                                // Neutral (10-word limit preserves key claim phrases)
  ];

  // Run all 3 in parallel — partial failures OK
  const settled = await Promise.allSettled(
    queries.map(q => runSearchQuery(q, apiKey))
  );

  const queryResults: QueryResult[] = settled.map(r =>
    r.status === "fulfilled" ? r.value : { results: [], failed: true, unavailable: false }
  );

  const [supportingResult, skepticalResult, neutralResult] = queryResults;

  // If ALL searches hit 404 (SERP unavailable) → return unavailable message
  const allUnavailable = queryResults.every(qr => qr.unavailable);
  if (allUnavailable) {
    return SERP_UNAVAILABLE;
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

  if (supportCount === 0 && contradictCount === 0) {
    verdict = "insufficient_data";
    confidence = 0;
  } else {
    const total = supportCount + contradictCount;
    const score = supportCount / total;

    if (score >= 0.7) {
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
  lines.push(`## Sources Mentioning the Claim (${supportingEvidence.length} found)`);
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
