// Reconciles our governance API against the chain and reports every drift.
// Exits non-zero on any material mismatch, so it can gate a deploy or run
// on a timer. Written after proposal 45 was shown as VETOED on our page and
// passing everywhere else.
//
// Run: node scripts/audit-governance.mjs [baseUrl]
//
// What it checks, and what it deliberately does not:
//   - live proposals: every voter and option, ours vs chain, both directions
//   - live proposals: tally must come from the chain, not the indexer
//   - settled proposals: tally vs the chain's retained final_tally_result
//   - settled proposals: vote ROWS are not checked. The SDK deletes votes
//     from state once a proposal is tallied, so the chain cannot answer and
//     the indexer is the only source. That gap is structural, not a bug.
const BASE = process.argv[2] || "https://tx.silknodes.io";
const LCD = "https://coreum-api.polkachu.com";
const TOLERANCE_TX = 2000; // indexer snapshots land a block or two early

const j = async (u, opts) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 45_000);
  try { const r = await fetch(u, { ...opts, signal: c.signal }); return r.ok ? r.json() : null; }
  catch { return null; } finally { clearTimeout(t); }
};
const ours = (id) => j(`${BASE}/api/governance/${id}`, { headers: { Referer: `${BASE}/governance/${id}` } });
const n = (x) => Number(x ?? 0) / 1e6;

async function chainVotes(id) {
  const out = {}; let key = null;
  do {
    const q = new URLSearchParams({ "pagination.limit": "1000" });
    if (key) q.set("pagination.key", key);
    const d = await j(`${LCD}/cosmos/gov/v1/proposals/${id}/votes?${q}`);
    if (!d?.votes) break;
    for (const v of d.votes) if (v.options?.[0]) out[v.voter] = v.options[0].option.replace("VOTE_OPTION_", "");
    key = d.pagination?.next_key;
  } while (key);
  return out;
}

const all = await j(`${LCD}/cosmos/gov/v1/proposals?pagination.limit=200`);
if (!all?.proposals) { console.error("cannot reach chain"); process.exit(2); }

let problems = 0;
for (const pr of all.proposals) {
  const id = Number(pr.id);
  const live = pr.status === "PROPOSAL_STATUS_VOTING_PERIOD";
  const o = await ours(id);
  if (!o?.proposal) { console.log(`#${id}  UNREACHABLE on our API`); problems++; continue; }
  const t = o.proposal.tally;
  const issues = [];

  if (live) {
    if (o.tallySource !== "chain") issues.push(`live tally came from "${o.tallySource}", must be "chain"`);
    const cv = await chainVotes(id);
    const mine = {};
    for (const v of o.validators) if (v.voteOption && v.voteOption !== "DID_NOT_VOTE") mine[v.selfDelegateAddress] = v.voteOption;
    for (const r of o.delegatorVotes) mine[r.voterAddress] = r.voteOption;
    const missing = Object.keys(cv).filter((a) => !(a in mine));
    const phantom = Object.keys(mine).filter((a) => !(a in cv));
    const wrong = Object.keys(mine).filter((a) => a in cv && mine[a] !== cv[a]);
    if (missing.length) issues.push(`${missing.length} chain votes missing from our page (e.g. ${missing[0]})`);
    if (phantom.length) issues.push(`${phantom.length} votes on our page not on chain (e.g. ${phantom[0]})`);
    if (wrong.length) issues.push(`${wrong.length} votes with the wrong option (e.g. ${wrong[0]})`);
  } else {
    const ft = pr.final_tally_result ?? {};
    for (const [k, key] of [["yes", "yes_count"], ["no", "no_count"], ["abstain", "abstain_count"], ["noWithVeto", "no_with_veto_count"]]) {
      const d = Math.abs(t[k] - n(ft[key]));
      if (d > TOLERANCE_TX) issues.push(`${k} off by ${d.toLocaleString(undefined, { maximumFractionDigits: 0 })} TX`);
    }
  }
  if (issues.length) { problems++; console.log(`#${id} ${live ? "LIVE" : pr.status.replace("PROPOSAL_STATUS_", "")}`); for (const i of issues) console.log(`     ${i}`); }
}
console.log(problems === 0 ? `\nOK: ${all.proposals.length} proposals reconcile against the chain.` : `\n${problems} proposal(s) with drift.`);
process.exit(problems === 0 ? 0 : 1);
