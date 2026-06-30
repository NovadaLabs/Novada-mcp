# Test 11: BBC Sport Football Crawl

## Test Command
```bash
cd ~/Projects/novada-mcp
NOVADA_API_KEY=<key> node << 'EOF'
const { novadaCrawl } = await import('./build/tools/crawl.js');
const r = await novadaCrawl({
  url: 'https://www.bbc.com/sport/football',
  max_pages: 3,
  strategy: 'bfs',
  format: 'markdown',
  render: 'auto'
}, process.env.NOVADA_API_KEY);
EOF
```

## Results

| Metric | Value |
|--------|-------|
| Latency | 1049ms |
| Output size | 10731 chars |
| Pages crawled | 3 |
| Total words | 1252 |
| Failed pages | 0 |
| JS pages missing render | 0 |
| France mentioned | YES |
| Norway mentioned | YES |

## Pages Crawled (BFS order)

1. `https://www.bbc.com/sport/football` (depth 0, 254 words) -- root page
2. `https://www.bbc.com` (depth 1, 504 words) -- BBC homepage
3. `https://www.bbc.com/news` (depth 1, 494 words) -- BBC News

## Content Quality

The football root page extracted current headlines including:
- Rice back in England training but James misses out again
- Why has Trump stayed away from the World Cup?
- Is an outsider right about reasons for Scottish football's ills?
- Rainbow flags await Egypt and Iran at awkward Pride Match
- Arsenal explore moves for Newcastle's Guimaraes & Tonali

The BBC homepage included World Cup content:
- "Mbappe v Haaland: Who is more important for their country?" -- France vs Norway reference (both keywords found)
- "Why are World Cup underdogs doing so well?"
- "US interested in hosting 2038 World Cup"
- "Has VAR become a lottery at the World Cup?"

## Agent Hints Output
- Chainable output includes `root_url` and `crawled_pages` list
- `agent_instruction` suggests using `novada_extract` for specific pages or `novada_map` for more discovery
- `agent_memory` line for recall integration

## Observations

1. BFS crawl followed links from the football page to BBC homepage and BBC News (depth 1) rather than staying within /sport/football/ subtree. This is expected BFS behavior without `select_paths` filtering.
2. Content injection guardrails present: `<!-- BEGIN EXTERNAL CONTENT -- untrusted source -->` wrappers on all crawled content.
3. Fast response (1049ms for 3 pages) suggests static extraction path was used (no JS render escalation needed).
4. Both "France" and "Norway" keywords confirmed present via BBC homepage World Cup coverage (Mbappe vs Haaland article).

## Verdict: PASS
