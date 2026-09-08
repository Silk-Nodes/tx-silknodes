-- ─── validator_identity: consensus and self-delegate addresses ──────────
--
-- The validator detail route asked Coreum's Hasura indexer for these two
-- fields on every page load, and could not start its second round of chain
-- calls until that answered, because signing info is keyed by consensus
-- address and the governance vote lookup is keyed by self-delegate address.
-- Measured 767ms cold and 489ms warm, twice per request because the second
-- Hasura call could not overlap the first. That was the single largest cost
-- in a 1.2 to 1.6s endpoint.
--
-- Both values are static for the life of a validator, so they belong next to
-- the other identity facts we already cache. The collector pays the Hasura
-- cost once per run instead of once per reader.
ALTER TABLE validator_identity
  ADD COLUMN IF NOT EXISTS consensus_address     TEXT,
  ADD COLUMN IF NOT EXISTS self_delegate_address TEXT;

-- The route looks a validator up by operator address (already the primary
-- key), but the governance page resolves the other direction.
CREATE INDEX IF NOT EXISTS idx_validator_identity_self_delegate
  ON validator_identity (self_delegate_address);

-- ─── staking_events: index the redelegation source ──────────────────────
--
-- Four of the validator route's queries filter
--   WHERE validator = :v OR source_validator = :v
-- and only `validator` was indexed, so Postgres could not build a BitmapOr
-- and fell back to a sequential scan. At 15,367 rows that costs 7.7ms and
-- does not matter. It matters at ten times the size, and the table only
-- grows.
CREATE INDEX IF NOT EXISTS idx_staking_events_source_validator
  ON staking_events (source_validator, "timestamp" DESC);
