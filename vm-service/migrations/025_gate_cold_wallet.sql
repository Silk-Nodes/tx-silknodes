-- Gate's cold wallet, and internal exchange moves left out of flows.
--
-- core1xunyznpjmj9jv5e2zwngp2qrzmulr2ggtke9wd has only ever moved TX with
-- Gate's hot wallet: 60 of its 62 sends since 2022, the rest small
-- multisends (checked against the indexer on 2026-11-09). On 2026-11-03,
-- block 92,562,916, Gate sent it 316.43M TX, and the flows pages counted
-- that as a withdrawal. It turned a week of net deposits into a -266M week.
--
-- The label goes in known_entities, not exchange_addresses: adding it there
-- would make the collector rescan the wallet from genesis, and nothing it
-- does is customer flow anyway.
--
-- Idempotent.

INSERT INTO known_entities (address, label, type, verified, source) VALUES
  ('core1xunyznpjmj9jv5e2zwngp2qrzmulr2ggtke9wd', 'Gate', 'cex', true,
   'on-chain: 60 of 62 sends with the Gate hot wallet since 2022, checked 2026-11-09')
ON CONFLICT (address) DO UPDATE SET
  label    = EXCLUDED.label,
  type     = EXCLUDED.type,
  verified = EXCLUDED.verified,
  source   = EXCLUDED.source;

-- A transfer between two wallets of the same exchange is the exchange moving
-- its own coins, not a deposit or a withdrawal. Every flows route reads this
-- view, so the rule applies everywhere at once. On 2026-11-10 it drops one
-- row: the 316.43M above. No other cex-labelled wallet shares an exchange's
-- name today.
CREATE OR REPLACE VIEW exchange_flows_listed AS
SELECT ef.*
  FROM exchange_flows ef
  JOIN exchange_addresses ea ON ea.address = ef.exchange_address
 WHERE (ea.delisted_at IS NULL OR ef.timestamp < ea.delisted_at)
   AND NOT EXISTS (
     SELECT 1 FROM known_entities ke
      WHERE ke.address = ef.counterparty
        AND ke.type = 'cex'
        AND ke.label = ea.exchange_name
   );
