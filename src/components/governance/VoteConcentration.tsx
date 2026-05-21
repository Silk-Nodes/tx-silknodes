"use client";

import { useMemo } from "react";
import type { ValidatorVote, VoteOption } from "@/hooks/useProposalDetail";
import { formatTxAmount } from "@/lib/governance";

interface Props {
  validators: ValidatorVote[];
  totalBonded: number;
  yesThreshold: number;
  quorumRequired: number;
}

// Vote concentration analytics: how decentralized was this vote, really?
// We compute:
//   1. Top-10 share: what fraction of vote-weight came from top 10 voters
//   2. Smallest set to decide: how few validators were enough to flip Yes/No
//   3. Gini coefficient over voting power (chain-wide baseline for context)
//   4. Late-voter share: fraction of vote-weight cast in the last 24h
//
// All computed client-side from the data we already have. No extra fetch.
export default function VoteConcentration({
  validators,
  totalBonded,
}: Props) {
  const stats = useMemo(() => computeStats(validators, totalBonded), [validators, totalBonded]);

  return (
    <div className="vc-grid">
      <Stat
        label="Top 10 share of votes"
        value={`${(stats.top10Share * 100).toFixed(1)}%`}
        sub={stats.top10Share > 0.5
          ? "Highly concentrated: a small group decided this."
          : "Reasonably distributed across many validators."}
        tone={stats.top10Share > 0.6 ? "warn" : stats.top10Share > 0.4 ? "note" : "ok"}
      />
      <Stat
        label="Smallest set to flip outcome"
        value={stats.flipCount === null
          ? "n/a"
          : `${stats.flipCount} validator${stats.flipCount === 1 ? "" : "s"}`}
        sub={stats.flipCount === null
          ? "Outcome not yet determinable from votes."
          : `Holding ${formatTxAmount(stats.flipStake)} TX between them.`}
        tone={stats.flipCount !== null && stats.flipCount <= 3 ? "warn" : "note"}
      />
      <Stat
        label="Vote-weight Gini"
        value={stats.gini.toFixed(2)}
        sub={stats.gini > 0.7
          ? "Stake among voters is highly unequal."
          : stats.gini > 0.5
          ? "Moderate inequality among voters."
          : "Relatively even spread."}
        tone={stats.gini > 0.7 ? "warn" : stats.gini > 0.5 ? "note" : "ok"}
      />
      <Stat
        label="Late voters (last 24h)"
        value={`${(stats.lateShare * 100).toFixed(1)}%`}
        sub={stats.lateShare > 0.3
          ? "Heavy late activity: vote was decided near the deadline."
          : "Vote settled early."}
        tone="note"
      />
    </div>
  );
}

function Stat({
  label, value, sub, tone,
}: { label: string; value: string; sub: string; tone: "ok" | "note" | "warn" }) {
  return (
    <div className={`vc-card vc-tone-${tone}`}>
      <div className="vc-card-label">{label}</div>
      <div className="vc-card-value">{value}</div>
      <div className="vc-card-sub">{sub}</div>
    </div>
  );
}

interface Stats {
  top10Share: number;
  flipCount: number | null;
  flipStake: number;
  gini: number;
  lateShare: number;
}

function computeStats(validators: ValidatorVote[], totalBonded: number): Stats {
  // Only validators who actually voted contribute weight to the proposal.
  const voted = validators.filter((v) => v.voteOption !== "DID_NOT_VOTE");
  const totalVoteWeight = voted.reduce((sum, v) => sum + v.bondedStakeTX, 0);

  // Top 10 share. If fewer than 10 voted, sums everyone.
  const sortedDesc = [...voted].sort((a, b) => b.bondedStakeTX - a.bondedStakeTX);
  const top10 = sortedDesc.slice(0, 10).reduce((sum, v) => sum + v.bondedStakeTX, 0);
  const top10Share = totalVoteWeight > 0 ? top10 / totalVoteWeight : 0;

  // Find the winning side, then count how few of its largest voters were
  // enough to win. If the winner had 60% Yes, take the largest Yes voters
  // until they'd be enough to outweigh the No+Veto combined.
  const flipResult = computeFlipSet(voted);

  // Gini over voted stake. Standard formula on sorted ascending values.
  const sortedAsc = [...sortedDesc].reverse();
  let cumDiff = 0;
  for (let i = 0; i < sortedAsc.length; i++) {
    for (let j = 0; j < sortedAsc.length; j++) {
      cumDiff += Math.abs(sortedAsc[i].bondedStakeTX - sortedAsc[j].bondedStakeTX);
    }
  }
  const meanStake = totalVoteWeight / Math.max(1, sortedAsc.length);
  const gini = sortedAsc.length > 1 && meanStake > 0
    ? cumDiff / (2 * sortedAsc.length * sortedAsc.length * meanStake)
    : 0;

  // Late share: votes cast in the last 24h before "now". Server returns
  // votedAt as ISO; we trust client clock here since the table only needs
  // rough ordering.
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const lateWeight = voted
    .filter((v) => v.votedAt && new Date(v.votedAt).getTime() >= cutoff)
    .reduce((sum, v) => sum + v.bondedStakeTX, 0);
  const lateShare = totalVoteWeight > 0 ? lateWeight / totalVoteWeight : 0;

  // totalBonded is unused for the stats below but reserved for a future
  // "votes vs idle stake" comparison. Keep the parameter so callers don't
  // have to refactor when we add it.
  void totalBonded;

  return {
    top10Share,
    flipCount: flipResult.count,
    flipStake: flipResult.stake,
    gini,
    lateShare,
  };
}

function computeFlipSet(voted: ValidatorVote[]): { count: number | null; stake: number } {
  // Tally per side.
  const sides: Record<VoteOption, number> = {
    YES: 0, NO: 0, NO_WITH_VETO: 0, ABSTAIN: 0, DID_NOT_VOTE: 0,
  };
  for (const v of voted) sides[v.voteOption] += v.bondedStakeTX;
  // Winner = largest of YES / NO / VETO. If tied or all zero, no flip.
  const candidates = [
    { side: "YES" as VoteOption, stake: sides.YES },
    { side: "NO" as VoteOption, stake: sides.NO },
    { side: "NO_WITH_VETO" as VoteOption, stake: sides.NO_WITH_VETO },
  ];
  candidates.sort((a, b) => b.stake - a.stake);
  if (candidates[0].stake === 0) return { count: null, stake: 0 };
  const winner = candidates[0].side;
  const opponents = candidates[1].stake + candidates[2].stake;

  // Walk the winner's voters by stake desc, accumulating until they exceed
  // the opponents. That's the minimum set that secured the win.
  const winnerVoters = voted
    .filter((v) => v.voteOption === winner)
    .sort((a, b) => b.bondedStakeTX - a.bondedStakeTX);
  let cum = 0;
  for (let i = 0; i < winnerVoters.length; i++) {
    cum += winnerVoters[i].bondedStakeTX;
    if (cum > opponents) {
      return { count: i + 1, stake: cum };
    }
  }
  return { count: winnerVoters.length, stake: cum };
}
