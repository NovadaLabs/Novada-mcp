import { z } from "zod";

// ─── NOV-323: novada_search_feedback ─────────────────────────────────────────
// Lets an agent record search-result quality — which result URLs were useful and
// an overall rating — so future ranking can learn from it. The feedback is kept
// in a module-scoped in-memory store (nothing persisted, nothing leaves the
// process), and the tool returns a thank-you/echo response carrying an
// agent_instruction. MCP-safe; resets on server restart.

// ─── Zod Schema ───────────────────────────────────────────────────────────────

export const SearchFeedbackParamsSchema = z.object({
  search_id: z
    .string()
    .min(1, "search_id is required")
    .max(128)
    // Constrain shape: this value is used as a Map key and echoed back. Keep it
    // to a safe, opaque-id character set (no whitespace / control chars).
    .regex(
      /^[a-zA-Z0-9_\-:.]+$/,
      "search_id must be alphanumeric with underscores, hyphens, dots, or colons only"
    )
    .describe(
      "The id of the search this feedback is about. Use the search_id returned by a prior novada_search call (or any stable identifier you used for the query)."
    ),
  query: z
    .string()
    .min(1, "query is required")
    .max(2000)
    .describe("The query text that produced the results being rated."),
  useful_urls: z
    .array(z.string().url("each useful_urls entry must be a valid URL").max(2048))
    .max(50)
    .optional()
    .default([])
    .describe(
      "URLs from the result set that were actually useful. Drives future ranking — list the results you clicked or cited. Max 50."
    ),
  rating: z
    .enum(["good", "ok", "bad"])
    .describe(
      "Overall quality of the result set. 'good': relevant + sufficient. 'ok': partially useful. 'bad': irrelevant or missing what you needed."
    ),
  note: z
    .string()
    .max(2000)
    .optional()
    .describe("Optional free-text note — what was missing, what would have ranked better, etc."),
  format: z
    .enum(["markdown", "json"])
    .default("markdown")
    .describe(
      "Output format. 'markdown' (default): human-readable confirmation. 'json': structured object for programmatic agent use."
    ),
});

export type SearchFeedbackParams = z.infer<typeof SearchFeedbackParamsSchema>;

export function validateSearchFeedbackParams(
  args: Record<string, unknown> | undefined
): SearchFeedbackParams {
  return SearchFeedbackParamsSchema.parse(args ?? {});
}

// ─── In-memory feedback store ─────────────────────────────────────────────────

/** One recorded feedback entry. */
export interface FeedbackEntry {
  search_id: string;
  query: string;
  useful_urls: string[];
  rating: "good" | "ok" | "bad";
  note?: string;
  /** ISO timestamp the feedback was recorded. */
  at: string;
}

/**
 * search_id → ordered feedback entries. A given search can be rated more than
 * once (e.g. an agent revises its assessment); we keep each submission rather
 * than overwriting, so the ranking signal isn't silently lost.
 */
const feedbackStore = new Map<string, FeedbackEntry[]>();

let totalFeedback = 0;

/**
 * Record one feedback entry into the in-memory store. Returns the stored entry
 * plus how many total submissions now exist for that search_id.
 */
function storeFeedback(params: SearchFeedbackParams): {
  entry: FeedbackEntry;
  submissions_for_search: number;
} {
  const entry: FeedbackEntry = {
    search_id: params.search_id,
    query: params.query,
    useful_urls: params.useful_urls,
    rating: params.rating,
    note: params.note,
    at: new Date().toISOString(),
  };
  const existing = feedbackStore.get(params.search_id) ?? [];
  existing.push(entry);
  feedbackStore.set(params.search_id, existing);
  totalFeedback += 1;
  return { entry, submissions_for_search: existing.length };
}

/**
 * Read back all feedback recorded for a given search_id. Exposed for in-process
 * consumers (e.g. a future ranking pass) and tests.
 */
export function getFeedbackForSearch(searchId: string): readonly FeedbackEntry[] {
  return feedbackStore.get(searchId) ?? [];
}

/** Total feedback submissions recorded this session (across all searches). */
export function getTotalFeedbackCount(): number {
  return totalFeedback;
}

/** Test-only: clear the store. Not wired to any tool. */
export function resetSearchFeedback(): void {
  feedbackStore.clear();
  totalFeedback = 0;
}

// ─── Tool Implementation ──────────────────────────────────────────────────────

/**
 * Record search-result quality feedback into the in-memory store and return a
 * thank-you / echo confirmation with an agent_instruction. In-memory only;
 * resets on server restart.
 */
export async function novadaSearchFeedback(
  params: SearchFeedbackParams
): Promise<string> {
  const { entry, submissions_for_search } = storeFeedback(params);

  const agentInstruction =
    "Feedback recorded in-memory for this session — it will bias future ranking. No need to re-submit the same search_id unless your assessment changes.";

  if (params.format === "json") {
    return JSON.stringify(
      {
        status: "recorded",
        thank_you: "Thanks — your search feedback was recorded.",
        search_id: entry.search_id,
        query: entry.query,
        rating: entry.rating,
        useful_urls: entry.useful_urls,
        useful_url_count: entry.useful_urls.length,
        note: entry.note ?? null,
        recorded_at: entry.at,
        submissions_for_search,
        total_feedback_this_session: totalFeedback,
        agent_instruction: agentInstruction,
      },
      null,
      2
    );
  }

  const lines: string[] = [
    "## Novada MCP — Search Feedback Recorded",
    "",
    "> Thanks — your feedback was stored in-memory for this session and will bias future ranking.",
    "",
    `search_id: ${entry.search_id}`,
    `query: ${entry.query}`,
    `rating: ${entry.rating}`,
    `useful_urls: ${entry.useful_urls.length}`,
  ];
  if (entry.useful_urls.length > 0) {
    for (const url of entry.useful_urls) {
      lines.push(`  - ${url}`);
    }
  }
  if (entry.note) {
    lines.push(`note: ${entry.note}`);
  }
  lines.push(`recorded_at: ${entry.at}`);
  lines.push(`submissions_for_this_search: ${submissions_for_search}`);
  lines.push(`total_feedback_this_session: ${totalFeedback}`);
  lines.push("");
  lines.push(`agent_instruction: ${agentInstruction}`);

  return lines.join("\n");
}
