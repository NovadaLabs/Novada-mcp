/** Benchmark configuration */
export interface BenchmarkConfig {
  providers: ProviderName[];
  categories: CategoryName[];
  limit: number;
  timeout: number;
  outputDir: string;
}

export type ProviderName = "novada" | "firecrawl" | "tavily";
export type CategoryName = "static" | "js_heavy" | "anti_bot" | "structured";

/** Category display labels */
export const CATEGORY_LABELS: Record<CategoryName, string> = {
  static: "A: Static/Simple Pages",
  js_heavy: "B: JS-Heavy SPAs",
  anti_bot: "C: Anti-Bot Protected",
  structured: "D: Structured Data",
};

/** Single extraction result from a provider */
export interface ExtractionResult {
  provider: ProviderName;
  category: CategoryName;
  url: string;
  success: boolean;
  error?: string;
  latencyMs: number;
  charCount: number;
  /** 0-10 content quality score based on heuristics */
  qualityScore: number;
  /** Raw response stored for debugging */
  rawResponsePath?: string;
  timestamp: string;
}

/** Aggregated stats for a provider+category pair */
export interface AggregatedStats {
  provider: ProviderName;
  category: CategoryName;
  totalUrls: number;
  successCount: number;
  successRate: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  avgCharCount: number;
  avgQualityScore: number;
  costPerRequest: number;
}

/** Full benchmark report */
export interface BenchmarkReport {
  runDate: string;
  config: BenchmarkConfig;
  results: ExtractionResult[];
  aggregated: AggregatedStats[];
  summary: ProviderSummary[];
}

/** Per-provider summary across all categories */
export interface ProviderSummary {
  provider: ProviderName;
  overallSuccessRate: number;
  overallLatencyP50: number;
  overallLatencyP95: number;
  overallAvgQuality: number;
  overallAvgChars: number;
  estimatedCostPer1k: number;
}

/** URL list file format */
export type UrlList = Record<CategoryName, string[]>;
