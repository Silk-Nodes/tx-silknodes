-- Track how many distinct wallets contribute to each completion-day
-- bucket on the Pending Undelegations curve. The chart tooltip surfaces
-- this so a "26.94M unbonding" headline is grounded in "from N wallets"
-- rather than reading as a single-actor decision.
--
-- Backfilled to 0 for any pre-existing rows; the next collector tick
-- truncates and re-inserts the whole table with real counts.
ALTER TABLE pending_undelegations
  ADD COLUMN IF NOT EXISTS wallet_count INTEGER NOT NULL DEFAULT 0;
