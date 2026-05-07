-- ─── pse_cohort_snapshots ──────────────────────────────────────────────
-- Daily snapshots of PSE community recipient cohort behavior. Powers
-- the "% of cycle N's PSE stayed staked vs unbonded" card.
--
-- One row per (cycle, cohort_top_n, measured_at_height). The collector
-- runs daily (silknodes-pse-cohort.timer), captures a snapshot at the
-- current chain height for any cycle whose 7d window is still open.
-- Closed cycles get a single final snapshot (backfilled once via
-- --backfill flag) and are never re-measured.
--
-- The buckets JSONB carries the per-bucket counts and TX sums so the UI
-- can show the four-state breakdown (kept_bonded / partial_unbond /
-- fully_unbonded / net_drew_down) without joining another table.
--
-- PSE auto-bonds the reward at distribution. So:
--   kept_bonded_tx       — sum of bondedΔ for wallets that kept ≥75% bonded
--   unbonded_tx          — total PSE that was unbonded within the window
--   exited_wallet_tx     — of the unbonded, how much actually left the wallet
--   liquid_retained_tx   — of the unbonded, how much sits liquid in wallet
CREATE TABLE IF NOT EXISTS pse_cohort_snapshots (
  cycle               INT          NOT NULL,
  cohort_top_n        INT          NOT NULL,
  measured_at         TIMESTAMPTZ  NOT NULL,
  measured_at_height  BIGINT       NOT NULL,
  distribution_height BIGINT       NOT NULL,
  full_plus_7d_height BIGINT       NOT NULL,
  window_days_covered NUMERIC      NOT NULL,
  window_complete     BOOLEAN      NOT NULL,
  cohort_size         INT          NOT NULL,
  validator_self_bond_count INT    NOT NULL,
  received_tx         NUMERIC      NOT NULL,
  bonded_delta_tx     NUMERIC      NOT NULL,
  liquid_delta_tx     NUMERIC      NOT NULL,
  kept_bonded_tx      NUMERIC      NOT NULL,
  unbonded_tx         NUMERIC      NOT NULL,
  exited_wallet_tx    NUMERIC      NOT NULL,
  liquid_retained_tx  NUMERIC      NOT NULL,
  buckets             JSONB        NOT NULL,
  buckets_ex_validators JSONB      NOT NULL,
  inserted_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cycle, cohort_top_n, measured_at_height)
);

CREATE INDEX IF NOT EXISTS idx_pse_cohort_snapshots_cycle_measured
  ON pse_cohort_snapshots (cycle, cohort_top_n, measured_at DESC);
