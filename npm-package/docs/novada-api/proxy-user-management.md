# Proxy User Management API

> Source: https://developer-api.novada.com/apis/proxy-user-management
> Fetched: 2026-05-08

**Base URL:** `https://developer-api.novada.com`
**Auth:** Bearer token in `Authorization` header (all endpoints)
**Content-Type:** `multipart/form-data` (all endpoints)

## Product Type Codes

| Code | Product |
|------|---------|
| 1 | Residential |
| 2 | Rotating ISP |
| 3 | Rotating Datacenter |
| 4 | Unlimited |
| 7 | Unblocker |
| 9 | Mobile |

## Status Codes

| Code | Meaning |
|------|---------|
| 1 | Normal (active) |
| -3 | Personal disabled |

---

## POST /v1/proxy_account/create

Create a new proxy user account.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `product` | string | Yes | Product type code (see table above) |
| `account` | string | Yes | Account name |
| `password` | string | Yes | Account password |
| `status` | integer | Yes | 1=normal, -3=disabled |
| `remark` | string | No | Notes |
| `limit_flow` | string | No | Data cap in GB |

### Response

- `200` — Success
- `404` — Fail

---

## POST /v1/proxy_account/list

List proxy users with filtering and pagination.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `product` | integer | Yes | Product type code |
| `page` | integer | Yes | Page number |
| `limit` | integer | Yes | Entries per page |
| `status` | integer | No | 1=normal, -3=disabled |
| `account` | string | No | Filter by account name |

### Response

- `200` — Success (paginated list)
- `404` — Fail

---

## POST /v1/proxy_account/update

Update an existing proxy user account.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | integer | Yes | Account ID |
| `account` | string | Yes | Account name |
| `password` | string | Yes | Account password |
| `status` | integer | No | 1=normal, -3=disabled |
| `remark` | string | No | Notes |
| `limit_flow` | string | No | Data cap in GB |

### Response

- `200` — Success
- `404` — Fail

---

## POST /v1/proxy_account/consume_log

Retrieve traffic consumption history for an account.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `account_id` | integer | Yes | Account ID |
| `limit` | integer | Yes | Entries per page |
| `page` | integer | Yes | Page number |
| `start_time` | string | No | Start datetime |
| `end_time` | string | No | End datetime |

### Response

- `200` — Success (consumption log entries)
- `404` — Fail
