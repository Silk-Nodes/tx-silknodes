#!/usr/bin/env bash
set -euo pipefail

# Silk Nodes Staking Collector - VM Setup Script
# Run this from vm-service/ directory after cloning the repo

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_PATH="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_NAME="silknodes-collector"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
DAILY_SERVICE_NAME="silknodes-daily-analytics"
DAILY_SERVICE_FILE="/etc/systemd/system/${DAILY_SERVICE_NAME}.service"
DAILY_TIMER_FILE="/etc/systemd/system/${DAILY_SERVICE_NAME}.timer"
CURRENT_USER="$(whoami)"

echo "=== Silk Nodes VM Services Setup ==="
echo "Repo path: $REPO_PATH"
echo "User: $CURRENT_USER"
echo
echo "This installs two units:"
echo "  1. $SERVICE_NAME (systemd service, always running) — staking events feed"
echo "  2. $DAILY_SERVICE_NAME (systemd timer, daily) — historical analytics metrics"
echo

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js not found. Install Node 18+ first."
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "  sudo apt install -y nodejs"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "ERROR: Node.js 18+ required (found v$NODE_VERSION)"
  exit 1
fi
echo "Node.js version: $(node -v)"

# Check git
if ! command -v git &> /dev/null; then
  echo "ERROR: git not found"
  exit 1
fi

# Check that git can push (SSH key configured)
cd "$REPO_PATH"
GIT_REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
if [ -z "$GIT_REMOTE" ]; then
  echo "ERROR: No git remote configured"
  exit 1
fi
echo "Git remote: $GIT_REMOTE"

# Configure git user if not set
if [ -z "$(git config user.email || true)" ]; then
  echo
  echo "Git user.email not configured. Please run:"
  echo "  git config --global user.email \"your-email@example.com\""
  echo "  git config --global user.name \"Your Name\""
  exit 1
fi

# Auto-detect node path (handles nvm, snap, system installs)
NODE_PATH="$(command -v node)"
echo "Node path: $NODE_PATH"

# Helper: substitute template placeholders and install a systemd unit file
install_unit() {
  local src="$1"
  local dest="$2"
  local tmp
  tmp=$(mktemp)
  sed "s|__REPO_PATH__|$REPO_PATH|g; s|%i|$CURRENT_USER|g; s|__NODE_PATH__|$NODE_PATH|g; s|/usr/bin/node|$NODE_PATH|g" \
    "$src" > "$tmp"
  sudo cp "$tmp" "$dest"
  rm "$tmp"
}

# Install the staking events collector service (always running)
echo
echo "Installing $SERVICE_NAME.service..."
install_unit "$SCRIPT_DIR/silknodes-collector.service" "$SERVICE_FILE"

# Install the daily analytics collector service + timer (fires once per day)
echo "Installing $DAILY_SERVICE_NAME.service + .timer..."
install_unit "$SCRIPT_DIR/silknodes-daily-analytics.service" "$DAILY_SERVICE_FILE"
install_unit "$SCRIPT_DIR/silknodes-daily-analytics.timer" "$DAILY_TIMER_FILE"

sudo systemctl daemon-reload

# Initial fetch (without pushing) to populate data file
echo
echo "Running initial data fetch (this takes ~30 seconds)..."
cd "$SCRIPT_DIR"
GIT_PUSH=false timeout 120 node collect-staking-events.mjs &
INITIAL_PID=$!
sleep 60
kill $INITIAL_PID 2>/dev/null || true
wait 2>/dev/null || true
echo "Initial fetch complete"

# Enable and start services
echo
echo "Enabling and starting services..."
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl start "$SERVICE_NAME"
sudo systemctl enable "${DAILY_SERVICE_NAME}.timer"
sudo systemctl start "${DAILY_SERVICE_NAME}.timer"

sleep 2
echo
echo "=== Staking collector status ==="
sudo systemctl status "$SERVICE_NAME" --no-pager || true
echo
echo "=== Daily analytics timer status ==="
sudo systemctl status "${DAILY_SERVICE_NAME}.timer" --no-pager || true

echo
echo "=== Setup complete ==="
echo
echo "Useful commands:"
echo "  Staking collector logs:   sudo journalctl -u $SERVICE_NAME -f"
echo "  Daily analytics logs:     sudo journalctl -u $DAILY_SERVICE_NAME -n 200 --no-pager"
echo "  Run daily now:            sudo systemctl start $DAILY_SERVICE_NAME"
echo "  List timer schedule:      systemctl list-timers | grep silknodes"
echo "  Restart staking:          sudo systemctl restart $SERVICE_NAME"
echo
echo "The daily analytics collector fires once per day at 02:00 UTC and also"
echo "5 minutes after boot. To backfill missing days right now, run:"
echo "  sudo systemctl start $DAILY_SERVICE_NAME"
echo
