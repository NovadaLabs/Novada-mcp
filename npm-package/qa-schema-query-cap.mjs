import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: "dummy" }),
});
const c = new Client({ name: "qa-schema", version: "0" }, { capabilities: {} });
await c.connect(t);

const tools = (await c.listTools()).tools;
const searchTool = tools.find(t => t.name === "novada_search");
const researchTool = tools.find(t => t.name === "novada_research");

const searchQueryProp = searchTool?.inputSchema?.properties?.query;
const researchQuestionProp = researchTool?.inputSchema?.properties?.question;

console.log("novada_search query schema:", JSON.stringify(searchQueryProp, null, 2));
console.log("novada_research question schema:", JSON.stringify(researchQuestionProp, null, 2));

// Check if maxLength is exposed in the schema
const searchHasMaxLength = searchQueryProp?.maxLength !== undefined;
const researchHasMaxLength = researchQuestionProp?.maxLength !== undefined;
console.log("search query has maxLength in schema:", searchHasMaxLength);
console.log("research question has maxLength in schema:", researchHasMaxLength);

await c.close();
