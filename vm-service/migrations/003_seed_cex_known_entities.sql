-- Seed the four known exchange wallets as known_entities so they show up
-- with proper labels in the Whale Tracker and Top Delegators table.
--
-- The collector's writeKnownEntities() does per-row UPSERT (not TRUNCATE)
-- and only touches addresses it builds from on-chain data (validator
-- self-stakes + PSE-excluded). It will not overwrite or delete these CEX
-- rows because the addresses aren't in either of those sets.
--
-- Idempotent. Re-running this migration is safe; ON CONFLICT DO UPDATE
-- keeps the labels in sync with what's defined here.

INSERT INTO known_entities (address, label, type, verified, source) VALUES
  ('core155svs6sgxe55rnvs6ghprtqu0mh69kehsahk8c', 'Gate',   'cex', true, 'community-sourced 2026-04-29'),
  ('core1ctpu5ssl0hys60ukglv9pwzmqtys3x9gn8fh5l', 'Kraken', 'cex', true, 'community-sourced 2026-04-29'),
  ('core12lj6mhmhuvjwfwwxkzucqq9vq7hkp0gl5tnune', 'MEXC',   'cex', true, 'community-sourced 2026-04-29'),
  ('core1g2c72hh78wma9fqlva9wu5a9hx5vq8aeznltds', 'Bitrue', 'cex', true, 'community-sourced 2026-04-29')
ON CONFLICT (address) DO UPDATE SET
  label    = EXCLUDED.label,
  type     = EXCLUDED.type,
  verified = EXCLUDED.verified,
  source   = EXCLUDED.source;
