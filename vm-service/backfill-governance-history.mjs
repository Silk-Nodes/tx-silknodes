#!/usr/bin/env node
// Pull the historical governance facts Coreum's indexer holds and we do not,
// so the validator detail route can answer from our own Postgres.
//
// Two things, both static once a proposal settles:
//
//   proposal_vote                        who voted what. The SDK deletes votes
//                                        from state on tally, so for settled
//                                        proposals this indexer is the only
//                                        copy in existence. collect-governance
//                                        captures live proposals from the
//                                        chain, which is why gov_votes holds
//                                        46 and nothing older.
//   proposal_validator_status_snapshot   which validators were in the set for
//                                        each proposal, so participation is
//                                        scored over a validator's tenure and
//                                        not over every proposal that ever
//                                        existed.
//
// Idempotent: ON CONFLICT DO NOTHING on both primary keys. Safe to re-run,
// and worth re-running after any proposal settles.
//
// Usage:
//   node vm-service/backfill-governance-history.mjs
//   node vm-service/backfill-governance-history.mjs --dry-run

import { query, closePool } from "./db.mjs";

const HASURA = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
const DRY = process.argv.includes("--dry-run");

const log = (lvl, ...m) => console.log(`[${new Date().toISOString()}] [${lvl.toUpperCase()}]`, ...m);

async function gql(q, variables) {
  const res = await fetch(HASURA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: q, variables }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 200));
  return json.data;
}
// Hasura enforces a 100-row response cap on this deployment regardless of the
// limit asked for, and offset paging on top of that quietly loses rows: the
// second run of this script pulled 7,089 votes and was still missing Silk
// Nodes' vote on proposal 31, which the indexer does hold. Counting rows was
// not enough to catch it; only diffing the proposal ids per voter was.
//
// So: no offsets. Page per proposal, and within a proposal keyset-page on
// voter_address, which is half the primary key and therefore unique and
// totally ordered. A page boundary cannot skip or repeat.
const PAGE = 100;

async function votesForProposal(id) {
  const out = [];
  let after = "";
  for (;;) {
    const d = await gql(
      `query($id:Int!,$after:String!,$l:Int!){
         proposal_vote(
           where:{proposal_id:{_eq:$id}, voter_address:{_gt:$after}}
           order_by:{voter_address:asc, height:asc} limit:$l
         ){ proposal_id voter_address option height } }`,
      { id, after, l: PAGE },
    );
    const batch = d?.proposal_vote ?? [];
    out.push(...batch);
    if (batch.length === 0) break;
    after = batch[batch.length - 1].voter_address;
  }
  return out;
}

async function statusForProposal(id) {
  const out = [];
  let after = "";
  for (;;) {
    const d = await gql(
      `query($id:Int!,$after:String!,$l:Int!){
         proposal_validator_status_snapshot(
           where:{proposal_id:{_eq:$id}, validator_address:{_gt:$after}}
           order_by:{validator_address:asc} limit:$l
         ){ proposal_id validator_address status } }`,
      { id, after, l: PAGE },
    );
    const batch = d?.proposal_validator_status_snapshot ?? [];
    out.push(...batch);
    if (batch.length === 0) break;
    after = batch[batch.length - 1].validator_address;
  }
  return out;
}

// Proposal ids come from our own gov_proposals, which collect-governance keeps
// current from the chain. Asking the indexer which proposals exist would make
// the completeness of this backfill depend on the thing it is working around.
async function proposalIds() {
  const rows = await query(`SELECT id FROM gov_proposals ORDER BY id`);
  return (rows.rows ?? rows).map((r) => Number(r.id));
}

async function main() {
  log("info", `backfill governance history (dry_run=${DRY})`);

  const ids = await proposalIds();
  log("info", `${ids.length} proposals to walk`);

  const votes = [];
  const status = [];
  for (const id of ids) {
    const v = await votesForProposal(id);
    const st = await statusForProposal(id);
    votes.push(...v);
    status.push(...st);
    if (v.length || st.length) log("info", `  proposal ${id}: ${v.length} votes, ${st.length} in set`);
  }

  const props = new Set(votes.map((v) => v.proposal_id));
  log("info", `${votes.length} votes across ${props.size} proposals, ${status.length} status rows`);

  if (DRY) {
    log("info", "[dry-run] nothing written");
    return;
  }

  let v = 0;
  for (const r of votes) {
    if (!r.voter_address || !r.option) continue;
    // A voter can change its vote, and the indexer keeps every row: Silk Nodes
    // voted ABSTAIN on proposal 31 at height 65,774,246 and then NO at
    // 66,179,194. gov_votes holds one row per (proposal, voter), so the tie
    // has to break on height or we store a superseded vote as if it were the
    // record. DO NOTHING did exactly that. Highest height wins; a null height
    // never displaces a known one.
    const res = await query(
      `INSERT INTO gov_votes (proposal_id, voter_address, option, weight, observed_height)
       VALUES ($1,$2,$3,1,$4)
       ON CONFLICT (proposal_id, voter_address) DO UPDATE SET
         option = EXCLUDED.option,
         observed_height = EXCLUDED.observed_height
       WHERE EXCLUDED.observed_height IS NOT NULL
         AND (gov_votes.observed_height IS NULL
              OR EXCLUDED.observed_height > gov_votes.observed_height)`,
      [r.proposal_id, r.voter_address, String(r.option).replace("VOTE_OPTION_", ""), r.height ?? null],
    );
    v += res.rowCount ?? 0;
  }

  let s = 0;
  for (const r of status) {
    if (!r.validator_address) continue;
    const res = await query(
      `INSERT INTO gov_validator_status (proposal_id, validator_address, status)
       VALUES ($1,$2,$3)
       ON CONFLICT (proposal_id, validator_address) DO NOTHING`,
      [r.proposal_id, r.validator_address, r.status ?? null],
    );
    s += res.rowCount ?? 0;
  }

  log("info", `inserted ${v} votes and ${s} status rows (the rest were already present)`);
}

main()
  .catch((e) => { log("error", e.stack || e.message); process.exitCode = 1; })
  .finally(() => closePool());
