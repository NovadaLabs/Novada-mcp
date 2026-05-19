# Rotating ISP Proxies API

> Source: https://developer-api.novada.com/apis/rotating-isp-proxies
> Fetched: 2026-05-08

**Base URL:** `https://developer-api.novada.com`
**Auth:** Bearer token in `Authorization` header (all endpoints)
**Content-Type:** `multipart/form-data` (all endpoints)

---

## POST /v1/proxy/isp_data_area

List available rotating ISP proxy countries.

### Parameters

None required (empty form body).

### Response

- `200` — Success (list of countries)
- `404` — Fail

---

## POST /v1/isp_flow/balance

Show remaining ISP traffic balance.

### Parameters

None required (empty form body).

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

---

## POST /v1/isp_flow/consume_log

List main account ISP traffic consumption.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `start_time` | string | Yes | Start datetime |
| `end_time` | string | Yes | End datetime |

### Response

- `200` — Success (consumption log entries)
- `404` — Fail
