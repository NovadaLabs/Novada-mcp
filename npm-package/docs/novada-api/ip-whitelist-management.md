# IP Whitelist Management API

> Source: https://developer-api.novada.com/apis/ip-whitelist-management
> Fetched: 2026-05-08

**Base URL:** `https://developer-api.novada.com`
**Auth:** Bearer token in `Authorization` header (all endpoints)
**Content-Type:** `multipart/form-data` (all endpoints)

## Product Type Codes (for whitelist)

| Code | Product |
|------|---------|
| 1 | Residential |
| 4 | Unlimited |
| 5 | Static ISP |

---

## POST /v1/white_list/add

Add an IP to the whitelist.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `product` | integer | Yes | Product type (1=Residential, 5=Static ISP, 4=Unlimited) |
| `ip` | string | Yes | IP address to whitelist |
| `remark` | string | No | Notes about the entry |

### Response

- `200` — Success
- `404` — Fail

---

## POST /v1/white_list/list

List whitelisted IPs with optional filtering.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `product` | integer | Yes | Product type (1=Residential, 5=Static) |
| `ip` | string | No | Filter by specific IP |
| `start_time` | string | No | Start datetime filter |
| `end_time` | string | No | End datetime filter |
| `lock` | integer | No | 0=Unlocked, 1=Locked |

### Response

- `200` — Success (whitelist entries)
- `404` — Fail

---

## POST /v1/white_list/del

Delete one or more whitelisted IPs.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `product` | string | Yes | Product type |
| `ips` | string | Yes | Comma-separated list of IPs to remove |

### Response

- `200` — Success
- `404` — Fail

---

## POST /v1/white_list/remark

Update the remark on a whitelist entry.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `product` | integer | Yes | Product type |
| `id` | string | Yes | Whitelist entry ID |
| `remark` | string | No | Updated remark text |

### Response

- `200` — Success
- `404` — Fail
