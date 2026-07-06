# Residential Proxies API

> Source: https://developer-api.novada.com/apis/residential-proxies
> Fetched: 2026-05-08

**Base URL:** `https://developer-api.novada.com`
**Auth:** Bearer token in `Authorization` header (all endpoints)
**Content-Type:** `multipart/form-data` (all endpoints)

---

## POST /v1/proxy/domestic_dynamic_area

List available residential proxy countries.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `search_word` | string | No | Country name search filter |

### Response

- `200` — Success (list of countries with codes)
- `404` — Fail

---

## POST /v1/proxy/city_by_code

List states/regions for a given country.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | Yes | Country code (e.g. "US") |

### Response

- `200` — Success (list of states/regions)
- `404` — Fail

---

## POST /v1/proxy/region_by_city

List cities within a country and continent/region.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | Yes | Country code |
| `region` | string | Yes | Continent/region name |

### Response

- `200` — Success (list of cities)
- `404` — Fail

---

## POST /v1/proxy/city_isp

List ISPs available in a given country.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | Yes | Country code |

### Response

- `200` — Success (list of ISPs)
- `404` — Fail

---

## POST /v1/residential_flow/consume_log

List traffic consumption history.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `start_time` | string | Yes | Start datetime |
| `end_time` | string | Yes | End datetime |

### Response

- `200` — Success (consumption log entries)
- `404` — Fail

---

## POST /v1/residential_flow/balance

Show remaining residential traffic balance.

### Parameters

None required.

### Response (200)

```json
{
  "code": 0,
  "data": {
    "balance": 10737418240,
    "expire_time": 1716163200
  },
  "msg": "success",
  "timestamp": 1715558400
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.balance` | integer | Remaining traffic in **bytes** |
| `data.expire_time` | integer | Unix timestamp of expiration |

- `404` — Fail
