# Backend Engineer — Roundtable Response

## 1. Most Dangerous Bug Still Unfixed

**Verify returning `confidence: 100` with zero evidence is a trust-destroying bug.** When 0 supporting sources exist, the formula divides 5 (unrelated hits) by 5+0 and declares "supported." A journalist or compliance agent acting on this gets burned. The fix is trivial -- if `supportingEvidence.length === 0`, force `verdict: "insufficient_data"` and cap confidence at 0. This is a one-line guard but the damage from shipping without it is reputational. Ship the fix before any marketing pushes verify as a feature.

The `fields=null` render escalation bug is second priority. When all requested fields return null after static fetch, `render: 'auto'` should retry with JS rendering. The quality heuristic scores 85 on pages missing all business content -- it measures HTML completeness, not semantic completeness. This silently fails the core extract use case on JS-heavy pricing pages.

## 2. Build Next Week

- **Verify confidence guard** (P0, 1 day)
- **Auto-escalate extract when fields are all null** (P1, 2 days)
- **Strip raw metadata from research Summary output** -- agents consuming this downstream get polluted context (P2, 1 day)
- **Integration tests for these three paths** so they never regress

## 3. What We Should NOT Do

Do not add new tools. We have 40+ tools with known reliability gaps in the existing ones. Adding surface area before fixing verify/extract/research output quality is building on a cracked foundation. Fix, test, then ship.
