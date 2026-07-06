import type {
  ExtractionResult,
  AggregatedStats,
  ProviderSummary,
  ProviderName,
  CategoryName,
} from "./types.js";

/** Known cost per request (USD) — approximate from public pricing pages */
const COST_PER_REQUEST: Record<ProviderName, number> = {
  novada: 0.001,    // ~$1/1000 requests (Novada pricing)
  firecrawl: 0.004, // ~$4/1000 credits, 1 credit per scrape (Starter plan)
  tavily: 0.005,    // ~$5/1000 API calls (Researcher plan)
};

/** Compute percentile from sorted array using linear interpolation */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const fraction = rank - lower;
  return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
}

/** Aggregate results for a specific provider+category combination */
export function aggregateResults(
  results: ExtractionResult[],
  provider: ProviderName,
  category: CategoryName
): AggregatedStats {
  const filtered = results.filter(
    (r) => r.provider === provider && r.category === category
  );

  const successful = filtered.filter((r) => r.success);
  const latencies = successful.map((r) => r.latencyMs).sort((a, b) => a - b);

  return {
    provider,
    category,
    totalUrls: filtered.length,
    successCount: successful.length,
    successRate: filtered.length > 0 ? successful.length / filtered.length : 0,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    latencyP99: percentile(latencies, 99),
    avgCharCount:
      successful.length > 0
        ? Math.round(
            successful.reduce((sum, r) => sum + r.charCount, 0) /
              successful.length
          )
        : 0,
    avgQualityScore:
      successful.length > 0
        ? parseFloat(
            (
              successful.reduce((sum, r) => sum + r.qualityScore, 0) /
              successful.length
            ).toFixed(1)
          )
        : 0,
    costPerRequest: COST_PER_REQUEST[provider],
  };
}

/** Build per-provider summary across all categories */
export function summarizeProvider(
  results: ExtractionResult[],
  provider: ProviderName
): ProviderSummary {
  const filtered = results.filter((r) => r.provider === provider);
  const successful = filtered.filter((r) => r.success);
  const latencies = successful.map((r) => r.latencyMs).sort((a, b) => a - b);

  return {
    provider,
    overallSuccessRate:
      filtered.length > 0 ? successful.length / filtered.length : 0,
    overallLatencyP50: percentile(latencies, 50),
    overallLatencyP95: percentile(latencies, 95),
    overallAvgQuality:
      successful.length > 0
        ? parseFloat(
            (
              successful.reduce((sum, r) => sum + r.qualityScore, 0) /
              successful.length
            ).toFixed(1)
          )
        : 0,
    overallAvgChars:
      successful.length > 0
        ? Math.round(
            successful.reduce((sum, r) => sum + r.charCount, 0) /
              successful.length
          )
        : 0,
    estimatedCostPer1k: COST_PER_REQUEST[provider] * 1000,
  };
}
