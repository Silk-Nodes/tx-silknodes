-- ─── feature_requests ─────────────────────────────────────────────────
-- Public-facing feature-request board served at /feedback. People submit
-- ideas, anyone (per browser, cookie-identified) can upvote. Status is
-- managed by Silk Nodes operators via direct SQL (no admin UI in v1).
--
-- Privacy: submitter_id is a cookie UUID — opaque, never displayed.
-- submitter_ip is kept for abuse forensics only — never returned by the
-- public API. The two columns together let us moderate spam without
-- exposing anyone's identity to the rest of the community.
--
-- vote_count is denormalized: incremented in the same transaction as a
-- vote insert so the public list query can ORDER BY it without an
-- aggregate scan. Recovery: a periodic check can rebuild it from
-- feature_request_votes if it ever drifts.
CREATE TABLE IF NOT EXISTS feature_requests (
  id            BIGSERIAL PRIMARY KEY,
  title         TEXT        NOT NULL,
  description   TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'planned', 'in_progress', 'shipped', 'declined')),
  vote_count    INTEGER     NOT NULL DEFAULT 0,
  submitter_id  TEXT,
  submitter_ip  TEXT,
  hidden        BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(title) BETWEEN 10 AND 120),
  CHECK (char_length(description) BETWEEN 20 AND 2000)
);

-- Public list query plan: filter on (NOT hidden), order by vote_count
-- DESC (or created_at DESC). Partial index excludes hidden rows
-- entirely so spam never costs us at query time.
CREATE INDEX IF NOT EXISTS idx_feature_requests_open_votes
  ON feature_requests (status, vote_count DESC, created_at DESC)
  WHERE NOT hidden;

-- Rate-limit query plan: count submissions from one IP in the last 24h.
CREATE INDEX IF NOT EXISTS idx_feature_requests_submitter_ip_time
  ON feature_requests (submitter_ip, created_at DESC);

-- ─── feature_request_votes ────────────────────────────────────────────
-- One row per (request, voter cookie). PK enforces "one vote per
-- browser per request" without a separate UNIQUE constraint. Voter_ip
-- is recorded for forensics; not displayed.
CREATE TABLE IF NOT EXISTS feature_request_votes (
  request_id    BIGINT      NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
  voter_id      TEXT        NOT NULL,
  voter_ip      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (request_id, voter_id)
);

CREATE INDEX IF NOT EXISTS idx_feature_request_votes_voter
  ON feature_request_votes (voter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feature_request_votes_voter_ip_time
  ON feature_request_votes (voter_ip, created_at DESC);
