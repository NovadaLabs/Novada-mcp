# Novada Developer API Reference

> Local mirror of https://developer-api.novada.com/apis/
> Fetched: 2026-05-08 — read these instead of hitting the website.

**Base URL:** `https://developer-api.novada.com`
**Auth:** All endpoints require Bearer token in `Authorization` header
**Content-Type:** All endpoints use `multipart/form-data`
**Methods:** All endpoints are POST

## API Categories

| File | Endpoints | What it manages |
|------|-----------|-----------------|
| [proxy-user-management.md](./proxy-user-management.md) | 4 | Create/list/update proxy user accounts, consumption logs |
| [ip-whitelist-management.md](./ip-whitelist-management.md) | 4 | Add/list/delete/remark whitelisted IPs |
| [residential-proxies.md](./residential-proxies.md) | 6 | Countries/states/cities/ISPs lookup, traffic balance & consumption |
| [rotating-datacenter-proxies.md](./rotating-datacenter-proxies.md) | 3 | Countries lookup, traffic balance & consumption |
| [rotating-isp-proxies.md](./rotating-isp-proxies.md) | 3 | Countries lookup, traffic balance & consumption |
| [dedicated-datacenter-proxies.md](./dedicated-datacenter-proxies.md) | 6 | Open/list/export/renew dedicated DC IPs, region listing |
| [static-isp-proxies.md](./static-isp-proxies.md) | 6 | Open/list/export/renew static ISP IPs, region listing |

**Total: 32 endpoints across 7 API groups.**

## Product Type Codes (cross-reference)

| Code | Product | Used in |
|------|---------|---------|
| 1 | Residential | User mgmt, whitelist |
| 2 | Rotating ISP | User mgmt |
| 3 | Rotating Datacenter | User mgmt |
| 4 | Unlimited | User mgmt, whitelist |
| 5 | Static ISP | Whitelist |
| 7 | Unblocker | User mgmt |
| 9 | Mobile | User mgmt |

## Common Response Format

```json
{
  "code": 0,
  "data": { ... },
  "msg": "success",
  "timestamp": 1715558400
}
```

## Balance Response (shared across residential/DC/ISP)

```json
{
  "data": {
    "balance": 10737418240,  // bytes remaining
    "expire_time": 1716163200 // unix timestamp
  }
}
```
