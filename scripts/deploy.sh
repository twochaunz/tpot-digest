#!/usr/bin/env bash
#
# Deploy tpot-digest to a remote server.
#
# Usage:
#   ./scripts/deploy.sh user@yourserver.com
#
# First-time setup (run manually on server):
#   1. Install Docker: curl -fsSL https://get.docker.com | sh
#   2. Clone repo: git clone git@github.com:wktinker/tpot-digest.git
#   3. cd tpot-digest && cp .env.example .env && nano .env  (set passwords, domain)
#   4. ./scripts/deploy.sh user@yourserver.com
#
set -euo pipefail

SERVER="${1:?Usage: deploy.sh user@host}"
REMOTE_DIR="~/tpot-digest"

echo "==> Deploying to $SERVER..."

ssh "$SERVER" bash <<EOF
  set -euo pipefail
  cd $REMOTE_DIR

  echo "Pulling latest..."
  git pull origin feat/tpot-digest

  echo "Building and starting..."
  docker compose -f docker-compose.prod.yml up --build -d

  echo "Waiting for services..."
  sleep 5
  docker compose -f docker-compose.prod.yml ps

  echo ""
  echo "==> Deploy complete!"
EOF

echo ""
echo "Done. Your app should be live at https://\$(your domain)"
echo ""
echo "To upload Twitter session cookies:"
echo "  scp browser_state/twitter_session.json $SERVER:$REMOTE_DIR/browser_state/"
echo "  ssh $SERVER 'cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml restart backend'"
