-- Exchange flows: track Bank Send transactions touching known centralized
-- exchange wallet addresses so we can surface net inflow / outflow signals
-- on the Flows tab.
--
-- Direction is from the EXCHANGE's perspective:
--   inflow  = TX moving INTO the exchange wallet (someone sending to them)
--   outflow = TX moving OUT of the exchange wallet (exchange sending out)
--
-- Idempotent: re-running this file is safe.

-- ─── exchange_addresses ──────────────────────────────────────────────────
-- Hand-curated allowlist of addresses we treat as exchange wallets. CRUD-able
-- so new exchanges can be added via SQL without code change. The addresses
-- here are the four hot wallets confirmed by community member Elite_TX_Army
-- on 2026-04-29; the exchange names match the Twitter post they came from.
CREATE TABLE IF NOT EXISTS exchange_addresses (
  address       TEXT PRIMARY KEY,
  exchange_name TEXT        NOT NULL,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes         TEXT
);

-- Seed the four known addresses. ON CONFLICT keeps the existing row but
-- refreshes the exchange_name so a typo fix in this file gets picked up
-- on next migration run.
INSERT INTO exchange_addresses (address, exchange_name) VALUES
  ('core155svs6sgxe55rnvs6ghprtqu0mh69kehsahk8c', 'Gate'),
  ('core1ctpu5ssl0hys60ukglv9pwzmqtys3x9gn8fh5l', 'Kraken'),
  ('core12lj6mhmhuvjwfwwxkzucqq9vq7hkp0gl5tnune', 'MEXC'),
  ('core1g2c72hh78wma9fqlva9wu5a9hx5vq8aeznltds', 'Bitrue')
ON CONFLICT (address) DO UPDATE SET exchange_name = EXCLUDED.exchange_name;

-- ─── exchange_flows ──────────────────────────────────────────────────────
-- One row per Bank Send touching an exchange address. A single transaction
-- can produce two rows if the same address appears as both sender and
-- recipient (rare, but the UNIQUE constraint allows it).
--
-- amount is in TX (display units, not ucore). The collector converts.
--
-- The UNIQUE constraint includes (tx_hash, exchange_address, direction)
-- so the dedupe handles tx_hash collisions across different exchanges
-- (when two of our tracked addresses are involved in one tx) and lets the
-- collector use ON CONFLICT DO NOTHING to be idempotent on re-fetch.
CREATE TABLE IF NOT EXISTS exchange_flows (
  id               BIGSERIAL PRIMARY KEY,
  tx_hash          TEXT        NOT NULL,
  height           BIGINT      NOT NULL,
  timestamp        TIMESTAMPTZ NOT NULL,
  exchange_address TEXT        NOT NULL REFERENCES exchange_addresses(address),
  direction        TEXT        NOT NULL CHECK (direction IN ('inflow', 'outflow')),
  counterparty     TEXT        NOT NULL,
  amount           NUMERIC     NOT NULL,
  inserted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tx_hash, exchange_address, direction, counterparty, amount)
);

CREATE INDEX IF NOT EXISTS idx_exchange_flows_timestamp
  ON exchange_flows (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_exchange_flows_exchange_ts
  ON exchange_flows (exchange_address, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_exchange_flows_height
  ON exchange_flows (height DESC);

-- ─── exchange_flows_state ────────────────────────────────────────────────
-- Cursor table so the collector can resume from the last block height it
-- successfully processed for each address — avoids re-scanning the whole
-- chain on every poll cycle.
CREATE TABLE IF NOT EXISTS exchange_flows_state (
  exchange_address    TEXT PRIMARY KEY REFERENCES exchange_addresses(address),
  last_scanned_height BIGINT      NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
