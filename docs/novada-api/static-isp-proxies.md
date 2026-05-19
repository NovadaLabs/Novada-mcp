# Static ISP Proxies API

> Source: https://developer-api.novada.com/apis/static-isp-proxies
> Fetched: 2026-05-08

**Base URL:** `https://developer-api.novada.com`
**Auth:** Bearer token in `Authorization` header (all endpoints)
**Content-Type:** `multipart/form-data` (all endpoints)

## IP Types

| Value | Description |
|-------|-------------|
| `normal` | Standard ISP IP |
| `premium` | Premium ISP IP |

## ISP Types (for region listing)

| Value | Description |
|-------|-------------|
| `isp-resi` | Static Residential |
| `isp-resi-hq` | Premium Residential |

---

## POST /v1/static_house/open

Activate new static ISP IP addresses.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ip_type` | string | Yes | `normal` (Standard) or `premium` (Premium) |
| `region` | string | Yes | Area code |
| `duration` | string | Yes | Activation period: `week` or `month` |
| `num` | integer | Yes | Number of IPs to activate |

### Response

- `200` — Success
- `404` — Fail

---

## POST /v1/static_house/list

List static ISP IPs with filtering and pagination.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `page` | integer | Yes | Page number |
| `limit` | integer | Yes | Entries per page |
| `status` | string | No | ""=All, "1"=In use, "2"=Expired, "3"=Released |
| `region` | string | No | Area code filter |
| `key_word` | string | No | Search by remarks, order number, or IP |
| `is_auto_renew` | integer | No | 1=Yes, -1=No |

### Response

- `200` — Success (paginated IP list)
- `404` — Fail

---

## POST /v1/static_house/export

Export filtered static ISP IP list.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | integer | No | ""=All, 1=In use, 2=Expired, 3=Released |
| `region` | string | No | Area code filter |
| `key_word` | string | No | Search terms |
| `is_auto_renew` | integer | No | Renewal preference filter |

### Response

- `200` — Success (export data)
- `404` — Fail

---

## POST /v1/static_house/region

List available regions for static ISP products.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `isp_type` | string | Yes | `isp-resi` (Standard) or `isp-resi-hq` (Premium) |

### Response

- `200` — Success (list of regions)
- `404` — Fail

---

## POST /v1/static_house/renew

Renew existing static ISP IPs.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `renew_ip_list` | string | Yes | Comma-separated list of IPs |
| `duration` | string | Yes | Renewal period: `week` or `month` |

### Response

- `200` — Success
- `404` — Fail

---

## POST /v1/static_house/renew_setting

Update auto-renewal settings for static ISP IPs.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Product type: `static_house` |
| `ids` | string | Yes | Comma-separated IP IDs |
| `package_type` | string | Yes | Duration: `week` or `month` |
| `status` | integer | Yes | -1=Disabled, 1=Enabled |

### Response

- `200` — Success
- `404` — Fail
