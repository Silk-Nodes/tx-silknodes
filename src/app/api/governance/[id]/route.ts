// GET /api/governance/[id]
//
// Returns one proposal joined with per-validator vote data and validator
// metadata so the detail page can render a real analytics dashboard.
//
// We fan out 3 Hasura queries in parallel:
//   1. The proposal itself (title, status, content, tally, snapshot)
//   2. All votes cast on the proposal
//   3. Validator metadata (latest description + latest voting_power + info
//      mapping consensus_address <-> self_delegate_address)
//
// Then we join in JS to produce the rows the UI needs.

import { NextResponse } from "next/server";
import { getActiveValidatorSet } from "@/lib/validator-set";
import { lcdGet } from "@/lib/chain-config";

export const dynamic = "force-dynamic";
export const revalidate = 30;

const HASURA_URL = "https://hasura.mainnet-1.coreum.dev/v1/graphql";

// The chain's own vote record, used to fill in what the indexer lost.
//
// Hasura has NO votes at all for proposals 1, 2, 4, 5, 6, 7, 8, 40 and 42, and
// it also drops individual votes inside proposals it does index. Without this
// merge those proposals render as though every validator abstained, which is
// not missing data, it is wrong data: a validator with a perfect record was
// shown as having skipped the vote.
//
// See scripts/backfill-votes.mjs for how it is produced and why the chain
// cannot simply be queried live (the SDK deletes votes once a proposal
// settles). Options are already normalized to YES / NO / ABSTAIN /
// NO_WITH_VETO, matching normalizeOption() below.
import HISTORICAL_VOTES from "@/data/historical-votes.json";

const ROUTE_TAG = "governance/[id]";
const UCORE_PER_TX = 1_000_000;

interface HasuraProposal {
  id: number;
  title: string;
  description: string;
  status: string;
  content: Record<string, unknown>[] | null;
  proposer_address: string | null;
  submit_time: string | null;
  voting_start_time: string | null;
  voting_end_time: string | null;
  proposal_tally_result: {
    yes: string;
    no: string;
    abstain: string;
    no_with_veto: string;
  } | null;
  staking_pool_snapshot: { bonded_tokens: string } | null;
}

interface HasuraVote {
  voter_address: string;
  option: string;
  weight: string;
  timestamp: string;
}

interface ValidatorRow {
  consensusAddress: string;
  operatorAddress: string;
  selfDelegateAddress: string;
  moniker: string;
  avatarUrl: string | null;
  website: string | null;
  bondedStakeTX: number;
  status: number;
  jailed: boolean;
}

interface ValidatorVoteRow extends ValidatorRow {
  voteOption: "YES" | "NO" | "ABSTAIN" | "NO_WITH_VETO" | "DID_NOT_VOTE";
  votedAt: string | null;
  weight: number;
}

const PROPOSAL_QUERY = `query Q($id: Int!) {
  proposal_by_pk(id: $id) {
    id title description status content
    proposer_address submit_time voting_start_time voting_end_time
    proposal_tally_result { yes no abstain no_with_veto }
    staking_pool_snapshot { bonded_tokens }
  }
  gov_params { params }
}`;

// Votes are fetched separately and paged. The Coreum Hasura clamps every
// query to 100 rows server-side, silently: limit 1000 still returns 100.
// Proposal 45 had 132 votes, so the last 32, among them the proposer's own
// validator, simply did not exist as far as this page was concerned. Pages
// run until a short page, ordered (timestamp, voter_address) so ties cannot
// shuffle rows between pages.
const VOTES_PAGE_QUERY = `query V($id: Int!, $off: Int!) {
  proposal_vote(
    where: {proposal_id: {_eq: $id}}
    order_by: [{timestamp: asc}, {voter_address: asc}]
    limit: 100
    offset: $off
  ) {
    voter_address option weight timestamp
  }
}`;

const HASURA_PAGE = 100;

async function fetchAllVotes(id: number): Promise<HasuraVote[]> {
  const out: HasuraVote[] = [];
  for (let off = 0; ; off += HASURA_PAGE) {
    const page = await hasura<{ proposal_vote: HasuraVote[] }>(VOTES_PAGE_QUERY, { id, off });
    out.push(...page.proposal_vote);
    if (page.proposal_vote.length < HASURA_PAGE) return out;
    // 132 votes is two pages; a proposal would need 10,000+ votes to hit
    // this, at which point something else is wrong. Bail rather than hammer.
    if (off >= 10_000) return out;
  }
}

// Latest snapshot per validator. distinct_on requires the order_by to start
// with the distinct field, then height desc to pick the latest row.
const VALIDATORS_QUERY = `{
  validator_voting_power(
    distinct_on: validator_address
    order_by: [{validator_address: asc}, {height: desc}]
  ) { validator_address voting_power }
  validator_description(
    distinct_on: validator_address
    order_by: [{validator_address: asc}, {height: desc}]
  ) { validator_address moniker avatar_url website }
  validator_status(
    distinct_on: validator_address
    order_by: [{validator_address: asc}, {height: desc}]
  ) { validator_address status jailed }
  validator_info { consensus_address operator_address self_delegate_address }
}`;

/**
 * Stamp UTC onto the indexer's naive timestamps.
 *
 * Hasura returns "2026-08-18T08:48:21" with no offset. Those values are
 * UTC, but ECMAScript parses an offset-less date-time as LOCAL time, so
 * every timestamp on this page landed wrong by the viewer's own timezone.
 * A vote cast 19 minutes ago rendered as "3h ago" for a reader in UTC+3,
 * and the countdown to voting close ran three hours fast, which matters
 * rather more than a stale-looking relative time.
 *
 * Fixed here at the boundary rather than in each component, because the
 * value is also used for sorting and for bucketing the velocity chart, and
 * every one of those call sites would otherwise have to remember.
 */
function toUtcIso(ts: string | null | undefined): string | null {
  if (!ts) return null;
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(ts) ? ts : `${ts}Z`;
}

function ucoreToTX(s: string | number | undefined | null): number {
  if (s === null || s === undefined) return 0;
  if (typeof s === "number") return s / UCORE_PER_TX;
  try { return Number(BigInt(s)) / UCORE_PER_TX; } catch { return 0; }
}

function normalizeOption(opt: string): ValidatorVoteRow["voteOption"] {
  switch (opt) {
    case "VOTE_OPTION_YES": return "YES";
    case "VOTE_OPTION_NO": return "NO";
    case "VOTE_OPTION_ABSTAIN": return "ABSTAIN";
    case "VOTE_OPTION_NO_WITH_VETO": return "NO_WITH_VETO";
    default: return "DID_NOT_VOTE";
  }
}

async function hasura<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(HASURA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`hasura HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`hasura errors: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "bad id" }, { status: 400 });
    }

    const [propData, validatorData, validatorSet, allVotes] = await Promise.all([
      hasura<{
        proposal_by_pk: HasuraProposal | null;
        gov_params: { params: { quorum: string; threshold: string; veto_threshold: string; voting_period: number } }[];
      }>(PROPOSAL_QUERY, { id }),
      hasura<{
        validator_voting_power: { validator_address: string; voting_power: number }[];
        validator_description: { validator_address: string; moniker: string | null; avatar_url: string | null; website: string | null }[];
        validator_status: { validator_address: string; status: number; jailed: boolean }[];
        validator_info: { consensus_address: string; operator_address: string; self_delegate_address: string }[];
      }>(VALIDATORS_QUERY),
      getActiveValidatorSet(),
      fetchAllVotes(id),
    ]);

    const p = propData.proposal_by_pk;
    if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });

    // Normalize every indexer timestamp to real UTC before anything reads
    // them: vote rows feed relative times, sorting and the velocity chart,
    // and the proposal times drive the countdown.
    for (const v of allVotes) {
      v.timestamp = toUtcIso(v.timestamp) as string;
    }
    p.submit_time = toUtcIso(p.submit_time);
    p.voting_start_time = toUtcIso(p.voting_start_time);
    p.voting_end_time = toUtcIso(p.voting_end_time);

    // Build validator metadata index keyed by self_delegate_address (the
    // address that actually casts the vote). Each validator may map to one
    // self-delegate address; we ignore validators we can't fully resolve.
    const byConsensus = new Map<string, ValidatorRow>();
    for (const vp of validatorData.validator_voting_power) {
      byConsensus.set(vp.validator_address, {
        consensusAddress: vp.validator_address,
        operatorAddress: "",
        selfDelegateAddress: "",
        moniker: "",
        avatarUrl: null,
        website: null,
        bondedStakeTX: ucoreToTX(vp.voting_power),
        status: 0,
        jailed: false,
      });
    }
    for (const d of validatorData.validator_description) {
      const row = byConsensus.get(d.validator_address);
      if (row) {
        row.moniker = d.moniker || row.consensusAddress.slice(0, 14);
        row.avatarUrl = d.avatar_url;
        row.website = d.website;
      }
    }
    for (const s of validatorData.validator_status) {
      const row = byConsensus.get(s.validator_address);
      if (row) {
        row.status = s.status;
        row.jailed = s.jailed;
      }
    }
    for (const info of validatorData.validator_info) {
      const row = byConsensus.get(info.consensus_address);
      if (row) {
        row.operatorAddress = info.operator_address;
        row.selfDelegateAddress = info.self_delegate_address || "";
      }
    }

    // Set membership and stake come from a source we control, not from the
    // Coreum indexer. On 2026-08-18 that index held no status row at all for
    // Kraken, SOLONATIONLABS, Huobi and Zeeve Inc., so this page rendered 50
    // validators against the chain's 54 and silently omitted the fourth
    // largest validator on the network. Hasura keeps the job it is good at
    // here: the vote records, plus cosmetic bits like avatars.
    if (validatorSet.validators.length > 0) {
      const decorByOperator = new Map<
        string,
        { avatarUrl: string | null; website: string | null; consensusAddress: string }
      >();
      for (const row of byConsensus.values()) {
        if (row.operatorAddress) {
          decorByOperator.set(row.operatorAddress, {
            avatarUrl: row.avatarUrl,
            website: row.website,
            consensusAddress: row.consensusAddress,
          });
        }
      }
      byConsensus.clear();
      for (const v of validatorSet.validators) {
        const decor = decorByOperator.get(v.operatorAddress);
        byConsensus.set(v.operatorAddress, {
          // Empty when the Coreum indexer has no row for this validator,
          // which is the whole reason this override exists. Never use it as
          // a React key: several validators share the empty string and the
          // duplicate keys wreck reconciliation. operatorAddress is unique
          // and always present.
          consensusAddress: decor?.consensusAddress ?? "",
          operatorAddress: v.operatorAddress,
          selfDelegateAddress: v.selfDelegateAddress,
          moniker: v.moniker,
          avatarUrl: decor?.avatarUrl ?? null,
          website: decor?.website ?? null,
          bondedStakeTX: v.bondedStakeTX,
          status: v.status,
          jailed: v.jailed,
        });
      }
    }

    // Index validators by self-delegate so we can match against vote rows
    // quickly. A validator without a self-delegate address can't be matched
    // to votes through this path; we keep it in the table as DID_NOT_VOTE.
    const bySelfDelegate = new Map<string, ValidatorRow>();
    for (const row of byConsensus.values()) {
      if (row.selfDelegateAddress) bySelfDelegate.set(row.selfDelegateAddress, row);
    }

    // Build vote map keyed by voter address. Non-validator votes (regular
    // delegators casting their own override votes) are kept separately so
    // the UI can show them in a secondary section if desired.
    const votesByAddr = new Map<string, HasuraVote>();
    for (const v of allVotes) votesByAddr.set(v.voter_address, v);

    // Assemble per-validator vote rows. We restrict to currently bonded,
    // non-jailed validators (Cosmos SDK status 3 = BOND_STATUS_BONDED). The
    // unbonded/unbonding/jailed set is noise on this page since they don't
    // have voting power in the active set anyway. We still keep delegator
    // votes from those validators' self-delegate addresses elsewhere if
    // they cast votes, but the table itself only lists the active set.
    // Votes for this proposal that the indexer lost, recovered from the chain.
    // Only consulted where Hasura has nothing: the indexer carries timestamps
    // and weights, which the chain snapshot does not, so it stays preferred
    // wherever it actually holds the vote.
    const archived: Record<string, string> =
      (HISTORICAL_VOTES as Record<string, Record<string, string>>)[String(id)] ?? {};
    let recovered = 0;

    const validatorVotes: ValidatorVoteRow[] = [];
    for (const v of byConsensus.values()) {
      if (v.status !== 3 || v.jailed) continue;
      const vote = v.selfDelegateAddress ? votesByAddr.get(v.selfDelegateAddress) : undefined;
      const fallback = !vote && v.selfDelegateAddress ? archived[v.selfDelegateAddress] : undefined;
      if (fallback) recovered++;
      validatorVotes.push({
        ...v,
        voteOption: vote
          ? normalizeOption(vote.option)
          : ((fallback as ValidatorVoteRow["voteOption"]) ?? "DID_NOT_VOTE"),
        // No timestamp survives in the chain snapshot. Null rather than a
        // fabricated one; the UI omits the time instead of inventing it.
        votedAt: vote ? vote.timestamp : null,
        weight: vote ? Number(vote.weight) : 0,
      });
    }
    // Sort by bonded stake desc (the natural "validator rank" view).
    validatorVotes.sort((a, b) => b.bondedStakeTX - a.bondedStakeTX);

    // Non-validator delegator votes (votes that didn't match any validator
    // self-delegate). These are individual delegators who voted directly.
    const validatorSelfDelegates = new Set(
      Array.from(bySelfDelegate.keys()),
    );
    const delegatorVotes = allVotes
      .filter((v) => !validatorSelfDelegates.has(v.voter_address))
      .map((v) => ({
        voterAddress: v.voter_address,
        voteOption: normalizeOption(v.option),
        votedAt: v.timestamp as string | null,
        weight: Number(v.weight),
      }));
    // Same recovery for delegator votes. On the proposals Hasura missed
    // entirely this is the only reason the section has any rows at all.
    for (const [voter, opt] of Object.entries(archived)) {
      if (validatorSelfDelegates.has(voter) || votesByAddr.has(voter)) continue;
      delegatorVotes.push({
        voterAddress: voter,
        voteOption: opt as ValidatorVoteRow["voteOption"],
        votedAt: null,
        weight: 0,
      });
      recovered++;
    }

    // Velocity series: cumulative TX share by hour over the voting period
    // for charting. Each vote contributes its validator's bonded stake (or 0
    // if it's a non-validator vote, since we don't know that delegator's
    // stake snapshot). This is good enough for a "voting acceleration" feel.
    const velocity = buildVelocity(
      allVotes,
      bySelfDelegate,
      p.voting_start_time,
      p.voting_end_time,
    );

    const tally = p.proposal_tally_result;
    let yes = ucoreToTX(tally?.yes);
    let no = ucoreToTX(tally?.no);
    let abstain = ucoreToTX(tally?.abstain);
    let noWithVeto = ucoreToTX(tally?.no_with_veto);
    let tallySource = "indexer";

    // While a proposal is live the indexer's tally snapshot lags its own vote
    // table: on 2026-08-21 it carried proposal 45's votes but not the 240.9M TX
    // abstain in the totals, which put the page on the wrong side of the veto
    // threshold. The chain's tally endpoint runs the same code that decides the
    // outcome, so for live proposals it is the authority. lcdGet orders hosts by
    // freshness, so a stalled node cannot answer this.
    if (p.status === "PROPOSAL_STATUS_VOTING_PERIOD") {
      try {
        const res = await lcdGet(`/cosmos/gov/v1/proposals/${p.id}/tally`);
        const body = await res.json();
        const t = body?.tally;
        const n = (x: unknown) => Number(x ?? 0) / 1e6;
        const total = n(t?.yes_count) + n(t?.no_count) + n(t?.abstain_count) + n(t?.no_with_veto_count);
        // Only take it if it is a real tally. A zeroed response means the host
        // answered without data, and a stale indexer beats an empty chart.
        if (total > 0) {
          yes = n(t.yes_count);
          no = n(t.no_count);
          abstain = n(t.abstain_count);
          noWithVeto = n(t.no_with_veto_count);
          tallySource = "chain";
        }
      } catch {
        // Keep the indexer numbers and say so, rather than failing the page.
      }
    }
    const rawType = Array.isArray(p.content) && p.content[0]?.["@type"]
      ? (p.content[0]["@type"] as string)
      : "";
    const contentPayload = Array.isArray(p.content) && p.content[0] ? p.content[0] : null;

    const rawParams = propData.gov_params?.[0]?.params;
    const govParams = {
      quorum: rawParams ? Number(rawParams.quorum) : 0.4,
      threshold: rawParams ? Number(rawParams.threshold) : 0.5,
      vetoThreshold: rawParams ? Number(rawParams.veto_threshold) : 0.334,
      votingPeriodSeconds: rawParams ? rawParams.voting_period / 1e9 : 432000,
    };

    return NextResponse.json(
      {
        proposal: {
          id: p.id,
          title: p.title,
          description: p.description,
          rawStatus: p.status,
          rawType,
          content: contentPayload,
          proposer: p.proposer_address,
          submitTime: p.submit_time,
          votingStartTime: p.voting_start_time,
          votingEndTime: p.voting_end_time,
          tally: {
            yes, no, abstain, noWithVeto,
            totalVoted: yes + no + abstain + noWithVeto,
            bondedSnapshot: ucoreToTX(p.staking_pool_snapshot?.bonded_tokens),
          },
        },
        params: govParams,
        validators: validatorVotes,
        delegatorVotes,
        velocity,
        // How many votes on this proposal came from the chain snapshot rather
        // than the indexer. Surfaced so the page can say the timeline is
        // incomplete instead of implying nobody voted early.
        tallySource,
        recoveredFromChain: recovered,
        meta: {
          validatorCount: validatorVotes.length,
          // "db", "lcd", or "none" when both failed and this fell back to
          // whatever the indexer reported.
          validatorSetSource: validatorSet.source,
          votedCount: validatorVotes.filter((v) => v.voteOption !== "DID_NOT_VOTE").length,
          delegatorVoteCount: delegatorVotes.length,
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err: unknown) {
    // The raw message can carry the DB role, connection string, internal
    // hostnames or upstream credentials, so it is logged and never returned.
    // Callers get a generic failure; operators get the detail in the journal.
    console.error(`[${ROUTE_TAG}]`, err);
    return NextResponse.json(
      { error: "internal error" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

function buildVelocity(
  votes: HasuraVote[],
  bySelfDelegate: Map<string, ValidatorRow>,
  start: string | null,
  end: string | null,
): { t: string; yes: number; no: number; veto: number; abstain: number }[] {
  if (!start || !end || votes.length === 0) return [];
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

  // Bucket votes into 24 evenly-spaced points across the voting window.
  // Cumulative so the lines only ever go up.
  const buckets = 24;
  const step = (endMs - startMs) / buckets;
  const series: { t: string; yes: number; no: number; veto: number; abstain: number }[] = [];

  // Sort once. cumulative is mutated as we walk.
  const sorted = [...votes].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  let cumYes = 0, cumNo = 0, cumVeto = 0, cumAbs = 0;
  let cursor = 0;

  for (let i = 1; i <= buckets; i++) {
    const tMs = startMs + step * i;
    while (cursor < sorted.length) {
      const v = sorted[cursor];
      const vMs = new Date(v.timestamp).getTime();
      if (vMs > tMs) break;
      const stake = bySelfDelegate.get(v.voter_address)?.bondedStakeTX ?? 0;
      switch (v.option) {
        case "VOTE_OPTION_YES": cumYes += stake; break;
        case "VOTE_OPTION_NO": cumNo += stake; break;
        case "VOTE_OPTION_NO_WITH_VETO": cumVeto += stake; break;
        case "VOTE_OPTION_ABSTAIN": cumAbs += stake; break;
      }
      cursor++;
    }
    series.push({
      t: new Date(tMs).toISOString(),
      yes: cumYes,
      no: cumNo,
      veto: cumVeto,
      abstain: cumAbs,
    });
  }
  return series;
}
