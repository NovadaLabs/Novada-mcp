import { submitSearchScrapeTask, resolveSearchResults } from "./search.js";
// ─── Model domains for site-scoped search ────────────────────────────────────
const MODEL_DOMAINS = {
    chatgpt: ["chatgpt.com", "openai.com"],
    perplexity: ["perplexity.ai"],
    grok: ["grok.com", "x.com/i/grok"],
    claude: ["claude.ai", "anthropic.com"],
    gemini: ["gemini.google.com"],
};
const DEFAULT_MODELS = ["chatgpt", "perplexity", "grok"];
// ─── Sentiment heuristic ─────────────────────────────────────────────────────
function classifySentiment(text, brand) {
    const lower = text.toLowerCase();
    const brandLower = brand.toLowerCase();
    const posPatterns = /recommend|excellent|best|leading|powerful|reliable|fast|innovative|top.?rated/i;
    const negPatterns = /avoid|unreliable|expensive|slow|limited|poor|worst|outdated|lacks/i;
    // Count positive/negative signals near brand mentions
    const sentences = text.split(/[.!?\n]/).filter(s => s.toLowerCase().includes(brandLower));
    let posCount = 0;
    let negCount = 0;
    for (const s of sentences) {
        if (posPatterns.test(s))
            posCount++;
        if (negPatterns.test(s))
            negCount++;
    }
    if (posCount > negCount)
        return "positive";
    if (negCount > posCount)
        return "negative";
    return "neutral";
}
function extractClaims(text, brand) {
    const brandLower = brand.toLowerCase();
    const claims = [];
    const sentences = text.split(/[.!?\n]/)
        .map(s => s.trim())
        .filter(s => s.toLowerCase().includes(brandLower) && s.length > 20 && s.length < 300);
    return sentences.slice(0, 5);
}
function extractCompetitorMentions(text, brand) {
    const brandLower = brand.toLowerCase();
    const competitors = new Set();
    // Common web scraping / data competitors
    const knownCompetitors = [
        "firecrawl", "brightdata", "bright data", "tavily", "oxylabs", "scrapy",
        "apify", "scrapingbee", "zenrows", "scrapfly", "browserless",
        "puppeteer", "playwright", "selenium", "crawlee",
    ];
    const lower = text.toLowerCase();
    for (const c of knownCompetitors) {
        if (lower.includes(c) && c !== brandLower) {
            competitors.add(c);
        }
    }
    return Array.from(competitors);
}
// ─── Main function ───────────────────────────────────────────────────────────
export async function novadaAiMonitor(params, apiKey) {
    const brand = params.brand;
    const models = params.models ?? DEFAULT_MODELS;
    const topics = params.topics ?? [];
    // INC-192: Parallelize all model queries instead of sequential.
    // Also add per-query timeout to prevent hosted (Vercel Edge) timeouts.
    const PER_QUERY_TIMEOUT_MS = 25_000; // 25s per query — leaves headroom for Edge 30s limit
    // Build all queries upfront
    const queryTasks = [];
    for (const model of models) {
        const domains = MODEL_DOMAINS[model.toLowerCase()];
        const siteFilter = domains ? domains.map(d => `site:${d}`).join(" OR ") : "";
        // One primary query per model (skip extract for speed on hosted)
        const query = topics.length > 0
            ? `"${brand}" ${topics[0]} ${siteFilter}`.trim()
            : `"${brand}" ${siteFilter}`.trim();
        queryTasks.push({ model, query });
    }
    // Run all queries in parallel with per-query timeout
    async function runSingleQuery(task) {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), PER_QUERY_TIMEOUT_MS));
        try {
            const result = await Promise.race([
                (async () => {
                    const submitted = await submitSearchScrapeTask(apiKey, "google.com", "google_search", task.query, 5, "q");
                    const results = await resolveSearchResults(apiKey, submitted);
                    if (results.length === 0) {
                        return {
                            model: task.model,
                            query_used: task.query,
                            sentiment: "not_found",
                            key_claims: [],
                            competitor_mentions: [],
                            source_url: null,
                            snippet: "No results found for this query.",
                        };
                    }
                    const topUrl = results[0].url || results[0].link;
                    // Skip deep extract on hosted to stay within timeout budget
                    const fullText = results[0].description || results[0].snippet || "";
                    const sentiment = classifySentiment(fullText, brand);
                    const claims = extractClaims(fullText, brand);
                    const competitors = extractCompetitorMentions(fullText, brand);
                    return {
                        model: task.model,
                        query_used: task.query,
                        sentiment,
                        key_claims: claims,
                        competitor_mentions: competitors,
                        source_url: topUrl || null,
                        snippet: (results[0].description || results[0].snippet || "").slice(0, 200),
                    };
                })(),
                timeoutPromise,
            ]);
            return result;
        }
        catch {
            return {
                model: task.model,
                query_used: task.query,
                sentiment: "not_found",
                key_claims: [],
                competitor_mentions: [],
                source_url: null,
                snippet: "Search timed out or failed for this query.",
            };
        }
    }
    const mentions = await Promise.all(queryTasks.map(t => runSingleQuery(t)));
    // Aggregate
    const allCompetitors = [...new Set(mentions.flatMap(m => m.competitor_mentions))];
    const sentimentCounts = { positive: 0, neutral: 0, negative: 0, not_found: 0 };
    for (const m of mentions)
        sentimentCounts[m.sentiment]++;
    const foundMentions = mentions.filter(m => m.sentiment !== "not_found");
    // Format output
    const lines = [
        `## AI Brand Monitor — ${brand}`,
        `models_checked: ${models.join(", ")} | mentions_found: ${foundMentions.length} | sentiment: +${sentimentCounts.positive} neutral:${sentimentCounts.neutral} -${sentimentCounts.negative}`,
        ``,
        `---`,
        ``,
    ];
    if (foundMentions.length === 0) {
        // INC-192: Distinguish "all searches failed/timed out" from "genuinely no mentions"
        const failedCount = mentions.filter(m => m.snippet.includes("timed out") || m.snippet.includes("failed")).length;
        if (failedCount === mentions.length) {
            lines.push(`**All ${failedCount} searches failed or timed out.** This is a service issue, not a genuine "0 mentions" result.`);
            lines.push(``);
            lines.push(`## Agent Hints`);
            lines.push(`- Search API may be unavailable or rate-limited. Call novada_health to check.`);
            lines.push(`- On hosted (Vercel Edge), ai_monitor may exceed execution time. Try fewer models or use local MCP server.`);
        }
        else {
            lines.push(`No AI model references found for "${brand}". The brand may not be indexed by these AI models yet.`);
            lines.push(``);
            lines.push(`## Agent Hints`);
            lines.push(`- Try broader search terms or different models`);
            lines.push(`- Check if the brand has a website indexed by search engines first: novada_search("${brand}")`);
        }
    }
    else {
        for (const m of mentions) {
            lines.push(`### ${m.model} — ${m.sentiment}`);
            lines.push(`query: ${m.query_used}`);
            if (m.source_url)
                lines.push(`source: ${m.source_url}`);
            if (m.snippet)
                lines.push(`snippet: ${m.snippet}`);
            if (m.key_claims.length > 0) {
                lines.push(`claims:`);
                for (const c of m.key_claims)
                    lines.push(`  - ${c}`);
            }
            if (m.competitor_mentions.length > 0) {
                lines.push(`competitors_mentioned: ${m.competitor_mentions.join(", ")}`);
            }
            lines.push(``);
        }
        lines.push(`---`);
        lines.push(`## Summary`);
        lines.push(`overall_sentiment: ${sentimentCounts.positive > sentimentCounts.negative ? "positive" : sentimentCounts.negative > sentimentCounts.positive ? "negative" : "neutral"}`);
        lines.push(`competitor_mentions: ${allCompetitors.length > 0 ? allCompetitors.join(", ") : "none"}`);
        lines.push(``);
        lines.push(`## Agent Hints`);
        lines.push(`- To track changes over time, run novada_ai_monitor periodically and compare results`);
        lines.push(`- For deeper analysis on any source URL, use novada_extract`);
        lines.push(`- To monitor competitor brands, run novada_ai_monitor with their brand name`);
    }
    lines.push(``);
    lines.push(`## Agent Memory`);
    lines.push(`remember: AI monitor for '${brand}' — ${foundMentions.length} mentions across ${models.length} models, overall ${sentimentCounts.positive > sentimentCounts.negative ? "positive" : "neutral"}`);
    lines.push(``);
    lines.push(`## Chainable Output`);
    lines.push(`brand: ${brand}`);
    lines.push(`models_checked: ${models.join(", ")}`);
    if (allCompetitors.length > 0)
        lines.push(`competitors_found: ${allCompetitors.join(", ")}`);
    lines.push(`agent_instruction: AI monitor complete. To deep-dive into any source, call novada_extract with the source URL. To monitor a competitor, call novada_ai_monitor with their brand name.`);
    return lines.join("\n");
}
//# sourceMappingURL=ai_monitor.js.map