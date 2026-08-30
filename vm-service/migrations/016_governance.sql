-- ─── governance: proposals, votes, tally history ───────────────────────
-- Our own copy of governance data, so the page does not go blank when the
-- Coreum indexer is unavailable. It returned HTTP 503 for everyone on
-- 2026-08-27 and again on 2026-08-30, during a live vote both times.
--
-- Two of these tables record things the CHAIN cannot tell us later:
--
--   gov_votes       The SDK deletes votes from state the moment a proposal
--                   is tallied. Once prop 45 settled, /proposals/45/votes
--                   returned nothing, forever. Anything not captured while
--                   the proposal was live is gone. This is the same class
--                   of problem as validator_snapshots: not backfillable,
--                   so every hour we do not run is a permanent hole.
--
--   gov_tally_snapshots
--                   The chain exposes the CURRENT tally only. The vote
--                   velocity chart needs the shape over time, which means
--                   somebody has to write it down as it happens.
--
-- gov_proposals is recoverable from the chain at any time and is kept
-- mainly so the list renders from one place.
CREATE TABLE IF NOT EXISTS gov_proposals (
  id                  INT          PRIMARY KEY,
  title               TEXT         NOT NULL,
  summary             TEXT,
  status              TEXT         NOT NULL,  -- PROPOSAL_STATUS_*
  proposal_type       TEXT,                   -- first message @type
  proposer            TEXT,
  submit_time         TIMESTAMPTZ,
  voting_start_time   TIMESTAMPTZ,
  voting_end_time     TIMESTAMPTZ,
  -- Final tally, populated by the chain only once the proposal settles.
  final_yes           NUMERIC,
  final_no            NUMERIC,
  final_abstain       NUMERIC,
  final_no_with_veto  NUMERIC,
  -- Bonded stake when we last saw it live, so turnout stays computable
  -- after the fact. The chain does not retain this per proposal.
  bonded_snapshot     NUMERIC,
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- One row per (proposal, voter). A voter can change their vote while the
-- proposal is live, so option is updated in place and first_seen_at keeps
-- the moment we first observed them voting.
--
-- first_seen_at is ours, not the chain's. The chain records THAT a vote
-- exists, never WHEN it was cast. Our observation time is the only clock
-- available, which is why the velocity chart needs this table rather than
-- the chain.
CREATE TABLE IF NOT EXISTS gov_votes (
  proposal_id    INT          NOT NULL,
  voter_address  TEXT         NOT NULL,
  option         TEXT         NOT NULL,  -- YES | NO | ABSTAIN | NO_WITH_VETO
  weight         NUMERIC      NOT NULL DEFAULT 1,
  first_seen_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  observed_height BIGINT,
  PRIMARY KEY (proposal_id, voter_address)
);
CREATE INDEX IF NOT EXISTS gov_votes_proposal_idx  ON gov_votes (proposal_id);
CREATE INDEX IF NOT EXISTS gov_votes_first_seen_idx ON gov_votes (proposal_id, first_seen_at);

-- Tally over time, one row per observation while a proposal is live.
-- Powers the velocity chart without depending on anyone else's index.
CREATE TABLE IF NOT EXISTS gov_tally_snapshots (
  proposal_id   INT          NOT NULL,
  observed_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  yes           NUMERIC      NOT NULL,
  no            NUMERIC      NOT NULL,
  abstain       NUMERIC      NOT NULL,
  no_with_veto  NUMERIC      NOT NULL,
  bonded        NUMERIC,
  PRIMARY KEY (proposal_id, observed_at)
);
CREATE INDEX IF NOT EXISTS gov_tally_proposal_idx ON gov_tally_snapshots (proposal_id, observed_at);
