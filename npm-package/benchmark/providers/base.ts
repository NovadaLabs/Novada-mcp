import type { ProviderName, ExtractionResult, CategoryName } from "../types.js";

/** Abstract provider that benchmark runner calls */
export interface BenchmarkProvider {
  name: ProviderName;
  /** Check if this provider is configured (has API keys, etc.) */
  isAvailable(): boolean;
  /** Extract content from a URL. Returns success/failure + metrics. */
  extract(url: string, category: CategoryName, timeout: number): Promise<ExtractionResult>;
}

/** Score content quality on a 0-10 scale based on heuristics */
export function scoreContentQuality(content: string, url: string): number {
  if (!content || content.length === 0) return 0;

  let score = 0;

  // Length scoring (0-3 points)
  const len = content.length;
  if (len > 5000) score += 3;
  else if (len > 2000) score += 2;
  else if (len > 500) score += 1;

  // Structure detection (0-3 points) — headings, lists, paragraphs
  const hasHeadings = /^#{1,6}\s/m.test(content) || /<h[1-6]/i.test(content);
  const hasLists = /^[-*]\s/m.test(content) || /<[ou]l/i.test(content);
  const hasParagraphs = content.split(/\n\n/).length > 2;
  if (hasHeadings) score += 1;
  if (hasLists) score += 1;
  if (hasParagraphs) score += 1;

  // Signal-to-noise (0-2 points) — low boilerplate indicators
  const lines = content.split("\n").filter(l => l.trim().length > 0);
  const longLines = lines.filter(l => l.trim().length > 40);
  const ratio = lines.length > 0 ? longLines.length / lines.length : 0;
  if (ratio > 0.3) score += 1;
  if (ratio > 0.5) score += 1;

  // No garbage detection (0-2 points)
  const hasNoEncodingGarbage = !/\\u[0-9a-f]{4}/i.test(content.slice(0, 500));
  const hasNoCaptcha = !/captcha|challenge|verify.*human|access.*denied/i.test(content.slice(0, 1000));
  if (hasNoEncodingGarbage) score += 1;
  if (hasNoCaptcha) score += 1;

  return Math.min(score, 10);
}

/** Helper to measure latency of an async operation */
export async function withLatency<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
  const start = performance.now();
  const result = await fn();
  const latencyMs = Math.round(performance.now() - start);
  return { result, latencyMs };
}
