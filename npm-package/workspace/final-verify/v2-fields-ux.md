# v2 Fields UX Cross-Verification

Date: 2026-06-26T17:59:51.110Z
Build: v0.8.3 (local)

## Test Results

| Test | Description | Result |
|------|-------------|--------|
| T1a | Wikipedia no bare dashes | PASS |
| T1b | Wikipedia has helpful message | PASS |
| T2 | E-commerce fields extract | PASS |
| T3 | Mixed fields no bare dash | PASS |
| T3b | Mixed fields annotated dash | PASS |
| T4 | No fields = no fields section | PASS |
| T5 | JSON format null not dash | PASS |

## Test Details

### T1: Wikipedia (all fields not_found)
- Verifies that when NO fields can be extracted (e.g. population, capital, gdp from Wikipedia),
  the output shows a helpful message like "not available as structured data" instead of bare dashes.
- allDash pattern found: false
- helpful message found: true

### T2: E-commerce (fields SHOULD work)
- Verifies fields like price/title/rating actually extract from structured pages.
- Price found: true

### T3: Mixed (some found, some not)
- When some fields match and some don't, not-found fields should show "— (not in structured data)"
  instead of bare "—".
- Bare dash for unknown field: false
- Annotated dash present: true

### T4: No fields requested
- When no fields param is passed, no "Requested Fields" section should appear.
- Section absent: true

### T5: JSON format
- JSON output should use null (not "—") for missing fields.
- Validates JSON parseable and fields object correct.

## Conclusion

All tests passed. The "—" fix is working correctly across multiple page types.

Fields UX behavior:
1. All-not-found: Shows "## Requested Fields (not available as structured data)" with guidance
2. Mixed: Found fields show value + source tag; not-found show "— (not in structured data)"
3. No fields param: No fields section rendered
4. JSON format: Missing fields return null, not dash strings
