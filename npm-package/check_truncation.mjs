// Reproduce the T12 truncation - long URL in error output
// Check if there's any truncation or if it's just terminal display
const hugeUrl = 'https://example.com/' + 'a'.repeat(2000);
const actions = [{ type: 'screenshot' }];
const sessionId = undefined;

const formatted = [
  `## Browser Flow — API Error`,
  `url: ${hugeUrl}`,
  `actions_requested: ${actions.length}${sessionId ? ` | session_id: ${sessionId}` : ""}`,
  ``,
  `Error: Missing required parameters.`,
  ``,
  `---`,
  `## Agent Hints`,
  `agent_instruction: The Browser Flow API returned an error.`,
].join("\n");

console.log('Total formatted length:', formatted.length, 'chars');
console.log('URL in output:', hugeUrl.length, 'chars');
console.log('First 200 chars of output:', formatted.slice(0, 200));
// This is NOT a defect - just terminal truncation in our probe output display
// The output does contain the full URL - confirmed by length
