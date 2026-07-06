import { z } from '/Users/tongwu/Projects/novada-mcp/node_modules/zod/index.js';

const BrowserFlowParamsSchema = z.object({
  url: z.string().url("A valid URL is required").describe("The URL."),
  actions: z.array(z.object({
    type: z.enum(["click", "scroll", "wait", "type", "screenshot"]),
  })).min(1).max(20),
  country: z.string().regex(/^[a-zA-Z]{0,2}$/).default(""),
  session_id: z.string().regex(/^[a-zA-Z0-9_\-\.]{0,64}$/).optional(),
});

// Test: parse WITHOUT country - does the default kick in?
const result1 = BrowserFlowParamsSchema.safeParse({
  url: 'https://example.com',
  actions: [{ type: 'screenshot' }],
  // country not provided
});
console.log('Parse WITHOUT country:');
console.log('  success:', result1.success);
console.log('  data:', result1.data);

// Test: parse WITH country=''
const result2 = BrowserFlowParamsSchema.safeParse({
  url: 'https://example.com',
  actions: [{ type: 'screenshot' }],
  country: '',
});
console.log('\nParse WITH country="":');
console.log('  success:', result2.success);
console.log('  data:', result2.data);

// What JSON schema says is required vs what Zod actually requires
const jsonSchema = BrowserFlowParamsSchema.toJSONSchema();
console.log('\nJSON schema required[]:', jsonSchema.required);
console.log('JSON schema country.default:', JSON.stringify(jsonSchema.properties.country.default));
// country is in required[] BUT has a default - this is contradictory
// MCP clients/LLMs seeing this schema will think country is mandatory
// but it has a server-side default of ""
