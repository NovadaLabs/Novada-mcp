/**
 * Core shared types for novada-mcp.
 *
 * Rules:
 * - No imports from tools/, utils/, or other _core/ files.
 * - No imports from zod (types only — no schema construction here).
 * - This file MUST stay import-free (plain TypeScript types and interfaces).
 *
 * Zod schemas for these types live in _core/validation.ts.
 */

// ─── API Response Types ───────────────────────────────────────────────────────

export interface NovadaSearchResult {
  title?: string;
  url?: string;
  /** Alias field returned by some endpoints. */
  link?: string;
  description?: string;
  /** Alias field returned by some endpoints. */
  snippet?: string;
  published?: string;
  /** Alias field returned by some endpoints. */
  date?: string;
}

/** Generic envelope returned by most Novada API endpoints. */
export interface NovadaApiResponse {
  /** 0 = success; non-zero = error (see Novada error code reference). */
  code?: number;
  msg?: string;
  data?: {
    organic_results?: NovadaSearchResult[];
    [key: string]: unknown;
  };
  /** Some endpoints return organic_results at top level. */
  organic_results?: NovadaSearchResult[];
}

// ─── Tool Response Envelope ───────────────────────────────────────────────────

/**
 * Standardised response returned by all tool functions.
 * Tools return strings for MCP compatibility; this type describes the
 * semantic shape before stringification (used in _base.ts).
 */
export interface ToolResponse {
  /** Rendered markdown string to return to the MCP client. */
  content: string;
  /** True when this is a partial result (e.g. truncated content). */
  truncated?: boolean;
  /** True when the tool succeeded but with degraded data (e.g. JS not rendered). */
  degraded?: boolean;
}

// ─── Proxy Types ─────────────────────────────────────────────────────────────

export type ProxyType = "residential" | "mobile" | "isp" | "datacenter";
export type ProxyOutputFormat = "url" | "env" | "curl";

export interface ProxyConfig {
  type: ProxyType;
  country?: string;
  city?: string;
  sessionId?: string;
  format: ProxyOutputFormat;
}

// ─── Browser Types ────────────────────────────────────────────────────────────

export type BrowserActionType =
  | "navigate"
  | "click"
  | "type"
  | "screenshot"
  | "snapshot"
  | "aria_snapshot"
  | "evaluate"
  | "wait"
  | "scroll"
  | "hover"
  | "press_key"
  | "select"
  | "close_session"
  | "list_sessions";

/** Discriminated union base — concrete action shapes live in validation.ts. */
export interface BrowserActionBase {
  action: BrowserActionType;
}

export interface BrowserSessionInfo {
  sessionId: string;
  url: string;
  createdAt: number;
  lastUsedAt: number;
}

// ─── Scraper Types ────────────────────────────────────────────────────────────

export type ScraperOutputFormat = "markdown" | "json" | "toon" | "csv" | "html" | "xlsx";

export interface ScraperTask {
  taskId: string;
  status: "pending" | "processing" | "completed" | "failed";
  platform: string;
  operation: string;
  createdAt?: string;
  completedAt?: string;
}

// ─── Research Types ───────────────────────────────────────────────────────────

export type ResearchDepth = "quick" | "deep" | "auto" | "comprehensive";

export interface ResearchSource {
  url: string;
  title?: string;
  snippet?: string;
  relevanceScore?: number;
}

// ─── Health / Probe Types ─────────────────────────────────────────────────────

export type ProbeStatus = "active" | "not_activated" | "not_configured" | "error";

export interface ProbeResult {
  status: ProbeStatus;
  label: string;
  latency: number | null;
  note?: string;
  /** Link to activate or configure this product. */
  activationUrl?: string;
}

// ─── Render Mode ─────────────────────────────────────────────────────────────

export type RenderMode = "auto" | "static" | "render" | "browser";

// ─── Verify Types ────────────────────────────────────────────────────────────

export type VerifyVerdict = "supported" | "unsupported" | "contested" | "insufficient_data";

export interface VerifyResult {
  verdict: VerifyVerdict;
  confidence: number;
  summary: string;
  sources: ResearchSource[];
}
