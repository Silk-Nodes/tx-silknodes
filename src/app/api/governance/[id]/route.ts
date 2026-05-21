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

export const dynamic = "force-dynamic";
export const revalidate = 30;

const HASURA_URL = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
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
  proposal_vote(where: {proposal_id: {_eq: $id}}, order_by: {timestamp: asc}) {
    voter_address option weight timestamp
  }
}`;

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

    const [propData, validatorData] = await Promise.all([
      hasura<{
        proposal_by_pk: HasuraProposal | null;
        gov_params: { params: { quorum: string; threshold: string; veto_threshold: string; voting_period: number } }[];
        proposal_vote: HasuraVote[];
      }>(PROPOSAL_QUERY, { id }),
      hasura<{
        validator_voting_power: { validator_address: string; voting_power: number }[];
        validator_description: { validator_address: string; moniker: string | null; avatar_url: string | null; website: string | null }[];
        validator_status: { validator_address: string; status: number; jailed: boolean }[];
        validator_info: { consensus_address: string; operator_address: string; self_delegate_address: string }[];
      }>(VALIDATORS_QUERY),
    ]);

    const p = propData.proposal_by_pk;
    if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });

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
    for (const v of propData.proposal_vote) votesByAddr.set(v.voter_address, v);

    // Assemble per-validator vote rows. We restrict to currently bonded,
    // non-jailed validators (Cosmos SDK status 3 = BOND_STATUS_BONDED). The
    // unbonded/unbonding/jailed set is noise on this page since they don't
    // have voting power in the active set anyway. We still keep delegator
    // votes from those validators' self-delegate addresses elsewhere if
    // they cast votes, but the table itself only lists the active set.
    const validatorVotes: ValidatorVoteRow[] = [];
    for (const v of byConsensus.values()) {
      if (v.status !== 3 || v.jailed) continue;
      const vote = v.selfDelegateAddress ? votesByAddr.get(v.selfDelegateAddress) : undefined;
      validatorVotes.push({
        ...v,
        voteOption: vote ? normalizeOption(vote.option) : "DID_NOT_VOTE",
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
    const delegatorVotes = propData.proposal_vote
      .filter((v) => !validatorSelfDelegates.has(v.voter_address))
      .map((v) => ({
        voterAddress: v.voter_address,
        voteOption: normalizeOption(v.option),
        votedAt: v.timestamp,
        weight: Number(v.weight),
      }));

    // Velocity series: cumulative TX share by hour over the voting period
    // for charting. Each vote contributes its validator's bonded stake (or 0
    // if it's a non-validator vote, since we don't know that delegator's
    // stake snapshot). This is good enough for a "voting acceleration" feel.
    const velocity = buildVelocity(
      propData.proposal_vote,
      bySelfDelegate,
      p.voting_start_time,
      p.voting_end_time,
    );

    const tally = p.proposal_tally_result;
    const yes = ucoreToTX(tally?.yes);
    const no = ucoreToTX(tally?.no);
    const abstain = ucoreToTX(tally?.abstain);
    const noWithVeto = ucoreToTX(tally?.no_with_veto);
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
        meta: {
          validatorCount: validatorVotes.length,
          votedCount: validatorVotes.filter((v) => v.voteOption !== "DID_NOT_VOTE").length,
          delegatorVoteCount: delegatorVotes.length,
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message },
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
