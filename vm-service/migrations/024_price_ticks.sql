-- ─── TX price from the exchanges ────────────────────────────────────────
--
-- The site's price came from CoinGecko's free plan alone, which reached 80%
-- of its monthly call cap on 2026-10-01, and which left every price number
-- on the site with no second source. collect-price.mjs now reads the TX
-- ticker straight from the venues that list it (Gate, Ourbit, Kraken, MEXC,
-- Bitrue: public endpoints, no key) once a minute and stores one row here.
-- CoinGecko is read every 30 minutes as a cross-check only.

CREATE TABLE IF NOT EXISTS price_ticks (
  taken_at     TIMESTAMPTZ  PRIMARY KEY,
  price_usd    NUMERIC      NOT NULL,   -- volume-weighted across the venues used
  open_24h     NUMERIC,                 -- volume-weighted 24h open, for the change
  volume_usd   NUMERIC,                 -- 24h quote volume summed, USDT counted as USD
  venues_used  INT          NOT NULL,
  sources      JSONB        NOT NULL,   -- per venue: price, volume, used, reason if dropped
  cg_price     NUMERIC                  -- CoinGecko price when this run cross-checked
);
