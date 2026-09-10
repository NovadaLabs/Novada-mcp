/**
 * Request-scoped credentials store using Node.js AsyncLocalStorage.
 *
 * Solves the SDK multi-client issue: instead of mutating process.env (global state),
 * the SDK wraps each call in withCredentials(). Tool utilities read from this store
 * first, falling back to process.env for MCP server use (single-tenant).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
const store = new AsyncLocalStorage();
/**
 * Run a function with specific credentials in scope.
 * Used by NovadaClient SDK to isolate credentials per-request.
 */
export function withCredentials(creds, fn) {
    return store.run(creds, fn);
}
/** Active web unblocker key: SDK-scoped webUnblockerKey > SDK-scoped apiKey > NOVADA_WEB_UNBLOCKER_KEY > NOVADA_API_KEY (unified). */
export function getWebUnblockerKey() {
    const ctx = store.getStore();
    return ctx?.webUnblockerKey ?? ctx?.apiKey ?? process.env.NOVADA_WEB_UNBLOCKER_KEY ?? process.env.NOVADA_API_KEY;
}
/**
 * Active browser WebSocket endpoint: SDK-scoped > NOVADA_BROWSER_WS env var.
 *
 * TENANT SAFETY: this reader is synchronous and has no apiKey to match against,
 * so it MUST NOT consult the per-key auto-fetch cache (_browserWsCache). On the
 * multi-tenant hosted server, returning any cached wsUrl here would serve one
 * caller's browser credentials to another. The cache is only read inside
 * fetchBrowserSubAccountCredentials(apiKey) / resolveBrowserWs(apiKey), where the
 * requesting key is known and the entry is matched by its fingerprint.
 * The store path is request-scoped and the env path is single-tenant config —
 * both are safe.
 */
export function getBrowserWs() {
    return store.getStore()?.browserWs ?? process.env.NOVADA_BROWSER_WS;
}
/** Active proxy credentials: SDK-scoped > NOVADA_PROXY_* env vars. */
export function getProxyCredentials() {
    const scoped = store.getStore();
    const user = scoped?.proxyUser ?? process.env.NOVADA_PROXY_USER;
    const pass = scoped?.proxyPass ?? process.env.NOVADA_PROXY_PASS;
    const endpoint = scoped?.proxyEndpoint ?? process.env.NOVADA_PROXY_ENDPOINT;
    if (user && pass && endpoint)
        return { user, pass, endpoint };
    return null;
}
/**
 * Residential proxy credentials — separate from datacenter proxy.
 * Reads NOVADA_RESIDENTIAL_PROXY_USER / PASS / ENDPOINT env vars.
 * Falls back to standard proxy credentials if residential vars are not set.
 */
export function getResidentialProxyCredentials() {
    const user = process.env.NOVADA_RESIDENTIAL_PROXY_USER;
    const pass = process.env.NOVADA_RESIDENTIAL_PROXY_PASS;
    const endpoint = process.env.NOVADA_RESIDENTIAL_PROXY_ENDPOINT;
    if (user && pass && endpoint)
        return { user, pass, endpoint };
    // Fall back to standard proxy credentials
    return getProxyCredentials();
}
// ─── Auto-fetch proxy credentials via management API ─────────────────────────
const MGMT_API_BASE = "https://api-m.novada.com/v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
/**
 * Fingerprint an apiKey for use as a cache map key. SHA-256, first 16 hex chars.
 *
 * TENANT SAFETY: the auto-fetch caches are process-global and shared across every
 * caller on the hosted (multi-tenant) server. Keying each entry by this fingerprint
 * — and returning a cached value ONLY when the requesting key's fingerprint matches —
 * prevents caller A's fetched proxy/browser credentials from being served to caller B
 * within the 6h TTL. The raw key is never stored (only its hash), so the map key is
 * safe to log; the credential VALUES it maps to are still secrets and must not be logged.
 */
function keyFingerprint(apiKey) {
    return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}
/** Per-key proxy sub-account cache, keyed by keyFingerprint(apiKey). */
const _credCache = new Map();
/**
 * Fetch the first active proxy sub-account using the caller's apiKey as a Bearer token.
 * Calls POST /v1/proxy_account/list directly — no OAuth2 exchange required.
 * Result is cached 6h in memory, keyed by the fingerprint of the fetching apiKey so
 * one caller's credentials are never returned to another (see keyFingerprint).
 */
export async function fetchProxySubAccountCredentials(apiKey) {
    const fp = keyFingerprint(apiKey);
    const cached = _credCache.get(fp);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return { account: cached.account, password: cached.password };
    }
    try {
        const form = new URLSearchParams();
        form.append("product", "1"); // residential
        form.append("page", "1");
        form.append("limit", "5");
        form.append("status", "1"); // active only
        const res = await fetch(`${MGMT_API_BASE}/proxy_account/list`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: form.toString(),
        });
        if (!res.ok)
            return null;
        const data = (await res.json());
        const accounts = data?.data?.list ?? [];
        if (accounts.length === 0)
            return null;
        const first = accounts[0];
        _credCache.set(fp, { account: first.account, password: first.password, fetchedAt: Date.now() });
        return { account: first.account, password: first.password };
    }
    catch {
        return null;
    }
}
/** Per-key Browser API WSS cache, keyed by keyFingerprint(apiKey). */
const _browserWsCache = new Map();
const BROWSER_WS_HOST = "upg-scbr2.novada.com"; // confirmed from credentials file
/**
 * Fetch Browser API WSS endpoint using the caller's apiKey as a Bearer token.
 * Calls POST /v1/proxy_account/list with product=10 (Browser API).
 * Returns wss://{account}:{password}@upg-scbr2.novada.com
 * Cached 6h in memory, keyed by the fingerprint of the fetching apiKey so one
 * caller's browser WSS endpoint is never returned to another (see keyFingerprint).
 */
export async function fetchBrowserSubAccountCredentials(apiKey) {
    const fp = keyFingerprint(apiKey);
    const cached = _browserWsCache.get(fp);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.wsUrl;
    }
    try {
        const form = new URLSearchParams();
        form.append("product", "10"); // Browser API product code
        form.append("page", "1");
        form.append("limit", "5");
        form.append("status", "1");
        const res = await fetch(`${MGMT_API_BASE}/proxy_account/list`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: form.toString(),
        });
        if (!res.ok)
            return null;
        const data = (await res.json());
        const accounts = data?.data?.list ?? [];
        if (accounts.length === 0)
            return null;
        const { account, password } = accounts[0];
        // The Browser API sub-account MUST carry the `-zone-browser` zone suffix in the
        // WSS username, exactly like proxy sub-accounts carry `-zone-res`/`-zone-isp`.
        // Without it the WS handshake completes HTTP 101 then closes with code 1006
        // (routing mismatch), which playwright-core misreports as "AuthorizationError:
        // Account or Password verification failed" — the red herring that made hosted
        // browser look impossible. Verified live: suffix present → CDP connects in ~6s.
        const wsUrl = `wss://${account}-zone-browser:${password}@${BROWSER_WS_HOST}`;
        _browserWsCache.set(fp, { wsUrl, fetchedAt: Date.now() });
        return wsUrl;
    }
    catch {
        return null;
    }
}
/**
 * Resolve Browser API WebSocket URL with priority:
 * 1. SDK-scoped browserWs
 * 2. NOVADA_BROWSER_WS env var
 * 3. Auto-fetch via NOVADA_API_KEY (product=10)
 */
export async function resolveBrowserWs(apiKey) {
    const direct = getBrowserWs();
    if (direct)
        return direct;
    const key = apiKey ?? process.env.NOVADA_API_KEY;
    if (!key)
        return null;
    return fetchBrowserSubAccountCredentials(key);
}
/** Universal proxy gateway host — works for every account (zone suffix on the
 * username selects the product/geo). Used when no per-account NOVADA_PROXY_ENDPOINT
 * is configured, e.g. on the hosted server. Verified live: routes residential IPs. */
const UNIVERSAL_PROXY_ENDPOINT = "proxy.novada.pro:7777";
let _bootProvisionedProxyCreds = null;
/** Test-only: reset the boot-provision provenance marker. */
export function clearBootProvisionedProxyCredentials() {
    _bootProvisionedProxyCreds = null;
}
/**
 * Boot-time proxy auto-provision (INC-198) — called ONCE from index.ts run():
 * when NOVADA_PROXY_ENDPOINT is set but NOVADA_PROXY_USER/PASS are missing,
 * resolve (auto-fetch) a sub-account and inject it into process.env, recording
 * provenance so the F11 ledger gate keeps applying to the injected pair
 * (MEDIUM-6, see the section comment above). Returns the provisioned account
 * (for redacted logging) or null when nothing was provisioned. Never throws —
 * a failed auto-provision must not stop the server booting; proxy tools
 * surface a configuration error when invoked.
 */
export async function autoProvisionProxyCredentialsAtBoot() {
    if (!process.env.NOVADA_PROXY_ENDPOINT ||
        (process.env.NOVADA_PROXY_USER && process.env.NOVADA_PROXY_PASS)) {
        return null;
    }
    try {
        const autoCreds = await resolveProxyCredentials();
        if (!autoCreds)
            return null;
        process.env.NOVADA_PROXY_USER = autoCreds.user;
        process.env.NOVADA_PROXY_PASS = autoCreds.pass;
        if (autoCreds.source === "auto_fetched" && autoCreds.billingApiKey) {
            _bootProvisionedProxyCreds = {
                user: autoCreds.user,
                pass: autoCreds.pass,
                fetchingKeyFingerprint: keyFingerprint(autoCreds.billingApiKey),
            };
        }
        return { user: autoCreds.user };
    }
    catch {
        // Non-fatal: proxy tools will show a configuration error when invoked.
        return null;
    }
}
/**
 * Resolve proxy credentials with priority:
 * 1. Explicit env vars (NOVADA_PROXY_USER + NOVADA_PROXY_PASS + NOVADA_PROXY_ENDPOINT) — no API call.
 * 2. Auto-fetch sub-account via apiKey when NOVADA_PROXY_ENDPOINT is set (custom endpoint).
 * 3. Auto-fetch sub-account via apiKey with NO endpoint configured → use the universal
 *    gateway proxy.novada.pro:7777. This is the hosted-server path: the caller supplies
 *    only an API key, we derive a working {user,pass,endpoint} entirely from it.
 *
 * `source` tells the caller HOW the credentials were obtained — "direct"
 * (env vars / SDK-scoped store, bypassing the mgmt API: the account ledger for
 * them is unknowable from here) vs "auto_fetched" (derived from the API key —
 * at call time below, or at boot via autoProvisionProxyCredentialsAtBoot(),
 * whose env-injected pair is re-identified by the provenance marker; MEDIUM-6).
 * F11's disclosure requirements hinge on this distinction.
 *
 * `billingApiKey` (auto_fetched only) is the EXACT key the fetched sub-account
 * bills to — the effective-key chain below (arg > store > env). HIGH-1: the F11
 * flow-ledger preflight must read THIS key's ledger; reading the server env
 * key's ledger for caller-billed creds refused healthy paying callers when the
 * server was exhausted (the 2026-07-30 wrong-ledger-denial P0 class,
 * cross-account) and issued dead creds when the caller was exhausted. The key
 * is for in-process threading only — never print or log it.
 *
 * @param apiKey - Caller's API key. Takes priority over the store-scoped key and NOVADA_API_KEY,
 *   so hosted-server requests are billed to the caller, not the server account.
 */
export async function resolveProxyCredentials(apiKey) {
    // Prefer the explicit arg, then the request-scoped store key (hosted pass-through),
    // then the server-level env var. Without the store fallback, hosted proxy calls would
    // bill the server account instead of the caller.
    const effectiveApiKey = apiKey ?? store.getStore()?.apiKey ?? process.env.NOVADA_API_KEY;
    const direct = getProxyCredentials();
    if (direct) {
        // MEDIUM-6: PROVENANCE, not credential shape, decides the class. If this
        // pair is EXACTLY the one autoProvisionProxyCredentialsAtBoot() injected
        // into env, it was auto-fetched with the boot key and bills that key's
        // account — classify it auto_fetched so the F11 fail-closed ledger gate
        // applies (and the "billing account unknowable" disclosure, false for
        // this class, never renders). The fingerprint check pins billingApiKey to
        // the key that actually fetched the pair: after a key rotation the
        // billing account genuinely cannot be read any more, so the pair falls
        // back to the "direct" fail-open + disclose arm below — exactly where
        // genuinely user-supplied env/SDK creds always stay.
        const boot = _bootProvisionedProxyCreds;
        if (boot &&
            direct.user === boot.user &&
            direct.pass === boot.pass &&
            effectiveApiKey &&
            keyFingerprint(effectiveApiKey) === boot.fetchingKeyFingerprint) {
            return { ...direct, source: "auto_fetched", billingApiKey: effectiveApiKey };
        }
        return { ...direct, source: "direct" };
    }
    const endpoint = process.env.NOVADA_PROXY_ENDPOINT ?? (effectiveApiKey ? UNIVERSAL_PROXY_ENDPOINT : undefined);
    if (!endpoint)
        return null;
    // No user/pass configured — auto-fetch a sub-account with the effective key.
    if (!effectiveApiKey)
        return null;
    const fetched = await fetchProxySubAccountCredentials(effectiveApiKey);
    if (!fetched)
        return null;
    return {
        user: fetched.account,
        pass: fetched.password,
        endpoint,
        source: "auto_fetched",
        billingApiKey: effectiveApiKey,
    };
}
/**
 * Redact a secret string to a last-4 fingerprint for safe logging.
 * Example: "abc123xyz" → "****xyz"
 * Never logs the full value.
 */
export function redactSecret(value) {
    if (!value)
        return "(not set)";
    if (value.length <= 4)
        return "****";
    return `****${value.slice(-4)}`;
}
//# sourceMappingURL=credentials.js.map