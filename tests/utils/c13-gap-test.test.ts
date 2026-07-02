/**
 * C13 gap test: isDescriptionBoilerplate must reject markdown-link-fragment values
 * like "logic](/wiki/Description_logic "Description logic")" which contain the "]("
 * sequence characteristic of a markdown link fragment.
 *
 * The scenario: Wikipedia Category:Artificial_intelligence page —
 * the DESCRIPTION_PATTERNS[0] regex matches "description" inside hyperlink text in
 * prose body (e.g. "Description logic](..." or "...description is a field...](...)")
 * and returns it as the description field at conf 0.60 with a warning instead of
 * treating it as boilerplate and falling through to unresolved.
 */
import { describe, it, expect } from "vitest";
import { extractFields } from "../../src/utils/fields.js";

// Reproduce a markdown-link-fragment that contains "](" and was grabbed by
// DESCRIPTION_PATTERNS[0] because it matched "description" in the text.
// The pattern: /(?:description|summary)[:\s]+(.{10,300}?)(?:\n|$)/i
// captures the portion after "description" in a hyperlink like:
// "[Description logic](/wiki/Description_logic "Description logic")"
// → captured group: "logic](/wiki/Description_logic "Description logic")"
const WIKI_CATEGORY_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Category:Artificial intelligence - Wikipedia</title>
</head>
<body>
  <h1>Category:Artificial intelligence</h1>
  <p>Articles about <a href="/wiki/Artificial_intelligence">artificial intelligence</a>, including
  <a href="/wiki/Description_logic">Description logic</a> and related topics.</p>
  <div class="catlinks">
    <a href="/wiki/Category:Artificial_intelligence">Category:Artificial intelligence</a>
  </div>
</body>
</html>`;

// Markdown that mimics what turndown produces from a Wikipedia category page.
// The prose body contains "Description logic](" which triggers DESCRIPTION_PATTERNS[0]
// matching "description" and capturing the remainder of the link fragment.
const WIKI_CATEGORY_MARKDOWN = `# Category:Artificial intelligence

Articles about [artificial intelligence](/wiki/Artificial_intelligence), including [Description logic](/wiki/Description_logic "Description logic") and related topics.

## Subcategories

Category:AI applications
Category:Machine learning`;

describe("C13 — isDescriptionBoilerplate: reject markdown-link-fragment values", () => {
  it("markdown link fragment containing ]( must not be returned as description (fall through to unresolved)", () => {
    // No meta tags, no structured data — triggers pattern fallback
    const results = extractFields(["description"], null, WIKI_CATEGORY_MARKDOWN, WIKI_CATEGORY_HTML);
    const r = results[0];
    // The defect: without the fix, r.value would be something like
    // "logic](/wiki/Description_logic "Description logic") and related topics."
    // because DESCRIPTION_PATTERNS[0] captured the tail of the markdown link.
    // After the fix: the link fragment must be rejected → value must be null or a real sentence.
    if (r.value !== null) {
      // If something resolved, it must NOT contain "](" — no link fragments allowed
      expect(r.value).not.toContain("](");
      // And it must not start with bracket or be obviously a link fragment
      expect(r.value).not.toMatch(/^\[/);
    } else {
      // Preferred outcome: unresolved
      expect(r.source).toBe("unresolved");
    }
  });

  it("direct link-fragment value 'logic](/wiki/Description_logic)' is rejected as boilerplate", () => {
    // Minimal markdown where DESCRIPTION_PATTERNS[0] directly captures a link fragment
    const MD_WITH_LINK_FRAGMENT = `Description logic](/wiki/Description_logic "Description logic") is used in AI.`;
    const results = extractFields(["description"], null, MD_WITH_LINK_FRAGMENT);
    const r = results[0];
    // Must not return the link fragment
    if (r.value !== null) {
      expect(r.value).not.toContain("](");
    } else {
      expect(r.source).toBe("unresolved");
    }
  });
});
