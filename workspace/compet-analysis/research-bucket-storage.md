# Research: Bucket/Storage Configuration for Batch Scraper Automation

**Date:** 2026-06-23
**Ticket:** INC-161
**Researcher:** Claude Agent

---

## Q1: Does Novada's Scraper API have any bucket/storage configuration endpoint?

**NO.** Novada's Scraper API has zero bucket/storage configuration endpoints. The API surface is:

| Endpoint | Purpose |
|----------|---------|
| `POST /request` (scraper.novada.com) | Submit a scrape task |
| `POST /v1/scraper/task_list` | List tasks (paginated) |
| `POST /v1/scraper/task_status` | Check task status by task_ids |
| `POST /v1/scraper/last_task_status` | Last task status for account |
| `POST /v1/scraper/task_download` | Get COS download URL for task results |

There is no endpoint for:
- Configuring a user-owned S3/GCS/Azure bucket
- Setting delivery preferences (webhook, storage, etc.)
- Managing storage credentials or access policies

All results are stored in Novada's own Tencent COS bucket (`novada-scraper-1303252866.cos.na-siliconvalley.myqcloud.com`). Users cannot redirect output.

---

## Q2: Does the task_download endpoint already provide COS URLs?

**YES.** The `task_download` endpoint returns pre-signed Tencent COS URLs. This IS a form of cloud storage delivery, but it is Novada-managed, not user-configurable.

### Evidence from API docs (`14-scraper-api.md`):

```json
{
  "code": 0,
  "data": [
    {
      "download": "https://novada-scraper-1303252866.cos.na-siliconvalley.myqcloud.com/novada/google_shopping/2026/03/26/32ab51b7fb48480f9f4fdb6e0d797956.json",
      "task_id": "32ab51b7fb48480f9f4fdb6e0d797956"
    }
  ]
}
```

### Evidence from our implementation (`scraper_result.ts`, lines 119-143):

Our code already does a 2-step COS download:
1. `POST /v1/scraper/task_download` to get the pre-signed COS URL
2. `GET` the COS URL (no auth needed, pre-signed)

**Key insight:** The infrastructure for cloud-stored results already exists. The gap is that users cannot choose their own bucket.

---

## Q3: Is the "oss" field in task_list a storage URL?

**YES.** The `oss` field in the `task_list` response is the Tencent COS object URL for the task's raw results.

### Evidence from API docs:

```json
{
  "oss": "https://novada-scraper-1303252866.cos.na-siliconvalley.myqcloud.com/novada/youtube/2026/03/27/e1445fdb67454ca69da1164135679db7/e1445fdb67454ca69da1164135679db7"
}
```

URL structure: `https://{bucket}.cos.{region}.myqcloud.com/novada/{platform}/{YYYY}/{MM}/{DD}/{task_id}/{task_id}`

Note: The `oss` field does NOT include a file extension. The `task_download` endpoint adds the extension based on the requested `file_type` param (json/csv/xlsx). The `oss` URL appears to be the raw result object, while `task_download` returns a format-specific pre-signed URL.

---

## Q4: How do competitors handle bucket storage for batch scraping?

### Bright Data (market leader)

**Full user-configurable delivery system:**

- **Supported destinations:** Amazon S3, Google Cloud Storage, Google Cloud Pub/Sub, Microsoft Azure Blob, Snowflake, SFTP, Webhook, API download
- **Configuration:** Dashboard-based setup with credential management (IAM roles for S3, service accounts for GCS)
- **API integration:** Delivery destination is set per-dataset or per-collection, not per-request
- **Streaming:** `&stream_max_lines=10` for incremental delivery to storage/webhook
- **File formats:** JSON, NDJSON, CSV, Parquet
- **Retention:** 30 days for snapshots

**Architecture:** Storage delivery is configured at the collection/dataset level via the dashboard. The API does not take per-request storage params. Users set up the destination once, and all results flow there.

### Oxylabs (strong competitor)

**Per-request cloud storage delivery:**

- **Supported destinations:** Amazon S3, Google Cloud Storage, Alibaba Cloud OSS, any S3-compatible storage
- **Configuration:** Inline in API payload via `storage_type` and `storage_url` parameters
- **API payload example:**
  ```json
  {
    "source": "amazon",
    "url": "https://www.example.com",
    "callback_url": "https://your.callback.url",
    "storage_type": "s3",
    "storage_url": "s3://your.bucket.name"
  }
  ```
- **S3-compatible:** Pass `ACCESS_KEY:SECRET` in the `storage_url` for non-AWS S3-compatible storage
- **Result path:** `YOUR_BUCKET_NAME/job_ID.json`
- **Result Aggregator:** Combines multiple small results into a single file before delivery
- **Integration method:** Push-Pull (async) only; not available in Realtime mode
- **Retention:** 24 hours for results in Oxylabs storage

### Key Competitive Differences

| Feature | Novada | Bright Data | Oxylabs |
|---------|--------|-------------|---------|
| Cloud storage for results | Novada-managed COS only | S3/GCS/Azure/Snowflake/SFTP | S3/GCS/Alibaba OSS/S3-compat |
| User-configurable bucket | No | Yes (dashboard) | Yes (per-request payload) |
| Per-request storage params | No | No (collection-level) | Yes (`storage_type`, `storage_url`) |
| Webhook delivery | No | Yes | Yes (`callback_url`) |
| Output formats | JSON, CSV, XLSX | JSON, NDJSON, CSV, Parquet | JSON |
| Result retention | Unknown (COS URLs work) | 30 days | 24 hours |
| Result aggregation | No | No | Yes |

---

## Q5: What would we need from Novada's backend to support user-defined buckets?

### Option A: Per-request storage params (Oxylabs model)

Backend changes needed:
1. New params on `/request` endpoint: `storage_type` (s3|gcs|cos|s3_compat), `storage_url`, `storage_credentials` (encrypted)
2. Backend writes results to user's bucket instead of (or in addition to) Novada COS
3. IAM/credential validation on submission
4. Error handling for permission failures during delivery

**Pros:** Most flexible, no dashboard needed, works via MCP tool
**Cons:** Credentials in API request body = security risk, complex backend work

### Option B: Dashboard-configured destinations (Bright Data model)

Backend changes needed:
1. New API: `POST /v1/scraper/storage_config` — CRUD for storage destinations (bucket, credentials, format)
2. New field on `/request`: `delivery_id` referencing a pre-configured destination
3. Backend credential storage (encrypted) with validation
4. Async delivery worker that copies COS results to user bucket post-completion

**Pros:** Credentials stored securely server-side, clean API surface
**Cons:** Requires dashboard UI, more complex infrastructure

### Option C: Webhook-based delivery (lightweight)

Backend changes needed:
1. New param on `/request`: `webhook_url`
2. POST results to webhook URL on task completion
3. User runs a receiver that stores to their own bucket

**Pros:** Minimal backend work (just HTTP POST), flexible for users
**Cons:** User must host a webhook endpoint, not true bucket delivery

### Minimum viable feature (recommended):

**Option C (webhook) as v1, then Option B (dashboard config) as v2.** Webhook is the fastest to implement and gives users programmatic control. Dashboard config is the proper enterprise solution.

---

## Q6: Can we implement "save to local folder" batch mode with our existing output pipeline?

**YES.** Our existing `output.ts` already saves results locally.

### What we have now:

- `saveOutput()` in `src/utils/output.ts` saves to `~/Downloads/novada-mcp/YYYY-MM-DD/`
- Supports JSON and CSV formats
- Auto-generates filenames: `{tool}_{hint}_{HHmmss}.{format}`
- Both `novada_scrape` and `novada_scraper_result` already call `saveOutput()` as a best-effort step
- The `cosUrl` field in `OutputOptions` is already defined but unused (placeholder for future COS URL passthrough)

### What we could add for batch automation (MCP-side only, no backend changes):

1. **Configurable output directory** — env var `NOVADA_OUTPUT_DIR` (default: `~/Downloads/novada-mcp/`)
2. **Batch scrape wrapper tool** — `novada_batch_scrape` that takes an array of operations, runs them in parallel, collects all results, and saves to a single directory
3. **COS URL passthrough** — Surface the COS download URLs from `task_download` in the tool output so agents/scripts can download directly
4. **Auto-sync to user bucket** — A post-save hook that uses `aws s3 cp` or equivalent to sync the output directory to a user-configured S3 bucket (env var: `NOVADA_S3_BUCKET`)

### Implementation sketch for batch + local save:

```typescript
// New tool: novada_batch_scrape
// Input: { operations: [{ platform, operation, params }], output_dir?: string }
// Process: submit all tasks in parallel, poll all, save all results to output_dir
// Output: summary with file paths and record counts
```

This is 100% implementable with no backend changes. The `saveOutput()` infrastructure is already there.

---

## Conclusion: Can we implement INC-161?

**PARTIAL.** Specifically:

### What we CAN do now (no backend changes):
- **Local batch save:** Enhance `saveOutput()` with configurable output dir + batch wrapper tool
- **COS URL surfacing:** The `task_download` endpoint already returns COS URLs; we just need to surface them more prominently in tool output
- **S3 sync hook:** Post-save hook that syncs output dir to a user-configured S3 bucket using AWS CLI/SDK

### What we CANNOT do without backend changes:
- **User-configurable delivery buckets** (like Oxylabs/Bright Data) — requires new backend endpoints
- **Webhook delivery** — requires backend to POST results on completion
- **Per-request storage routing** — requires backend param changes on `/request`

### Recommended roadmap:

| Phase | Scope | Backend needed? | Effort |
|-------|-------|-----------------|--------|
| **P1: Local batch** | Configurable output dir, batch scrape tool, COS URL passthrough | No | 2-3 days |
| **P2: S3 sync** | Post-save hook that syncs to user's S3 bucket via AWS SDK | No | 1-2 days |
| **P3: Webhook** | Backend `webhook_url` param on `/request` + POST on completion | Yes (light) | 1-2 weeks |
| **P4: Bucket config** | Dashboard storage config + backend delivery worker | Yes (heavy) | 3-4 weeks |

**P1+P2 are implementable immediately in novada-mcp without any backend dependency.** They cover the most common use case: "scrape N things, save results to a folder / S3 bucket."

P3+P4 require coordination with the backend team and are competitive parity features (Bright Data + Oxylabs both have them).
