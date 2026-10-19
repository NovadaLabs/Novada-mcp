# Privacy Policy — Novada Dify Plugin

This plugin is a thin client for the Novada hosted MCP API (`https://mcp.novada.com/mcp`).
It makes outbound HTTPS requests to exactly one host: `mcp.novada.com`.

## What data is sent

- The parameters you (or the calling LLM) supply to a tool call — e.g. a search
  `query`, a `url` to extract or crawl, a `platform`/`operation`/`params` triple for
  structured scraping, or a research `question`.
- Your Novada API key, sent as an `Authorization: Bearer` header on every request,
  used solely to authenticate and meter usage against your Novada account.

## What this plugin does NOT do

- It does not persist, log, or transmit your data to any destination other than
  `mcp.novada.com`. It requests no local storage (`storage.enabled: false` in
  `manifest.yaml`) and no Dify app/model/endpoint reverse-invocation permission
  (all set to `enabled: false`).
- It never sends your credentials or tool inputs to any third party other than
  Novada's own backend.

## How Novada's backend handles your request

`mcp.novada.com` forwards each tool call to Novada's own backend services to fulfill
it — `api-m.novada.com` (account/wallet lookups), `scraper.novada.com` (platform
structured-data scraping), and `webunlocker.novada.com` (search/extract/crawl/map).
These are Novada's own backend hosts, not hosts this plugin's code contacts directly;
they are documented here for completeness, not in `manifest.yaml`'s `network.domains`
(which declares only what this plugin's own code reaches).

Novada's telemetry for a tool call records: the tool name, argument key names (not
values, with a small set of allowlisted enum exceptions such as `format`/`engine`),
the target hostname only (never the full path, query string, or any credential), the
call outcome and latency, and an encrypted identity token tied to your account —
stored in Novada's own Supabase-backed telemetry store and internal operations log.
Unhandled server-side errors are reported to Sentry with sensitive fields redacted.

## Novada's own privacy policy

For how Novada (the upstream service) handles data at the account/platform level, see
https://novada.com/privacy.

## Contact

support@novada.com
