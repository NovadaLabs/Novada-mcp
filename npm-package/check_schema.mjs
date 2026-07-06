import { z } from '/Users/tongwu/Projects/novada-mcp/node_modules/zod/index.js';

const BrowserFlowParamsSchema = z.object({
  url: z.string().url("A valid URL is required").describe("The URL."),
  actions: z.array(z.object({
    type: z.enum(["click", "scroll", "wait", "type", "screenshot"]).describe("Action type."),
    selector: z.string().optional(),
    value: z.string().optional(),
    delay: z.number().int().min(0).max(30000).optional(),
  })).min(1).max(20),
  country: z.string().regex(/^[a-zA-Z]{0,2}$/).default(""),
  session_id: z.string().regex(/^[a-zA-Z0-9_\-\.]{0,64}$/).optional(),
});

const jsonSchema = BrowserFlowParamsSchema.toJSONSchema();
console.log('Required fields:', JSON.stringify(jsonSchema.required));
console.log('Country default:', jsonSchema.properties?.country?.default);
console.log('\n=== FULL ===');
console.log(JSON.stringify(jsonSchema, null, 2));
