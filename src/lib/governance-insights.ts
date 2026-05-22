// Plain-English insights computed from the same validator + velocity data
// the advanced charts use. The point is to give a non-technical reader
// three lines that tell the story of how the vote went, instead of making
// them read a Gini number.

import type { ValidatorVote, VelocityPoint } from "@/hooks/useProposalDetail";

export interface InsightBullet {
  text: string;
  tone: "ok" | "warn" | "neutral";
}

export interface GovernanceInsights {
  bullets: InsightBullet[];
  // Raw numbers exposed so the "advanced" view doesn't have to recompute.
  raw: {
    top10Share: number;
    flipCount: number | null;
    flipStake: number;
    lateShare: number;
    quorumHitBucket: number | null; // 0..23 or null if never hit
    totalBuckets: number;
  };
}

export function computeInsights(
  validators: ValidatorVote[],
  totalBonded: number,
  velocity: VelocityPoint[],
  quorumRequired: number,
): GovernanceInsights {
  const voted = validators.filter((v) => v.voteOption !== "DID_NOT_VOTE");
  const totalVoteWeight = voted.reduce((sum, v) => sum + v.bondedStakeTX, 0);

  // Top 10 concentration.
  const sortedDesc = [...voted].sort((a, b) => b.bondedStakeTX - a.bondedStakeTX);
  const top10 = sortedDesc.slice(0, 10).reduce((sum, v) => sum + v.bondedStakeTX, 0);
  const top10Share = totalVoteWeight > 0 ? top10 / totalVoteWeight : 0;

  // Smallest set of winners that overpowered the losing sides. Same logic
  // as VoteConcentration; copied here to keep this module standalone.
  const flip = computeFlipSet(voted);

  // Late-voter share: votes in the last bucket as a fraction of the total.
  // Using the velocity series (last bucket = the last few hours/day of
  // voting) so this works for any proposal length.
  let lateShare = 0;
  if (velocity.length >= 2) {
    const last = velocity[velocity.length - 1];
    const beforeLast = velocity[velocity.length - 2];
    const lastTotal = last.yes + last.no + last.veto + last.abstain;
    const beforeTotal = beforeLast.yes + beforeLast.no + beforeLast.veto + beforeLast.abstain;
    lateShare = lastTotal > 0 ? (lastTotal - beforeTotal) / lastTotal : 0;
  }

  // When did quorum get hit? Find the first bucket where cumulative voted
  // crosses the quorum threshold. Useful for "settled early" vs "close call".
  let quorumHitBucket: number | null = null;
  const quorumTarget = totalBonded * quorumRequired;
  for (let i = 0; i < velocity.length; i++) {
    const cum = velocity[i].yes + velocity[i].no + velocity[i].veto + velocity[i].abstain;
    if (cum >= quorumTarget) { quorumHitBucket = i; break; }
  }

  const bullets: InsightBullet[] = [];

  // 1. Concentration insight: "Top 10 controlled X% of votes"
  if (top10Share > 0) {
    const pct = Math.round(top10Share * 100);
    bullets.push({
      text: pct >= 80
        ? `Top 10 validators controlled ${pct}% of the votes — highly concentrated.`
        : pct >= 60
        ? `Top 10 validators controlled ${pct}% of the votes.`
        : `Top 10 validators only held ${pct}% — broadly distributed.`,
      tone: pct >= 80 ? "warn" : pct >= 60 ? "neutral" : "ok",
    });
  }

  // 2. Flip insight: how few validators determined the outcome?
  if (flip.count !== null) {
    bullets.push({
      text: flip.count === 1
        ? "Just 1 validator could have flipped this outcome."
        : flip.count <= 3
        ? `Only ${flip.count} validators could have flipped this outcome.`
        : `It would have taken ${flip.count} validators to flip this outcome.`,
      tone: flip.count <= 3 ? "warn" : "ok",
    });
  }

  // 3. Velocity insight: did it settle early or close to deadline?
  if (quorumHitBucket !== null && velocity.length > 0) {
    const totalBuckets = velocity.length;
    const hitFraction = quorumHitBucket / totalBuckets;
    if (hitFraction <= 0.33) {
      bullets.push({ text: "Quorum was reached early — the vote settled fast.", tone: "ok" });
    } else if (hitFraction >= 0.85) {
      bullets.push({ text: "Quorum only landed near the deadline — a close call.", tone: "warn" });
    } else if (lateShare > 0.3) {
      bullets.push({ text: "A burst of late voting decided the outcome.", tone: "neutral" });
    } else {
      bullets.push({ text: "Voting was steady, with no late surge.", tone: "ok" });
    }
  } else if (totalVoteWeight === 0) {
    bullets.push({ text: "No validators voted on this proposal.", tone: "warn" });
  }

  return {
    bullets,
    raw: {
      top10Share,
      flipCount: flip.count,
      flipStake: flip.stake,
      lateShare,
      quorumHitBucket,
      totalBuckets: velocity.length,
    },
  };
}

function computeFlipSet(voted: ValidatorVote[]): { count: number | null; stake: number } {
  const sides: Record<string, number> = { YES: 0, NO: 0, NO_WITH_VETO: 0 };
  for (const v of voted) {
    if (v.voteOption === "YES" || v.voteOption === "NO" || v.voteOption === "NO_WITH_VETO") {
      sides[v.voteOption] += v.bondedStakeTX;
    }
  }
  const candidates = [
    { side: "YES", stake: sides.YES },
    { side: "NO", stake: sides.NO },
    { side: "NO_WITH_VETO", stake: sides.NO_WITH_VETO },
  ];
  candidates.sort((a, b) => b.stake - a.stake);
  if (candidates[0].stake === 0) return { count: null, stake: 0 };
  const winner = candidates[0].side;
  const opponents = candidates[1].stake + candidates[2].stake;
  const winnerVoters = voted
    .filter((v) => v.voteOption === winner)
    .sort((a, b) => b.bondedStakeTX - a.bondedStakeTX);
  let cum = 0;
  for (let i = 0; i < winnerVoters.length; i++) {
    cum += winnerVoters[i].bondedStakeTX;
    if (cum > opponents) return { count: i + 1, stake: cum };
  }
  return { count: winnerVoters.length, stake: cum };
}
