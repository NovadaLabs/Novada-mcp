/**
 * Client-specific tool surfaces for the hosted endpoint (2026-11-05).
 *
 * One URL (https://mcp.novada.com/mcp) serves every client. A client that
 * connected through OAuth is mapped to a SURFACE by the redirect URIs it
 * registered at POST /register. The mapping is resolved per request from the
 * access token's client_id (see _oauth.ts resolveClientSurface), not frozen
 * into the token, so a client that is already connected moves to its surface
 * as soon as the server ships — no reconnect needed. API-key callers and OAuth
 * clients that match no rule keep the default hosted surface, unchanged.
 *
 * Today there is one non-default surface, "openai" — the OpenAI plugin review
 * (ChatGPT apps). It lists a narrower set of tools (see OPENAI_SURFACE_TOOLS),
 * marks the platform scrapers as not read-only (they queue upstream scrape
 * jobs), drops cross-references to tools it does not list (the sibling-span
 * mechanism in npm-package's _core/description_surface.ts, rendered against
 * this surface's own tool set), and leaves out the onboarding notice that
 * advertises free credits.
 *
 * Side-effect-free by design (no KV, no env, no vendor import) so tests import
 * it directly, same convention as _oauth.ts.
 */

export type HostedSurface = "default" | "openai";

/**
 * One row per non-default surface: the redirect-URI domains that select it.
 * A URI matches when it is https and its host IS a listed domain or a
 * subdomain of one — never a substring (evilchatgpt.com and
 * chatgpt.com.example.net do not match). First matching row wins.
 */
export const SURFACE_REDIRECT_DOMAIN_RULES: ReadonlyArray<{
  surface: Exclude<HostedSurface, "default">;
  domains: readonly string[];
}> = [
  { surface: "openai", domains: ["chatgpt.com", "openai.com"] },
];

function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Map a registered client's redirect URIs to its surface ("default" when no rule matches). */
export function classifyRedirectUris(redirectUris: readonly string[]): HostedSurface {
  for (const rule of SURFACE_REDIRECT_DOMAIN_RULES) {
    for (const uri of redirectUris) {
      let parsed: URL;
      try {
        parsed = new URL(uri);
      } catch {
        continue;
      }
      if (parsed.protocol !== "https:") continue;
      const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
      if (rule.domains.some((d) => hostMatchesDomain(host, d))) return rule.surface;
    }
  }
  return "default";
}

/** The 15 tools the OpenAI surface lists (plugin review scope, 2026-11-04 spec §2;
 *  novada_proxy and novada_scrape_perplexity dropped 2026-11-12 after the
 *  OpenAI review held both for further review — proxy configuration is of no
 *  use inside ChatGPT, and scraping another AI product's answers is the
 *  policy-sensitive kind of tool the review exists to catch).
 *  Everything else — the generic novada_scrape executor and its catalog
 *  (novada_discover), stateful/one-off tools (novada_monitor, novada_setup,
 *  novada_map), account writes (novada_proxy_account_create,
 *  novada_static_ip_mgmt), and the social-platform scrapers — is neither listed
 *  nor callable there. */
export const OPENAI_SURFACE_TOOLS: ReadonlySet<string> = new Set([
  "novada_search",
  "novada_extract",
  "novada_crawl",
  "novada_research",
  "novada_scrape_google",
  "novada_scrape_bing",
  "novada_scrape_duckduckgo",
  "novada_scrape_yandex",
  "novada_scrape_amazon",
  "novada_scrape_walmart",
  "novada_scrape_youtube",
  "novada_scrape_github",
  "novada_ai_monitor",
  "novada_account",
  "novada_proxy_account_list",
]);

export type ToolAnnotations = Record<string, boolean>;

export interface AnnotationRule {
  /** Which tools the rule applies to. */
  appliesTo: (toolName: string) => boolean;
  /** Annotation values that replace the tool's own. */
  set: ToolAnnotations;
  /** Why — kept next to the rule so the override is never unexplained. */
  reason: string;
}

export interface SurfacePolicy {
  /** Tools listed and callable; null = the default hosted set (core catalog minus HOSTED_HIDDEN). */
  tools: ReadonlySet<string> | null;
  annotationRules: readonly AnnotationRule[];
  /** Whether npm's backward-compat hidden aliases (novada_health, novada_unblock, …) stay callable by name. */
  routeHiddenAliases: boolean;
  /** Whether the one-time onboarding notice (it advertises free credits) may be appended to results. */
  firstRunNotice: boolean;
  /** Whether prompts/resources are advertised alongside tools. */
  promptsAndResources: boolean;
  /** Whether error guidance may point the user at the local npm server (`npx novada-mcp`) — i.e. at another client. */
  mentionLocalServer: boolean;
  /** MCP `instructions` returned from initialize, if any. */
  instructions?: string;
  /** Text returned when a client calls a tool this surface does not list; undefined = mcp.ts's default text. */
  notOnSurfaceMessage?: (toolName: string) => string;
}

const OPENAI_INSTRUCTIONS = [
  "Novada retrieves public web data. Choose a tool by task:",
  "- Find pages or URLs for a query: novada_search.",
  "- Read a page whose URL you already have: novada_extract.",
  "- Read several related pages under one site or section: novada_crawl.",
  "- Gather passages from several sources for one question in a single call: novada_research.",
  "- Structured data from one platform: novada_scrape_google, novada_scrape_bing, novada_scrape_duckduckgo, novada_scrape_yandex, novada_scrape_amazon, novada_scrape_walmart, novada_scrape_youtube, novada_scrape_github. Some of these run as background jobs; when a result says the job is still processing, call the same tool again with the task_id it returned.",
  "- Brand mentions and sentiment on AI-company websites (their indexed public pages): novada_ai_monitor.",
  "- Account balance and plans: novada_account. Proxy sub-accounts: novada_proxy_account_list.",
].join("\n");

export const SURFACE_POLICIES: Readonly<Record<HostedSurface, SurfacePolicy>> = {
  default: {
    tools: null,
    annotationRules: [],
    routeHiddenAliases: true,
    firstRunNotice: true,
    promptsAndResources: true,
    mentionLocalServer: true,
  },
  openai: {
    tools: OPENAI_SURFACE_TOOLS,
    annotationRules: [
      {
        appliesTo: (name) => name.startsWith("novada_scrape_"),
        set: { readOnlyHint: false, destructiveHint: false },
        reason: "each call submits a scrape job to the upstream Scraper API (OpenAI plugin rules: starting or queuing jobs is not read-only); nothing on the caller's side is modified or deleted",
      },
    ],
    routeHiddenAliases: false,
    firstRunNotice: false,
    promptsAndResources: false,
    mentionLocalServer: false,
    instructions: OPENAI_INSTRUCTIONS,
    notOnSurfaceMessage: (toolName) =>
      `Error [TOOL_NOT_ENABLED]: '${toolName}' is not available in this app.\nagent_instruction: Use one of the tools returned by tools/list.`,
  },
};

/** The tool's annotations with every matching rule applied (later rules win). Never mutates the input. */
export function applyAnnotationRules(
  toolName: string,
  annotations: ToolAnnotations,
  rules: readonly AnnotationRule[],
): ToolAnnotations {
  let out = { ...annotations };
  for (const rule of rules) {
    if (rule.appliesTo(toolName)) out = { ...out, ...rule.set };
  }
  return out;
}

// ─── Per-request client → surface resolution ─────────────────────────────────

// Client records are immutable after POST /register (there is no update
// endpoint and client_ids are random UUIDs, never reused), so a client's
// surface can never change — cache it per process. Bounded; only a successful
// lookup is cached. A missing/expired client or a KV error resolves to
// "default" for that one request (today's behavior for every client) and is
// retried on the next.
const CLIENT_SURFACE_CACHE_MAX = 1000;
const clientSurfaceCache = new Map<string, HostedSurface>();

/**
 * Resolve an OAuth client's surface. `lookupRedirectUris` reads the client's
 * registered redirect URIs (null when the client is unknown/expired) and may
 * throw on a storage error. Never throws.
 */
export async function resolveClientSurface(
  clientId: string,
  lookupRedirectUris: (clientId: string) => Promise<readonly string[] | null>,
): Promise<HostedSurface> {
  const cached = clientSurfaceCache.get(clientId);
  if (cached !== undefined) return cached;

  let redirectUris: readonly string[] | null;
  try {
    redirectUris = await lookupRedirectUris(clientId);
  } catch (err) {
    console.error(JSON.stringify({
      evt: "client_surface_lookup_failed",
      msg: "client record lookup failed — serving the default surface for this request",
      error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    }));
    return "default";
  }
  if (!redirectUris) return "default";

  const surface = classifyRedirectUris(redirectUris);
  if (clientSurfaceCache.size >= CLIENT_SURFACE_CACHE_MAX) {
    const oldest = clientSurfaceCache.keys().next().value;
    if (oldest !== undefined) clientSurfaceCache.delete(oldest);
  }
  clientSurfaceCache.set(clientId, surface);
  return surface;
}

/** Test-only: forget every cached client → surface mapping. */
export function resetClientSurfaceCacheForTests(): void {
  clientSurfaceCache.clear();
}
