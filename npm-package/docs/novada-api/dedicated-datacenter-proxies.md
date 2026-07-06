# Dedicated Datacenter Proxies API

> Source: https://developer-api.novada.com/apis/dedicated-datacenter-proxies
> Fetched: 2026-05-08

**Base URL:** `https://developer-api.novada.com`
**Auth:** Bearer token in `Authorization` header (all endpoints)
**Content-Type:** `multipart/form-data` (all endpoints)

---

## POST /v1/static/open

Activate new dedicated datacenter IPs.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `region` | string | Yes | Format: `area:num` (area code and count) |
| `duration` | string | Yes | Activation period: `week` or `month` |
| `num` | integer | Yes | Number of IPs to activate |

### Response

- `200` — Success
- `404` — Fail

---

## POST /v1/static/list

List dedicated datacenter IPs with filtering and pagination.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `page` | integer | Yes | Page number |
| `limit` | integer | Yes | Entries per page |
| `status` | integer | No | ""=All, 1=In use, 2=Expired, 3=Released |
| `region` | string | No | Area code filter |
| `key_word` | string | No | Search by remarks, order number, or IP |
| `is_auto_renew` | integer | No | 1=Yes, -1=No |

### Response

- `200` — Success (paginated IP list)
- `404` — Fail

---

## POST /v1/static/export

Export filtered dedicated datacenter IP list.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | integer | No | ""=All, 1=In use, 2=Expired, 3=Released |
| `region` | string | No | Area code filter |
| `key_word` | string | No | Search by remarks, order number, or IP |
| `is_auto_renew` | integer | No | Renewal status filter |

### Response

- `200` — Success (export data)
- `404` — Fail

---

## POST /v1/static/region

List available regions for dedicated datacenter.

### Parameters

None required.

### Response

- `200` — Success (list of regions with codes)
- `404` — Fail

---

## POST /v1/static/renew

Renew existing dedicated datacenter IPs.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `renew_ip_list` | string | Yes | Comma-separated list of IPs to renew |
| `duration` | string | Yes | Renewal period: `week` or `month` |

### Response

- `200` — Success
- `404` — Fail

---

## POST /v1/static/renew_setting

Update auto-renewal settings for dedicated datacenter IPs.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Product type: `static` |
| `ids` | string | Yes | Comma-separated IP IDs |
| `package_type` | string | Yes | Duration: `week` or `month` |
| `status` | integer | Yes | -1=Disabled, 1=Enabled |

### Response

- `200` — Success
- `404` — Fail
