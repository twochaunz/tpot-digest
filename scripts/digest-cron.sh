#!/usr/bin/env bash
# Process scheduled digest sends. Run via cron/systemd timer daily.
# Usage: ADMIN_SECRET=xxx ./scripts/digest-cron.sh
set -euo pipefail

DOMAIN="${DOMAIN:-abridged.tech}"
ADMIN_SECRET="${ADMIN_SECRET:?ADMIN_SECRET must be set}"

curl -sf -X POST "https://${DOMAIN}/api/digest/process-scheduled" \
  -H "X-Admin-Key: ${ADMIN_SECRET}" \
  -H "Content-Type: application/json" \
  || echo "Failed to process scheduled digests"
