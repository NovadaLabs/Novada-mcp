# Agent 5 — Pragmatist / Devil's Advocate
## The Case Against Refactoring Now

**Date:** 2026-06-22
**Role:** AGAINST the pipeline refactor

---

## 1. Working Code Is Not a Liability

The 784-line extract.ts just delivered a measurable jump from 70% to an estimated 82–85% success rate. That is not a coincidence — it is the product of six targeted fixes that went exactly where the pain was. The code is ugly by software-aesthetics standards. It is also producing results. The cost of refactoring working code is not zero, and the burden of proof belongs on the people proposing the change, not on those defending the status quo.

The synthesis report documents 6 gaps, 8 files changed, and 2 HIGH review findings — all addressed in a single session. That is a tight feedback loop. A refactor introduces a new surface area where the feedback loop resets to zero.

---

## 2. "Pipeline Refactor" Is an Abstract Benefit Against Concrete Risks

The concrete risks of restructuring a 784-line extraction engine mid-sprint are:

- **Regression risk at every integration point.** extract.ts has 6 call sites for `fetchViaBrowser` alone. Splitting the file into pipeline stages creates 6 new seams where argument passing errors, type narrowing gaps, or missing `await` calls can silently degrade behavior without failing tsc.
- **Test coverage does not exist yet.** The synthesis explicitly defers a benchmark re-run to "next step #1." Refactoring before measuring the actual post-fix baseline means you will not know whether any regression came from the refactor or was pre-existing.
- **Time cost vs. performance gain is not established.** The synthesis estimates 82–85% success. The target is presumably 91% (to close the 5.5pp gap with Firecrawl's 100%). There is zero evidence that a pipeline architecture closes that gap. The remaining 5–15pp lives in `engpicker` (per-domain ML optimizer) and `tlsclient` TLS fingerprinting — neither of which is a structuring problem.

---

## 3. The Firecrawl Thin-Client Comparison Is a Category Error

Firecrawl's client is 130 lines because fire-engine, their closed server, contains the quality-score waterfall, TLS impersonation, mobileProxy routing, CSS selector waits, and the `engpicker` ML optimizer. Firecrawl did not achieve a thin client through disciplined refactoring — they moved complexity into a proprietary server layer.

Novada's client is thick because Novada's server is thin. The path to a thinner client is building server-side intelligence (or exposing more routing controls via the API), not reorganizing TypeScript files. Any refactor that does not address this fundamental asymmetry is rearranging code for the sake of code.

---

## 4. Three Bugs Fixed in One Day Is Evidence the Architecture Is Maintainable

QW-1, MT-1, and MT-2 were substantive bugs: a param wired nowhere, a proxy tier applied uniformly regardless of domain, a wait param explicitly voided. Not trivial cosmetic issues. All three were found, diagnosed, and patched in a single session by a fresh reviewer without author context. If the codebase were genuinely unmaintainable, that would not have been possible. The speed of the fix cycle is the counterevidence to the "technical debt is a crisis" narrative.

---

## 5. Opportunity Cost Is Real

Two to three days spent on a pipeline refactor is two to three days not spent on:

- **Shipping the benchmark re-run** that validates the current fixes actually land the estimated 82–85% before investing further.
- **Residential proxy credential validation in production** — MT-1 is a no-op if the env vars are not set. This is a P0 deployment risk that a refactor does not address.
- **Amazon URL normalization (Gap #7)** — estimated 5–10% improvement, scoped as a small targeted change, currently deferred because it was deprioritized against the refactor conversation.
- **External user acquisition** — KR-5 is past its June 21 deadline with zero external users. Code quality does not matter if no one is using the product.

The 5.5pp gap to Firecrawl closes through proxy infrastructure, domain-specific routing, and eventually an `engpicker` equivalent — not through file organization.

---

## 6. The One Thing That Would Change My Mind

**If the benchmark re-run shows we are stuck below 80% even with all six fixes applied**, and root-cause analysis points to a structural issue — specifically, that multiple escalation paths are executing redundantly because there is no centralized decision point — then a pipeline refactor is justified. Redundant escalations mean wasted latency and cost, and that is a real problem a pipeline architecture solves cleanly.

That condition is not currently established. Run the benchmark first. If the numbers confirm the estimates, ship. If they do not, the refactor conversation will have a factual basis. Until then, it is architecture for architecture's sake.

---

**Bottom line:** 70% → 85% in one session is a result worth protecting. The next move is measurement, not restructuring.
