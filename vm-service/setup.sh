#!/usr/bin/env bash
set -euo pipefail

# Silk Nodes Staking Collector - VM Setup Script
# Run this from vm-service/ directory after cloning the repo

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_PATH="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_NAME="silknodes-collector"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
CURRENT_USER="$(whoami)"

echo "=== Silk Nodes Staking Collector Setup ==="
echo "Repo path: $REPO_PATH"
echo "User: $CURRENT_USER"
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

# Create systemd service file with path substitution
echo
echo "Creating systemd service..."
TEMP_SERVICE=$(mktemp)
sed "s|__REPO_PATH__|$REPO_PATH|g; s|%i|$CURRENT_USER|g" \
  "$SCRIPT_DIR/silknodes-collector.service" > "$TEMP_SERVICE"

sudo cp "$TEMP_SERVICE" "$SERVICE_FILE"
rm "$TEMP_SERVICE"
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

# Enable and start service
echo
echo "Enabling and starting service..."
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl start "$SERVICE_NAME"

sleep 2
echo
echo "=== Service status ==="
sudo systemctl status "$SERVICE_NAME" --no-pager || true

echo
echo "=== Setup complete ==="
echo
echo "Useful commands:"
echo "  View logs:     sudo journalctl -u $SERVICE_NAME -f"
echo "  Restart:       sudo systemctl restart $SERVICE_NAME"
echo "  Stop:          sudo systemctl stop $SERVICE_NAME"
echo "  Status:        sudo systemctl status $SERVICE_NAME"
echo
