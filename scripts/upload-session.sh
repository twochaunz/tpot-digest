#!/usr/bin/env bash
#
# Upload Twitter session cookies to your server.
#
# Usage:
#   ./scripts/upload-session.sh user@yourserver.com
#
set -euo pipefail

SERVER="${1:?Usage: upload-session.sh user@host}"
SSH_KEY="$HOME/wk_clawd"
SESSION_FILE="browser_state/twitter_session.json"
REMOTE_DIR="~/tpot-digest"

SSH_OPTS=()
SCP_OPTS=()
if [ -f "$SSH_KEY" ]; then
  SSH_OPTS+=(-i "$SSH_KEY")
  SCP_OPTS+=(-i "$SSH_KEY")
fi

if [ ! -f "$SESSION_FILE" ]; then
  echo "No session file found. Run the login script first:"
  echo "  python scripts/twitter-login.py"
  exit 1
fi

echo "Uploading session to $SERVER..."
ssh "${SSH_OPTS[@]}" "$SERVER" "mkdir -p $REMOTE_DIR/browser_state"
scp "${SCP_OPTS[@]}" "$SESSION_FILE" "$SERVER:$REMOTE_DIR/browser_state/twitter_session.json"

echo "Restarting backend to pick up new session..."
ssh "${SSH_OPTS[@]}" "$SERVER" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml restart backend"

echo ""
echo "Done! Session uploaded and backend restarted."
