-- Add Bitget hot wallet to the tracked exchange list. Source:
-- community-confirmed address from Silk Nodes team, 2026-05-15.
--
-- After this migration runs and silknodes-exchange-flows.service ticks:
--   1. listExchangeAddresses() will return the new row.
--   2. exchange_flows_state cursor for this address is absent → treated
--      as 0 → next scan walks from genesis to current height.
--   3. Historical Bitget inflows/outflows populate exchange_flows.
--   4. /api/flows and the Flows page light up automatically; no UI
--      changes needed.
--
-- ON CONFLICT keeps the row idempotent — re-running the migration is
-- a no-op except for the exchange_name refresh.
INSERT INTO exchange_addresses (address, exchange_name) VALUES
  ('core1yr8z44x2cxdaen0ha95qchqmugckxllwa7qcgx', 'Bitget')
ON CONFLICT (address) DO UPDATE SET exchange_name = EXCLUDED.exchange_name;
