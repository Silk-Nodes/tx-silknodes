-- ─── gov_validator_status: which validators could vote on what ──────────
--
-- The validator detail route asked Coreum's Hasura indexer for this on every
-- page load, alongside a second call for the validator's own votes. The two
-- ran in parallel with each other but after the chain calls, so they cost one
-- round trip of 390 to 460ms on the request path. That is the largest single
-- item left in the endpoint after PR #287.
--
-- Both are historical facts about settled proposals: they do not change. They
-- belong in our own Postgres next to gov_proposals and gov_votes.
--
-- Why this matters beyond speed: the Cosmos SDK deletes votes from state the
-- moment a proposal is tallied, so for settled proposals Coreum's indexer is
-- the only copy that exists. Keeping our own means a validator's governance
-- record survives that indexer going down, which it did for three days during
-- a live vote on 2026-08-27 and again on 08-30.
--
-- status is the SDK BondStatus enum (1 unbonded, 2 unbonding, 3 bonded). We
-- keep it rather than filtering on write, so a later question about who was
-- unbonding at vote time is answerable without refetching.
CREATE TABLE IF NOT EXISTS gov_validator_status (
  proposal_id       INT   NOT NULL,
  validator_address TEXT  NOT NULL,   -- corevalcons..., the consensus address
  status            INT,
  PRIMARY KEY (proposal_id, validator_address)
);

-- The route's query is "every proposal this consensus address was in the set
-- for", so the consensus address leads.
CREATE INDEX IF NOT EXISTS idx_gov_validator_status_validator
  ON gov_validator_status (validator_address, proposal_id);

-- gov_votes is keyed (proposal_id, voter_address). The route asks the other
-- way round: "every vote this address ever cast".
CREATE INDEX IF NOT EXISTS idx_gov_votes_voter
  ON gov_votes (voter_address, proposal_id);
