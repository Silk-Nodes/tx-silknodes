-- Initial schema for tx_silknodes Postgres backend.
--
-- Design principles:
--   1. Idempotent. Every CREATE uses IF NOT EXISTS so re-running this file
--      against a partially-initialised DB is safe. No migration tracking
--      table is needed yet — once we add a second migration we'll either
--      keep the idempotent style or introduce a tracker.
--   2. Mirrors the JSONs in public/analytics/ on a 1-to-1 basis. Phase 1
--      dual-writes JSON + DB; this schema makes that mapping obvious.
--   3. Relational where the data is naturally relational (events, daily
--      snapshots, history). JSONB only for the "transient computed payload"
--      tables (whale_changes) where flattening to many small typed tables
--      would cost more than it earns.
--   4. Indices target the actual read patterns the frontend exercises:
--      "events ordered by timestamp DESC", "events for delegator X",
--      "events for validator Y", "history snapshot for date D".
--
-- Apply on the VM with:
--   PGPASSWORD=$(cat ~/.silknodes-db-password) \
--     psql -h localhost -U silknodes -d tx_silknodes \
--     -v ON_ERROR_STOP=1 -f vm-service/migrations/001_initial.sql

-- ─── staking_events ─────────────────────────────────────────────────────
-- One row per (tx_hash, event_type, height) triple. Three fields are needed
-- because a single tx can emit multiple events of the same type at the same
-- height (e.g. a multi-message delegate). The amount is in TX (already
-- converted from ucore by the collector).
CREATE TABLE IF NOT EXISTS staking_events (
  id              BIGSERIAL PRIMARY KEY,
  tx_hash         TEXT        NOT NULL,
  height          BIGINT      NOT NULL,
  timestamp       TIMESTAMPTZ NOT NULL,
  type            TEXT        NOT NULL CHECK (type IN ('delegate', 'undelegate', 'redelegate')),
  delegator       TEXT        NOT NULL,
  validator       TEXT        NOT NULL,
  source_validator TEXT, -- only set for redelegate events
  amount          NUMERIC     NOT NULL,
  memo            TEXT,
  inserted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tx_hash, type, height, delegator, validator)
);

CREATE INDEX IF NOT EXISTS idx_staking_events_timestamp
  ON staking_events (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_staking_events_delegator
  ON staking_events (delegator, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_staking_events_validator
  ON staking_events (validator, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_staking_events_amount
  ON staking_events (amount DESC);

-- ─── validators ─────────────────────────────────────────────────────────
-- Cache of operator_address → moniker. Refreshed every hour by the
-- collector. Avoids re-fetching validator metadata on every event render.
CREATE TABLE IF NOT EXISTS validators (
  operator_address TEXT PRIMARY KEY,
  moniker          TEXT        NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── top_delegators (current snapshot) ──────────────────────────────────
-- Overwritten in full every 6 h. Use TRUNCATE + INSERT or upsert pattern.
-- Label fields are denormalised for read speed (no join required to render
-- the table). The label_text/type/verified mirror TopDelegatorLabel.
CREATE TABLE IF NOT EXISTS top_delegators (
  address         TEXT PRIMARY KEY,
  rank            INTEGER     NOT NULL,
  total_stake     NUMERIC     NOT NULL,
  validator_count INTEGER     NOT NULL,
  label_text      TEXT,
  label_type      TEXT,
  label_verified  BOOLEAN,
  refreshed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_top_delegators_rank
  ON top_delegators (rank);

CREATE INDEX IF NOT EXISTS idx_top_delegators_total_stake
  ON top_delegators (total_stake DESC);

-- ─── top_delegators_history (daily snapshots) ───────────────────────────
-- Replaces whale-history.json. One row per (date, address). 90-day rolling
-- retention is enforced by a daily prune in the collector. PRIMARY KEY on
-- (date, address) makes both UPSERT and lookup-by-date fast.
CREATE TABLE IF NOT EXISTS top_delegators_history (
  date         DATE    NOT NULL,
  rank         INTEGER NOT NULL,
  address      TEXT    NOT NULL,
  total_stake  NUMERIC NOT NULL,
  label_type   TEXT,
  PRIMARY KEY (date, address)
);

CREATE INDEX IF NOT EXISTS idx_top_delegators_history_date
  ON top_delegators_history (date DESC);

CREATE INDEX IF NOT EXISTS idx_top_delegators_history_address
  ON top_delegators_history (address, date DESC);

-- ─── whale_changes (latest 6h diff payload) ─────────────────────────────
-- Singleton table: exactly one row, overwritten on each refresh. JSONB for
-- arrivals/exits/movers because the data is transient (replaced wholesale
-- every 6 h) and the frontend already consumes it as a single payload —
-- splitting into 4 typed tables would force a multi-row read with no
-- analytical benefit.
CREATE TABLE IF NOT EXISTS whale_changes (
  id                  INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  updated_at          TIMESTAMPTZ NOT NULL,
  rank_threshold      INTEGER     NOT NULL,
  stake_threshold_tx  NUMERIC     NOT NULL,
  arrivals            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  exits               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  rank_movers         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  stake_movers        JSONB       NOT NULL DEFAULT '[]'::jsonb
);

-- ─── pending_undelegations ──────────────────────────────────────────────
-- The "amount unbonding by completion date" curve. Truncated and
-- re-inserted every refresh — past dates aren't useful (they're already
-- unbonded), so no history is kept here. If we want to chart how the curve
-- evolves, that's a follow-up table with (snapshot_at, date, value).
CREATE TABLE IF NOT EXISTS pending_undelegations (
  date       DATE        PRIMARY KEY,
  value      NUMERIC     NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── daily_metrics ──────────────────────────────────────────────────────
-- One wide row per UTC day covering every "snapshot at end of day" metric
-- the frontend currently fetches as a separate JSON. Wide table because
-- the frontend wants all of these together for the analytics dashboard
-- and a single PK lookup is cheaper than 8 separate file fetches.
CREATE TABLE IF NOT EXISTS daily_metrics (
  date                DATE PRIMARY KEY,
  transactions        BIGINT,
  active_addresses    BIGINT,
  total_stake         NUMERIC,
  staking_apr         NUMERIC,
  staked_pct          NUMERIC,
  total_supply        NUMERIC,
  circulating_supply  NUMERIC,
  price_usd           NUMERIC,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── known_entities ─────────────────────────────────────────────────────
-- Address → label mapping curated by the project. Read by the top
-- delegators view to badge known CEX / validator self-bond / individual
-- addresses.
CREATE TABLE IF NOT EXISTS known_entities (
  address    TEXT PRIMARY KEY,
  label      TEXT        NOT NULL,
  type       TEXT        NOT NULL,
  verified   BOOLEAN     NOT NULL DEFAULT false,
  source     TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_known_entities_type
  ON known_entities (type);

-- ─── pse_score ──────────────────────────────────────────────────────────
-- Time-series of the PSE network score. JSONB payload column carries the
-- detailed breakdown the script computes; we lift the headline score into
-- its own column for fast charting.
CREATE TABLE IF NOT EXISTS pse_score (
  computed_at TIMESTAMPTZ PRIMARY KEY,
  score       NUMERIC NOT NULL,
  payload     JSONB
);

CREATE INDEX IF NOT EXISTS idx_pse_score_computed_at
  ON pse_score (computed_at DESC);
