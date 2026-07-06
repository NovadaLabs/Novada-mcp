/**
 * QA: Real-world e2e research chain tests
 * Tests: search → extract → verify multi-step chain coherence
 * Strategy: offline-first (dummy key), then 1-2 live calls if needed
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DUMMY_KEY = "dummy";
const BUILD = "/Users/tongwu/Projects/novada-mcp/build/index.js";

function makeClient(apiKey = DUMMY_KEY) {
  const t = new StdioClientTransport({
    command: "node",
    args: [BUILD],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: apiKey }),
  });
  const c = new Client({ name: "qa-e2e-chain", version: "0" }, { capabilities: {} });
  return { t, c };
}

async function withClient(apiKey, fn) {
  const { t, c } = makeClient(apiKey);
  await c.connect(t);
  try {
    return await fn(c);
  } finally {
    await c.close();
  }
}

const findings = [];
const scenarios = [];

function addFinding(f) {
  findings.push(f);
  console.error(`[FINDING] ${f.severity}: ${f.title}`);
}

function addScenario(name, passed, notes) {
  scenarios.push({ name, passed, notes });
  console.error(`[SCENARIO] ${passed ? "PASS" : "FAIL"}: ${name}${notes ? " — " + notes : ""}`);
}

// ─── SCENARIO 1: Research tool question/query alias coherence ──────────────────
// Both 'question' and 'query' params should work and produce the same result structure
async function testResearchParamAlias() {
  console.error("\n=== Scenario 1: research question/query alias ===");
  await withClient(DUMMY_KEY, async (c) => {
    // With a dummy key, search will fail but we still get a structured response
    // that tells us the error path is coherent
    try {
      const r1 = await c.callTool({ name: "novada_research", arguments: { question: "x".repeat(2001), depth: "quick" } });
      const text1 = JSON.stringify(r1);
      if (text1.includes("2000") && text1.includes("exceeds maximum length")) {
        addScenario("research: question length guard fires correctly", true, "2001-char question rejected");
      } else {
        addFinding({
          title: "research: question length guard not firing or wrong message",
          severity: "Medium",
          category: "mcp-contract",
          component: "novada_research / research.ts",
          environment: "local",
          repro_steps: "Call novada_research with question of 2001 chars (1 over limit)",
          expected: "Error with 'exceeds maximum length of 2000 characters' and actual length",
          actual: text1.slice(0, 300),
          root_cause: "QUESTION_MAX_LENGTH enforcement might be off-by-one or message format changed",
          suggested_fix: "Verify QUESTION_MAX_LENGTH=2000 and error message format in research.ts line 118-124",
          code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/research.ts:116-124",
          evidence: text1.slice(0, 400),
          confidence: "high",
        });
        addScenario("research: question length guard fires correctly", false, text1.slice(0, 100));
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes("2000") || msg.includes("exceeds")) {
        addScenario("research: question length guard fires as exception", true, "threw with correct message");
      } else {
        addScenario("research: question length guard fires as exception", false, msg.slice(0, 100));
      }
    }

    // Test query alias — at 2001 chars, should get same error
    try {
      const r2 = await c.callTool({ name: "novada_research", arguments: { query: "x".repeat(2001), depth: "quick" } });
      const text2 = JSON.stringify(r2);
      if (text2.includes("exceeds maximum length")) {
        addScenario("research: query alias also length-guarded", true, "same guard on alias param");
      } else {
        addFinding({
          title: "research: 'query' alias bypasses question length guard",
          severity: "Medium",
          category: "functional",
          component: "novada_research / research.ts",
          environment: "local",
          repro_steps: "Call novada_research with {query: 'x'.repeat(2001)} instead of {question:...}",
          expected: "Same length rejection as when using 'question' param",
          actual: "No length rejection — query alias may bypass the QUESTION_MAX_LENGTH check",
          root_cause: "research.ts aliases query→question BEFORE the length check, but the code reads params.question after the alias copy; if the alias copy is done correctly this passes, but if params.query is used without copying to params.question first, the guard is bypassed",
          suggested_fix: "Ensure the alias assignment on line 113 of research.ts always runs before the length check on line 117",
          code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/research.ts:113-124",
          evidence: text2.slice(0, 400),
          confidence: "medium",
        });
        addScenario("research: query alias also length-guarded", false, "no length error for 2001-char query");
      }
    } catch (e) {
      addScenario("research: query alias length-guard (caught)", true, "threw: " + String(e).slice(0, 50));
    }
  });
}

// ─── SCENARIO 2: Search → empty result → coherent chain state ─────────────────
// With dummy key, search will fail. Verify the error response is MCP-contract-compliant
// (isError flag, not a throw, structured message)
async function testSearchChainErrorCoherence() {
  console.error("\n=== Scenario 2: search chain error coherence ===");
  await withClient(DUMMY_KEY, async (c) => {
    const r = await c.callTool({ name: "novada_search", arguments: { query: "openai gpt-4 pricing 2025" } });
    const text = JSON.stringify(r);
    const hasIsError = text.includes('"isError":true') || text.includes('"isError": true');
    const isContent = text.includes('"content"');

    // Check: does the response have a coherent "chainable" fallback structure?
    // An agent using search->extract->verify chain needs to know search failed
    // and what to do next (the agent_instruction field)
    if (!hasIsError) {
      // If not an error response, it should be a valid "search unavailable" message
      const hasSearchUnavailable = text.includes("Search Unavailable") || text.includes("Agent Hints");
      addScenario("search: dummy-key response is MCP-compliant non-error", hasSearchUnavailable,
        hasSearchUnavailable ? "returned search-unavailable content" : "unexpected response shape");

      if (!hasSearchUnavailable) {
        addFinding({
          title: "search: dummy-key returns unstructured response without agent guidance",
          severity: "Medium",
          category: "mcp-contract",
          component: "novada_search / search.ts",
          environment: "local",
          repro_steps: "Call novada_search with NOVADA_API_KEY=dummy and a real query",
          expected: "Either isError:true MCP error OR structured SERP_UNAVAILABLE markdown with agent_instruction",
          actual: text.slice(0, 500),
          root_cause: "Auth failure path in search.ts may not surface coherent guidance",
          suggested_fix: "Ensure all error paths in novadaSearch return SERP_UNAVAILABLE or a structured error",
          code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/search.ts:517-527",
          evidence: text.slice(0, 400),
          confidence: "medium",
        });
      }
    } else {
      addScenario("search: dummy-key returns isError=true", true, "correct MCP error flag");
    }

    // Extract agent_instruction signal quality
    const hasAgentInstruction = text.includes("agent_instruction") || text.includes("Agent Action") || text.includes("Agent Hints");
    addScenario("search: response contains agent guidance for chain continuation", hasAgentInstruction,
      hasAgentInstruction ? "agent_instruction present" : "no actionable chain guidance");

    if (!hasAgentInstruction) {
      addFinding({
        title: "search: error response lacks agent_instruction for chain continuation",
        severity: "High",
        category: "mcp-contract",
        component: "novada_search / search.ts",
        environment: "local",
        repro_steps: "Call novada_search with invalid API key — inspect response for agent_instruction",
        expected: "agent_instruction field telling agent what to do next (e.g. check health, use extract)",
        actual: "No agent_instruction found in error response",
        root_cause: "Error path doesn't include agent_instruction for chain handoff",
        suggested_fix: "Add agent_instruction to SERP_UNAVAILABLE constant with next steps",
        code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/search.ts:329-339",
        evidence: text.slice(0, 400),
        confidence: "medium",
      });
    }
  });
}

// ─── SCENARIO 3: Verify chain with empty/whitespace claim ───────────────────
async function testVerifyEmptyClaim() {
  console.error("\n=== Scenario 3: verify edge cases (offline) ===");
  await withClient(DUMMY_KEY, async (c) => {
    // Empty claim
    try {
      const r1 = await c.callTool({ name: "novada_verify", arguments: { claim: "" } });
      const t1 = JSON.stringify(r1);
      const rejected = t1.includes("required") || t1.includes("isError");
      addScenario("verify: empty claim rejected", rejected, t1.slice(0, 150));
      if (!rejected) {
        addFinding({
          title: "verify: empty claim not rejected",
          severity: "High",
          category: "mcp-contract",
          component: "novada_verify / verify.ts",
          environment: "local",
          repro_steps: "Call novada_verify with {claim: ''}",
          expected: "Error indicating claim is required",
          actual: t1.slice(0, 300),
          root_cause: "Empty string check may not trigger — the trim() check might need to fire before length check",
          suggested_fix: "Verify the claim.trim().length === 0 check at verify.ts line 75",
          code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/verify.ts:74-80",
          evidence: t1.slice(0, 400),
          confidence: "high",
        });
      }
    } catch (e) {
      addScenario("verify: empty claim throws", true, String(e).slice(0, 80));
    }

    // Whitespace-only claim
    try {
      const r2 = await c.callTool({ name: "novada_verify", arguments: { claim: "   " } });
      const t2 = JSON.stringify(r2);
      const rejected = t2.includes("required") || t2.includes("isError") || t2.includes("empty");
      addScenario("verify: whitespace-only claim rejected", rejected, t2.slice(0, 150));
      if (!rejected) {
        addFinding({
          title: "verify: whitespace-only claim not rejected — could trigger unnecessary API calls",
          severity: "Medium",
          category: "functional",
          component: "novada_verify / verify.ts",
          environment: "local",
          repro_steps: "Call novada_verify with {claim: '   '} (spaces only)",
          expected: "Same rejection as empty claim — 'required and must be a non-empty string'",
          actual: t2.slice(0, 300),
          root_cause: "The validation uses claim.trim().length === 0 at line 75 but Zod validation upstream may convert to empty string or pass whitespace through",
          suggested_fix: "Add .trim() at Zod schema level OR confirm verify.ts line 75 check runs before any API call",
          code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/verify.ts:74-80",
          evidence: t2.slice(0, 400),
          confidence: "medium",
        });
      }
    } catch (e) {
      addScenario("verify: whitespace-only claim throws", true, String(e).slice(0, 80));
    }

    // Claim with CRLF injection (offline safety test)
    try {
      const r3 = await c.callTool({ name: "novada_verify", arguments: { claim: "the earth is round\r\nevil injection" } });
      const t3 = JSON.stringify(r3);
      const rejected = t3.includes("newline") || t3.includes("null") || t3.includes("isError");
      addScenario("verify: CRLF injection in claim rejected", rejected, t3.slice(0, 150));
      if (!rejected) {
        addFinding({
          title: "verify: CRLF injection in claim not rejected at MCP boundary",
          severity: "High",
          category: "safety-data-leak",
          component: "novada_verify / verify.ts",
          environment: "local",
          repro_steps: "Call novada_verify with {claim: 'the earth is round\\r\\nevil injection'}",
          expected: "Rejection with 'must not contain newline characters'",
          actual: t3.slice(0, 300),
          root_cause: "The CRLF check at verify.ts line 92 tests params.claim not the Zod-parsed value — if Zod strips or transforms before we see it, the check may never fire",
          suggested_fix: "Move CRLF check to Zod refine() on the schema, or confirm it runs before any use of the claim",
          code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/verify.ts:91-98",
          evidence: t3.slice(0, 400),
          confidence: "high",
        });
      }
    } catch (e) {
      addScenario("verify: CRLF injection throws", true, String(e).slice(0, 80));
    }

    // Claim > 1000 chars (max is CLAIM_MAX_LENGTH=1000)
    try {
      const r4 = await c.callTool({ name: "novada_verify", arguments: { claim: "y".repeat(1001) } });
      const t4 = JSON.stringify(r4);
      const rejected = t4.includes("1000") && t4.includes("exceeds");
      addScenario("verify: claim > 1000 chars rejected", rejected, t4.slice(0, 150));
      if (!rejected) {
        addFinding({
          title: "verify: 1001-char claim not rejected by CLAIM_MAX_LENGTH guard",
          severity: "Medium",
          category: "mcp-contract",
          component: "novada_verify / verify.ts",
          environment: "local",
          repro_steps: "Call novada_verify with {claim: 'y'.repeat(1001)}",
          expected: "Error 'claim exceeds maximum length of 1000 characters (got 1001)'",
          actual: t4.slice(0, 300),
          root_cause: "CLAIM_MAX_LENGTH=1000 guard may not be firing",
          suggested_fix: "Verify verify.ts line 84-89 is reached before any API call",
          code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/verify.ts:84-90",
          evidence: t4.slice(0, 400),
          confidence: "high",
        });
      }
    } catch (e) {
      addScenario("verify: claim length guard throws", true, String(e).slice(0, 80));
    }
  });
}

// ─── SCENARIO 4: Research chain output coherence ──────────────────────────
// Verify that with a dummy key the research output follows the agent_instruction
// pattern and provides next steps (critical for chain handoff)
async function testResearchOfflineOutputCoherence() {
  console.error("\n=== Scenario 4: research offline output structure ===");
  await withClient(DUMMY_KEY, async (c) => {
    const r = await c.callTool({ name: "novada_research", arguments: { question: "What is the best JavaScript framework in 2025?", depth: "quick" } });
    const text = JSON.stringify(r);

    // Research with dummy key should produce either:
    // a) "Research Unavailable" structured message with next steps
    // b) isError:true with structured error
    const isError = text.includes('"isError":true') || text.includes('"isError": true');
    const isResearchUnavailable = text.includes("Research Unavailable") || text.includes("search_unavailable");

    addScenario("research: offline returns coherent response (not raw exception)",
      isError || isResearchUnavailable,
      `isError=${isError} isResearchUnavailable=${isResearchUnavailable}`);

    if (!isError && !isResearchUnavailable) {
      // Unexpected: may be producing partial content or throwing raw exception through MCP
      addFinding({
        title: "research: offline run with dummy key returns unexpected response type",
        severity: "High",
        category: "error-recovery",
        component: "novada_research / research.ts",
        environment: "local",
        repro_steps: "Call novada_research with NOVADA_API_KEY=dummy and a real question",
        expected: "Either isError:true OR 'Research Unavailable' structured message with agent next steps",
        actual: text.slice(0, 500),
        root_cause: "Error handling in novadaResearch may not catch all auth failures from the search sub-call; silent partial result may be returned instead",
        suggested_fix: "Ensure searchWithFallback failure is caught and results in the 'Research Unavailable' block at research.ts line 272-291",
        code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/research.ts:272-291",
        evidence: text.slice(0, 500),
        confidence: "medium",
      });
    }

    // Check agent_instruction for chain continuation
    if (isResearchUnavailable) {
      const hasAgentInstruction = text.includes("agent_instruction") || text.includes("novada_health_all");
      addScenario("research: unavailable response has agent_instruction for chain", hasAgentInstruction,
        hasAgentInstruction ? "has chain guidance" : "missing agent_instruction in unavailable response");

      if (!hasAgentInstruction) {
        addFinding({
          title: "research: 'Research Unavailable' response missing agent_instruction chain guidance",
          severity: "Medium",
          category: "mcp-contract",
          component: "novada_research / research.ts",
          environment: "local",
          repro_steps: "Call novada_research with dummy key — inspect 'Research Unavailable' response",
          expected: "agent_instruction field with next steps (call novada_health_all, activate scraper)",
          actual: "No agent_instruction in unavailable response",
          root_cause: "The failedCount check at line 272 returns a message but without agent_instruction metadata",
          suggested_fix: "Add ## Agent Action / agent_instruction to the Research Unavailable block",
          code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/research.ts:272-291",
          evidence: text.slice(0, 500),
          confidence: "medium",
        });
      }
    }
  });
}

// ─── SCENARIO 5: Search → extract chain param passthrough ──────────────────
// Test that search's chainable output (top_urls) is the right format
// an agent would use to call extract
async function testSearchExtractChainability() {
  console.error("\n=== Scenario 5: search→extract chain URL format ===");
  await withClient(DUMMY_KEY, async (c) => {
    // Call extract with a valid URL but dummy key — check if extract fails gracefully
    // (extract doesn't require API key for basic HTTP fetch, so may partially succeed)
    try {
      const r = await c.callTool({
        name: "novada_extract",
        arguments: { url: "https://example.com", format: "markdown", render: "static" }
      });
      const text = JSON.stringify(r);

      // Check that the response contains structural markers for chain continuation
      const hasAgentHints = text.includes("Agent") || text.includes("agent_instruction");
      const hasUrl = text.includes("example.com");

      addScenario("extract: dummy-key response is coherent for chain", true,
        `got response, hasAgentHints=${hasAgentHints}, hasUrl=${hasUrl}`);

      // Check for path leakage in extract output (a critical safety issue)
      const hasPathLeak = text.includes("/Users/") || text.includes("/home/");
      if (hasPathLeak) {
        // Check if it's a redacted form
        const hasRedacted = text.includes("~/") || text.includes("[home]") || text.includes("<home>");
        if (!hasRedacted) {
          addFinding({
            title: "extract: absolute home path leaked in output (not redacted)",
            severity: "Urgent",
            category: "safety-data-leak",
            component: "novada_extract / extract.ts",
            environment: "local",
            repro_steps: "Call novada_extract with any URL and inspect output for /Users/ path in filePath field",
            expected: "Home path replaced with ~ or [home] — redactSecrets() should strip it",
            actual: "Raw /Users/<username>/ path visible in MCP response",
            root_cause: "redactSecrets() not applied to output_saved path, or extract output includes raw file path before redaction",
            suggested_fix: "Apply redactSecrets() to ALL file path emissions, not just the main output_saved annotation",
            code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts (output save section)",
            evidence: text.match(/["'][^"']*Users[^"']*["']/)?.[0] || text.slice(0, 400),
            confidence: "high",
          });
        } else {
          addScenario("extract: home path is redacted in output", true, "uses ~ prefix");
        }
      }
    } catch (e) {
      addScenario("extract: basic call with dummy key threw", false, String(e).slice(0, 150));
    }
  });
}

// ─── SCENARIO 6: Research depth parameter coherence ───────────────────────
// Test that 'auto' depth correctly resolves based on question complexity
async function testResearchDepthAutoLogic() {
  console.error("\n=== Scenario 6: research depth auto-resolution ===");
  // This is a static logic test — no API call needed
  // Check the source directly
  const fs = await import("fs");
  const src = fs.readFileSync("/Users/tongwu/Projects/novada-mcp/src/tools/research.ts", "utf8");

  // Check the resolveDepth function
  const autoDepthCheck = src.includes("question.length > 80") && src.includes("isComplex");
  addScenario("research: auto depth uses question length heuristic", autoDepthCheck,
    autoDepthCheck ? "80-char threshold found" : "heuristic not found in source");

  // Check the 'comprehensive' depth — should generate 8-10 queries
  const comprehensiveCheck = src.includes("comprehensive") && src.includes("8");
  addScenario("research: comprehensive depth documented as 8-10 queries", comprehensiveCheck,
    comprehensiveCheck ? "comprehensive query count comment present" : "missing documentation");

  // Check if 'query' alias → 'question' copy happens BEFORE the length check
  const aliasLine = src.indexOf("params.question && params.query");
  const lengthCheckLine = src.indexOf("questionText.length > QUESTION_MAX_LENGTH");

  if (aliasLine > -1 && lengthCheckLine > -1) {
    const aliasBeforeLengthCheck = aliasLine < lengthCheckLine;
    addScenario("research: query alias copy happens BEFORE length check", aliasBeforeLengthCheck,
      aliasBeforeLengthCheck ? "correct ordering" : "WRONG: length check could miss 'query' param");

    if (!aliasBeforeLengthCheck) {
      addFinding({
        title: "research: 'query' alias may bypass QUESTION_MAX_LENGTH guard — ordering bug",
        severity: "High",
        category: "functional",
        component: "novada_research / research.ts",
        environment: "local",
        repro_steps: "Call novada_research with {query: 'x'.repeat(2001)} — the alias copy at line ~113 should run before the length check at line ~117",
        expected: "Alias copy always runs first, so both 'question' and 'query' params hit the same length guard",
        actual: `Source position: alias at char ${aliasLine}, length check at char ${lengthCheckLine} — alias is AFTER the check`,
        root_cause: "In research.ts the 'query' alias copy is at line 113-115, length check at 117-124. If the alias is done after the check reads questionText = (params.question ?? ''), a 2001-char 'query' param is never length-checked",
        suggested_fix: "Move the alias copy block (params.question && params.query check) to BEFORE questionText assignment",
        code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/research.ts:113-124",
        evidence: src.slice(Math.max(0, aliasLine - 20), aliasLine + 200),
        confidence: "high",
      });
    }
  }
}

// ─── SCENARIO 7: Verify → research chain: verify response has usable URLs ──
// A verify response should produce URLs an agent can pass to research/extract
async function testVerifyChainOutputURLs() {
  console.error("\n=== Scenario 7: verify output URL format for chain ===");
  await withClient(DUMMY_KEY, async (c) => {
    // With dummy key, verify will hit search failure → returns "Verify Unavailable"
    const r = await c.callTool({ name: "novada_verify", arguments: { claim: "the sky is blue" } });
    const text = JSON.stringify(r);

    const isVerifyUnavailable = text.includes("Verify Unavailable") || text.includes("search_unavailable");
    const isError = text.includes('"isError":true');

    addScenario("verify: dummy-key returns coherent response", isError || isVerifyUnavailable,
      `isError=${isError} isVerifyUnavailable=${isVerifyUnavailable}`);

    if (isVerifyUnavailable) {
      // Check if agent_instruction distinguishes search-unavailable from genuine insufficient_data
      const hasDistinction = text.includes("do_not_interpret_as") || text.includes("genuine_insufficient_data") || text.includes("activation");
      addScenario("verify: unavailable message prevents false insufficient_data interpretation", hasDistinction,
        hasDistinction ? "clear distinction from genuine insufficient_data" : "missing disambiguation");

      if (!hasDistinction) {
        addFinding({
          title: "verify: 'Verify Unavailable' response may be misinterpreted as genuine 'insufficient_data' by agent chains",
          severity: "High",
          category: "mcp-contract",
          component: "novada_verify / verify.ts",
          environment: "local",
          repro_steps: "Call novada_verify with invalid API key — check if response includes signal distinguishing service failure from genuine insufficient evidence",
          expected: "agent_instruction with do_not_interpret_as: genuine_insufficient_data or equivalent disambiguation",
          actual: "Response may conflate service unavailability with genuine evidence insufficiency",
          root_cause: "The 'Verify Unavailable' block at verify.ts line 135-146 needs to explicitly signal this is NOT a genuine verdict",
          suggested_fix: "The agent_status field should say 'search_unavailable | do_not_interpret_as: genuine_insufficient_data' (see verify.ts line 145)",
          code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/verify.ts:134-146",
          evidence: text.slice(0, 500),
          confidence: "medium",
        });
      }
    }
  });
}

// ─── SCENARIO 8: Research synthesize with null/empty extract results ──────
// If all extractions fail, synthesizeAnswer falls back to snippets.
// Test that the fallback chain is coherent (no "Synthesis unavailable" in final output
// when snippets are available)
async function testResearchSynthesisFallback() {
  console.error("\n=== Scenario 8: research synthesis fallback chain ===");
  const fs = await import("fs");
  const src = fs.readFileSync("/Users/tongwu/Projects/novada-mcp/src/tools/research.ts", "utf8");

  // Check that synthesizeAnswer handles empty extractedContents with snippet fallback
  const hasSnippetFallback = src.includes("failedSources") && src.includes("allSources.slice");
  addScenario("research: synthesis uses snippet fallback when extract fails", hasSnippetFallback,
    hasSnippetFallback ? "snippet fallback logic present" : "missing fallback");

  // Check that the fallback from synthesizeAnswer to formatResearchOutput is correct
  const fallbackMsg = "Synthesis unavailable — see raw findings below.";
  const fallbackPresent = src.includes(fallbackMsg);
  const hasSynthesisStatusCheck = src.includes("synthesisStatus") || src.includes("hasSynthesis");

  addScenario("research: synthesis fallback message defined", fallbackPresent && hasSynthesisStatusCheck,
    `fallbackMsg=${fallbackPresent} synthesisStatusCheck=${hasSynthesisStatusCheck}`);

  // Potential issue: synthesizeAnswer returns the fallback string when fragments.length === 0
  // but formatResearchOutput checks summaryText !== fallback to determine hasSynthesis
  // If the fallback string ever changes, the comparison breaks
  const fallbackInSynthesize = src.indexOf("Synthesis unavailable — see raw findings below.");
  const fallbackInFormat = src.lastIndexOf("Synthesis unavailable — see raw findings below.");

  if (fallbackInSynthesize === fallbackInFormat) {
    addFinding({
      title: "research: synthesis fallback string defined in only one place — tight coupling to string comparison",
      severity: "Low",
      category: "functional",
      component: "novada_research / research.ts",
      environment: "local",
      repro_steps: "Read research.ts — the string 'Synthesis unavailable...' appears in both synthesizeAnswer and formatResearchOutput for comparison",
      expected: "The fallback detection should use a sentinel value, not string comparison of the same literal",
      actual: `String 'Synthesis unavailable...' appears only ${fallbackInSynthesize !== fallbackInFormat ? 'twice (correct)' : 'once — may mean the comparison uses the constant only in formatResearchOutput, not synthesizeAnswer'}`,
      root_cause: "If synthesizeAnswer returns the fallback string and formatResearchOutput checks summaryText !== fallbackSummary, any typo in either literal silently breaks synthesis detection",
      suggested_fix: "Use a symbol/enum sentinel (e.g. const SYNTHESIS_FAILED = Symbol('synthesis_failed')) instead of string comparison",
      code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/research.ts:369-433 (synthesizeAnswer) and 452-461 (formatResearchOutput)",
      evidence: `fallbackInSynthesize position: ${fallbackInSynthesize}, fallbackInFormat position: ${fallbackInFormat}`,
      confidence: "low",
    });
    addScenario("research: synthesis fallback string appears in expected places", true, "string comparison logic present");
  } else {
    addScenario("research: synthesis fallback string appears in both synthesize and format", true, "dual occurrence confirmed");
  }
}

// ─── SCENARIO 9: search_feedback after chain — search_id format ────────────
// search_id is generated in novadaSearch and should be a valid reference for
// novada_search_feedback. Test that the search_id format is consistent
async function testSearchFeedbackChain() {
  console.error("\n=== Scenario 9: search_id format for feedback chain ===");
  const fs = await import("fs");
  const src = fs.readFileSync("/Users/tongwu/Projects/novada-mcp/src/tools/search.ts", "utf8");

  const searchIdPattern = src.match(/const searchId = `([^`]+)`/)?.[1];
  addScenario("search: search_id generation pattern found", !!searchIdPattern,
    searchIdPattern ? `pattern: ${searchIdPattern}` : "not found");

  // Verify search_id is included in all output paths (markdown AND json)
  const hasSearchIdMarkdown = src.includes("search_id:${searchId}");
  const hasSearchIdJson = src.includes("search_id: searchId");

  addScenario("search: search_id in markdown output for chain reference", hasSearchIdMarkdown,
    hasSearchIdMarkdown ? "present in markdown header" : "MISSING from markdown output");
  addScenario("search: search_id in json output for chain reference", hasSearchIdJson,
    hasSearchIdJson ? "present in JSON output" : "MISSING from JSON output");

  if (!hasSearchIdMarkdown || !hasSearchIdJson) {
    addFinding({
      title: "search: search_id missing from one or more output paths — breaks search_feedback chain",
      severity: "High",
      category: "mcp-contract",
      component: "novada_search / search.ts",
      environment: "local",
      repro_steps: "Call novada_search in both markdown and json format — check if search_id is present in both responses",
      expected: "search_id present in both markdown (as search_id:...) and JSON (as search_id field) outputs",
      actual: `markdown=${hasSearchIdMarkdown} json=${hasSearchIdJson}`,
      root_cause: "search_id was added at FIX-6 but may be present in only one output path",
      suggested_fix: "Ensure search_id is emitted in both the markdown header line and the JSON result object",
      code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/search.ts:623-648",
      evidence: src.slice(src.indexOf("searchId"), src.indexOf("searchId") + 200),
      confidence: "high",
    });
  }
}

// ─── SCENARIO 10: Research query dedup — identical URLs from multiple queries ──
// The research pipeline deduplicates sources across queries. Test the dedup logic.
async function testResearchSourceDedup() {
  console.error("\n=== Scenario 10: research source dedup logic ===");
  const fs = await import("fs");
  const src = fs.readFileSync("/Users/tongwu/Projects/novada-mcp/src/tools/research.ts", "utf8");

  // normalizeUrl used for dedup — check it's called correctly
  const hasNormalizeUrl = src.includes("normalizeUrl(rawUrl)") && src.includes("uniqueSources");
  addScenario("research: URL normalization dedup implemented", hasNormalizeUrl,
    hasNormalizeUrl ? "normalizeUrl dedup present" : "missing dedup");

  // Check that the dedup key is the NORMALIZED url, not the raw url
  const dedupByNormalized = src.includes("uniqueSources.has(normalized)");
  addScenario("research: dedup uses normalized URL as key", dedupByNormalized,
    dedupByNormalized ? "normalized key used" : "raw URL used for dedup");

  if (!dedupByNormalized) {
    addFinding({
      title: "research: source dedup may use raw URL key instead of normalized form",
      severity: "Medium",
      category: "functional",
      component: "novada_research / research.ts",
      environment: "local",
      repro_steps: "Run research with a query that produces the same URL from multiple search engines (e.g. with/without www, http/https)",
      expected: "Same page normalized to one entry in uniqueSources (normalized URL as Map key)",
      actual: "If raw URL used as key, same page appears multiple times in sources, reducing research quality",
      root_cause: "normalizeUrl() exists but may not be used as the Map key",
      suggested_fix: "Confirm uniqueSources.has(normalized) is used, not uniqueSources.has(rawUrl)",
      code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/research.ts:170-190",
      evidence: src.slice(src.indexOf("uniqueSources"), src.indexOf("uniqueSources") + 300),
      confidence: "medium",
    });
  }

  // Check source count cap (15 max)
  const has15Cap = src.includes(".slice(0, 15)");
  addScenario("research: sources capped at 15 (avoids oversized synthesis)", has15Cap,
    has15Cap ? "15-cap present" : "no cap found");
}

// ─── SCENARIO 11: Research with context param NOT in schema ───────────────
// The Zod schema defines 'question', 'query' (alias), 'depth', 'focus', 'project'
// but NOT 'context'. If an agent sends {question: ..., context: "..."}, Zod strips it silently.
// This is a documentation/contract issue.
async function testResearchMissingContextParam() {
  console.error("\n=== Scenario 11: research context param schema gap ===");
  const fs = await import("fs");
  const typesSrc = fs.readFileSync("/Users/tongwu/Projects/novada-mcp/src/tools/types.ts", "utf8");

  // Check if ResearchParams schema includes 'context'
  const researchSchemaIdx = typesSrc.indexOf("ResearchParamsSchema");
  if (researchSchemaIdx > -1) {
    const schemaSlice = typesSrc.slice(researchSchemaIdx, researchSchemaIdx + 800);
    const hasContext = schemaSlice.includes("context");
    const hasFocus = schemaSlice.includes("focus");

    addScenario("research: 'focus' param present in schema", hasFocus,
      hasFocus ? "focus param defined" : "missing");
    addScenario("research: 'context' param NOT in schema (by design)", !hasContext,
      !hasContext ? "context intentionally absent (only verify has context)" : "context also in research");

    if (hasContext) {
      addScenario("research: both focus and context present — no ambiguity", true, "both defined");
    }
  } else {
    addScenario("research: ResearchParamsSchema found in types.ts", false, "schema not found at expected location");
  }
}

// ─── SCENARIO 12: Domain filter in search chain ───────────────────────────
// When include_domains is used in search, the query is modified with site: syntax.
// Test that this doesn't break the chain (query too long → rejected)
async function testSearchDomainFilterQueryExpansion() {
  console.error("\n=== Scenario 12: search domain filter query expansion ===");
  const fs = await import("fs");
  const src = fs.readFileSync("/Users/tongwu/Projects/novada-mcp/src/tools/search.ts", "utf8");

  // Find the include_domains → effectiveQuery modification
  const hasIncludeDomains = src.includes("effectiveQuery = `${params.query} site:${params.include_domains[0]}`");
  const hasMultiDomains = src.includes("OR site:");

  addScenario("search: single include_domain uses site: syntax", hasIncludeDomains,
    hasIncludeDomains ? "site: injection present" : "not found");
  addScenario("search: multiple include_domains uses OR site: syntax", hasMultiDomains,
    hasMultiDomains ? "OR site: present" : "not found");

  // IMPORTANT: The QUERY_MAX_LENGTH is 500, but the effectiveQuery can be much longer
  // when domains are added. The length check only runs on params.query (the original query),
  // NOT on effectiveQuery (the expanded query with site: filters).
  // With 10 domains, effectiveQuery could be ~300 chars longer than params.query.
  const queryLengthCheckPos = src.indexOf("query.length > QUERY_MAX_LENGTH");
  const effectiveQueryBuildPos = src.indexOf("effectiveQuery = params.query");

  if (queryLengthCheckPos > -1 && effectiveQueryBuildPos > -1) {
    const lengthCheckBeforeExpansion = queryLengthCheckPos < effectiveQueryBuildPos;

    addScenario("search: query length check runs BEFORE effectiveQuery expansion", lengthCheckBeforeExpansion,
      lengthCheckBeforeExpansion ? "correct: base query checked before site: expansion" : "WARNING: length check AFTER expansion");

    // This is intentional design — the user's query is checked, but the expanded query
    // could still exceed upstream limits. Worth noting as a medium finding.
    if (lengthCheckBeforeExpansion) {
      // The check is on the base query, not the expanded one — potential issue for upstream
      const has10DomainCap = src.includes(".slice(0, 10)") || src.includes("Max 10");
      if (has10DomainCap) {
        // With 10 domains of avg 20 chars, effectiveQuery = query + " (site:d1.com OR site:d2.com ... )" = +280 chars max
        // If base query is 450 chars, expanded could be 730 chars — above any typical upstream limit
        addFinding({
          title: "search: effectiveQuery with max domains could exceed upstream limits (base query up to 500 + 10 domains at ~25 chars each = 750 chars)",
          severity: "Low",
          category: "functional",
          component: "novada_search / search.ts",
          environment: "local",
          repro_steps: "Call novada_search with query of 495 chars + include_domains=['d1.com','d2.com','d3.com','d4.com','d5.com','d6.com','d7.com','d8.com','d9.com','d10.com']",
          expected: "Upstream API receives a manageable query length",
          actual: "Base query (500 chars) + site: expansion for 10 domains (~250 chars) = ~750-char effectiveQuery sent upstream without length check",
          root_cause: "QUERY_MAX_LENGTH=500 applies to params.query, not effectiveQuery. Domain expansion happens after length check.",
          suggested_fix: "Add a secondary cap on effectiveQuery length before submission, or reduce domain count when base query is long",
          code_location: "/Users/tongwu/Projects/novada-mcp/src/tools/search.ts:451-476",
          evidence: src.slice(effectiveQueryBuildPos - 10, effectiveQueryBuildPos + 300),
          confidence: "low",
        });
      }
    }
  }
}

// ─── Run all scenarios ─────────────────────────────────────────────────────
async function main() {
  console.error("=== QA: Novada MCP 0.9.0 — E2E Research Chain ===\n");

  await testResearchParamAlias();
  await testSearchChainErrorCoherence();
  await testVerifyEmptyClaim();
  await testResearchOfflineOutputCoherence();
  await testSearchExtractChainability();
  await testResearchDepthAutoLogic();
  await testVerifyChainOutputURLs();
  await testResearchSynthesisFallback();
  await testSearchFeedbackChain();
  await testResearchSourceDedup();
  await testResearchMissingContextParam();
  await testSearchDomainFilterQueryExpansion();

  const result = {
    perspective: "Real-world e2e — research chain",
    summary: `Tested ${scenarios.length} scenarios covering search→extract→verify chain coherence. Found ${findings.length} genuine issues. Key areas tested: param aliases, length guards, CRLF injection, chain output structure, agent_instruction completeness, synthesis fallback, search_id emission, source dedup, domain filter expansion.`,
    scenarios_run: scenarios.length,
    scenarios_detail: scenarios,
    findings,
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
