# Silk Nodes Staking Events Collector

A 24/7 service that runs on your home VM. Polls Coreum RPC for staking events, maintains a rolling 3 month window in `src/data/analytics/staking-events.json`, and pushes updates to GitHub every 5 minutes.

## Requirements

- Linux VM with systemd
- Node.js 18+
- Git configured with SSH key that can push to the repo

## One-time setup

### 1. Install Node.js 20 (if not already installed)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Set up SSH key for GitHub (if not already)

```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
cat ~/.ssh/id_ed25519.pub
# Add this public key to https://github.com/settings/keys
ssh -T git@github.com   # verify it works
```

### 3. Clone the repo via SSH

```bash
cd ~
git clone git@github.com:Silk-Nodes/tx-silknodes.git
cd tx-silknodes/vm-service
```

### 4. Configure git identity

```bash
git config --global user.email "bot@silknodes.io"
git config --global user.name "Silk Nodes Bot"
```

### 5. Run setup script

```bash
bash setup.sh
```

The script will:
- Verify Node.js and git are installed
- Install the systemd service
- Run an initial data fetch to populate `staking-events.json`
- Enable + start the service

## Managing the service

```bash
# View live logs
sudo journalctl -u silknodes-collector -f

# Check status
sudo systemctl status silknodes-collector

# Restart
sudo systemctl restart silknodes-collector

# Stop
sudo systemctl stop silknodes-collector

# Disable (won't start on reboot)
sudo systemctl disable silknodes-collector
```

## Configuration

Environment variables (edit the systemd unit file to change):

| Variable | Default | Description |
|----------|---------|-------------|
| `REPO_PATH` | Parent of vm-service dir | Path to the tx-silknodes repo |
| `GIT_PUSH` | `true` | Set to `false` to skip git push (for testing) |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## Local testing

Run without pushing to GitHub:

```bash
cd vm-service
npm run dev   # GIT_PUSH=false LOG_LEVEL=debug
```

## What it does

Every 60 seconds:
1. Queries Coreum RPC `tx_search` for `MsgDelegate`, `MsgUndelegate`, `MsgBeginRedelegate` transactions
2. Parses tx events to extract delegator, validator, amount, and block timestamp
3. Filters out amounts below 5,000 TX
4. Deduplicates by tx hash
5. Keeps only the most recent 3 months
6. Writes to `src/data/analytics/staking-events.json`

Every 5 minutes (if there are changes):
1. Runs `git pull --rebase --autostash`
2. Commits the updated JSON
3. Pushes to GitHub
4. GitHub Pages rebuilds automatically

## Troubleshooting

**Service won't start:**
```bash
sudo journalctl -u silknodes-collector -n 100
```

**Git push fails:**
- Check SSH key: `ssh -T git@github.com`
- Check git remote is SSH not HTTPS: `git remote -v`
- If HTTPS, switch to SSH: `git remote set-url origin git@github.com:Silk-Nodes/tx-silknodes.git`

**No events appearing:**
- Verify RPC is reachable: `curl https://rpc-coreum.ecostake.com/status`
- Check minimum amount filter (5,000 TX) isn't filtering everything
- Run in debug mode: `LOG_LEVEL=debug node collect-staking-events.mjs`
