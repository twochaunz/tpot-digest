#!/bin/sh
# Generate bcrypt hash of AUTH_PASS and export it for Caddyfile
if [ -n "$AUTH_PASS" ]; then
  export AUTH_PASS_HASH=$(caddy hash-password --plaintext "$AUTH_PASS")
fi
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
