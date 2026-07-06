/**
 * QA Client - MCP CONTRACT Testing for novada-mcp 0.9.0
 * Perspective: tools/list + prompts + resources JSON-Schema validity
 * Author: qa-contract
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy"; // offline checks

async function makeClient() {
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY })
  });
  const c = new Client({ name: "qa-contract", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { client: c, transport: t };
}

async function run() {
  const { client } = await makeClient();
  const output = {};

  // ===== 1. tools/list - get all tools =====
  const toolsResult = await client.listTools();
  const tools = toolsResult.tools || [];
  output.toolCount = tools.length;
  output.nextCursor = toolsResult.nextCursor ?? null;
  output.toolNames = tools.map(t => t.name);

  // ===== 2. Validate each tool's inputSchema is valid JSON Schema =====
  const schemaIssues = [];

  for (const tool of tools) {
    const issues = [];

    // MCP spec: tool.name must be non-empty string
    if (typeof tool.name !== "string" || tool.name.length === 0) {
      issues.push("name_missing_or_empty");
    }
    // MCP spec: description should be string
    if (tool.description !== undefined && typeof tool.description !== "string") {
      issues.push("description_not_string:" + typeof tool.description);
    }
    // MCP spec: inputSchema must be object
    if (!tool.inputSchema || typeof tool.inputSchema !== "object") {
      issues.push("inputSchema_missing_or_not_object");
    } else {
      const s = tool.inputSchema;

      // JSON Schema for MCP: root must be type:object
      if (s.type !== "object") {
        issues.push("inputSchema_type_not_object:" + s.type);
      }

      // additionalProperties must be boolean or object (not string/number)
      if (s.additionalProperties !== undefined) {
        if (typeof s.additionalProperties !== "boolean" && typeof s.additionalProperties !== "object") {
          issues.push("additionalProperties_invalid_type:" + typeof s.additionalProperties);
        }
      }

      // $schema must start with http if present
      if (s.$schema && !s.$schema.startsWith("http")) {
        issues.push("schema_ref_invalid:" + s.$schema);
      }

      // properties must be an object if present
      if (s.properties !== undefined && (typeof s.properties !== "object" || Array.isArray(s.properties))) {
        issues.push("properties_not_object");
      }

      // required must be array of strings if present
      if (s.required !== undefined) {
        if (!Array.isArray(s.required)) {
          issues.push("required_not_array");
        } else {
          for (const r of s.required) {
            if (typeof r !== "string") {
              issues.push("required_contains_non_string:" + typeof r);
            }
            // required items must exist in properties
            if (s.properties && !(r in s.properties)) {
              issues.push("required_field_not_in_properties:" + r);
            }
          }
        }
      }

      // Validate each property schema
      if (s.properties) {
        for (const [propName, propDef] of Object.entries(s.properties)) {
          if (typeof propDef !== "object" || propDef === null || Array.isArray(propDef)) {
            issues.push("property_not_schema_object:" + propName);
            continue;
          }
          // Property should have type or $ref or anyOf/oneOf/allOf/enum
          const hasTypeDecl = propDef.type || propDef.$ref || propDef.anyOf || propDef.oneOf || propDef.allOf || propDef.enum;
          if (!hasTypeDecl) {
            issues.push("property_missing_type_decl:" + propName);
          }
          // Check for enum being an array if present
          if (propDef.enum !== undefined && !Array.isArray(propDef.enum)) {
            issues.push("property_enum_not_array:" + propName);
          }
          // Check for default type matching declared type
          if (propDef.default !== undefined && propDef.type) {
            const defaultType = Array.isArray(propDef.default) ? "array" : typeof propDef.default;
            const declaredType = Array.isArray(propDef.type) ? propDef.type : [propDef.type];
            // Rough type check (JSON Schema allows flexible defaults but flagging mismatches)
            if (!declaredType.includes(defaultType) && !declaredType.includes("null")) {
              // Only flag clear mismatches (string default for number type etc)
              if ((propDef.type === "integer" || propDef.type === "number") && typeof propDef.default === "string") {
                issues.push("property_default_type_mismatch:" + propName + " declared=" + propDef.type + " default=" + typeof propDef.default);
              }
              if (propDef.type === "boolean" && typeof propDef.default === "string") {
                issues.push("property_default_type_mismatch:" + propName + " declared=boolean default=string");
              }
            }
          }
          // Check numeric constraints are numbers
          if (propDef.minimum !== undefined && typeof propDef.minimum !== "number") {
            issues.push("property_minimum_not_number:" + propName);
          }
          if (propDef.maximum !== undefined && typeof propDef.maximum !== "number") {
            issues.push("property_maximum_not_number:" + propName);
          }
          // Check exclusiveMinimum/exclusiveMaximum (JSON Schema draft 4 style: boolean; draft 7+: number)
          // Just verify it's there for flags
          if (propDef.minLength !== undefined && typeof propDef.minLength !== "number") {
            issues.push("property_minLength_not_number:" + propName);
          }
          // items for arrays must be object if present
          if (propDef.type === "array" && propDef.items !== undefined) {
            if (typeof propDef.items !== "object" || propDef.items === null) {
              issues.push("property_items_not_object:" + propName);
            }
          }
        }
      }
    }

    if (issues.length > 0) {
      schemaIssues.push({ tool: tool.name, issues });
    }
  }

  output.schemaIssues = schemaIssues;

  // ===== 3. prompts/list =====
  let promptsResult;
  let promptsError = null;
  try {
    promptsResult = await client.listPrompts();
    output.promptCount = promptsResult.prompts?.length ?? 0;
    output.prompts = promptsResult.prompts;
    // Validate prompts
    const promptIssues = [];
    for (const p of (promptsResult.prompts || [])) {
      if (typeof p.name !== "string" || p.name.length === 0) {
        promptIssues.push({ prompt: JSON.stringify(p).slice(0,100), issue: "name_missing" });
      }
      if (p.arguments !== undefined && !Array.isArray(p.arguments)) {
        promptIssues.push({ prompt: p.name, issue: "arguments_not_array" });
      }
      if (Array.isArray(p.arguments)) {
        for (const arg of p.arguments) {
          if (typeof arg.name !== "string") {
            promptIssues.push({ prompt: p.name, issue: "argument_name_not_string" });
          }
        }
      }
    }
    output.promptIssues = promptIssues;
  } catch (e) {
    promptsError = { code: e.code, message: e.message };
    output.promptsError = promptsError;
    output.promptCount = 0;
  }

  // ===== 4. resources/list =====
  let resourcesError = null;
  try {
    const resourcesResult = await client.listResources();
    output.resourceCount = resourcesResult.resources?.length ?? 0;
    output.resources = resourcesResult.resources;
    // Validate resources
    const resourceIssues = [];
    for (const r of (resourcesResult.resources || [])) {
      if (typeof r.uri !== "string" || r.uri.length === 0) {
        resourceIssues.push({ resource: JSON.stringify(r).slice(0,100), issue: "uri_missing" });
      }
      if (typeof r.name !== "string" || r.name.length === 0) {
        resourceIssues.push({ resource: r.uri, issue: "name_missing" });
      }
      if (r.mimeType !== undefined && typeof r.mimeType !== "string") {
        resourceIssues.push({ resource: r.uri, issue: "mimeType_not_string" });
      }
    }
    output.resourceIssues = resourceIssues;
  } catch (e) {
    resourcesError = { code: e.code, message: e.message };
    output.resourcesError = resourcesError;
    output.resourceCount = 0;
  }

  // ===== 5. Pagination - bad cursor =====
  try {
    const paginatedResult = await client.listTools({ cursor: "INVALID_CURSOR_XYZ" });
    output.paginationWithBadCursor = {
      toolCount: paginatedResult.tools?.length,
      errorOrFallback: "returned_result_not_error"
    };
  } catch (e) {
    output.paginationWithBadCursor = { code: e.code, message: e.message };
  }

  // ===== 6. Duplicate tool name check =====
  const namesSeen = new Set();
  const duplicates = [];
  for (const t of tools) {
    if (namesSeen.has(t.name)) duplicates.push(t.name);
    namesSeen.add(t.name);
  }
  output.duplicateToolNames = duplicates;

  // ===== 7. Check $schema version declaration on each inputSchema =====
  const schemaVersions = {};
  for (const t of tools) {
    if (t.inputSchema?.$schema) {
      schemaVersions[t.name] = t.inputSchema.$schema;
    }
  }
  output.toolsWithSchemaVersion = Object.keys(schemaVersions).length;
  output.sampleSchemaVersions = Object.entries(schemaVersions).slice(0, 3);

  // ===== 8. Spot-check specific critical tools =====
  const criticalTools = ["novada_search", "novada_extract", "novada_crawl", "novada_browser", "novada_scrape", "novada_proxy"];
  const criticalToolSchemas = {};
  for (const name of criticalTools) {
    const tool = tools.find(t => t.name === name);
    if (tool) {
      criticalToolSchemas[name] = tool.inputSchema;
    } else {
      criticalToolSchemas[name] = "NOT_FOUND";
    }
  }
  output.criticalToolSchemas = criticalToolSchemas;

  // ===== 9. Check for tools with no properties but claims required =====
  const noPropsButRequired = [];
  for (const t of tools) {
    const s = t.inputSchema;
    if (s && s.required && s.required.length > 0 && (!s.properties || Object.keys(s.properties).length === 0)) {
      noPropsButRequired.push({ tool: t.name, required: s.required });
    }
  }
  output.noPropsButRequired = noPropsButRequired;

  // ===== 10. Check for anyOf containing non-objects =====
  const anyOfIssues = [];
  function checkAnyOf(schema, path) {
    if (!schema || typeof schema !== "object") return;
    if (schema.anyOf) {
      for (const s of schema.anyOf) {
        if (typeof s !== "object" || s === null) {
          anyOfIssues.push({ path, issue: "anyOf_contains_non_object", value: s });
        }
      }
    }
    if (schema.properties) {
      for (const [k, v] of Object.entries(schema.properties)) {
        checkAnyOf(v, path + "." + k);
      }
    }
  }
  for (const t of tools) {
    checkAnyOf(t.inputSchema, t.name);
  }
  output.anyOfIssues = anyOfIssues;

  await client.close();
  return output;
}

run().then(output => {
  console.log(JSON.stringify(output, null, 2));
}).catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
