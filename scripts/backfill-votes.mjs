// Regenerates src/data/historical-votes.json.
//
// Hasura records no votes at all for a handful of early proposals, and the
// chain cannot be asked for them live: the SDK deletes votes once a proposal
// settles, so the vote TRANSACTION is the only surviving evidence.
//
// Neither of the node's two relevant tx indexes is complete on its own, so
// this unions both:
//
//   1. by proposal (`proposal_vote.proposal_id`) — catches every voter on a
//      proposal, but missed TX Forge's vote on proposal 5.
//   2. by sender (`message.sender`) per validator self-delegate address —
//      missed TX Forge's votes on proposals 6 and 8, which pass 1 found.
//
// Each pass recovers votes the other drops, on the same node, for the same
// txs. Trusting either alone silently undercounts participation, which is the
// bug this file exists to fix. Pass 2 only adds votes pass 1 lacks.
//
// These proposals are settled, so the output is immutable, not a cache.
//
//   node scripts/backfill-votes.mjs
//
// Re-run only if Hasura loses votes for additional proposals; add their ids to
// GAPS below. Ids Hasura already covers must NOT be listed: the indexer has
// the full history and stays authoritative for anything it recorded.

import { writeFileSync } from "node:fs";

// Must be an ARCHIVE node. A pruned node answers successfully with fewer
// votes, which is worse than failing.
const LCD = process.env.LCD || "https://full-node.mainnet-1.coreum.dev:1317";
// Every real proposal. Id 3 is skipped because it does not exist on chain:
// its deposit period expired, so the SDK deleted it. That is why the chain
// has 43 proposals spread across ids 1 to 44.
//
// This deliberately covers ALL proposals, not just the nine where Hasura has
// no votes at all. Hasura also drops INDIVIDUAL votes inside proposals it
// otherwise indexes: it holds votes for proposals 9 and 10 but not TX Forge's,
// which is why that validator read as 39 of 43 when the chain says 41. The
// loss is per vote, so only a full scan finds it.
const GAPS = Array.from({ length: 44 }, (_, i) => i + 1).filter((n) => n !== 3);
const OUT = "src/data/historical-votes.json";

const LABEL = {
  VOTE_OPTION_YES: "YES",
  VOTE_OPTION_NO: "NO",
  VOTE_OPTION_ABSTAIN: "ABSTAIN",
  VOTE_OPTION_NO_WITH_VETO: "NO_WITH_VETO",
};

async function votesFor(pid) {
  const votes = {};
  for (let offset = 0; offset <= 2000; offset += 100) {
    const q = encodeURIComponent(`proposal_vote.proposal_id=${pid}`);
    const url = `${LCD}/cosmos/tx/v1beta1/txs?query=${q}&pagination.limit=100&pagination.offset=${offset}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`proposal ${pid}: HTTP ${res.status}`);
    const { txs = [] } = await res.json();
    for (const tx of txs) {
      for (const m of tx?.body?.messages ?? []) {
        if (!String(m["@type"] ?? "").includes("MsgVote")) continue;
        if (Number(m.proposal_id) !== pid || !m.voter) continue;
        // MsgVoteWeighted carries `options`; take the heaviest.
        const opt =
          m.option ??
          (m.options ?? []).reduce(
            (best, o) => (Number(o.weight) > Number(best?.weight ?? -1) ? o : best),
            null,
          )?.option;
        // Later txs overwrite earlier ones, so a changed vote keeps the last.
        if (opt) votes[m.voter] = LABEL[opt] ?? opt;
      }
    }
    if (txs.length < 100) break;
  }
  return Object.fromEntries(Object.keys(votes).sort().map((k) => [k, votes[k]]));
}

// Pass 2: sweep the sender index for every validator's self-delegate address.
async function votesBySender(voter) {
  const found = {};
  for (const action of [
    "/cosmos.gov.v1beta1.MsgVote",
    "/cosmos.gov.v1.MsgVote",
    "/cosmos.gov.v1beta1.MsgVoteWeighted",
    "/cosmos.gov.v1.MsgVoteWeighted",
  ]) {
    for (let offset = 0; offset <= 500; offset += 100) {
      const q = encodeURIComponent(
        `message.sender='${voter}' AND message.action='${action}'`,
      );
      const url = `${LCD}/cosmos/tx/v1beta1/txs?query=${q}&pagination.limit=100&pagination.offset=${offset}`;
      let txs;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
        if (!res.ok) break;
        ({ txs = [] } = await res.json());
      } catch {
        break;
      }
      for (const tx of txs) {
        for (const m of tx?.body?.messages ?? []) {
          if (!String(m["@type"] ?? "").includes("MsgVote")) continue;
          const pid = Number(m.proposal_id);
          if (!GAPS.includes(pid)) continue; // indexer owns the rest
          const opt =
            m.option ??
            (m.options ?? []).reduce(
              (best, o) => (Number(o.weight) > Number(best?.weight ?? -1) ? o : best),
              null,
            )?.option;
          if (opt) (found[pid] ??= {})[voter] = LABEL[opt] ?? opt;
        }
      }
      if (txs.length < 100) break;
    }
  }
  return found;
}

async function selfDelegateAddresses() {
  const res = await fetch("https://hasura.mainnet-1.coreum.dev/v1/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "{ validator_info { self_delegate_address } }",
    }),
    signal: AbortSignal.timeout(60000),
  });
  const json = await res.json();
  return [
    ...new Set(
      (json?.data?.validator_info ?? [])
        .map((r) => r.self_delegate_address)
        .filter((a) => typeof a === "string" && a.startsWith("core1")),
    ),
  ];
}

const out = {};
for (const pid of GAPS) {
  out[pid] = await votesFor(pid);
  console.log(`  proposal ${pid}: ${Object.keys(out[pid]).length} voters`);
}

const addrs = await selfDelegateAddresses();
console.log(`sender sweep over ${addrs.length} validator addresses`);
let added = 0;
for (const a of addrs) {
  for (const [pid, voters] of Object.entries(await votesBySender(a))) {
    for (const [voter, opt] of Object.entries(voters)) {
      if (out[pid]?.[voter]) continue;
      (out[pid] ??= {})[voter] = opt;
      added++;
      console.log(`  + proposal ${pid}: ${voter} = ${opt} (sender index only)`);
    }
  }
}
console.log(`sender sweep added ${added} votes the proposal index missed`);

for (const pid of Object.keys(out)) {
  out[pid] = Object.fromEntries(Object.keys(out[pid]).sort().map((k) => [k, out[pid][k]]));
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`wrote ${OUT}: ${Object.values(out).reduce((n, v) => n + Object.keys(v).length, 0)} records`);
