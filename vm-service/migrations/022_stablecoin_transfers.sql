-- ─── stablecoin transfers ───────────────────────────────────────────────
--
-- Every transfer leg of a tracked stablecoin, from the chain's tx index.
-- The /stablecoins page draws daily activity from this: how many
-- transactions moved a coin, how much moved, and how many wallets sent it.
--
-- Legs, not transactions, are stored so nothing is decided at write time. A
-- DEX swap is two legs (wallet to pool, pool to wallet) and summing both
-- would double the volume, so the page reads the largest leg per
-- transaction instead. That choice lives in the query and can change
-- without a backfill.
--
-- Canonical USDC had 32,449 transactions with a transfer on 2026-09-25,
-- about 20 a day recently. The collector keeps the last 30 days filled and
-- walks forward hourly.

CREATE TABLE IF NOT EXISTS stablecoin_transfers (
  txhash      TEXT         NOT NULL,
  leg         INT          NOT NULL,   -- ordinal of this denom's legs within the tx
  height      BIGINT       NOT NULL,
  ts          TIMESTAMPTZ  NOT NULL,
  denom       TEXT         NOT NULL,
  sender      TEXT         NOT NULL,
  recipient   TEXT         NOT NULL,
  amount      NUMERIC      NOT NULL,   -- display units, 6 decimals applied
  -- ibc_in    the tx received an IBC packet
  -- ibc_out   the tx sent one
  -- chain     everything else: sends, swaps, contract calls
  kind        TEXT         NOT NULL CHECK (kind IN ('ibc_in', 'ibc_out', 'chain')),
  PRIMARY KEY (txhash, denom, leg)
);
CREATE INDEX IF NOT EXISTS idx_stablecoin_transfers_denom_ts ON stablecoin_transfers (denom, ts);
CREATE INDEX IF NOT EXISTS idx_stablecoin_transfers_denom_height ON stablecoin_transfers (denom, height);
