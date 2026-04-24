#!/usr/bin/env bash
# Deploy the Next.js web app on the VM after a merge.
#
# Usage:
#   cd /home/zoltan/tx-silknodes
#   bash vm-service/deploy-web.sh
#
# Does:
#   1. git pull origin main
#   2. npm install at the repo root
#   3. npm run build
#   4. sudo systemctl restart silknodes-web
#   5. tail the journal briefly so you can see the boot log
#
# The build step is kept OUT of the systemd service's ExecStart so that
# routine restarts stay fast (~1 s). Build is only re-run when there's
# actually new code to compile, via this script.
#
# Safe to run multiple times: git pull / npm install / npm run build
# are all idempotent. If the build fails the old .next/ directory
# stays in place so systemctl restart still has something to serve.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_PATH="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> Pulling latest main from origin..."
cd "$REPO_PATH"
git pull origin main

echo "==> Installing dependencies..."
npm install --no-audit --no-fund

echo "==> Building Next.js (this takes ~20-25 s)..."
npm run build

echo "==> Restarting silknodes-web..."
sudo systemctl restart silknodes-web

echo "==> Boot log (last 20 lines):"
sleep 2
sudo journalctl -u silknodes-web -n 20 --no-pager
