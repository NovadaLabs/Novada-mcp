import { describe, it, expect } from "vitest";
import {
  scoreExtraction,
  qualityLabel,
  stripBoilerplate,
  hasSubstantiveContent,
} from "../../src/utils/html.js";

/**
 * NOV-565 — quality scorer split.
 *
 * Regression target: documentation pages with full text were being labelled
 * "poor" (cleanliness score < 40) purely because their markup is link-heavy or
 * sparsely structured, which then suppressed content_ok in extract.ts. The split
 * adds content_present (substantive prose detected on the CLEANED markdown) which
 * drives content_ok independently of the cleanliness score.
 *
 * These fixtures are CLEANED-markdown bodies (post extraction), mirroring what the
 * extract pipeline feeds scoreExtraction. The negative fixtures are the shapes that
 * MUST stay content_present:false (empty page, cookie wall, JS shell).
 */

/** Mirror of extract.ts content_ok for a static, non-JS-heavy page (the docs case). */
function contentOkFor(
  markdown: string,
  q: ReturnType<typeof scoreExtraction>,
  usedMode = "static",
  stillJsHeavy = false,
): boolean {
  return q.content_present && markdown.length > 100 && usedMode !== "render-failed" && !stillJsHeavy;
}

/**
 * Build a realistic docs-page markdown body: heading-anchor "permalink" empty
 * anchors, docs chrome ("Copy page", "On this page", "Was this page helpful?"),
 * and genuine prose paragraphs + code. This is the shape that historically scored
 * "poor" yet clearly has full content.
 */
function docsMarkdown(topic: string, paragraphs: number): string {
  const lines: string[] = [];
  lines.push("[​](#" + topic.toLowerCase().replace(/\s+/g, "-") + ")");
  lines.push(`# ${topic}`);
  lines.push("Copy page");
  lines.push("On this page");
  lines.push("");
  lines.push(
    `${topic} lets you configure and run the workflow end to end. This guide walks ` +
      `through installation, authentication, the core request lifecycle, and the most ` +
      `common failure modes you will encounter in production environments.`,
  );
  lines.push("");
  lines.push("[​](#getting-started)");
  lines.push("## Getting started");
  lines.push(
    `Install the package from the registry and import the client. The client reads ` +
      `credentials from the environment and exposes a single typed entry point. Most ` +
      `applications only need the default configuration to get going.`,
  );
  lines.push("```bash");
  lines.push(`npm install ${topic.toLowerCase().replace(/\s+/g, "-")}`);
  lines.push("```");
  lines.push("");
  for (let i = 0; i < paragraphs; i++) {
    lines.push(`[​](#section-${i})`);
    lines.push(`### Section ${i + 1}`);
    lines.push(
      `Section ${i + 1} explains a specific capability in detail. It covers the ` +
        `parameters you can pass, the shape of the response, and how errors are ` +
        `surfaced to the caller so that downstream code can react appropriately. ` +
        `See the [reference](https://docs.example.com/ref/${i}) and the ` +
        `[examples](https://docs.example.com/examples/${i}) for more.`,
    );
    lines.push("");
  }
  lines.push("Was this page helpful?");
  return lines.join("\n");
}

const DOCS_TOPICS = [
  "Quickstart Guide",
  "Authentication",
  "Rate Limits",
  "Webhooks",
  "Pagination",
  "Error Handling",
  "SDK Reference",
  "Streaming Responses",
  "Batch Processing",
  "Deployment",
];

describe("NOV-565 stripBoilerplate", () => {
  it("removes empty / zero-width anchor links regardless of target", () => {
    const md = "[​](#heading)\n[](#section)\n[ ](https://x.example/a)\nReal text here.";
    const out = stripBoilerplate(md);
    expect(out).not.toContain("](#heading)");
    expect(out).not.toContain("](#section)");
    expect(out).not.toContain("https://x.example/a");
    expect(out).toContain("Real text here.");
  });

  it("removes known docs boilerplate phrases", () => {
    const md = "Copy page\n# Title\nOn this page\nReal content body.\nWas this page helpful?\nBuilding an AI startup?";
    const out = stripBoilerplate(md);
    expect(out).not.toMatch(/Copy page/);
    expect(out).not.toMatch(/On this page/);
    expect(out).not.toMatch(/Was this page helpful\?/);
    expect(out).not.toMatch(/Building an AI startup\?/);
    expect(out).toContain("Real content body.");
    expect(out).toContain("# Title");
  });

  it("keeps real link text intact", () => {
    const md = "See the [API reference](https://docs.example.com/ref) for details.";
    const out = stripBoilerplate(md);
    expect(out).toContain("[API reference](https://docs.example.com/ref)");
  });

  it("returns empty string for empty input", () => {
    expect(stripBoilerplate("")).toBe("");
  });
});

describe("NOV-565 hasSubstantiveContent", () => {
  it("true for prose >= 200 chars and >= 50 words", () => {
    const prose = "word ".repeat(60).trim() + " and some more padding text to clear two hundred characters comfortably here.";
    expect(prose.length).toBeGreaterThanOrEqual(200);
    expect(hasSubstantiveContent(prose)).toBe(true);
  });

  it("false for short text", () => {
    expect(hasSubstantiveContent("Just a moment...")).toBe(false);
  });

  it("false for long-but-few-words (e.g. one giant token)", () => {
    expect(hasSubstantiveContent("x".repeat(500))).toBe(false);
  });

  it("false for empty input", () => {
    expect(hasSubstantiveContent("")).toBe(false);
  });
});

describe("NOV-565 docs fixtures → content_present + content_ok, never 'poor'", () => {
  for (const topic of DOCS_TOPICS) {
    it(`"${topic}" docs page reads as substantive content`, () => {
      const md = docsMarkdown(topic, 6);
      // No JSON-LD on these docs pages — content_present must hold on its own.
      const q = scoreExtraction("<html><body>...</body></html>", md, "static", false);

      expect(q.content_present).toBe(true);
      expect(contentOkFor(md, q)).toBe(true);
      expect(qualityLabel(q.score)).not.toBe("poor");
      expect(qualityLabel(q.score)).not.toBe("low");
      // Presence floor guarantees at least "moderate".
      expect(q.score).toBeGreaterThanOrEqual(40);
      // Reasons must explain the decision to the agent.
      expect(q.quality_reasons.some(r => r.startsWith("content_present:true"))).toBe(true);
    });
  }

  it("applies the +15 substantive_prose signal when content + headings present", () => {
    const md = docsMarkdown("Substantive", 4);
    const q = scoreExtraction("<html></html>", md, "static", false);
    expect(q.signals).toContain("substantive_prose:+15");
  });

  it("link-heavy docs page is not dragged below 'moderate' by link density", () => {
    // Many links, real prose — exactly the false-negative case from NOV-565.
    const lines: string[] = ["[​](#top)", "## Overview"];
    const body =
      "This integration guide documents every endpoint exposed by the service and the " +
      "exact payloads each one expects. Read it top to bottom before wiring anything up.";
    lines.push(body);
    for (let i = 0; i < 40; i++) lines.push(`- [Endpoint ${i}](https://docs.example.com/e/${i})`);
    const md = lines.join("\n");
    const q = scoreExtraction("<html></html>", md, "static", false);
    expect(q.content_present).toBe(true);
    expect(q.score).toBeGreaterThanOrEqual(40);
    expect(qualityLabel(q.score)).not.toBe("poor");
  });
});

describe("NOV-565 negatives → content_present:false + content_ok:false", () => {
  it("empty page", () => {
    const q = scoreExtraction("<html><body></body></html>", "", "static", false);
    expect(q.content_present).toBe(false);
    expect(contentOkFor("", q)).toBe(false);
    expect(q.score).toBeLessThan(40); // presence floor must NOT fire
  });

  it("cookie-consent wall (boilerplate only, no real content)", () => {
    const md = [
      "# We value your privacy",
      "We use cookies to enhance your browsing experience.",
      "Accept all",
      "Reject all",
      "Manage preferences",
    ].join("\n");
    const q = scoreExtraction("<html></html>", md, "static", false);
    expect(q.content_present).toBe(false);
    expect(contentOkFor(md, q)).toBe(false);
  });

  it("JS shell (app mount point, no rendered content)", () => {
    const shellHtml = '<html><body><div id="root"></div><script src="/app.js"></script></body></html>';
    // Extraction of a JS shell yields effectively-empty markdown.
    const md = "";
    const q = scoreExtraction(shellHtml, md, "static", false);
    expect(q.content_present).toBe(false);
    // Even if a consumer somehow passed mainContent>100, stillJsHeavy=true keeps content_ok false.
    expect(contentOkFor("x".repeat(200), q, "static", true)).toBe(false);
  });

  it("bot-challenge page stays content_present:false (no presence floor)", () => {
    const md = "Checking your browser before allowing you access.";
    const q = scoreExtraction("<html></html>", md, "static", false);
    expect(q.content_present).toBe(false);
    expect(q.score).toBeLessThanOrEqual(40);
  });
});

describe("NOV-565 back-compat", () => {
  it("score === cleanliness_score", () => {
    const md = docsMarkdown("Compat", 5);
    const q = scoreExtraction("<html></html>", md, "static", false);
    expect(q.score).toBe(q.cleanliness_score);
  });

  it("still returns a signals array", () => {
    const q = scoreExtraction("<html></html>", docsMarkdown("Signals", 3), "static", false);
    expect(Array.isArray(q.signals)).toBe(true);
    expect(q.signals.length).toBeGreaterThan(0);
  });
});
