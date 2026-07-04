/**
 * QA: Verify truncatePreservingTable edge cases
 * 1. .slice(0, maxChars) can still cut inside table when preserving prefix
 * 2. Test 2 anomaly: table at 30% mark should NOT be "preserved" but IS being preserved
 */
import "/Users/tongwu/Projects/novada-mcp/build/index.js"; // suppress server output
