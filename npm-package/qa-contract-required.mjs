/**
 * Test: various required field contract issues
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY })
});
const c = new Client({ name: "qa-required", version: "0" }, { capabilities: {} });
await c.connect(t);

// Check all tools' required fields vs their properties' defaults
const toolsResult = await c.listTools();
const tools = toolsResult.tools;

const contractMismatches = [];

for (const tool of tools) {
  const schema = tool.inputSchema;
  if (!schema?.properties || !schema?.required) continue;

  const props = schema.properties;
  const required = schema.required;

  for (const field of required) {
    const propSchema = props[field];
    if (propSchema && "default" in propSchema) {
      contractMismatches.push({
        tool: tool.name,
        field,
        issue: "in_required_but_has_default",
        default: propSchema.default,
        note: "Schema claims required but has a default — inconsistent contract"
      });
    }
  }
}

console.log("Top-level required+default mismatches:", JSON.stringify(contractMismatches, null, 2));

// Now check nested schemas in oneOf/anyOf for same issue
const nestedMismatches = [];

function checkNestedSchema(schema, path) {
  if (!schema || typeof schema !== "object") return;

  const props = schema.properties;
  const required = schema.required;

  if (props && Array.isArray(required)) {
    for (const field of required) {
      const propSchema = props[field];
      if (propSchema && "default" in propSchema) {
        nestedMismatches.push({
          path,
          field,
          issue: "nested_required_has_default",
          default: propSchema.default
        });
      }
    }
  }

  // Check oneOf/anyOf/allOf
  for (const keyword of ["oneOf", "anyOf", "allOf"]) {
    if (Array.isArray(schema[keyword])) {
      for (let i = 0; i < schema[keyword].length; i++) {
        checkNestedSchema(schema[keyword][i], `${path}.${keyword}[${i}]`);
      }
    }
  }

  // Check properties
  if (props) {
    for (const [key, propSchema] of Object.entries(props)) {
      checkNestedSchema(propSchema, `${path}.${key}`);
    }
  }

  // Check items
  if (schema.items) {
    checkNestedSchema(schema.items, `${path}.items`);
  }
}

for (const tool of tools) {
  checkNestedSchema(tool.inputSchema, tool.name);
}

console.log("Nested required+default mismatches:", JSON.stringify(nestedMismatches, null, 2));

// Test 1: novada_proxy with no arguments (all fields have defaults)
try {
  const r1 = await c.callTool({ name: "novada_proxy", arguments: {} });
  console.log("\nnovada_proxy empty args:", JSON.stringify(r1).slice(0, 200));
} catch (e) {
  console.log("\nnovada_proxy empty args threw:", e.message);
}

// Test 2: novada_search with only required 'query' field (minimal call)
try {
  const r2 = await c.callTool({ name: "novada_search", arguments: { query: "test" } });
  console.log("\nnovada_search minimal:", JSON.stringify(r2).slice(0, 200));
} catch (e) {
  console.log("\nnovada_search minimal threw:", e.message);
}

// Test 3: novada_extract without url (required field omitted)
try {
  const r3 = await c.callTool({ name: "novada_extract", arguments: { format: "markdown", render: "auto" } });
  console.log("\nnovada_extract no url:", JSON.stringify(r3).slice(0, 200));
} catch (e) {
  console.log("\nnovada_extract no url threw:", e.message);
}

// Test 4: novada_scrape without operation (required field omitted)
try {
  const r4 = await c.callTool({ name: "novada_scrape", arguments: { platform: "amazon.com" } });
  console.log("\nnovada_scrape no operation:", JSON.stringify(r4).slice(0, 200));
} catch (e) {
  console.log("\nnovada_scrape no operation threw:", e.message);
}

await c.close();
