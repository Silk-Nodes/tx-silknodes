// Plain-English explainer for governance proposals. Mintscan and most
// explorers dump raw proposal text; we parse the structured `content`
// field that Cosmos SDK emits per message type and turn it into a few
// short bullets a delegator can actually read.
//
// The explainer never invents facts. Every bullet is grounded in a
// field on the proposal's content[0] payload. If we don't recognize
// the @type, we fall back to "see description".
//
// Coverage as of 2026-05-15:
//   /cosmos.upgrade.v1beta1.MsgSoftwareUpgrade
//   /cosmos.upgrade.v1beta1.MsgCancelUpgrade
//   /cosmos.distribution.v1beta1.MsgCommunityPoolSpend
//   /cosmos.gov.v1.MsgUpdateParams
//   /tx.pse.v1.MsgUpdateExcludedAddresses
//   /tx.pse.v1.MsgUpdateParams
//   /coreum.feemodel.v1.MsgUpdateParams
//   (plus generic Update Params fallback)
//
// Adding a new type = one branch in explainProposal().

import type { Proposal, ProposalTally } from "./governance";

export interface ExplainerBullet {
  label: string;
  value: string;
}

export interface ExplainerSection {
  headline: string;       // one-line summary, plain English
  bullets: ExplainerBullet[]; // structured facts, label + value
  unrecognized?: boolean; // true when we hit the fallback path
}

const UCORE_PER_TX = 1_000_000;

function ucoreToTX(raw: unknown): number {
  if (typeof raw === "string") {
    try { return Number(BigInt(raw)) / UCORE_PER_TX; } catch { return 0; }
  }
  if (typeof raw === "number") return raw / UCORE_PER_TX;
  return 0;
}

function formatTX(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B TX`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M TX`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K TX`;
  return `${n.toFixed(0)} TX`;
}

function truncateAddr(addr: string): string {
  if (!addr || addr.length <= 20) return addr || "—";
  return `${addr.slice(0, 12)}…${addr.slice(-6)}`;
}

export function explainProposal(p: Proposal): ExplainerSection {
  const c = p.content || {};

  switch (p.rawType) {
    case "/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade": {
      const plan = (c.plan as Record<string, unknown>) || {};
      const name = plan.name as string | undefined;
      const height = plan.height as string | undefined;
      const info = plan.info as string | undefined;
      return {
        headline: name
          ? `Chain upgrade to ${name}.`
          : "Schedules a chain software upgrade.",
        bullets: [
          { label: "Upgrade name", value: name || "—" },
          { label: "Trigger block", value: height ? `#${Number(height).toLocaleString()}` : "—" },
          ...(info ? [{ label: "Notes", value: info }] : []),
          { label: "What happens", value: "Validators must update node software before the trigger block, or the chain halts for them at that height." },
        ],
      };
    }

    case "/cosmos.upgrade.v1beta1.MsgCancelUpgrade": {
      return {
        headline: "Cancels a previously scheduled chain upgrade.",
        bullets: [
          { label: "What happens", value: "The chain will NOT halt at the previously-planned block; validators can keep running their current node version." },
        ],
      };
    }

    case "/cosmos.distribution.v1beta1.MsgCommunityPoolSpend": {
      const amounts = (c.amount as Array<Record<string, unknown>>) || [];
      const ucoreAmount = amounts.find((a) => a.denom === "ucore");
      const amountTX = ucoreAmount ? ucoreToTX(ucoreAmount.amount) : 0;
      const recipient = c.recipient as string | undefined;
      return {
        headline: `Spend ${formatTX(amountTX)} from the community pool.`,
        bullets: [
          { label: "Amount", value: formatTX(amountTX) },
          { label: "Recipient", value: recipient ? truncateAddr(recipient) : "—" },
          { label: "What happens", value: "If passed, the community pool sends this amount directly to the recipient address." },
        ],
      };
    }

    case "/cosmos.gov.v1.MsgUpdateParams": {
      const params = (c.params as Record<string, unknown>) || {};
      const bullets: ExplainerBullet[] = [];
      if (params.quorum) bullets.push({ label: "New quorum", value: `${(Number(params.quorum) * 100).toFixed(1)}%` });
      if (params.threshold) bullets.push({ label: "New pass threshold", value: `${(Number(params.threshold) * 100).toFixed(1)}%` });
      if (params.veto_threshold) bullets.push({ label: "New veto threshold", value: `${(Number(params.veto_threshold) * 100).toFixed(2)}%` });
      if (params.voting_period) {
        const secs = Number(params.voting_period) / 1e9;
        bullets.push({ label: "New voting period", value: `${(secs / 86400).toFixed(1)} days` });
      }
      const minDeposit = params.min_deposit as Array<Record<string, unknown>> | undefined;
      if (minDeposit) {
        const ucoreMin = minDeposit.find((d) => d.denom === "ucore");
        if (ucoreMin) {
          bullets.push({ label: "New min deposit", value: formatTX(ucoreToTX(ucoreMin.amount)) });
        }
      }
      return {
        headline: "Updates governance parameters.",
        bullets: bullets.length > 0 ? bullets : [
          { label: "Params changing", value: "See full content in description below." },
        ],
      };
    }

    case "/tx.pse.v1.MsgUpdateExcludedAddresses": {
      const excluded = (c.excluded_addresses as string[]) || [];
      return {
        headline: `Updates the PSE excluded-address list (${excluded.length} addresses).`,
        bullets: [
          { label: "Count", value: `${excluded.length} addresses` },
          { label: "First entries", value: excluded.slice(0, 3).map(truncateAddr).join(", ") + (excluded.length > 3 ? ` … (+${excluded.length - 3} more)` : "") },
          { label: "What happens", value: "Addresses on this list do NOT receive community PSE rewards. Typically used to exclude foundation, vesting, or contract accounts." },
        ],
      };
    }

    case "/tx.pse.v1.MsgUpdateParams": {
      return {
        headline: "Updates PSE module parameters.",
        bullets: [
          { label: "What this is", value: "Changes how the Protocol Sustainability Engine distributes rewards. See description for specifics." },
        ],
      };
    }

    case "/coreum.feemodel.v1.MsgUpdateParams": {
      return {
        headline: "Updates Coreum's fee model parameters.",
        bullets: [
          { label: "What this is", value: "Adjusts transaction fee curve params (gas, congestion, etc.). See description for specifics." },
        ],
      };
    }

    default: {
      // Unrecognized type. Show what we know without making up details.
      const last = p.rawType.split(".").pop() || "Unknown";
      return {
        unrecognized: true,
        headline: `${p.type}. Type not yet recognized by the explainer.`,
        bullets: [
          { label: "Raw type", value: p.rawType || "—" },
          { label: "Action", value: `Cosmos SDK message: ${last}` },
          { label: "Next step", value: "Read the full description below for context. If this is a common type, file a feature request and we'll add a structured explainer." },
        ],
      };
    }
  }
}

// ─── Voting projection for ACTIVE proposals ──────────────────────────
// Tells the user "is this on track to pass / fail given current numbers
// and quorum requirements." Based entirely on chain math, no opinion.
export interface VoteProjection {
  outcome: "passing" | "failing-quorum" | "failing-veto" | "failing-threshold";
  reason: string;
  quorumMet: boolean;
  remainingForQuorum: number; // TX needed to reach quorum
  unvotedStake: number;       // bonded - already voted
}

export function projectActiveVote(
  tally: ProposalTally,
  quorumRequired: number,
  yesThresholdRequired: number,
  vetoThreshold: number,
): VoteProjection {
  const bonded = tally.bondedSnapshot;
  const voted = tally.totalVoted;
  const quorum = bonded > 0 ? voted / bonded : 0;
  const quorumMet = quorum >= quorumRequired;
  const remainingForQuorum = Math.max(0, bonded * quorumRequired - voted);
  const unvotedStake = Math.max(0, bonded - voted);

  const nonAbstain = tally.yes + tally.no + tally.noWithVeto;
  const yesShare = nonAbstain > 0 ? tally.yes / nonAbstain : 0;
  const vetoShare = nonAbstain > 0 ? tally.noWithVeto / nonAbstain : 0;

  if (!quorumMet) {
    return {
      outcome: "failing-quorum",
      reason: `Quorum not met. ${formatTX(remainingForQuorum)} more bonded stake needs to vote to reach the ${(quorumRequired * 100).toFixed(0)}% quorum.`,
      quorumMet,
      remainingForQuorum,
      unvotedStake,
    };
  }
  if (vetoShare >= vetoThreshold) {
    return {
      outcome: "failing-veto",
      reason: `Veto share is ${(vetoShare * 100).toFixed(1)}%, above the ${(vetoThreshold * 100).toFixed(1)}% veto threshold. The proposal will fail and the deposit will be burned if this holds.`,
      quorumMet,
      remainingForQuorum,
      unvotedStake,
    };
  }
  if (yesShare >= yesThresholdRequired) {
    return {
      outcome: "passing",
      reason: `Yes share is ${(yesShare * 100).toFixed(1)}% of non-abstain votes, above the ${(yesThresholdRequired * 100).toFixed(0)}% threshold. Will pass if numbers hold.`,
      quorumMet,
      remainingForQuorum,
      unvotedStake,
    };
  }
  return {
    outcome: "failing-threshold",
    reason: `Yes share is ${(yesShare * 100).toFixed(1)}%, below the ${(yesThresholdRequired * 100).toFixed(0)}% threshold. Will fail unless Yes share rises.`,
    quorumMet,
    remainingForQuorum,
    unvotedStake,
  };
}
