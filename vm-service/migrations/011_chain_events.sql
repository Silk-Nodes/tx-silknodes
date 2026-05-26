-- ─── chain_events ─────────────────────────────────────────────────────
-- Derived, typed events from on-chain activity we already collect. The
-- deriver scans staking_events, validator snapshots, and PSE schedule;
-- emits one row per notable thing that happened. The Today page feed
-- merges these with news_items so a single timeline shows both world
-- news and chain activity.
--
-- type taxonomy (extend as needed):
--   whale_delegate    a single delegation above the dynamic threshold
--   large_unbond      a single unbond above the dynamic threshold
--   validator_joined  a validator entered the active (bonded) set
--   validator_left    a validator dropped out of the active set
--   commission_changed  validator commission moved > 1 percentage point
--   jailed            validator was jailed
--   unjailed          validator left jail
--   pse_distributed   a PSE cycle distribution executed
--
-- severity: 'low' / 'normal' / 'high'. Feed sorts on ts only; severity
-- is used by the UI to pick chip color and tone, not ordering.
--
-- payload is type-specific JSON: { validator, amount, delegator, … }.
-- The deriver guarantees a stable shape per type; the UI reads keys
-- defensively in case schema evolves.
--
-- dedupe_key is computed deterministically from (type + the inputs that
-- define the event) so re-running the deriver is idempotent. Examples:
--   whale_delegate:  tx_hash  (each tx is one event)
--   commission_changed:  validator|YYYYMMDD  (one per validator per day)
--   pse_distributed:  cycle_index  (one per cycle)
CREATE TABLE IF NOT EXISTS chain_events (
  id          BIGSERIAL   PRIMARY KEY,
  type        TEXT        NOT NULL,
  severity    TEXT        NOT NULL DEFAULT 'normal'
                CHECK (severity IN ('low', 'normal', 'high')),
  ts          TIMESTAMPTZ NOT NULL,
  payload     JSONB       NOT NULL,
  dedupe_key  TEXT        NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Feed query plan: ORDER BY ts DESC LIMIT 6, optionally filtered by
-- type for the UI filter chips. Same index covers retention prune.
CREATE INDEX IF NOT EXISTS idx_chain_events_ts
  ON chain_events (ts DESC);

CREATE INDEX IF NOT EXISTS idx_chain_events_type_ts
  ON chain_events (type, ts DESC);
