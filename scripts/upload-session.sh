#!/usr/bin/env bash
#
# Upload Twitter session cookies to your server.
#
# Usage:
#   ./scripts/upload-session.sh user@yourserver.com
#
set -euo pipefail

SERVER="${1:?Usage: upload-session.sh user@host}"
SESSION_FILE="browser_state/twitter_session.json"
REMOTE_DIR="~/tpot-digest"

if [ ! -f "$SESSION_FILE" ]; then
  echo "No session file found. Run the login script first:"
  echo "  python scripts/twitter-login.py"
  exit 1
fi

echo "Uploading session to $SERVER..."
ssh "$SERVER" "mkdir -p $REMOTE_DIR/browser_state"
scp "$SESSION_FILE" "$SERVER:$REMOTE_DIR/browser_state/twitter_session.json"

echo "Restarting backend to pick up new session..."
ssh "$SERVER" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml restart backend"

echo ""
echo "Done! Session uploaded and backend restarted."
