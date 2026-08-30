-- ─── validator_identity ────────────────────────────────────────────────
-- Moniker, Keybase identity, avatar and website for every validator, owned
-- by us instead of read from the Coreum indexer.
--
-- Why this exists: validator logos vanished site-wide on 2026-08-30 when
-- hasura.mainnet-1.coreum.dev returned 503 for two days. avatar_url and
-- website came only from that indexer's validator_description table, so
-- every validator on every page rendered without a logo. Monikers survived
-- because they already come from validator_snapshots, which is ours.
--
-- None of this needs the indexer. The chain carries moniker, website and
-- identity in each validator's description, and identity is the Keybase
-- suffix that resolves to a picture. We already do that lookup on the
-- validator detail page; this just stores the result so every page can use
-- it and a Keybase outage cannot blank the site either.
--
-- One row per validator, not one per day. Identity changes are rare and a
-- daily snapshot of an unchanging avatar URL is noise. updated_at records
-- when we last confirmed it.
--
-- avatar_url is nullable on purpose: a validator with no Keybase identity
-- has no avatar, which is a real answer and not a failure. avatar_checked_at
-- separates "we looked and there is none" from "we have not looked yet", so
-- a Keybase outage does not get cached as a permanent absence.
CREATE TABLE IF NOT EXISTS validator_identity (
  operator_address  TEXT         PRIMARY KEY,
  moniker           TEXT         NOT NULL,
  identity          TEXT,                    -- Keybase key suffix, may be ''
  avatar_url        TEXT,
  website           TEXT,
  details           TEXT,
  avatar_checked_at TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS validator_identity_updated_idx ON validator_identity (updated_at);
