-- ─── news_items ───────────────────────────────────────────────────────
-- External news pulled from free sources and surfaced in the Today page
-- "What's happening" feed. Currently:
--   source = 'twitter'  pulled from cdn.syndication.twitter.com (no API key)
--   source = 'medium'   pulled from medium.com/feed/@txEcosystem
--   source = 'tx_press' scraped from tx.org/press-and-media
--
-- Dedupe is by (source, external_id). external_id is whatever stable
-- identifier the source provides: tweet id, RSS guid, or sha1 of the
-- press article URL. The UNIQUE constraint means re-running the
-- collector is idempotent.
--
-- severity drives UI emphasis. 'high' items get an ANNOUNCEMENT badge in
-- the feed. The collector sets this based on Medium tags (announcement,
-- governance, partnership, roadmap, upgrade) and on press release type.
-- Twitter posts default to 'normal' since we have no signal there.
--
-- tags is a JSON array for Medium posts; null for sources without tags.
-- raw is the original payload for forensics and future re-derivation
-- without re-fetching the upstream source.
--
-- Retention: 90 days, pruned by collect-news.mjs on each tick.
CREATE TABLE IF NOT EXISTS news_items (
  id           BIGSERIAL   PRIMARY KEY,
  source       TEXT        NOT NULL
                 CHECK (source IN ('twitter', 'medium', 'tx_press')),
  external_id  TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  url          TEXT        NOT NULL,
  summary      TEXT,
  ts           TIMESTAMPTZ NOT NULL,
  severity     TEXT        NOT NULL DEFAULT 'normal'
                 CHECK (severity IN ('normal', 'high')),
  tags         JSONB,
  raw          JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, external_id)
);

-- Feed query plan: ORDER BY ts DESC LIMIT 6. Index covers both the
-- merged-feed read and the 90d retention prune.
CREATE INDEX IF NOT EXISTS idx_news_items_ts
  ON news_items (ts DESC);

-- Source-specific reads (e.g. "latest tweet we saw") for incremental
-- pulling.
CREATE INDEX IF NOT EXISTS idx_news_items_source_ts
  ON news_items (source, ts DESC);
