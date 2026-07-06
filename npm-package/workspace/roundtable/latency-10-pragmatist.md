# Agent 10 — Pragmatist / Devil's Advocate
## Latency Roundtable | 2026-06-22

**Position:** Search latency is NOT the most important thing to fix right now.

---

## Ground truth from the benchmark

| Metric | Novada | Tavily | Firecrawl |
|--------|--------|--------|-----------|
| Success rate | 91.7% (22/24) | 100% | 100% |
| Avg latency | 1955 ms | 831 ms | 789 ms |
| p95 latency | 2311 ms | 1232 ms | 1072 ms |
| Max latency | 4378 ms | 1245 ms | 1354 ms |
| Avg content | 2431 chars | 5512 chars | 0 chars |

Two failures. One outlier at 4378 ms (TypeScript generics — 2.2x the mean). The rest cluster tightly at 1500–2200 ms with very low variance.

---

## 1. Does 1955 ms vs 831 ms actually hurt an agent?

In a 5-minute (300-second) research session with 10 novada_search calls:

- Total novada search time: **19.6 s**
- Total tavily search time: **8.3 s**
- Extra time from novada: **11.2 s** = **3.7% of the session**

The other 96.3% of the session is the LLM doing its own reasoning, reading fetched content, writing output, calling other tools, and waiting on the orchestrator. No human is drumming their fingers. The agent is not blocked on latency — it is blocked on its own inference.

The 1124 ms gap is noise within a session that is already dominated by LLM think time. At Sonnet 4.6 speeds, a single 500-token response takes roughly 3–5 seconds. One LLM reply costs more wall-clock time than the entire latency delta across 10 searches.

Verdict: **1955 ms is not a problem for agent workflows. It is a problem for browser UX. We are not building a browser.**

---

## 2. Async MCP tool calls — latency semantics are different

When a human types a query into a search box, anything over ~300 ms registers as "slow." That is a deeply studied UX threshold.

When an agent calls novada_search via MCP, no human is watching a spinner. The tool call executes while the agent is doing nothing else anyway — it issued the call and is awaiting the response. The relevant question is not "does this feel slow?" but "does this delay the final output in a way the user notices?"

In practice:
- A novada_search at 1955 ms vs 831 ms shifts the agent's final answer delivery by ~1.1 s per call.
- In a multi-tool research session, these calls are often sequential in the agent's plan but invisible in the user's experience — the user sees a thinking indicator and a final response, not individual tool timings.

The latency framing imported from human-facing search UX does not cleanly apply here. **The relevant SLA is "complete before the user gets impatient with the whole session" — typically 30–120 seconds — not sub-second per-call performance.**

---

## 3. Success rate: 91.7% is the real problem

Two failures in 24 runs. That is a 1-in-12 call failure rate.

For an agent running a research pipeline:
- A failed search call means the agent either retries (doubling effective latency for that query), falls back to a different tool, or produces an answer with a missing source.
- Most agent frameworks do not gracefully handle tool failures — they either hallucinate past them or surface an error.
- A 8.3% failure rate on a 10-call research session means there is a **57% chance at least one call fails** (1 − 0.917^10 = 0.573).

That is a coin flip on whether the session is clean. No latency optimization fixes this. A 500 ms novada_search that fails 1-in-12 times is strictly worse than a 2000 ms call that succeeds 100% of the time.

**Speed without reliability is not a product. Reliability without speed is still a usable product.**

Notably, both failures returned contentLen > 0 (2724 and 2876 chars respectively). The data came back — the failure is in some validation or response-shape check, not in the underlying search. This is likely a fast fix. It should be fixed before any latency sprint is planned.

---

## 4. Content quality gap — is it still real post-snippet fix?

Before the snippet fix:
- Novada returned URLs only (effectively 0 useful content for agents)
- Tavily averaged 5512 chars of actual content per query

After the snippet fix (today):
- Novada now exposes snippets, averaging ~2431 chars

The gap narrowed from "unusable vs. useful" to "2431 chars vs. 5512 chars." That is still a 2.3x content deficit. But is it material?

For agent use cases, the question is whether 2431 chars is enough for the agent to:
1. Determine relevance and select which URLs to fetch in depth
2. Answer simple factual queries without a follow-up fetch
3. Provide grounding citations

For (1) and (3), 2431 chars of snippet text is likely sufficient — agents selecting sources need titles, URLs, and short excerpts, not full articles. For (2), it depends on the query complexity.

**The content quality gap is real but no longer disqualifying. The snippet fix moved Novada from "wrong tool for agents" to "viable tool with caveats."** The remaining gap (2431 vs 5512) is a second-order concern compared to reliability.

---

## 5. Opportunity cost: latency sprint vs. alternatives

What does 1 week of latency engineering actually buy?

Assuming the latency is in the upstream search provider round-trip (most likely), improving it requires either:
- A faster upstream provider (contract/business decision, not engineering)
- Response caching (useful for repeated queries, but research agents rarely repeat exact queries)
- Parallelizing sub-queries (changes the API contract significantly)
- Switching the backend (major infrastructure risk)

Best realistic outcome: shave 400–600 ms off average latency. From 1955 ms to ~1400 ms. This changes the 10-query session cost from 19.6 s to 14.0 s. Delta: **5.6 seconds saved per 5-minute session.** Under 2%.

What does 1 week on alternatives buy?

- **Fix the 91.7% success rate**: Likely a 1–3 day fix (response validation bug). Moves from "57% chance of a failed session" to "near-zero." This directly improves agent reliability — the metric agents are actually gated on.
- **GitHub tool / new tools**: Each new tool expands the addressable use cases for novada-mcp. A GitHub search tool addresses a use case (code search) that no existing tool covers. New surface area > faster existing surface area.
- **Distribution / KR-5 (0 external users past DDL)**: The most important metric right now is not latency — it is zero external users. No latency optimization will acquire users. A user acquisition plan, marketplace listing, or blog post about the snippet fix will.

**ROI comparison:**
| Investment | Expected gain | Timeline |
|------------|---------------|----------|
| Latency sprint | 5.6 s/session, no new users | 1 week |
| Fix success rate | 57% → ~0% session failure rate | 1–3 days |
| New tool (GitHub) | New use case unlocked | 3–5 days |
| Distribution work | First external users (KR-5) | 1 week |

---

## 6. The pragmatist case: acceptable performance at superior economics

Stated plainly: **91.7% success at 1955 ms average, at 4-5x lower cost than Tavily, is an acceptable product for agent use cases today.**

Here is why:

- Agents are not latency-sensitive in the way browsers are. The 1955 ms call happens while the LLM is between tokens anyway.
- 4-5x cost advantage is a hard moat. A team running 10,000 search calls/day saves real money. Cost compounds; latency does not.
- The snippet fix shipped today. The content gap went from disqualifying to "second-order concern" in one PR.
- No external users have complained about latency. There are no external users. The latency complaint is hypothetical. The cost advantage is real.
- Competitors (Tavily at 100% success, 831 ms) win on reliability and speed. Novada's differentiation cannot be "also fast" — it has to be "cheaper, with enough quality." That is a viable position.

The benchmark shows Novada is a legitimate option for cost-sensitive agent pipelines. It is not the premium choice. It does not need to be.

---

## 7. The one metric that would change my mind

**If average latency crossed 5000 ms, I would reprioritize.**

Here is why that threshold:
- At 5000 ms per call, a 10-call session costs 50 seconds in search alone.
- LLM-level timeouts in most frameworks (LangChain, CrewAI, etc.) default to 30–60 seconds per tool call. At 5000 ms average, p95 latency likely exceeds 8000–10000 ms, approaching timeout territory.
- Tool call timeouts cause hard failures — worse than the current 8.3% soft failure rate.
- The TypeScript generics query already hit 4378 ms. One more bad day and individual calls brush 5000 ms.

So the pragmatist is not saying "latency never matters." The pragmatist is saying **current latency (1955 ms avg, p95 2311 ms) is inside the acceptable envelope for agent MCP calls, with headroom before timeouts become structural.** Watch the p95 and max, not the mean.

Secondary tripwire: if a paying customer explicitly cites latency as a reason not to renew, that is a real signal. Hypothetical benchmarks are not.

---

## 8. Verdict: do not spend the sprint on latency

**Priority order for the next sprint:**

1. **Fix the 91.7% success rate** (1–3 days). This is a reliability bug, not a performance issue. It is the highest-leverage improvement available. Find the validation failure, fix it, bump to 100%.

2. **KR-5 distribution** (rest of sprint). Zero external users is the existential problem. Publish the benchmark (showing the snippet fix and cost advantage). List on MCP marketplaces. Write one targeted post for the agent-builder community. Latency-optimized search with no users is a local maximum.

3. **GitHub tool or one new tool** (if bandwidth allows). Expands surface area. New use cases matter more than faster existing use cases.

4. **Latency engineering** — defer unless p95 approaches 4000+ ms consistently or a paying user flags it.

The benchmark data makes a clean case: Novada has a pricing moat, adequate content quality post-snippet-fix, and a reliability bug. Fix the bug. Find users. Optimize speed when users tell you it matters.

---

*Agent 10 — Pragmatist. Reviewed: 2026-06-22. Data source: benchmark/results/2026-06-22-search-v2.json (24 novada runs, 24 tavily, 24 firecrawl).*
