import { describe, it, expect } from "vitest";
import { listPrompts, getPrompt, PROMPTS } from "../../src/prompts/index.js";

describe("PROMPTS array", () => {
  it("contains all 5 prompts", () => {
    expect(PROMPTS).toHaveLength(5);
  });

  it("has correct names", () => {
    const names = PROMPTS.map((p) => p.name);
    expect(names).toContain("research_topic");
    expect(names).toContain("extract_and_summarize");
    expect(names).toContain("site_audit");
    expect(names).toContain("scrape_platform_data");
    expect(names).toContain("browser_stateful_workflow");
  });
});

describe("listPrompts()", () => {
  it("returns all 5 prompts", () => {
    const result = listPrompts();
    expect(result.prompts).toHaveLength(5);
  });

  it("includes research_topic with description", () => {
    const { prompts } = listPrompts();
    const p = prompts.find((x) => x.name === "research_topic");
    expect(p).toBeDefined();
    expect(p!.description).toContain("research");
  });

  it("includes extract_and_summarize with description", () => {
    const { prompts } = listPrompts();
    const p = prompts.find((x) => x.name === "extract_and_summarize");
    expect(p).toBeDefined();
    expect(p!.description).toContain("Extract");
  });

  it("includes site_audit with description", () => {
    const { prompts } = listPrompts();
    const p = prompts.find((x) => x.name === "site_audit");
    expect(p).toBeDefined();
    expect(p!.description).toContain("website");
  });

  it("includes scrape_platform_data with description", () => {
    const { prompts } = listPrompts();
    const p = prompts.find((x) => x.name === "scrape_platform_data");
    expect(p).toBeDefined();
    expect(p!.description).toContain("Scraper");
  });

  it("includes browser_stateful_workflow with description", () => {
    const { prompts } = listPrompts();
    const p = prompts.find((x) => x.name === "browser_stateful_workflow");
    expect(p).toBeDefined();
    expect(p!.description).toContain("session");
  });
});

describe("getPrompt() — research_topic", () => {
  it("returns a user message containing the topic", () => {
    const result = getPrompt("research_topic", { topic: "quantum computing" });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content.type).toBe("text");
    expect(result.messages[0].content.text).toContain("quantum computing");
  });

  it("description contains the topic", () => {
    const result = getPrompt("research_topic", { topic: "machine learning" });
    expect(result.description).toContain("machine learning");
  });

  it("includes country when provided", () => {
    const result = getPrompt("research_topic", { topic: "finance", country: "de" });
    expect(result.messages[0].content.text).toContain("de");
  });

  it("does not include country line when omitted", () => {
    const result = getPrompt("research_topic", { topic: "science" });
    expect(result.messages[0].content.text).not.toContain("Focus on information relevant");
  });

  it("includes focus when provided", () => {
    const result = getPrompt("research_topic", { topic: "AI", focus: "market trends" });
    expect(result.messages[0].content.text).toContain("market trends");
  });

  it("does not include focus line when omitted", () => {
    const result = getPrompt("research_topic", { topic: "AI" });
    expect(result.messages[0].content.text).not.toContain("Specifically focus on");
  });

  it("recommends novada_research and novada_extract in workflow", () => {
    const result = getPrompt("research_topic", { topic: "test" });
    const text = result.messages[0].content.text;
    expect(text).toContain("novada_research");
    expect(text).toContain("novada_extract");
  });
});

describe("getPrompt() — extract_and_summarize", () => {
  it("handles a single URL — no 'array' mention", () => {
    const result = getPrompt("extract_and_summarize", { urls: "https://example.com" });
    const text = result.messages[0].content.text;
    expect(text).toContain("https://example.com");
    expect(text).not.toContain("array");
  });

  it("handles multiple URLs — mentions 'array' for batch extraction", () => {
    const result = getPrompt("extract_and_summarize", {
      urls: "https://a.com, https://b.com",
    });
    const text = result.messages[0].content.text;
    expect(text).toContain("https://a.com");
    expect(text).toContain("https://b.com");
    expect(text).toContain("array");
  });

  it("includes focus when provided", () => {
    const result = getPrompt("extract_and_summarize", {
      urls: "https://example.com",
      focus: "pricing information",
    });
    expect(result.messages[0].content.text).toContain("pricing information");
  });

  it("does not mention focus when omitted", () => {
    const result = getPrompt("extract_and_summarize", { urls: "https://example.com" });
    expect(result.messages[0].content.text).not.toContain("Focus specifically on");
  });

  it("description truncates long URL lists", () => {
    const longUrls = "https://example.com/very/long/path/that/exceeds/sixty/characters/easily";
    const result = getPrompt("extract_and_summarize", { urls: longUrls });
    expect(result.description).toContain("...");
  });

  it("description does not truncate short URL", () => {
    const result = getPrompt("extract_and_summarize", { urls: "https://short.com" });
    expect(result.description).not.toContain("...");
  });
});

describe("getPrompt() — site_audit", () => {
  it("includes the URL in the message", () => {
    const result = getPrompt("site_audit", { url: "https://example.com" });
    const text = result.messages[0].content.text;
    expect(text).toContain("https://example.com");
  });

  it("description contains the URL", () => {
    const result = getPrompt("site_audit", { url: "https://example.com" });
    expect(result.description).toContain("https://example.com");
  });

  it("mentions sections when provided", () => {
    const result = getPrompt("site_audit", { url: "https://example.com", sections: "pricing, docs" });
    const text = result.messages[0].content.text;
    expect(text).toContain("pricing, docs");
  });

  it("mentions 'top 3-5' when no sections provided", () => {
    const result = getPrompt("site_audit", { url: "https://example.com" });
    const text = result.messages[0].content.text;
    expect(text).toContain("top 3-5");
  });

  it("includes novada_map in recommended workflow", () => {
    const result = getPrompt("site_audit", { url: "https://example.com" });
    expect(result.messages[0].content.text).toContain("novada_map");
  });
});

describe("getPrompt() — scrape_platform_data", () => {
  it("includes platform and data_type in message", () => {
    const result = getPrompt("scrape_platform_data", {
      platform: "amazon.com",
      data_type: "product listings",
      query: "laptop",
    });
    const text = result.messages[0].content.text;
    expect(text).toContain("amazon.com");
    expect(text).toContain("product listings");
  });

  it("references novada://scraper-platforms resource", () => {
    const result = getPrompt("scrape_platform_data", {
      platform: "reddit.com",
      data_type: "user posts",
      query: "AI",
    });
    expect(result.messages[0].content.text).toContain("novada://scraper-platforms");
  });

  it("includes the query in the message", () => {
    const result = getPrompt("scrape_platform_data", {
      platform: "amazon.com",
      data_type: "reviews",
      query: "wireless headphones",
    });
    expect(result.messages[0].content.text).toContain("wireless headphones");
  });

  it("description contains platform and data_type", () => {
    const result = getPrompt("scrape_platform_data", {
      platform: "linkedin.com",
      data_type: "job listings",
      query: "engineer",
    });
    expect(result.description).toContain("linkedin.com");
    expect(result.description).toContain("job listings");
  });

  it("mentions novada_scrape in message", () => {
    const result = getPrompt("scrape_platform_data", {
      platform: "amazon.com",
      data_type: "reviews",
      query: "test",
    });
    expect(result.messages[0].content.text).toContain("novada_scrape");
  });
});

describe("getPrompt() — browser_stateful_workflow", () => {
  it("shows 'new session' language when no session_id", () => {
    const result = getPrompt("browser_stateful_workflow", {
      url: "https://example.com",
      workflow: "log in and download report",
    });
    const text = result.messages[0].content.text;
    expect(text).toContain("new browser session");
  });

  it("shows reuse message when session_id is provided", () => {
    const result = getPrompt("browser_stateful_workflow", {
      url: "https://example.com",
      workflow: "continue pagination",
      session_id: "sess_abc123",
    });
    const text = result.messages[0].content.text;
    expect(text).toContain("sess_abc123");
    expect(text).toContain("maintain state");
  });

  it("shows new session language when session_id is empty string", () => {
    const result = getPrompt("browser_stateful_workflow", {
      url: "https://example.com",
      workflow: "fill form",
      session_id: "",
    });
    expect(result.messages[0].content.text).toContain("new browser session");
  });

  it("shows new session language when session_id is whitespace", () => {
    const result = getPrompt("browser_stateful_workflow", {
      url: "https://example.com",
      workflow: "navigate",
      session_id: "   ",
    });
    expect(result.messages[0].content.text).toContain("new browser session");
  });

  it("includes URL and workflow in message", () => {
    const result = getPrompt("browser_stateful_workflow", {
      url: "https://dashboard.example.com",
      workflow: "export data",
    });
    const text = result.messages[0].content.text;
    expect(text).toContain("https://dashboard.example.com");
    expect(text).toContain("export data");
  });

  it("description truncates long workflow", () => {
    const longWorkflow = "log in, navigate to settings, click on billing, download the invoice PDF and save it locally";
    const result = getPrompt("browser_stateful_workflow", {
      url: "https://example.com",
      workflow: longWorkflow,
    });
    expect(result.description).toContain("...");
  });
});

describe("getPrompt() — unknown prompt", () => {
  it("throws an error for an unknown prompt name", () => {
    expect(() => getPrompt("nonexistent_prompt", {})).toThrow("Unknown prompt");
    expect(() => getPrompt("nonexistent_prompt", {})).toThrow("nonexistent_prompt");
  });
});
