# Silk Nodes VM Services

This VM is the **single source of truth** for all on-chain analytics that feed the Silk Nodes dashboard. It runs two units side-by-side.

## The two units

### 1. `silknodes-collector.service` — continuous
Polls Coreum RPC for delegate/undelegate/redelegate transactions, maintains a rolling 3 month window, pushes to GitHub every 5 minutes with a 30-minute heartbeat.

Files written:
| File | Cadence | Source |
|---|---|---|
| `public/analytics/staking-events.json` | 60s poll, 5 min push, 30 min heartbeat | RPC `tx_search` |
| `public/analytics/pending-undelegations.json` | 15 min refresh | LCD `unbonding_delegations` aggregated across all validators |

The pending-undelegations file lives here (not in the daily collector) because it's a **current-state snapshot** — entries mature at arbitrary times and a daily cadence would leave completed entries on the chart for up to 24h. Single writer = no race with the daily collector.

Schema: `{ updatedAt: ISO, entries: [{date, value}, ...] }`. The `updatedAt` field lets the external monitor treat it with the same freshness discipline as staking-events.json.

### 2. `silknodes-daily-analytics.timer` — once per day
Fires at **02:00 UTC** (and 5 min after boot) and runs `collect-daily-analytics.mjs`. Fills every missing day of per-day metrics in `public/analytics/`:

| File | Source |
|---|---|
| `transactions.json` | RPC `tx_search?per_page=1` → `total_count` |
| `active-addresses.json` | RPC `tx_search` paginated → unique `message.sender` |
| `total-stake.json` | LCD `/cosmos/staking/v1beta1/pool` |
| `staking-apr.json` | LCD mint/distribution params + bonded |
| `staked-pct.json` | bonded / circulating |
| `total-supply.json` | LCD `/cosmos/bank/v1beta1/supply/by_denom` |
| `circulating-supply.json` | TX API `/circulating-supply` |
| `price-usd.json` | CoinGecko daily snapshot |

Block heights for a UTC date are resolved by **RPC-only binary search** on `/block?height=X` timestamps. No Hasura, no Cloudflare in the critical path. ~42 RPC calls per date, ~2-3 seconds.

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

The script:

- Verifies Node.js and git are installed
- Installs both systemd units: `silknodes-collector.service` and `silknodes-daily-analytics.{service,timer}`
- Runs an initial staking fetch to populate `staking-events.json`
- Enables + starts the staking collector
- Enables the daily timer (first run at next 02:00 UTC or 5 min after boot, whichever comes first)

## Managing the services

### Staking events collector
```bash
sudo journalctl -u silknodes-collector -f          # live logs
sudo systemctl status silknodes-collector          # health check
sudo systemctl restart silknodes-collector         # restart
```

### Daily analytics
```bash
systemctl list-timers | grep silknodes             # see next run
sudo systemctl start silknodes-daily-analytics     # run now (backfills gaps)
sudo journalctl -u silknodes-daily-analytics -n 200 --no-pager  # last run's logs
```

## Configuration

Environment variables in each systemd unit file:

| Variable | Default | Description |
|----------|---------|-------------|
| `REPO_PATH` | Parent of vm-service dir | Path to the tx-silknodes repo |
| `GIT_PUSH` | `true` | Set to `false` to skip git push (testing) |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## Local testing

```bash
cd vm-service
npm run dev                                                 # staking collector, no push
GIT_PUSH=false LOG_LEVEL=debug node collect-daily-analytics.mjs  # daily analytics, no push
```

## Reliability defenses

### In the staking collector (continuous)
- **Loud failures:** git errors include full stderr/stdout
- **Circuit breaker:** exits after 5 consecutive push or poll failures; systemd `Restart=always` brings it back up with fresh state (and any pulled code changes)
- **Heartbeat:** forces a commit every 30 min even with no new events, so `updatedAt` never silently goes stale
- **Client warning:** if `updatedAt` > 60 min, the Staking Activity panel shows an amber "Feed appears stale" banner
- **External monitor:** `.github/workflows/staking-feed-health.yml` runs every 20 min and fails if the JSON is stale

### In the daily analytics collector (one-shot)
- **Per-metric try/catch:** one flaky endpoint does not abort the whole run
- **Per-day try/catch:** a transient RPC blip on day N does not throw away days 1..N-1
- **Incremental writes:** each day writes to disk before moving on, so failures never waste completed work
- **Pull-rebase-retry on push:** up to 4 attempts with backoff so we can't collide with the staking collector pushing to the same repo
- **Systemd `Persistent=true`:** if the VM is off at 02:00 UTC, the timer fires as soon as it comes back online
- **OnBootSec=5min:** extra safety net to catch gaps immediately after any downtime
- **RPC-only:** no Hasura, no Cloudflare rate-limit dependency

## Troubleshooting

**Either service won't start:**
```bash
sudo journalctl -u silknodes-collector -n 100
sudo journalctl -u silknodes-daily-analytics -n 100
```

**Git push fails:**
- Check SSH key: `ssh -T git@github.com`
- Check git remote is SSH not HTTPS: `git remote -v`
- If HTTPS: `git remote set-url origin git@github.com:Silk-Nodes/tx-silknodes.git`

**No events appearing in staking feed:**
- Verify RPC: `curl https://rpc-coreum.ecostake.com/status`
- Check minimum amount filter (5,000 TX) isn't filtering everything
- Run in debug mode: `LOG_LEVEL=debug node collect-staking-events.mjs`

**Daily analytics missing a day:**
- Re-trigger: `sudo systemctl start silknodes-daily-analytics`
- The script is idempotent: it only processes days that are actually missing
- If the same day keeps failing, check the RPC's earliest served block: `curl https://rpc-coreum.ecostake.com/status | jq .result.sync_info.earliest_block_height` — data before that height is pruned and can't be recovered

**Verifying a tx count manually:**
```bash
# Look up a date's block range
curl 'https://rpc-coreum.ecostake.com/block?height=70350994' | jq .result.block.header.time   # first block of Apr 15
# Then query tx_search
curl 'https://rpc-coreum.ecostake.com/tx_search?query=%22tx.height%3E%3D70350994%20AND%20tx.height%3C%3D70449744%22&per_page=1&page=1' | jq .result.total_count
```
