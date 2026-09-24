-- ─── stablecoins on TX ──────────────────────────────────────────────────
--
-- USTX, a native stablecoin issued by Brale, is announced for October 2026.
-- On 2026-09-24 it was not on mainnet (584 denoms) or testnet (5,492).
--
-- This exists before launch on purpose. The chain reports CURRENT supply and
-- holders only. Supply can be rebuilt afterwards from mint and burn events,
-- but holder count and holder concentration cannot: once day one has passed
-- nobody can say how many wallets held the coin that day. The collector has
-- to be running before the first mint for that history to exist at all.
--
-- Concentration is the metric that matters. Brale already issued a
-- stablecoin on this chain in 2024. SBC reached 10,287 in supply across 50
-- holders, and one wallet holds 97.2% of it. Supply alone would never have
-- shown that.

-- What we follow, and how each entry got here.
CREATE TABLE IF NOT EXISTS tracked_stablecoins (
  denom             TEXT         PRIMARY KEY,
  symbol            TEXT         NOT NULL,
  network           TEXT         NOT NULL CHECK (network IN ('mainnet', 'testnet')),
  kind              TEXT         NOT NULL CHECK (kind IN ('native', 'ibc')),
  issuer            TEXT,
  -- seed        added by this migration
  -- issuer      appeared under a watched issuer address
  -- symbol      matched the symbol scan
  source            TEXT         NOT NULL,
  first_seen_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- One row per stablecoin per collector run. Mainnet only: testnet is watched
-- for early warning of a launch, not measured.
CREATE TABLE IF NOT EXISTS stablecoin_snapshots (
  taken_at      TIMESTAMPTZ  NOT NULL,
  denom         TEXT         NOT NULL,
  supply        NUMERIC      NOT NULL,   -- display units, precision applied
  holders       INT,                     -- null when the owner list could not be read in full
  top1_share    NUMERIC,                 -- 0..1, largest holder / supply
  top10_share   NUMERIC,                 -- 0..1
  PRIMARY KEY (denom, taken_at)
);
CREATE INDEX IF NOT EXISTS idx_stablecoin_snapshots_taken ON stablecoin_snapshots (taken_at);

-- Seeds. Canonical USDC is the route from noble-1 over channel-19, which held
-- 56,502.80 of the 58,894.71 USDC on chain across 39 denoms. The rest are
-- Brale's three mainnet tokens, which is also where USTX is expected to land.
INSERT INTO tracked_stablecoins (denom, symbol, network, kind, issuer, source) VALUES
  ('ibc/E1E3674A0E4E1EF9C69646F9AF8D9497173821826074622D831BAB73CCB99A2D',
     'USDC', 'mainnet', 'ibc', NULL, 'seed'),
  ('usbc-core1rfxrg75fzuq5hgnnymjgsxj70d9w9cs8xuza7x',  'SBC',  'mainnet', 'native', 'core1rfxrg75fzuq5hgnnymjgsxj70d9w9cs8xuza7x', 'seed'),
  ('uysbc-core1rfxrg75fzuq5hgnnymjgsxj70d9w9cs8xuza7x', 'YSBC', 'mainnet', 'native', 'core1rfxrg75fzuq5hgnnymjgsxj70d9w9cs8xuza7x', 'seed'),
  ('uusdx-core1rfxrg75fzuq5hgnnymjgsxj70d9w9cs8xuza7x', 'USDX', 'mainnet', 'native', 'core1rfxrg75fzuq5hgnnymjgsxj70d9w9cs8xuza7x', 'seed')
ON CONFLICT (denom) DO NOTHING;
