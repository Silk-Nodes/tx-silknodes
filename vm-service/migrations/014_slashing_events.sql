-- ─── slashing_events ───────────────────────────────────────────────────
-- Append-only log of validator penalty events: jailings, unjailings, slashes
-- and tombstones.
--
-- Why this table has to exist: the chain exposes only CURRENT state. From
-- today's signing_infos you can read that 50 of 105 validators are jailed and
-- 5 are tombstoned, but not WHEN any of it happened or how often a given
-- validator has been jailed before. That history is not reconstructable after
-- the fact, so like validator_snapshots, the only way to have it is to start
-- recording. Every day this is not running is a permanent hole.
--
-- `source` is deliberate. Two detection paths feed this table and they carry
-- different confidence:
--
--   'event'      parsed from a block's finalize_block_events. Authoritative:
--                carries the reason and the burned amount.
--   'state_diff' inferred by comparing the validator set against the previous
--                poll. Catches every jail/unjail transition regardless of
--                event-attribute naming, but cannot know the burned amount,
--                so amount_tx stays NULL.
--
-- Recording which path produced a row means later analysis can weight them
-- honestly instead of treating an inference as a measurement.
CREATE TABLE IF NOT EXISTS slashing_events (
  id                BIGSERIAL    PRIMARY KEY,
  operator_address  TEXT         NOT NULL,
  moniker           TEXT         NOT NULL DEFAULT '',
  -- jailed | unjailed | slashed | tombstoned
  event_type        TEXT         NOT NULL,
  -- missing_signature | double_sign | NULL when not known
  reason            TEXT,
  -- burned stake in display TX. NULL for state_diff rows and for unjailings.
  amount_tx         NUMERIC,
  -- block height the event was observed at. For state_diff rows this is the
  -- height at detection, which is the poll boundary rather than the exact
  -- block the transition occurred in.
  height            BIGINT,
  occurred_at       TIMESTAMPTZ  NOT NULL,
  source            TEXT         NOT NULL DEFAULT 'state_diff',
  inserted_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Idempotency. The collector re-polls overlapping ranges after a restart, and
-- a state_diff run that sees the same unchanged jail state must not append a
-- duplicate. One transition per validator per type per height is the natural
-- key; NULL height (should not happen, but be safe) falls back to occurred_at.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_slashing_events_natural
  ON slashing_events (operator_address, event_type, COALESCE(height, 0), occurred_at);

-- "Show me this validator's penalty history", the per-validator page query.
CREATE INDEX IF NOT EXISTS idx_slashing_events_operator
  ON slashing_events (operator_address, occurred_at DESC);

-- "What happened on the network recently", the leaderboard / feed query.
CREATE INDEX IF NOT EXISTS idx_slashing_events_time
  ON slashing_events (occurred_at DESC);

-- ─── slashing_cursor ───────────────────────────────────────────────────
-- Single-row bookkeeping so the collector knows where it stopped. Kept in a
-- table rather than a file because the VM's JSON writes are being retired and
-- a cursor that disagrees with the data it guards causes silent gaps.
CREATE TABLE IF NOT EXISTS slashing_cursor (
  id            INT          PRIMARY KEY DEFAULT 1,
  last_height   BIGINT       NOT NULL,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT slashing_cursor_single_row CHECK (id = 1)
);
