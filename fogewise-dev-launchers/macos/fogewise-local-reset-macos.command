#!/usr/bin/env bash
set -Eeuo pipefail

ADMIN_ADDRESS="127.0.0.1:20191"

printf '\n[Fogewise] Resetting local development override...\n'

if command -v caddy >/dev/null 2>&1; then
  caddy stop --address "$ADMIN_ADDRESS" >/dev/null 2>&1 || true
fi

if grep -Eq '#[[:space:]]*fogewise-local-dev[[:space:]]*$' /etc/hosts 2>/dev/null; then
  sudo sed -i '' '/#[[:space:]]*fogewise-local-dev[[:space:]]*$/d' /etc/hosts
fi

sudo dscacheutil -flushcache 2>/dev/null || true
sudo killall -HUP mDNSResponder 2>/dev/null || true

printf '[Fogewise] All Fogewise local hosts overrides were removed.\n'
printf '[Fogewise] Fogewise domains now resolve through public DNS again.\n'
