import { novadaExtract } from "./extract.js";
import { submitSearchScrapeTask, pollSearchResult, parseScraperSearchResults } from "./search.js";
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
    const mentions = [];
    // Build search queries per model
    for (const model of models) {
        const domains = MODEL_DOMAINS[model.toLowerCase()];
        const siteFilter = domains ? domains.map(d => `site:${d}`).join(" OR ") : "";
        const queries = [
            `"${brand}" ${siteFilter}`.trim(),
            ...(topics.length > 0
                ? topics.map(t => `"${brand}" ${t} ${siteFilter}`.trim())
                : [`"${brand}" review comparison ${siteFilter}`.trim()]),
        ];
        for (const query of queries) {
            try {
                const taskId = await submitSearchScrapeTask(apiKey, "google.com", "google_search", query, 5, "q");
                const data = await pollSearchResult(apiKey, taskId);
                const results = parseScraperSearchResults(data);
                if (results.length === 0) {
                    mentions.push({
                        model,
                        query_used: query,
                        sentiment: "not_found",
                        key_claims: [],
                        competitor_mentions: [],
                        source_url: null,
                        snippet: "No results found for this query.",
                    });
                    continue;
                }
                // Extract top result for deeper analysis
                const topUrl = results[0].url || results[0].link;
                let fullText = results[0].description || results[0].snippet || "";
                if (topUrl) {
                    try {
                        const extracted = await novadaExtract({ url: topUrl, format: "markdown", render: "auto", max_chars: 10000 }, apiKey);
                        fullText = extracted;
                    }
                    catch { /* keep snippet */ }
                }
                const sentiment = classifySentiment(fullText, brand);
                const claims = extractClaims(fullText, brand);
                const competitors = extractCompetitorMentions(fullText, brand);
                mentions.push({
                    model,
                    query_used: query,
                    sentiment,
                    key_claims: claims,
                    competitor_mentions: competitors,
                    source_url: topUrl || null,
                    snippet: (results[0].description || results[0].snippet || "").slice(0, 200),
                });
            }
            catch {
                mentions.push({
                    model,
                    query_used: query,
                    sentiment: "not_found",
                    key_claims: [],
                    competitor_mentions: [],
                    source_url: null,
                    snippet: "Search failed for this query.",
                });
            }
        }
    }
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
        lines.push(`No AI model references found for "${brand}". The brand may not be indexed by these AI models yet.`);
        lines.push(``);
        lines.push(`## Agent Hints`);
        lines.push(`- Try broader search terms or different models`);
        lines.push(`- Check if the brand has a website indexed by search engines first: novada_search("${brand}")`);
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