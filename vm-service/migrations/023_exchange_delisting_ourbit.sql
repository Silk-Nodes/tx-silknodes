-- ─── exchange delistings, and Ourbit ────────────────────────────────────
--
-- Bitget delisted TX/USDT on 2026-08-21 10:00 UTC (Bitget notice "Notice of
-- Delisting 6 Spot Trading Pairs on August 21, 2026"). Its wallet stays in
-- exchange_addresses and the collector keeps scanning it, so the indexer
-- history is complete. What changes is what the dashboard shows: a delisted
-- venue drops out of exchange lists, and its flows count only up to the
-- delisting, through exchange_flows_listed below.
--
-- Ourbit replaces it in the tracked set. Address supplied by the Silk Nodes
-- team on 2026-09-30. On chain it first moved on 2026-09-28 and held about
-- 1.71M TX on 2026-09-30, a new wallet. The collector has no cursor for it,
-- so its first run scans it from genesis, which is quick for a wallet this
-- young.

ALTER TABLE exchange_addresses ADD COLUMN IF NOT EXISTS delisted_at TIMESTAMPTZ;

UPDATE exchange_addresses
   SET delisted_at = '2026-08-21 10:00:00+00',
       notes = COALESCE(notes || ' ', '') || 'Delisted TX/USDT 2026-08-21 10:00 UTC.'
 WHERE address = 'core1yr8z44x2cxdaen0ha95qchqmugckxllwa7qcgx'
   AND delisted_at IS NULL;

INSERT INTO exchange_addresses (address, exchange_name, notes) VALUES
  ('core16yxk8guwrt6r8mx8pvk3n2dntlz9qm30qz0g0a', 'Ourbit', 'Added 2026-09-30.')
ON CONFLICT (address) DO UPDATE SET exchange_name = EXCLUDED.exchange_name;

-- What the dashboard reads. Same columns as exchange_flows; rows from a
-- delisted venue after its delisting are left out.
CREATE OR REPLACE VIEW exchange_flows_listed AS
SELECT ef.*
  FROM exchange_flows ef
  JOIN exchange_addresses ea ON ea.address = ef.exchange_address
 WHERE ea.delisted_at IS NULL OR ef.timestamp < ea.delisted_at;
