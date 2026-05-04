-- Pending community submissions for the Top Private Destinations
-- audit panel. Visitors who recognise an address (e.g. "core1xyz is
-- Bybit's hot wallet") submit via the Flows page. Submissions land
-- here for human review; approved rows get UPSERTed into
-- known_entities.
--
-- One row per submission, not per address — multiple people can
-- submit the same address, which is itself useful signal that the
-- guess is probably right.
--
-- status:
--   pending    awaiting review
--   approved   migrated into known_entities (kept here for audit)
--   rejected   reviewed and rejected; address stays in the pool
--
-- Rate limiting + honeypot is enforced at the API layer; this table
-- just stores. submitter_ip kept for abuse forensics, not displayed.
CREATE TABLE IF NOT EXISTS entity_submissions (
  id            BIGSERIAL   PRIMARY KEY,
  address       TEXT        NOT NULL,
  label         TEXT        NOT NULL,
  type          TEXT        NOT NULL,
  source        TEXT,
  submitter_ip  TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at   TIMESTAMPTZ,
  reviewer_note TEXT
);

-- Speeds up "any pending submission for this address?" lookups
-- driven by the audit panel.
CREATE INDEX IF NOT EXISTS idx_entity_submissions_address_status
  ON entity_submissions (address, status);

-- Speeds up the rate-limit "submissions from this IP in the last
-- hour" check.
CREATE INDEX IF NOT EXISTS idx_entity_submissions_ip_time
  ON entity_submissions (submitter_ip, submitted_at DESC);
