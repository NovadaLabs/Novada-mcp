#!/bin/bash
# Sync novada-mcp build → novada-mcpserver vendor → Vercel deploy
# Run after every npm publish or significant code change
#
# Usage: ./scripts/sync-to-hosted.sh

set -e

MCP_DIR="$HOME/Projects/novada-mcp"
SERVER_DIR="$HOME/Projects/novada-mcpserver"

echo "═══ Novada MCP → Hosted Server Sync ═══"

# Step 1: Build
echo "→ Building novada-mcp..."
cd "$MCP_DIR"
npm run build 2>&1 | tail -1
MCP_VERSION=$(node -e "console.log(require('./package.json').version)")
echo "  Version: $MCP_VERSION"

# Step 2: Sync vendor
echo "→ Syncing vendor..."
rm -rf "$SERVER_DIR/vercel/vendor/novada-mcp"
mkdir -p "$SERVER_DIR/vercel/vendor/novada-mcp"
cp -r "$MCP_DIR/build/"* "$SERVER_DIR/vercel/vendor/novada-mcp/"
cp "$MCP_DIR/package.json" "$SERVER_DIR/vercel/vendor/novada-mcp/"

VENDOR_VERSION=$(node -e "console.log(require('$SERVER_DIR/vercel/vendor/novada-mcp/package.json').version)")
echo "  Vendor: $VENDOR_VERSION"

# Step 3: Verify match
if [ "$MCP_VERSION" != "$VENDOR_VERSION" ]; then
  echo "❌ VERSION MISMATCH: mcp=$MCP_VERSION vendor=$VENDOR_VERSION"
  exit 1
fi

# Step 4: Commit + push
echo "→ Committing..."
cd "$SERVER_DIR"
git add vercel/vendor/novada-mcp/
CHANGED=$(git diff --cached --stat | tail -1)
if [ -z "$CHANGED" ]; then
  echo "  No changes — already in sync"
else
  git commit -m "sync: vendor novada-mcp v$MCP_VERSION"
  git push origin main
  echo "  Pushed: $CHANGED"
fi

# Step 5: Deploy to Vercel
echo "→ Deploying to Vercel..."
cd "$SERVER_DIR"
npx vercel deploy --prod 2>&1 | grep -E "Ready|message|url" | head -3
echo ""
echo "✅ Sync complete: novada-mcp v$MCP_VERSION → mcp.novada.com"
