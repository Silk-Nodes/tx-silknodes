-- ─── validator_snapshots.self_delegate_address ─────────────────────────
-- The account address that casts a validator's governance vote.
--
-- Why this column exists: the governance page has to match on-chain vote
-- rows (keyed by account address) to validators (keyed by operator
-- address). Until now that mapping came from the Coreum indexer's
-- validator_info table, and on 2026-08-18 that table was missing four
-- bonded validators outright -- Kraken, SOLONATIONLABS, Huobi and
-- Zeeve Inc., 339,303,713 TX between them, 9.87% of bonded stake. The
-- page rendered 50 validators while the chain had 54, because it trusted
-- an upstream index for something we can derive ourselves.
--
-- The derivation needs no network call at all. An operator address and its
-- self-delegate account address are the same 20 bytes with a different
-- bech32 prefix, so corevaloper1abc... and core1abc... are one key. The
-- collector re-encodes rather than looking it up.
--
-- Nullable because existing rows predate the column. The collector
-- backfills every row it touches from the next run onward.
ALTER TABLE validator_snapshots
  ADD COLUMN IF NOT EXISTS self_delegate_address TEXT;

-- The governance route looks a validator up by the address that voted.
CREATE INDEX IF NOT EXISTS idx_validator_snapshots_self_delegate
  ON validator_snapshots (self_delegate_address);
