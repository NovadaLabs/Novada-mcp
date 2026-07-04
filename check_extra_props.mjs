import { z } from '/Users/tongwu/Projects/novada-mcp/node_modules/zod/index.js';

const schema = z.object({
  url: z.string().url(),
  actions: z.array(z.object({ type: z.string() })).min(1),
  country: z.string().default(""),
}).strict(); // strict() means no extra properties

const result = schema.safeParse({
  url: 'https://example.com',
  actions: [{ type: 'screenshot' }],
  country: '',
  unknownParam: 'hello',
});
console.log('strict() parse with extra param:', result.success, result.error?.message);

// Without strict()
const schema2 = z.object({
  url: z.string().url(),
  actions: z.array(z.object({ type: z.string() })).min(1),
  country: z.string().default(""),
}); // no strict

const result2 = schema2.safeParse({
  url: 'https://example.com',
  actions: [{ type: 'screenshot' }],
  country: '',
  unknownParam: 'hello',
});
console.log('non-strict parse with extra param:', result2.success);
console.log('data:', result2.data); // does it include unknownParam?
