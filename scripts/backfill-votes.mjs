// Regenerates src/data/historical-votes.json: the complete historical vote
// record, read from the chain.
//
// Why this file has to exist at all
// ---------------------------------
// Hasura loses votes two ways. It has no votes at all for proposals 1, 2, 4,
// 5, 6, 7, 8, 40 and 42, and it also drops INDIVIDUAL votes inside proposals
// it does index (it holds proposal 9 and 10 votes but not TX Forge's). Those
// votes cannot be re-read live either: the SDK deletes votes once a proposal
// settles, so the vote TRANSACTION is the only surviving evidence.
//
// Why the enumeration looks so paranoid
// -------------------------------------
// The node's tx search silently caps every query at 100 results. BOTH forms of
// paging are ignored: `pagination.offset` returns the same first page forever
// (walking it "found" 1600 txs for a query whose total is 166), and
// `pagination.page` returns nothing new after page 1. There is no error and no
// truncation flag. A query reporting total=166 hands back 100 txs and looks
// complete.
//
// That cost real accuracy. Proposal 7 appeared to have 95 voters and TX Forge
// appeared to have abstained from it, so the site showed 42 of 43 and called a
// validator's perfect record imperfect. Proposal 7 actually has 162 voters and
// TX Forge voted YES. Its real record is 43 of 43.
//
// So results are never paged. Instead each query is constrained to a height
// window, and any window whose reported total exceeds the 100 cap is split in
// half and recursed until every window fits under it. Then the cap is never
// reached and nothing is silently dropped. Proposal 7 resolves in 19 queries.
//
// Usage:
//   node scripts/backfill-votes.mjs
//
// The output is a snapshot, not a cache: every proposal here has settled, and
// settled votes are immutable.

import { writeFileSync } from "node:fs";

// Must be an ARCHIVE node. A pruned node answers successfully with fewer
// votes, which is worse than failing.
const LCD = process.env.LCD || "https://full-node.mainnet-1.coreum.dev:1317";
const OUT = "src/data/historical-votes.json";

// Every real proposal. Id 3 is skipped because it does not exist on chain: its
// deposit period expired, so the SDK deleted it. That is why the chain has 43
// proposals spread across ids 1 to 44.
const PROPOSALS = Array.from({ length: 44 }, (_, i) => i + 1).filter((n) => n !== 3);

// The node returns at most this many txs per query regardless of what is asked
// for, and does not say so. Windows are split until they fit underneath it.
const PAGE_CAP = 100;

const LABEL = {
  VOTE_OPTION_YES: "YES",
  VOTE_OPTION_NO: "NO",
  VOTE_OPTION_ABSTAIN: "ABSTAIN",
  VOTE_OPTION_NO_WITH_VETO: "NO_WITH_VETO",
};

async function get(query, limit) {
  const url = `${LCD}/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(query)}&pagination.limit=${limit}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (res.ok) return await res.json();
    } catch {
      // retry
    }
  }
  throw new Error(`query failed after 3 attempts: ${query}`);
}

// Votes can be wrapped in an authz MsgExec, which puts the real MsgVote one
// level down. Reading only body.messages would miss those entirely.
function* flatten(messages) {
  for (const m of messages ?? []) {
    yield m;
    yield* flatten(m.msgs);
  }
}

function collect(json, sink) {
  for (const tx of json?.txs ?? []) {
    for (const m of flatten(tx?.body?.messages)) {
      if (!String(m["@type"] ?? "").includes("MsgVote") || !m.voter) continue;
      // MsgVoteWeighted carries `options` instead of `option`; take the heaviest.
      const opt =
        m.option ??
        (m.options ?? []).reduce(
          (best, o) => (Number(o.weight) > Number(best?.weight ?? -1) ? o : best),
          null,
        )?.option;
      if (opt) sink(Number(m.proposal_id), m.voter, LABEL[opt] ?? opt);
    }
  }
}

// Walks a height range, splitting any window that would hit the silent cap.
// Windows are visited in ascending height order, so a validator that changed
// its vote ends up with the later one.
async function walk(baseQuery, lo, hi, sink, stats) {
  const scoped = `${baseQuery} AND tx.height>=${lo} AND tx.height<=${hi}`;
  stats.queries++;
  const total = Number((await get(scoped, 1))?.total ?? 0);
  if (total === 0) return;
  if (total > PAGE_CAP && hi > lo) {
    const mid = Math.floor((lo + hi) / 2);
    await walk(baseQuery, lo, mid, sink, stats);
    await walk(baseQuery, mid + 1, hi, sink, stats);
    return;
  }
  stats.queries++;
  collect(await get(scoped, PAGE_CAP), sink);
}

async function chainTip() {
  const res = await fetch(`${LCD}/cosmos/base/tendermint/v1beta1/blocks/latest`, {
    signal: AbortSignal.timeout(60000),
  });
  return Number((await res.json())?.block?.header?.height);
}

async function selfDelegateAddresses() {
  const res = await fetch("https://hasura.mainnet-1.coreum.dev/v1/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "{ validator_info { self_delegate_address } }" }),
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

const tip = await chainTip();
console.log(`chain tip ${tip}`);

const out = {};
const sink = (pid, voter, opt) => {
  if (!PROPOSALS.includes(pid)) return;
  (out[pid] ??= {})[voter] = opt;
};

// Pass 1: by proposal. This is the authoritative sweep.
for (const pid of PROPOSALS) {
  const stats = { queries: 0 };
  await walk(`proposal_vote.proposal_id=${pid}`, 1, tip, sink, stats);
  console.log(`  proposal ${pid}: ${Object.keys(out[pid] ?? {}).length} voters (${stats.queries} queries)`);
}

// Pass 2: by sender, per validator self-delegate address. Pass 1 should already
// be complete now that paging is fixed; this is a cheap independent check that
// it is. Anything it adds is a bug in pass 1 and is logged loudly.
const addrs = await selfDelegateAddresses();
console.log(`\nsender cross-check over ${addrs.length} validator addresses`);
let added = 0;
for (const a of addrs) {
  const stats = { queries: 0 };
  await walk(`message.sender='${a}' AND message.action='/cosmos.gov.v1beta1.MsgVote'`, 1, tip,
    (pid, voter, opt) => {
      if (!PROPOSALS.includes(pid) || out[pid]?.[voter]) return;
      (out[pid] ??= {})[voter] = opt;
      added++;
      console.log(`  ! proposal ${pid}: ${voter} = ${opt} (missed by the proposal sweep)`);
    }, stats);
}
console.log(added ? `sender cross-check added ${added} votes` : "sender cross-check found nothing missing");

for (const pid of Object.keys(out)) {
  out[pid] = Object.fromEntries(Object.keys(out[pid]).sort().map((k) => [k, out[pid][k]]));
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(
  `\nwrote ${OUT}: ${Object.values(out).reduce((n, v) => n + Object.keys(v).length, 0)} records`,
);
