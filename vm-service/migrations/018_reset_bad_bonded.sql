-- ─── clear bonded_snapshot values written by the broken estimator ──────
-- The first version of the governance collector estimated a proposal's
-- closing height from a fixed 0.742s block time. Block time has averaged
-- ~1.27s over the chain's life, so anything older than a few months
-- estimated to a NEGATIVE height, clamped to 1, and read genesis-era bonded
-- stake of ~80,600 TX. The list then rendered turnout figures like
-- "Q 140564%".
--
-- Null them so the fixed collector recomputes with a real binary search on
-- block timestamps. Only obviously-broken rows are cleared: a proposal
-- cannot have more stake vote than was bonded, so anything implying over
-- 105% turnout is wrong by definition. Correct rows are left alone.
UPDATE gov_proposals
   SET bonded_snapshot = NULL
 WHERE bonded_snapshot IS NOT NULL
   AND COALESCE(final_yes,0) + COALESCE(final_no,0)
     + COALESCE(final_abstain,0) + COALESCE(final_no_with_veto,0)
     > bonded_snapshot * 1.05;
