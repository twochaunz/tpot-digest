#!/usr/bin/env bash
#
# Deploy tpot-digest to a remote server.
#
# Usage:
#   ./scripts/deploy.sh user@yourserver.com
#
# First-time setup (run manually on server):
#   1. Install Docker: curl -fsSL https://get.docker.com | sh
#   2. Clone repo: git clone https://github.com/twochaunz/tpot-digest.git
#   3. cd tpot-digest && cp .env.example .env && nano .env  (set passwords, domain)
#   4. ./scripts/deploy.sh user@yourserver.com
#
set -euo pipefail

SERVER="${1:?Usage: deploy.sh user@host}"
SSH_KEY="$HOME/wk_clawd"
REMOTE_DIR="~/tpot-digest"

SSH_OPTS=()
if [ -f "$SSH_KEY" ]; then
  SSH_OPTS+=(-i "$SSH_KEY")
fi

echo "==> Deploying to $SERVER..."

ssh "${SSH_OPTS[@]}" "$SERVER" bash <<EOF
  set -euo pipefail
  cd $REMOTE_DIR

  echo "Pulling latest..."
  git pull origin master

  echo "Building and starting..."
  docker compose -f docker-compose.prod.yml up --build -d

  echo "Waiting for services..."
  sleep 5
  docker compose -f docker-compose.prod.yml ps

  echo ""
  echo "==> Deploy complete!"
EOF

echo ""
echo "Done. Your app should be live at https://tpot.wonchan.com"
