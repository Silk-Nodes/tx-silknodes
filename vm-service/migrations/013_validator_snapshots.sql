-- ─── validator_snapshots ───────────────────────────────────────────────
-- Daily point-in-time snapshot of every validator in the set. Powers the
-- per-validator detail pages: voting-power history, commission-change
-- history, uptime trend, and delegator-count growth.
--
-- Why this table has to exist at all: none of this is derivable after the
-- fact. The chain exposes only CURRENT state, and reconstructing history
-- from staking_events would be wrong, because bonded stake also moves via
-- PSE emission and reward compounding, neither of which produces a
-- delegate transaction. (That mismatch is exactly what made the July 7
-- bonded-stake step look like a collector bug when it was a PSE
-- distribution.) So the only way to get history is to start recording it.
--
-- One row per (date, operator_address). Idempotent: re-running on the same
-- day updates the row rather than duplicating it, so a manual re-run after
-- a partial failure is safe.
--
-- Nullable columns are the per-validator extras (delegator_count,
-- self_bonded_tx, missed_blocks). Those need an extra LCD call each, so a
-- single validator timing out degrades to NULL for that day instead of
-- failing the whole snapshot.
CREATE TABLE IF NOT EXISTS validator_snapshots (
  date              DATE         NOT NULL,
  operator_address  TEXT         NOT NULL,
  moniker           TEXT         NOT NULL,
  tokens            NUMERIC      NOT NULL,  -- bonded stake, display TX
  commission_rate   NUMERIC      NOT NULL,  -- 0.05 = 5%
  jailed            BOOLEAN      NOT NULL,
  status            TEXT         NOT NULL,  -- BOND_STATUS_BONDED etc.
  delegator_count   INT,
  self_bonded_tx    NUMERIC,
  missed_blocks     BIGINT,
  tombstoned        BOOLEAN,
  inserted_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (date, operator_address)
);

-- Per-validator time series: "show me this validator's last 90 days".
CREATE INDEX IF NOT EXISTS idx_validator_snapshots_operator_date
  ON validator_snapshots (operator_address, date DESC);

-- Whole-set view for a given day: "rank everyone as of date X".
CREATE INDEX IF NOT EXISTS idx_validator_snapshots_date
  ON validator_snapshots (date DESC);
