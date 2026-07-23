# Database migrations

Plain SQL files applied with `psql`. Filenames are zero-padded and ordered
(`001_*.sql`, `002_*.sql`, …). Every file is **idempotent** — `CREATE TABLE
IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF
NOT EXISTS` — so re-running them against a partially-initialised database
is safe and we don't need a tracking table yet.

If/when migrations grow non-idempotent (data backfills, column drops), we'll
introduce a `_migrations` tracking table and a small runner script.

## Apply on the VM

```bash
cd /home/zoltan/tx-silknodes
# Credentials live in ~/.silknodes-db.env as PG* vars (the same file the
# systemd units load). Sourcing it exports PGUSER/PGPASSWORD/PGDATABASE,
# which psql picks up automatically.
set -a; . ~/.silknodes-db.env; set +a
psql -v ON_ERROR_STOP=1 -f vm-service/migrations/001_initial.sql
```

Expected output: a series of `CREATE TABLE` / `CREATE INDEX` lines, no
errors. Re-running is harmless.

## Verify

```bash
set -a; . ~/.silknodes-db.env; set +a
psql -c "\dt"
```

You should see all the tables listed:
`staking_events`, `validators`, `top_delegators`, `top_delegators_history`,
`whale_changes`, `pending_undelegations`, `daily_metrics`, `known_entities`,
`pse_score`.

## Schema map (which JSON each table replaces)

| Table | Replaces (in `public/analytics/`) |
| --- | --- |
| `staking_events` | `staking-events.json` (events array) |
| `validators` | `staking-events.json` (validators map) |
| `top_delegators` | `top-delegators.json` |
| `top_delegators_history` | `whale-history.json` |
| `whale_changes` | `whale-changes.json` |
| `pending_undelegations` | `pending-undelegations.json` |
| `daily_metrics` | `transactions.json`, `active-addresses.json`, `total-stake.json`, `staking-apr.json`, `staked-pct.json`, `total-supply.json`, `circulating-supply.json`, `price-usd.json` |
| `known_entities` | `known-entities.json` |
| `pse_score` | `public/pse-network-score.json` |

## Phasing

- **Step 2 (this PR)**: schema only. No collector or frontend changes.
- **Step 3**: add `pg` dependency + `vm-service/db.mjs` connection pool.
- **Steps 4–6**: collectors dual-write JSON + DB.
- **Step 7**: collectors stop writing JSON.
- **Phase 2**: frontend reads from DB instead of JSONs.
