# API Error Code Compliance Audit
Date: 2026-06-23
Source spec: /tmp/novada-api-pages/18-error-codes.md
Implementation: src/_core/errors.ts, src/utils/http.ts, src/_core/developer_api.ts

---

## 1. Error Codes Defined in the Official API Spec

The spec (18-error-codes.md) defines exactly **4 business error codes**:

| HTTP | code    | Meaning                              |
|------|---------|--------------------------------------|
| 200  | `50001` | API Key does not exist or is invalid |
| 200  | `50002` | API Key is disabled                  |
| 200  | `50003` | API Key has expired                  |
| 200  | `500`   | Server-side error                    |

Key structural facts from the spec:
- **The HTTP response code is always `200`.** Error type is determined by the `code` field in the body, NOT the HTTP status.
- Response envelope: `{ code: <int>, data: {}, msg: <string> }` (no `timestamp` field mentioned in the spec for the error envelope).
- The spec does NOT define a `200` success code — it uses `0` for success (confirmed by developer_api.ts comment: `{"code":0,"data":{...},"msg":"success"}`).

---

## 2. Error Codes We Handle in errors.ts

`errors.ts` defines a `NovadaErrorCode` enum with **12 internal codes**, none of which are the spec's numeric codes (50001/50002/50003/500). These are our own symbolic codes used for agent instructions. The mapping from raw API numeric codes to these internal codes happens in:

- `classifyError()` in errors.ts — maps HTTP status codes and error message strings
- `devApiPost()` in developer_api.ts — maps business codes 11000, 10002
- `submitScrapeTask()` in scrape.ts — maps codes 11006, 11008, 10001, 11000
- `scraper_status.ts` — maps codes 27202, 10002, 10003
- `search.ts` — maps code 27202 (pending)

---

## 3. MISSING: Spec Codes NOT Handled

### CRITICAL — `50001`, `50002`, `50003` are never explicitly matched

The spec defines these three as the primary auth error codes. None appear anywhere in the codebase:

```
grep "50001\|50002\|50003" src/ → 0 results
```

**Current behavior when these arrive:**
- The Scraper API returns HTTP 200 with `{ code: 50001, msg: "..." }` in the body.
- In `submitScrapeTask()` (scrape.ts line 81): `if (body.code !== 0)` triggers, falls through to the generic `errorMessages` dict (only has 10001/11000 keys), then falls to `body.msg ?? "Unknown scraper error"`.
- The error is thrown as a plain `Error` (not a `NovadaError`), then caught by `classifyError()` in errors.ts which checks message strings for "401", "api_key", "unauthorized", "invalid_api_key" — it will NOT match "50001" or "50002" or "50003" unless the `msg` text happens to contain those words.
- **Result**: These errors surface as `UNKNOWN` or `INVALID_PARAMS` instead of `INVALID_API_KEY`. The agent gets the wrong `agent_instruction`.

**Distinction matters:**
- `50001` = key doesn't exist or invalid → INVALID_API_KEY (auth, permanent)
- `50002` = key is disabled → INVALID_API_KEY (auth, permanent) — this is what the task described as "api_key_disabled"
- `50003` = key has expired → INVALID_API_KEY (auth, permanent)
- `500` = server-side error → API_DOWN (transient, retry)

### ALSO MISSING — spec code `500` (server-side error) in body

The spec defines `code: 500` as a server error returned in the **response body** (not as an HTTP status). Our `classifyError()` checks `msg.includes("500")` which may accidentally match URLs containing "500" rather than the numeric code field.

In `devApiPost()` (developer_api.ts line 135): `if (resp.status >= 500)` correctly handles HTTP 500, but this is a different signal — the spec says HTTP is always 200.

---

## 4. Response Envelope Parsing — Are We Correct?

**Spec envelope**: `{ code: int, data: object, msg: string }`

**Our `DeveloperApiEnvelope` type** (developer_api.ts line 30):
```typescript
interface DeveloperApiEnvelope<T = unknown> {
  code?: number;
  msg?: string;
  message?: string;   // <-- extra field not in spec; handles server variance
  data?: T | null;
}
```

**Success condition** (developer_api.ts line 174):
```typescript
if (envelope.code === 0 || envelope.code === undefined) { ... }
```

**ISSUE**: The spec says `0 = success`. But our code treats `code === undefined` as success too. If the API ever returns a body without a `code` field (e.g., a routing error returning plain JSON), we silently treat it as success and return empty data. This is a potential silent failure.

**No `timestamp` field** in our envelope type — the spec example in the task description mentions `timestamp`. The scrape.ts `SubmitApiResponse` does have `timestamp?: number` (line 18), so this is partially handled for the Scraper API but not in the developer-api envelope.

---

## 5. Are We Surfacing `msg` to the Agent?

**developer_api.ts**: YES — line 179:
```typescript
const serverMsg = sanitizeServerMsg(envelope.msg ?? envelope.message ?? `code=${envelope.code}`);
```
The `msg` is sanitized (keys/tokens stripped) and included in the thrown `NovadaError` message. Good.

**scrape.ts** (submitScrapeTask): YES — line 101-102:
```typescript
const msg = errorMessages[body.code] ?? body.msg ?? "Unknown scraper error";
throw new Error(`Scraper error (code ${body.code}): ${sanitizeServerMsg(msg)}`);
```
`body.msg` is included. Good.

**search.ts** (submitSearchScrapeTask, line 174):
```typescript
throw new Error(`Scraper search submit error (code ${body.code}): ${body.msg ?? "unknown"}`);
```
`body.msg` included, but NOT sanitized through `sanitizeServerMsg`. Minor gap — could leak API keys if the server echoes them back in `msg`.

**scraper_status.ts line 254**:
```typescript
const serverMsg = sanitizeServerMsg(body?.msg ?? err.message);
```
Sanitized. Good.

---

## 6. HTTP Status vs Response Body Code — Priority

**The spec is explicit**: HTTP is always 200; error type comes from the body `code` field.

**Our implementation priority**:

In `devApiPost()` (developer_api.ts):
1. HTTP 401/403 → INVALID_API_KEY (checked FIRST, before envelope)
2. HTTP 429 → RATE_LIMITED
3. HTTP >=500 → API_DOWN
4. HTTP 404 → PRODUCT_UNAVAILABLE
5. Then envelope `code` field

**This is WRONG for the Novada Scraper API** (though may be correct for the developer-api which may use standard HTTP semantics). The spec states HTTP is always 200, so checking HTTP status first is correct only if the developer-api behaves differently from the scraper API. Based on developer_api.ts's own comment: `{"code":0,"data":{...},"msg":"success"}` — the developer API also uses body codes, not HTTP codes.

For the Scraper API (`scrape.ts`, `search.ts`), the code correctly checks `body.code !== 0` as the primary signal and doesn't check HTTP status independently — this matches the spec.

In `classifyError()` (errors.ts), fallback text matching checks for "401", "502" etc. in error messages — these will match HTTP codes embedded in error strings thrown by axios, which is acceptable as a catch-all.

**Summary**: Priority is correct for the Scraper API paths. The developer-api path has an inversion (HTTP first) that may not match spec but may reflect actual developer-api behavior.

---

## 7. Handling of 401 (api_key_disabled) and 402 (product_not_subscribed)

**Note**: The spec does NOT define HTTP 401 or 402 as error responses — it says HTTP is always 200. The codes 50001/50002/50003 in the body are the spec's auth/subscription signals.

**401 (what we do)**:
- `classifyError()` line 248: matches `msg.includes("401")` → INVALID_API_KEY
- `devApiPost()` line 123: HTTP 401/403 → INVALID_API_KEY
- `fetchViaProxy()` in http.ts line 194: HTTP 401/403 → throws auth error

There is no explicit handling for "api_key_disabled" as a string. If the server returns `{ code: 50002, msg: "API Key is disabled" }`, the `50002` code is not matched; the msg "API Key is disabled" will not match "api_key", "unauthorized", or "invalid_api_key" in classifyError(), so it falls through to UNKNOWN.

**402 (product_not_subscribed)**:
- `classifyError()` line 268: matches `msg.includes("402")` → PRODUCT_UNAVAILABLE
- There is no explicit handling for "product_not_subscribed" as a string or `50003` (key expired)

---

## Summary of Gaps

| Gap | Severity | Location | Description |
|-----|----------|----------|-------------|
| `50001` not matched | HIGH | scrape.ts, search.ts | Key-invalid code returns as UNKNOWN/generic |
| `50002` not matched | HIGH | scrape.ts, search.ts | Key-disabled code returns as UNKNOWN/generic |
| `50003` not matched | HIGH | scrape.ts, search.ts | Key-expired code returns as UNKNOWN/generic |
| Body `code: 500` not matched | MEDIUM | scrape.ts, search.ts | Server-error body code not mapped to API_DOWN |
| `search.ts` msg not sanitized | LOW | search.ts:174 | `body.msg` passed without sanitizeServerMsg |
| `envelope.code === undefined` treated as success | LOW | developer_api.ts:174 | Silent success on missing code field |
| HTTP-first priority in devApiPost | INFO | developer_api.ts | May conflict with spec (HTTP always 200) but may reflect actual developer-api behavior |

---

## Recommended Fixes

In `submitScrapeTask()` (scrape.ts) and equivalent spots in `search.ts`, `scraper_status.ts`, expand the explicit code map to include the spec-defined codes:

```typescript
// Add to errorMessages in submitScrapeTask and equivalent:
50001: "API Key does not exist or is invalid",  // → INVALID_API_KEY
50002: "API Key is disabled",                    // → INVALID_API_KEY
50003: "API Key has expired",                    // → INVALID_API_KEY
500:   "Server-side error",                      // → API_DOWN
```

And throw typed `NovadaError` (via `makeNovadaError`) rather than plain `Error` so `classifyError()` is bypassed and the correct `agent_instruction` is delivered directly.
